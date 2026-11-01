import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ARENA } from '../src/app/arena';
import { DEFAULT_STAGE, initialStage, parseStage, STAGES, type StageId } from '../src/app/stages';
import { planarTo3 } from '../src/physics/space';
import { faceLighting, STAGE_BUILDERS } from '../src/render/stages';
import { FLAT_RADIUS, scatterTrees, terrainHeight, terrainMesh } from '../src/render/stages/terrain';

/*
 * Stages change the look only. These check the choice logic and that every stage draws
 * walls and pillars exactly where the colliders are, so what she bumps into is what you see.
 */

const build = (id: StageId) => STAGE_BUILDERS[id](ARENA, { reducedMotion: true });

function named(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name === name) out.push(o);
  });
  return out;
}

test('stage choice: url beats the saved choice, which beats the default; junk is ignored', () => {
  assert.equal(parseStage('void'), 'void');
  assert.equal(parseStage('lava'), null);
  assert.equal(parseStage(null), null);
  assert.equal(initialStage('', null), DEFAULT_STAGE);
  assert.equal(initialStage('', 'dusk'), 'dusk');
  assert.equal(initialStage('?stage=void', 'dusk'), 'void');
  assert.equal(initialStage('?stage=nope', 'dusk'), 'dusk', 'a bad url value falls back to the saved one');
  assert.equal(initialStage('?body=classic', 'garbage'), DEFAULT_STAGE);
  assert.equal(DEFAULT_STAGE, 'grounds', 'daytime training grounds by default');
});

test('every stage in the menu has a builder, and menu copy is lowercase with no em dashes', () => {
  assert.deepEqual(STAGES.map((s) => s.id).sort(), Object.keys(STAGE_BUILDERS).sort());
  for (const s of STAGES) {
    for (const text of [s.label, s.blurb]) {
      assert.equal(text, text.toLowerCase(), text);
      assert.ok(!text.includes('—'), text);
    }
  }
});

for (const { id } of STAGES) {
  test(`${id}: walls and pillars sit on their colliders`, () => {
    const stage = build(id);
    stage.root.updateMatrixWorld(true);

    const pillars = named(stage.root, 'pillar');
    assert.equal(pillars.length, ARENA.pillars.length);
    for (const p of ARENA.pillars) {
      const c = planarTo3(p.center, 0);
      const match = pillars.find((o) => {
        const w = o.getWorldPosition(new THREE.Vector3());
        return Math.hypot(w.x - c.x, w.z - c.z) < 1e-6;
      });
      assert.ok(match, `pillar at ${p.center.x}, ${p.center.y}`);
      // Within reach of her feet the stone is as wide as the collider (a few cm either way).
      const box = new THREE.Box3();
      match.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const b = new THREE.Box3().setFromObject(mesh);
        if (b.min.y < 1.8) box.union(b);
      });
      const half = (box.max.x - box.min.x) / 2;
      assert.ok(Math.abs(half - p.radius) < 0.07, `pillar foot radius ${half.toFixed(3)} vs collider ${p.radius}`);
      const top = new THREE.Box3().setFromObject(match).max.y;
      assert.ok(top >= p.height - 1e-6, `pillar reaches its collider's height (${top.toFixed(2)})`);
    }

    const walls = named(stage.root, 'wall');
    assert.equal(walls.length, ARENA.walls.length);
    for (const w of ARENA.walls) {
      const c = planarTo3(w.center, 0);
      const match = walls.find((o) => {
        const p = o.getWorldPosition(new THREE.Vector3());
        return Math.hypot(p.x - c.x, p.z - c.z) < 1e-6;
      });
      assert.ok(match, `wall at ${w.center.x}, ${w.center.y}`);
      // The courtyard face is flush with the collider: nothing pokes inside it.
      const box = new THREE.Box3().setFromObject(match);
      const inner = Math.abs(c.x) > Math.abs(c.z) ? Math.min(Math.abs(box.min.x), Math.abs(box.max.x)) : Math.min(Math.abs(box.min.z), Math.abs(box.max.z));
      const colliderInner = ARENA.half - Math.min(w.half.x, w.half.y);
      assert.ok(inner >= colliderInner - 0.06, `wall inner face ${inner.toFixed(3)} vs collider ${colliderInner}`);
    }
    stage.dispose();
  });
}

