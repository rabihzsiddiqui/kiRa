import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, rng, stoneBlockTexture, stoneGrainTexture, woodTexture } from './textures';
import type { Scatter } from './terrain';

/*
 * Pieces of the training grounds, built from three.js primitives. Each function returns
 * meshes with their origin on the ground; groundsStage.ts places them.
 */

export interface PropMaterials {
  stone: THREE.MeshStandardMaterial;
  stoneBlocks: THREE.MeshStandardMaterial;
  stoneCap: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  woodDark: THREE.MeshStandardMaterial;
  bronze: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  straw: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  roofAlt: THREE.MeshStandardMaterial;
  window: THREE.MeshStandardMaterial;
  cloth: THREE.MeshStandardMaterial;
  indigo: THREE.MeshStandardMaterial;
  embers: THREE.MeshStandardMaterial;
}

export function propMaterials(windowGlow: number, embersLit: boolean, wallRepeat: number): PropMaterials {
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...p });
  const blocks = stoneBlockTexture();
  if (blocks) blocks.repeat.set(wallRepeat, 1);
  const grain = stoneGrainTexture();
  const wood = woodTexture();
  return {
    stone: std({ color: 0xd8d0c4, map: grain, vertexColors: true }),
    stoneBlocks: std({ color: 0xc9c0b2, map: blocks }),
    stoneCap: std({ color: 0xbdb4a6, map: grain }),
    wood: std({ color: 0x8a5d38, map: wood, roughness: 0.9 }),
    woodDark: std({ color: 0x5a3d26, map: wood, roughness: 0.9 }),
    bronze: std({ color: 0x9c7442, metalness: 0.75, roughness: 0.42 }),
    iron: std({ color: 0x3f3f46, metalness: 0.7, roughness: 0.5 }),
    straw: std({ color: 0xd9b866, roughness: 1 }),
    plaster: std({ color: 0xe9dfca, roughness: 0.95 }),
    roof: std({ color: 0x48507a, roughness: 0.8 }),
    roofAlt: std({ color: 0x3b3a6e, roughness: 0.8 }),
    window: std({ color: 0x1c1f2e, emissive: 0xffb057, emissiveIntensity: windowGlow, roughness: 0.4 }),
    cloth: std({ color: 0xf1e9d8, roughness: 0.95, side: THREE.DoubleSide }),
    indigo: std({ color: 0x3f3a9e, roughness: 0.9, side: THREE.DoubleSide }),
    embers: std({ color: 0x2a1a12, emissive: 0xff6a1f, emissiveIntensity: embersLit ? 2.2 : 0.15, roughness: 1 }),
  };
}

function place<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, shadow = true): T {
  o.position.set(x, y, z);
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = shadow;
      c.receiveShadow = true;
    }
  });
  return o;
}

const m = (geo: THREE.BufferGeometry, mat: THREE.Material) => new THREE.Mesh(geo, mat);

/** Vertex colors that darken toward the ground, so stone looks weathered at its foot. */
function weather(geo: THREE.BufferGeometry, yOffset: number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + yOffset;
    const k = 0.72 + 0.28 * Math.min(1, Math.max(0, y / 1.3));
    colors[i * 3] = k;
    colors[i * 3 + 1] = k * 0.99;
    colors[i * 3 + 2] = k * 0.95;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

const lathe = (pts: Array<[number, number]>, segments = 40) =>
  new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segments);

// ------------------------------------------------------------------ column

export interface ColumnParts {
  group: THREE.Group;
  /** Top of the brazier's coals, where flames and the light go. */
  fireY: number;
}

/**
 * A classical stone column: round plinth, molded base, a fluted shaft with a slight swell
 * (entasis), a flared capital under a square abacus, and a bronze brazier on top.
 * The plinth's radius is the collider's (0.6) plus a few cm, so she never walks into stone.
 */
