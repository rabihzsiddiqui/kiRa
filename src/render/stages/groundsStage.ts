import * as THREE from 'three';
import type { ArenaLayout } from '../../app/arena';
import { planarTo3 } from '../../physics/space';
import { disposeTree } from './dispose';
import {
  archeryTarget,
  banner,
  barrel,
  castle,
  column,
  crate,
  flameTexture,
  forest,
  hayBale,
  house,
  pavilion,
  propMaterials,
  stoneWall,
  tufts,
  wallTuftSpots,
  weaponRack,
  type Banner,
} from './groundsProps';
import { skyDome, type SkyLook } from './sky';
import type { BuiltStage, StageOptions } from './Stage';
import { CASTLE, VILLAGE, scatterTrees, terrainHeight, terrainMesh, type TerrainLook } from './terrain';
import { canvasTexture, rng, sandTexture } from './textures';

/** Everything that changes between day and dusk. The meshes are the same. */
interface GroundsPreset {
  name: string;
  sky: SkyLook;
  /** Toward the sun, three.js axes. */
  sunDir: THREE.Vector3;
  sunColor: number;
  sunIntensity: number;
  hemi: { sky: number; ground: number; intensity: number };
  fog: { color: number; near: number; far: number };
  exposure: number;
  bloom: { strength: number; threshold: number };
  envIntensity: number;
  terrain: TerrainLook;
  greens: { pine: number; leaf: number };
  /** Braziers burning, with a warm light each. */
  lit: boolean;
  windowGlow: number;
}

const DAY: GroundsPreset = {
  name: 'grounds',
  sky: {
    zenith: 0x3f7fd4,
    horizon: 0xc9dff0,
    ground: 0xb7c9d6,
    sun: 0xfff1d6,
    cloud: 0xf4f6fa,
    cloudShade: 0xb3c0d4,
    cover: 0.42,
    sunGlow: 9,
  },
  // Behind the spawn camera and to the right, high: the yard and her face are lit.
  sunDir: new THREE.Vector3(0.62, 0.66, 0.42).normalize(),
  sunColor: 0xfff0d8,
  sunIntensity: 3.6,
  hemi: { sky: 0xbcd6ff, ground: 0x7a6a48, intensity: 0.9 },
  fog: { color: 0xc4d7e6, near: 60, far: 560 },
  exposure: 1.0,
  bloom: { strength: 0.32, threshold: 1.05 },
  envIntensity: 0.55,
  terrain: { grass: 0x5f8f3c, grassDry: 0x9a9a52, rock: 0x8a8580, snow: 0xf4f6fa },
  greens: { pine: 0x2f5a35, leaf: 0x4f7f34 },
  lit: false,
  windowGlow: 0,
};

const DUSK: GroundsPreset = {
  name: 'dusk',
  sky: {
    zenith: 0x2a2d6a,
    horizon: 0xf2a066,
    ground: 0xb7837a,
    sun: 0xffb070,
    cloud: 0xf3a98a,
    cloudShade: 0x5d5287,
    cover: 0.48,
    sunGlow: 7,
  },
  // Low, ahead and to the left: the sun sets beyond the castle.
  sunDir: new THREE.Vector3(-0.78, 0.12, -0.62).normalize(),
  sunColor: 0xffb05c,
  sunIntensity: 2.8,
  hemi: { sky: 0x8a90c8, ground: 0x56402e, intensity: 0.85 },
  fog: { color: 0xd09a82, near: 50, far: 480 },
  exposure: 1.12,
  bloom: { strength: 0.4, threshold: 0.95 },
  envIntensity: 0.6,
  terrain: { grass: 0x51703a, grassDry: 0x8b7a4a, rock: 0x7d6f72, snow: 0xf6d6c8 },
  greens: { pine: 0x2b4a33, leaf: 0x46662f },
  lit: true,
  windowGlow: 1.6,
};

/** Rough average of the sky dome's brightness: horizon, zenith and the haze below. */
function skyLuma(sky: SkyLook): number {
  const l = (hex: number) => {
    const c = new THREE.Color(hex);
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  };
  return (l(sky.horizon) + l(sky.zenith) + l(sky.ground)) / 3;
}

export const buildGroundsDay = (layout: ArenaLayout, opts: StageOptions) => buildGrounds(layout, opts, DAY);
export const buildGroundsDusk = (layout: ArenaLayout, opts: StageOptions) => buildGrounds(layout, opts, DUSK);

/**
 * Training grounds in a fantasy valley: a sand yard inside low stone walls, the four
 * pillars as stone columns with braziers and banners, practice gear outside the walls,
 * woods, a village, a castle on a hill and mountains in the haze.
 */