test('grounds: the land is flat round the yard, trees stay outside the walls', () => {
  for (const [x, z] of [[0, 0], [20, 20], [-30, 10], [0, -FLAT_RADIUS + 1]]) assert.equal(terrainHeight(x, z), 0);
  assert.ok(terrainHeight(0, -260) > 20, 'mountains in the distance');
  for (const t of scatterTrees(300, 5, 25, 170)) {
    assert.ok(Math.max(Math.abs(t.x), Math.abs(t.z)) > ARENA.half + 2, `tree at ${t.x.toFixed(1)}, ${t.z.toFixed(1)}`);
  }
});

test('grounds: the terrain faces up, so it is drawn from above (it was invisible when wound backwards)', () => {
  const geo = terrainMesh({ grass: 0, grassDry: 0, rock: 0, snow: 0 }).geometry;
  const normals = geo.getAttribute('normal');
  let down = 0;
  for (let i = 0; i < normals.count; i++) if (normals.getY(i) <= 0) down++;
  assert.equal(down, 0, `${down} vertex normals point down`);
  // The face winding itself, not just the normals: the first quad outside the middle.
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex()!;
  const v = (k: number) => new THREE.Vector3().fromBufferAttribute(pos, idx.getX(k));
  const tri = 192 * 6 * 5; // ring 5, first segment
  const n = new THREE.Vector3().crossVectors(v(tri + 1).sub(v(tri)), v(tri + 2).sub(v(tri)));
  assert.ok(n.y > 0, 'faces wind counterclockwise seen from above');
  geo.dispose();
});

test('grounds: banners hang above her head; dusk lights the braziers, day does not', () => {
  const day = build('grounds');
  const dusk = build('dusk');
  const lights = (s: ReturnType<typeof build>) => {
    let n = 0;
    s.root.traverse((o) => {
      if ((o as THREE.PointLight).isPointLight) n++;
    });
    return n;
  };
  assert.equal(lights(day), 0);
  assert.equal(lights(dusk), ARENA.pillars.length);

  day.root.updateMatrixWorld(true);
  day.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !(mesh.geometry instanceof THREE.PlaneGeometry) || mesh.name === 'floor') return;
    const b = new THREE.Box3().setFromObject(mesh);
    if (b.max.y > 3) assert.ok(b.min.y > 2, `banner bottom at ${b.min.y.toFixed(2)} m`);
  });
  day.dispose();
  dusk.dispose();
});

test('her eyes take the light her face gets: bright toward the sun, dim in shade and in the void', () => {
  const [day, dusk, dark] = (['grounds', 'dusk', 'void'] as const).map(build);
  const eyes = (s: ReturnType<typeof build>, x: number, z: number) => faceLighting(s)(new THREE.Vector3(x, 0.2, z).normalize());
  // Facing the dummy from the spawn is -z; the camera (and the day sun) is behind her, +z.
  const dayToSun = eyes(day, 0, 1);
  const dayShade = eyes(day, 0, -1);
  assert.ok(dayToSun > 0.85, `day, facing the sun: ${dayToSun.toFixed(2)}`);
  assert.ok(dayShade < dayToSun * 0.6, `day, face in shade: ${dayShade.toFixed(2)}`);
  // Dusk: the low sun is ahead of her; it lights her face less than the midday sun does.
  const duskToSun = eyes(dusk, 0, -1);
  assert.ok(duskToSun < dayToSun && eyes(dusk, 0, 1) < duskToSun, `dusk ${duskToSun.toFixed(2)}`);
  assert.ok(eyes(dusk, 0, 1) < 0.35);
  // The void: no stronger than shade at noon, whichever way she faces.
  for (const [x, z] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) assert.ok(eyes(dark, x, z) <= 0.5, `void ${x},${z}`);
  assert.ok(eyes(dark, 0, -1) < 0.25, 'void, facing the dummy (key light behind her)');
  for (const s of [day, dusk, dark]) s.dispose();
});