export function column(height: number, mats: PropMaterials): ColumnParts {
  const g = new THREE.Group();
  g.name = 'pillar';
  const plinth = weather(new THREE.CylinderGeometry(0.63, 0.65, 0.24, 40), 0.12);
  g.add(place(m(plinth, mats.stone), 0, 0.12, 0));
  g.add(place(m(weather(lathe([[0.64, 0.24], [0.62, 0.3], [0.58, 0.36], [0.52, 0.4], [0.5, 0.44]]), 0), mats.stone), 0, 0, 0));

  const shaftBottom = 0.44;
  const shaftTop = height - 0.76;
  const shaftH = shaftTop - shaftBottom;
  const shaft = new THREE.CylinderGeometry(0.43, 0.5, shaftH, 96, 12, true);
  const pos = shaft.getAttribute('position');
  const FLUTES = 20;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const t = (pos.getY(i) + shaftH / 2) / shaftH;
    const a = Math.atan2(z, x);
    const flute = 1 - 0.035 * Math.pow(0.5 + 0.5 * Math.cos(a * FLUTES), 0.6);
    const swell = 1 + 0.025 * Math.sin(Math.PI * t);
    pos.setX(i, x * flute * swell);
    pos.setZ(i, z * flute * swell);
  }
  shaft.computeVertexNormals();
  weather(shaft, shaftBottom + shaftH / 2);
  g.add(place(m(shaft, mats.stone), 0, shaftBottom + shaftH / 2, 0));

  const cap = lathe(
    [[0.43, 0], [0.47, 0.03], [0.47, 0.08], [0.44, 0.11], [0.45, 0.3], [0.52, 0.42], [0.6, 0.5], [0.65, 0.56]],
    48,
  );
  g.add(place(m(weather(cap, shaftTop), mats.stone), 0, shaftTop, 0));
  const abacus = new THREE.BoxGeometry(1.36, 0.2, 1.36);
  g.add(place(m(weather(abacus, height), mats.stone), 0, height - 0.1, 0));

  // Brazier: a stem and a shallow bronze bowl of coals.
  g.add(place(m(new THREE.CylinderGeometry(0.09, 0.14, 0.18, 16), mats.bronze), 0, height + 0.09, 0));
  const bowl = lathe([[0.001, 0], [0.16, 0], [0.22, 0.05], [0.38, 0.19], [0.46, 0.31], [0.44, 0.34], [0.36, 0.24], [0.001, 0.12]], 32);
  g.add(place(m(bowl, mats.bronze), 0, height + 0.16, 0));
  const coals = new THREE.CircleGeometry(0.38, 24);
  coals.rotateX(-Math.PI / 2);
  g.add(place(m(coals, mats.embers), 0, height + 0.43, 0, false));
  return { group: g, fireY: height + 0.46 };
}

// ------------------------------------------------------------------ banner

export interface Banner {
  group: THREE.Group;
  update(time: number): void;
}