function buildGrounds(layout: ArenaLayout, opts: StageOptions, p: GroundsPreset): BuiltStage {
  const root = new THREE.Group();
  root.name = `stage:${p.name}`;
  const half = layout.half;
  const wallLen = Math.max(...layout.walls.map((w) => Math.max(w.half.x, w.half.y) * 2));
  const mats = propMaterials(p.windowGlow, p.lit, Math.round(wallLen / 1.2));
  const updates: Array<(t: number) => void> = [];

  // ---- light
  root.add(new THREE.HemisphereLight(p.hemi.sky, p.hemi.ground, p.hemi.intensity));
  const sun = new THREE.DirectionalLight(p.sunColor, p.sunIntensity);
  sun.position.copy(p.sunDir).multiplyScalar(60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  const reach = half + 6; // the yard and the props just outside it
  sc.left = -reach;
  sc.right = reach;
  sc.top = reach;
  sc.bottom = -reach;
  sc.near = 1;
  sc.far = 140;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  root.add(sun);

  // ---- sky (one dome for the view, a twin for image based lighting)
  const sky = skyDome(p.sky, p.sunDir);
  root.add(sky.mesh);
  const envScene = new THREE.Scene();
  envScene.add(skyDome(p.sky, p.sunDir).mesh);
  updates.push((t) => (sky.uniforms.uTime.value = opts.reducedMotion ? 0 : t));

  // ---- land
  root.add(terrainMesh(p.terrain));
  const sandTex = sandTexture(8);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2, half * 2),
    new THREE.MeshStandardMaterial({ color: sandTex ? 0xd2b48a : 0xc9a978, map: sandTex, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  root.add(floor);
  // A ring of flagstones set into the sand, and a worn patch where the dummy stands.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(10.4, 11.0, 128, 1),
    new THREE.MeshStandardMaterial({ color: 0xb9b0a2, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.002;
  ring.receiveShadow = true;
  root.add(ring);
  // alphaMap reads the green channel, so this is drawn in greys on black.
  const worn = canvasTexture(
    128,
    (g, s) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, s, s);
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgb(120,120,120)');
      grad.addColorStop(0.55, 'rgb(70,70,70)');
      grad.addColorStop(1, 'rgb(0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    },
    { color: false },
  );
  if (worn) {
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 40),
      new THREE.MeshStandardMaterial({
        color: 0x9a7650,
        alphaMap: worn,
        transparent: true,
        depthWrite: false,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    const d = planarTo3(layout.dummy.position, 0.003);
    patch.position.set(d.x, d.y, d.z);
    patch.rotation.x = -Math.PI / 2;
    patch.receiveShadow = true;
    root.add(patch);
  }

  // ---- walls, from the same boxes as the colliders
  for (const w of layout.walls) {
    const c = planarTo3(w.center, 0);
    const alongX = w.half.x >= w.half.y;
    const length = Math.max(w.half.x, w.half.y) * 2;
    const thickness = Math.min(w.half.x, w.half.y) * 2;
    const outward = Math.sign(alongX ? c.z : c.x) || 1;
    const wall = stoneWall(length, w.height, thickness, mats, outward);
    wall.position.set(c.x, 0, c.z);
    if (!alongX) wall.rotation.y = Math.PI / 2;
    root.add(wall);
  }

  // ---- pillars: columns with braziers, a banner on the side facing the middle
  const banners: Banner[] = [];
  const flame = p.lit ? flameTexture() : null;
  layout.pillars.forEach((pl, i) => {
    const c = planarTo3(pl.center, 0);
    const col = column(pl.height, mats);
    col.group.position.set(c.x, 0, c.z);
    root.add(col.group);

    const inward = new THREE.Vector3(-c.x, 0, -c.z).normalize();
    const b = banner(0.9, 2.4, mats, opts.reducedMotion, i * 1.7);
    const by = pl.height - 0.95;
    b.group.position.set(c.x + inward.x * 0.68, by, c.z + inward.z * 0.68);
    b.group.rotation.y = Math.atan2(inward.x, inward.z);
    root.add(b.group);
    banners.push(b);
    // Iron arm from the shaft out to the rod.
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), mats.iron);
    arm.position.set(c.x + inward.x * 0.55, by + 0.02, c.z + inward.z * 0.55);
    arm.rotation.y = b.group.rotation.y;
    root.add(arm);

    if (p.lit) {
      const light = new THREE.PointLight(0xff9a4a, 5, 16, 1.6);
      light.position.set(c.x, col.fireY + 0.35, c.z);
      root.add(light);
      const sprites = [0, 1].map((k) => {
        const s = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: flame, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
        );
        s.position.set(c.x, col.fireY + 0.3 + k * 0.12, c.z);
        s.scale.set(0.8 - k * 0.25, 1.0 - k * 0.3, 1);
        root.add(s);
        return s;
      });
      const seed = i * 2.31;
      updates.push((t) => {
        if (opts.reducedMotion) return;
        const f = 0.85 + 0.1 * Math.sin(t * 11 + seed) + 0.06 * Math.sin(t * 23.7 + seed * 3);
        sprites.forEach((s, k) => s.scale.set((0.8 - k * 0.25) * (0.9 + f * 0.1), (1.0 - k * 0.3) * f, 1));
        light.intensity = 5 * f;
      });
    }
  });
  updates.push((t) => banners.forEach((b) => b.update(t)));

  // ---- grass at the foot of the walls and pillars
  const spots = wallTuftSpots(half, 260, 77);
  const r = rng(78);
  for (const pl of layout.pillars) {
    const c = planarTo3(pl.center, 0);
    for (let k = 0; k < 10; k++) {
      const a = r() * Math.PI * 2;
      const rad = 0.72 + r() * 0.25;
      spots.push({ x: c.x + Math.cos(a) * rad, z: c.z + Math.sin(a) * rad, s: 0.5 + r() * 0.6 });
    }
  }
  root.add(tufts(spots, p.terrain.grass));

  // ---- practice gear just outside the walls. Front (+z) of each faces the yard.
  const out = half + 1.5;
  const props: Array<[THREE.Group, number, number]> = [
    [archeryTarget(mats), -6, -out - 0.8],
    [archeryTarget(mats), 5, -out - 1.0],
    [hayBale(mats), -0.5, -out],
    [hayBale(mats), 10, -out - 0.2],
    [weaponRack(mats), -11, -out + 0.2],
    [weaponRack(mats), out, -4],
    [weaponRack(mats), out, 4],
    [barrel(mats), out + 0.2, 9],
    [barrel(mats), out + 0.9, 9.6],
    [crate(mats), out + 0.3, -10],
    [crate(mats, 0.55), out + 0.4, -10.9],
    [hayBale(mats), -out, 3],
    [hayBale(mats), -out - 0.3, 4.3],
    [archeryTarget(mats), -out - 1.2, 10],
    [crate(mats), -out, -9],
    [barrel(mats), -out - 0.6, -8],
    [weaponRack(mats), 0, out],
    [pavilion(mats), -8.5, out + 4.5],
    [pavilion(mats), 8.5, out + 4.5],
    [barrel(mats), 3.5, out + 0.3],
  ];
  for (const [g, x, z] of props) {
    g.position.set(x, 0, z);
    g.rotation.y = Math.atan2(-x, -z);
    root.add(g);
  }
  // A second bale stacked on the first of each pair.
  const stacked = hayBale(mats);
  stacked.position.set(-0.4, 0.5, -out);
  stacked.rotation.y = 0.2;
  root.add(stacked);

  // ---- village to the right
  const vr = rng(91);
  for (let i = 0; i < 8; i++) {
    const a = VILLAGE.fromAngle + ((i + 0.5) / 8) * (VILLAGE.toAngle - VILLAGE.fromAngle) + (vr() - 0.5) * 0.08;
    const rad = VILLAGE.minR + vr() * (VILLAGE.maxR - VILLAGE.minR);
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    const h = house(3.6 + vr() * 2.4, 3.6 + vr() * 1.6, 2.6 + vr() * 1.4, mats, vr() < 0.4);
    h.position.set(x, terrainHeight(x, z) - 0.03, z);
    h.rotation.y = Math.atan2(-x, -z) + (vr() - 0.5) * 0.5;
    root.add(h);
  }

  // ---- castle on its hill, turned to face the yard
  const keep = castle(mats);
  keep.position.set(CASTLE.x, terrainHeight(CASTLE.x, CASTLE.z) - 0.5, CASTLE.z);
  keep.scale.setScalar(CASTLE.scale);
  keep.rotation.y = Math.atan2(-CASTLE.x, -CASTLE.z);
  root.add(keep);

  // ---- woods
  root.add(forest(scatterTrees(300, 5, 25, 170), scatterTrees(160, 6, 24, 120), p.greens));

  return {
    root,
    background: null,
    fog: new THREE.Fog(p.fog.color, p.fog.near, p.fog.far),
    exposure: p.exposure,
    bloom: p.bloom,
    envScene,
    envIntensity: p.envIntensity,
    envLuma: skyLuma(p.sky),
    update: (t) => updates.forEach((u) => u(t)),
    dispose: () => {
      disposeTree(root);
      disposeTree(envScene);
    },
  };
}