/** Indigo banner with gold trim and a sword emblem, swallowtail hem. */
export function bannerTexture(): THREE.Texture | null {
  return canvasTexture(
    256,
    (g, s) => {
      const w = s * 0.5; // the banner is twice as tall as wide; we draw in the middle half
      const x0 = (s - w) / 2;
      g.clearRect(0, 0, s, s);
      g.save();
      g.beginPath();
      g.moveTo(x0, 0);
      g.lineTo(x0 + w, 0);
      g.lineTo(x0 + w, s);
      g.lineTo(x0 + w / 2, s * 0.86);
      g.lineTo(x0, s);
      g.closePath();
      g.clip();
      const grad = g.createLinearGradient(0, 0, 0, s);
      grad.addColorStop(0, '#2e2a7a');
      grad.addColorStop(1, '#3f3a9e');
      g.fillStyle = grad;
      g.fillRect(x0, 0, w, s);
      // Gold trim down the sides and along the hem.
      g.strokeStyle = '#d4a24c';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(x0 + 8, 0);
      g.lineTo(x0 + 8, s - 12);
      g.lineTo(x0 + w / 2, s * 0.86 - 10);
      g.lineTo(x0 + w - 8, s - 12);
      g.lineTo(x0 + w - 8, 0);
      g.stroke();
      // Emblem: a gold ring with a blade through it, and a small square at its foot.
      const cx = x0 + w / 2;
      const cy = s * 0.38;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(cx, cy, w * 0.28, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#e9c37a';
      g.fillRect(cx - 2.5, cy - w * 0.42, 5, w * 0.72);
      g.fillRect(cx - 14, cy + w * 0.12, 28, 4);
      g.fillRect(cx - 5, cy + w * 0.48, 10, 10);
      g.restore();
    },
    {},
  );
}

/**
 * A cloth banner hung from an iron rod. The cloth waves on real time (CPU, a few dozen
 * vertices): more toward the hem, nothing at the rod. Still under reduced motion.
 */
export function banner(width: number, length: number, mats: PropMaterials, reducedMotion: boolean, phase: number): Banner {
  const g = new THREE.Group();
  const tex = bannerTexture();
  // The texture's banner fills the middle half of the canvas; crop to it.
  if (tex) {
    tex.repeat.set(0.5, 1);
    tex.offset.set(0.25, 0);
  }
  const mat = new THREE.MeshStandardMaterial({
    color: tex ? 0xffffff : 0x3f3a9e,
    map: tex,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.9,
  });
  const geo = new THREE.PlaneGeometry(width, length, 6, 18);
  geo.translate(0, -length / 2, 0); // hang from the top edge
  const cloth = m(geo, mat);
  cloth.castShadow = true;
  cloth.receiveShadow = true;
  g.add(cloth);
  const rod = new THREE.CylinderGeometry(0.025, 0.025, width + 0.2, 8);
  rod.rotateZ(Math.PI / 2);
  g.add(place(m(rod, mats.iron), 0, 0.02, 0));
  for (const sx of [-1, 1]) g.add(place(m(new THREE.SphereGeometry(0.045, 10, 8), mats.bronze), sx * (width / 2 + 0.1), 0.02, 0));

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const base = Float32Array.from(pos.array as Float32Array);
  const wave = (time: number) => {
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const y = base[i * 3 + 1];
      const hang = -y / length; // 0 at the rod, 1 at the hem
      const z =
        Math.sin(time * 1.6 + y * 2.4 + phase) * 0.07 * hang +
        Math.sin(time * 2.9 + x * 4 + y * 1.3 + phase * 2) * 0.025 * hang +
        0.05 * hang * hang; // the wind leans it out a little
      pos.setZ(i, z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  };
  wave(0);
  return { group: g, update: reducedMotion ? () => {} : wave };
}

// ------------------------------------------------------------------ walls

/** Low stone wall along a box, with a cap course on top and piers along its length. */
export function stoneWall(length: number, height: number, thickness: number, mats: PropMaterials, outward: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'wall';
  g.add(place(m(new THREE.BoxGeometry(length, height, thickness), mats.stoneBlocks), 0, height / 2, 0));
  // Cap course: a slight lip, small enough that nothing pokes past the collider.
  g.add(place(m(new THREE.BoxGeometry(length + 0.1, 0.12, thickness + 0.08), mats.stoneCap), 0, height + 0.06, 0));
  // Piers every 4 m, pushed outward so the shaft sits 4 cm behind the courtyard face and the
  // wider cap ends on the collider plane. Flush faces z-fight and flicker.
  const piers = Math.round(length / 4);
  const pierOffset = 0.44 - thickness / 2;
  for (let i = 0; i <= piers; i++) {
    const x = -length / 2 + (i / piers) * length;
    const pier = new THREE.Group();
    pier.add(place(m(new THREE.BoxGeometry(0.8, height + 0.3, 0.8), mats.stoneBlocks), 0, (height + 0.3) / 2, 0));
    pier.add(place(m(new THREE.BoxGeometry(0.88, 0.14, 0.88), mats.stoneCap), 0, height + 0.37, 0));
    pier.add(place(m(new THREE.SphereGeometry(0.16, 12, 8), mats.stoneCap), 0, height + 0.56, 0));
    pier.position.set(x, 0, outward * pierOffset);
    g.add(pier);
  }
  return g;
}

// ------------------------------------------------------------------ trees

const toNonIndexed = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geo = mergeGeometries(parts.map(toNonIndexed));
  if (!geo) throw new Error('could not merge tree geometry');
  return geo;
}

/**
 * Woods as two instanced meshes per kind (foliage and trunk), so hundreds of trees cost
 * four draw calls. Flat shaded for a clean, low-poly look.
 */
export function forest(conifers: Scatter[], broadleaf: Scatter[], greens: { pine: number; leaf: number }): THREE.Group {
  const g = new THREE.Group();
  g.name = 'forest';
  const cone = (r: number, h: number, y: number) => new THREE.ConeGeometry(r, h, 7).translate(0, y, 0);
  const pineFoliage = merged([cone(1.7, 2.8, 2.4), cone(1.35, 2.4, 3.6), cone(0.95, 2.0, 4.7), cone(0.5, 1.4, 5.6)]);
  const pineTrunk = new THREE.CylinderGeometry(0.16, 0.24, 1.8, 6).translate(0, 0.9, 0);
  const blob = (r: number, x: number, y: number, z: number) => new THREE.IcosahedronGeometry(r, 1).translate(x, y, z);
  const leafFoliage = merged([blob(1.7, 0, 3.4, 0), blob(1.25, 0.95, 3.9, 0.35), blob(1.2, -0.8, 3.7, -0.45), blob(1.0, 0.1, 4.6, -0.2)]);
  const leafTrunk = new THREE.CylinderGeometry(0.2, 0.3, 2.8, 6).translate(0, 1.4, 0);

  const foliageMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.95 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d26, flatShading: true, roughness: 1 });
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, spots: Scatter[], base: number | null) => {
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.yaw, 0);
      dummy.scale.set(s.scale, s.scale * (0.9 + s.tint * 0.3), s.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (base !== null) {
        color.setHex(base).offsetHSL((s.tint - 0.5) * 0.04, (s.tint - 0.5) * 0.15, (s.tint - 0.5) * 0.12);
        mesh.setColorAt(i, color);
      }
    });
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  };
  g.add(
    instanced(pineFoliage, foliageMat, conifers, greens.pine),
    instanced(pineTrunk, trunkMat, conifers, null),
    instanced(leafFoliage, foliageMat, broadleaf, greens.leaf),
    instanced(leafTrunk, trunkMat, broadleaf, null),
  );
  return g;
}

/** Little grass tufts for the edges of the yard: three thin blades each. */
export function tufts(spots: Array<{ x: number; z: number; s: number }>, color: number): THREE.InstancedMesh {
  const blade = (a: number, lean: number) => {
    const b = new THREE.ConeGeometry(0.03, 0.28, 3).translate(0, 0.14, 0);
    b.rotateZ(lean);
    b.rotateY(a);
    return b;
  };
  const geo = merged([blade(0, 0.25), blade(2.1, -0.3), blade(4.2, 0.15), blade(1.0, 0)]);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }), spots.length);
  const d = new THREE.Object3D();
  spots.forEach((p, i) => {
    d.position.set(p.x, 0, p.z);
    d.rotation.set(0, p.x * 13.1 + p.z * 7.7, 0);
    d.scale.setScalar(p.s);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  });
  mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ village

/** Triangular prism, ridge along x. Width w (x), base depth d (z), height h. */
function prism(w: number, d: number, h: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0);
  shape.lineTo(d / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geo.translate(0, 0, -w / 2);
  geo.rotateY(Math.PI / 2);
  return geo;
}

/** A timber framed cottage: plaster walls, beams, a steep slate roof, door, windows, chimney. */
export function house(w: number, d: number, h: number, mats: PropMaterials, altRoof: boolean): THREE.Group {
  const g = new THREE.Group();
  g.add(place(m(new THREE.BoxGeometry(w, h, d), mats.plaster), 0, h / 2, 0, false));
  // Beams: a band at the floor line and the eaves, and corner posts.
  for (const y of [h * 0.48, h - 0.08]) g.add(place(m(new THREE.BoxGeometry(w + 0.06, 0.16, d + 0.06), mats.woodDark), 0, y, 0, false));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(place(m(new THREE.BoxGeometry(0.18, h, 0.18), mats.woodDark), sx * (w / 2 - 0.06), h / 2, sz * (d / 2 - 0.06), false));
  }
  const roofH = d * 0.62;
  // Extrude groups: 0 is the two end caps (plaster gables), 1 the sloped sides (slate).
  const roof = new THREE.Mesh(prism(w + 0.7, d + 0.8, roofH), [mats.plaster, altRoof ? mats.roofAlt : mats.roof]);
  g.add(place(roof, 0, h, 0, false));
  g.add(place(m(new THREE.BoxGeometry(0.5, 1.6, 0.5), mats.stoneCap), w * 0.28, h + roofH * 0.6, -d * 0.18, false));
  // Front (+z): a door and two windows.
  g.add(place(m(new THREE.BoxGeometry(0.95, 1.8, 0.08), mats.woodDark), 0, 0.9, d / 2 + 0.02, false));
  for (const sx of [-1, 1]) {
    g.add(place(m(new THREE.BoxGeometry(0.62, 0.62, 0.06), mats.window), sx * w * 0.3, h * 0.72, d / 2 + 0.02, false));
    g.add(place(m(new THREE.BoxGeometry(0.62, 0.62, 0.06), mats.window), sx * w * 0.3, h * 0.24 + 0.6, d / 2 + 0.02, false));
  }
  return g;
}

// ------------------------------------------------------------------ castle

/** Crenellations along a straight run, merged into one geometry. */
function merlons(length: number, along: 'x' | 'z', y: number, offset: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = Math.floor(length / 1.8);
  for (let i = 0; i <= n; i++) {
    const t = -length / 2 + (i / n) * length;
    const b = new THREE.BoxGeometry(0.9, 1.0, 0.9);
    b.translate(along === 'x' ? t : offset, y + 0.5, along === 'x' ? offset : t);
    parts.push(b);
  }
  return merged(parts);
}

/**
 * A fairy-tale castle for the skyline: curtain walls with crenellations, round corner
 * towers with conical indigo roofs, a gatehouse, a keep and one tall spire tower.
 * Faces +z (toward the yard) once placed.
 */
export function castle(mats: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'castle';
  const stone = new THREE.MeshStandardMaterial({ color: 0xd9d2c6, roughness: 0.9 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x4a4796, roughness: 0.7 });
  const W = 46;
  const D = 32;
  const H = 10;
  for (const [x, z, w, d] of [
    [0, D / 2, W, 2.4],
    [0, -D / 2, W, 2.4],
    [W / 2, 0, 2.4, D],
    [-W / 2, 0, 2.4, D],
  ] as const) {
    g.add(place(m(new THREE.BoxGeometry(w, H, d), stone), x, H / 2, z, false));
    g.add(m(merlons(w > d ? w : d, w > d ? 'x' : 'z', H, w > d ? z : x), stone));
  }
  const tower = (x: number, z: number, r: number, h: number, roofH: number) => {
    g.add(place(m(new THREE.CylinderGeometry(r, r * 1.05, h, 20), stone), x, h / 2, z, false));
    g.add(place(m(new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.8, 20), stone), x, h + 0.4, z, false));
    g.add(place(m(new THREE.ConeGeometry(r * 1.25, roofH, 20), roof), x, h + 0.8 + roofH / 2, z, false));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.3, 0.3), mats.window);
      win.position.set(x + Math.cos(a) * r, h * 0.7, z + Math.sin(a) * r);
      win.rotation.y = -a + Math.PI / 2;
      g.add(win);
    }
  };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) tower((sx * W) / 2, (sz * D) / 2, 3.6, 15, 7.5);
  // Gatehouse on the front wall.
  for (const sx of [-1, 1]) tower(sx * 4.2, D / 2 + 0.6, 2.6, 13, 5.5);
  g.add(place(m(new THREE.BoxGeometry(4.2, 5.2, 0.4), mats.woodDark), 0, 2.6, D / 2 + 1.3, false));
  // Keep, and the spire tower rising out of it.
  g.add(place(m(new THREE.BoxGeometry(16, 20, 13), stone), -3, 10, -5, false));
  g.add(m(merlons(16, 'x', 20, 1.5), stone).translateX(-3));
  g.add(place(m(prism(16.6, 13.6, 6), roof), -3, 20, -5, false));
  tower(6, -6, 3.2, 32, 11);
  // A pennant on the spire.
  const pole = new THREE.CylinderGeometry(0.08, 0.08, 3, 6);
  g.add(place(m(pole, mats.iron), 6, 32 + 0.8 + 11 + 1.2, -6, false));
  const flag = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(2.4, -0.45, 0), new THREE.Vector3(0, -0.9, 0)]);
  flag.computeVertexNormals();
  g.add(place(m(flag, mats.indigo), 6.05, 32 + 0.8 + 11 + 2.6, -6, false));
  return g;
}

// ------------------------------------------------------------------ yard props

/** Weapon rack: two posts, rails, wooden practice swords and two spears leaning on it. */
export function weaponRack(mats: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) g.add(place(m(new THREE.BoxGeometry(0.1, 1.6, 0.1), mats.wood), sx * 0.95, 0.8, 0));
  g.add(place(m(new THREE.BoxGeometry(2.0, 0.08, 0.1), mats.wood), 0, 1.35, 0));
  g.add(place(m(new THREE.BoxGeometry(2.0, 0.08, 0.22), mats.woodDark), 0, 0.25, 0));
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Group();
    s.add(place(m(new THREE.BoxGeometry(0.05, 1.05, 0.025), mats.wood), 0, 0.52, 0));
    s.add(place(m(new THREE.BoxGeometry(0.2, 0.04, 0.05), mats.woodDark), 0, 0.32, 0));
    s.position.set(-0.65 + i * 0.32, 0.29, 0.06);
    s.rotation.x = -0.18;
    g.add(s);
  }
  for (const x of [0.62, 0.8]) {
    const spear = new THREE.Group();
    spear.add(place(m(new THREE.CylinderGeometry(0.022, 0.022, 2.3, 6), mats.wood), 0, 1.15, 0));
    spear.add(place(m(new THREE.ConeGeometry(0.05, 0.25, 6), mats.iron), 0, 2.42, 0));
    spear.position.set(x, 0.29, 0.08);
    spear.rotation.x = -0.12;
    g.add(spear);
  }
  return g;
}

/** Square straw bale with two twine bands. */
export function hayBale(mats: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  g.add(place(m(new THREE.BoxGeometry(1.1, 0.5, 0.6), mats.straw), 0, 0.25, 0));
  for (const x of [-0.28, 0.28]) g.add(place(m(new THREE.BoxGeometry(0.03, 0.52, 0.62), mats.woodDark), x, 0.25, 0));
  return g;
}

export function barrel(mats: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  g.add(place(m(lathe([[0.001, 0], [0.3, 0], [0.36, 0.25], [0.37, 0.45], [0.36, 0.65], [0.3, 0.9], [0.001, 0.9]], 18), mats.wood), 0, 0, 0));
  for (const y of [0.16, 0.74]) {
    const hoop = new THREE.TorusGeometry(0.345, 0.018, 6, 20);
    hoop.rotateX(Math.PI / 2);
    g.add(place(m(hoop, mats.iron), 0, y, 0));
  }
  return g;
}

export function crate(mats: PropMaterials, size = 0.7): THREE.Group {
  const g = new THREE.Group();
  g.add(place(m(new THREE.BoxGeometry(size, size, size), mats.wood), 0, size / 2, 0));
  const e = size + 0.02;
  for (const y of [0.04, size - 0.04]) g.add(place(m(new THREE.BoxGeometry(e, 0.07, e), mats.woodDark), 0, y, 0));
  return g;
}

/** Straw archery target on a three-legged easel, rings painted on its face, two arrows in it. */
export function archeryTarget(mats: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  for (const [x, z, rx, rz] of [[-0.5, 0.15, 0.1, -0.2], [0.5, 0.15, 0.1, 0.2], [0, -0.45, -0.3, 0]] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.9, 6), mats.wood);
    leg.position.set(x * 0.7, 0.92, z);
    leg.rotation.set(rx, 0, rz);
    g.add(place(leg, leg.position.x, leg.position.y, leg.position.z));
  }
  const face = canvasTexture(256, (c, s) => {
    const rings = ['#f1e9d8', '#3f3a9e', '#f1e9d8', '#3f3a9e', '#d4a24c'];
    rings.forEach((col, i) => {
      c.fillStyle = col;
      c.beginPath();
      c.arc(s / 2, s / 2, (s / 2) * (1 - i * 0.19), 0, Math.PI * 2);
      c.fill();
    });
  });
  const disk = new THREE.CylinderGeometry(0.62, 0.62, 0.22, 32);
  disk.rotateX(Math.PI / 2);
  const faceMat = new THREE.MeshStandardMaterial({ color: face ? 0xffffff : 0xd9b866, map: face, roughness: 1 });
  // Cylinder groups: 0 side, 1 top, 2 bottom. After the turn, the top cap faces +z.
  const target = new THREE.Mesh(disk, [mats.straw, faceMat, mats.straw]);
  target.rotation.x = -0.15;
  g.add(place(target, 0, 1.25, 0.2));
  for (const [x, y] of [[0.12, 1.32], [-0.2, 1.1]] as const) {
    const arrow = new THREE.CylinderGeometry(0.008, 0.008, 0.55, 5);
    arrow.rotateX(Math.PI / 2 - 0.1);
    g.add(place(m(arrow, mats.wood), x, y, 0.55));
  }
  return g;
}

/** Striped pavilion tent: eight-sided cloth walls, a conical striped roof, a pennant. */
export function pavilion(mats: PropMaterials): THREE.Group {
  const g = new THREE.Group();
  const stripes = canvasTexture(256, (c, s) => {
    const n = 12;
    for (let i = 0; i < n; i++) {
      c.fillStyle = i % 2 ? '#f1e9d8' : '#3f3a9e';
      c.fillRect((i / n) * s, 0, s / n + 1, s);
    }
    c.fillStyle = '#d4a24c';
    c.fillRect(0, s - 10, s, 10);
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: stripes ? 0xffffff : 0x3f3a9e, map: stripes, roughness: 0.95, side: THREE.DoubleSide });
  g.add(place(m(new THREE.CylinderGeometry(2.3, 2.3, 2.2, 8, 1, true), mats.cloth), 0, 1.1, 0));
  g.add(place(m(new THREE.ConeGeometry(2.75, 2.0, 24, 1, true), roofMat), 0, 3.2, 0));
  // Scalloped valance under the roof edge.
  g.add(place(m(new THREE.CylinderGeometry(2.62, 2.62, 0.35, 24, 1, true), mats.indigo), 0, 2.05, 0));
  // Door flap: an open dark slot facing +z.
  g.add(place(m(new THREE.PlaneGeometry(1.0, 1.9), mats.woodDark), 0, 0.95, 2.25));
  g.add(place(m(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), mats.wood), 0, 4.6, 0));
  const flag = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.9, -0.18, 0), new THREE.Vector3(0, -0.36, 0)]);
  flag.computeVertexNormals();
  g.add(place(m(flag, mats.indigo), 0.03, 5.15, 0));
  return g;
}

/** Soft radial flame sprite texture. */
export function flameTexture(): THREE.Texture | null {
  return canvasTexture(128, (c, s) => {
    const grad = c.createRadialGradient(s / 2, s * 0.62, 0, s / 2, s * 0.55, s / 2);
    grad.addColorStop(0, 'rgba(255,240,200,1)');
    grad.addColorStop(0.3, 'rgba(255,170,70,0.9)');
    grad.addColorStop(0.7, 'rgba(255,90,20,0.35)');
    grad.addColorStop(1, 'rgba(255,60,0,0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, s, s);
  });
}

/** Seeded spots along the inside of the walls, for grass tufts. */
export function wallTuftSpots(half: number, count: number, seed: number): Array<{ x: number; z: number; s: number }> {
  const r = rng(seed);
  const spots: Array<{ x: number; z: number; s: number }> = [];
  for (let i = 0; i < count; i++) {
    const side = Math.floor(r() * 4);
    const along = (r() * 2 - 1) * (half - 0.5);
    const inset = half - 0.35 - r() * 0.5;
    const s = 0.6 + r() * 0.9;
    if (side === 0) spots.push({ x: along, z: inset, s });
    else if (side === 1) spots.push({ x: along, z: -inset, s });
    else if (side === 2) spots.push({ x: inset, z: along, s });
    else spots.push({ x: -inset, z: along, s });
  }
  return spots;
}
