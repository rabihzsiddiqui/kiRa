import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AXIS_Z, BACK, fitArmor, FRONT, type PlateFit } from '../src/character/armorFit';
import { fitHair, fringeEdge, HAIR, hairEnd, hairLength, headCenter } from '../src/character/hairFit';
import { fitBody, GRIP_RADIUS, KNUCKLES, restJoints, type FittedBody } from '../src/character/bodyFit';
import { BONE_IDS, type BoneId } from '../src/character/rig';
import { readBody } from './support/readBody';



let cached: FittedBody | null = null;
let fitMs = 0;
function fitted(): FittedBody {
  if (!cached) {
    const { positions, normals, indices } = readBody();
    const t0 = performance.now();
    cached = fitBody(positions, normals, indices);
    fitMs = performance.now() - t0;
  }
  return cached;
}

const vertex = (f: FittedBody, v: number) => [f.positions[3 * v], f.positions[3 * v + 1], f.positions[3 * v + 2]] as const;
/** The bone that weighs most on vertex v. */
const mainBone = (f: FittedBody, v: number): BoneId => {
  let best = 0;
  for (let k = 1; k < 4; k++) if (f.skinWeight[v * 4 + k] > f.skinWeight[v * 4 + best]) best = k;
  return BONE_IDS[f.skinIndex[v * 4 + best]];
};

test('the base body gets sound skin weights: four per vertex, summing to one, no NaN', () => {
  const f = fitted();
  const n = f.positions.length / 3;
  for (let v = 0; v < n; v++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const w = f.skinWeight[v * 4 + k];
      assert.ok(w >= 0 && Number.isFinite(w));
      assert.ok(f.skinIndex[v * 4 + k] < BONE_IDS.length);
      sum += w;
    }
    assert.ok(Math.abs(sum - 1) < 1e-4, `vertex ${v} weights sum to ${sum}`);
    for (let a = 0; a < 3; a++) assert.ok(Number.isFinite(f.positions[3 * v + a]) && Number.isFinite(f.normals[3 * v + a]));
  }
  assert.ok(fitMs < 1500, `fitting at load stays quick (${fitMs.toFixed(0)} ms)`);
});

test('the fit lands the body on the rig: feet on the floor, hands at the wrists, no head of its own', () => {
  const f = fitted();
  const rest = restJoints();
  const used = new Set<number>(f.indices);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of used) {
    const [, y] = vertex(f, v);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  assert.ok(Math.abs(minY) < 0.02, `soles at the floor (${minY.toFixed(3)})`);
  assert.ok(maxY < rest.head[1] + 0.03, `its own head is gone: tops out at ${maxY.toFixed(3)}, the anime head covers the rest`);

  // Every bone drives the part of the body around its own joint.
  const near = (id: BoneId) => {
    const [jx, jy, jz] = rest[id];
    const counts = new Map<BoneId, number>();
    for (const v of used) {
      const [x, y, z] = vertex(f, v);
      if (Math.hypot(x - jx, y - jy, z - jz) < 0.05) counts.set(mainBone(f, v), (counts.get(mainBone(f, v)) ?? 0) + 1);
    }
    return counts;
  };
  for (const [joint, expect] of [
    ['forearmR', ['upperArmR', 'forearmR']],
    ['handL', ['forearmL', 'handL']],
    ['shinR', ['thighR', 'shinR']],
    ['footL', ['shinL', 'footL']],
  ] as Array<[BoneId, BoneId[]]>) {
    const counts = near(joint);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const right = expect.reduce((s, id) => s + (counts.get(id) ?? 0), 0);
    assert.ok(total > 3, `body around ${joint}`);
    assert.ok(right / total > 0.9, `around ${joint} it moves with ${expect.join(' and ')}: ${JSON.stringify([...counts])}`);
  }
});

test('arms are found by shape and their fingers curl around the grip', () => {
  const f = fitted();
  const rest = restJoints();
  const n = f.positions.length / 3;
  let arm = 0;
  let pastKnuckles = 0;
  for (let v = 0; v < n; v++) {
    if (f.armParam[v] < 0) continue;
    arm++;
    const [x, y] = vertex(f, v);
    const side = x > 0 ? 'handR' : 'handL';
    const [wx, wy] = rest[side];
    // Curled fingers: nothing hangs more than a fist below the grip.
    assert.ok(y > wy - KNUCKLES - 2.5 * GRIP_RADIUS - 0.02, `finger tip at ${(wy - y).toFixed(3)} below the wrist`);
    if (y < wy - KNUCKLES && Math.abs(x - wx) < 0.06) pastKnuckles++;
    assert.ok(Math.abs(x) > 0.1, 'arm vertices sit out at the arms');
  }
  assert.ok(arm > n * 0.1 && arm < n * 0.4, `a fair share of the body is arms (${arm} of ${n})`);
  assert.ok(pastKnuckles > 20, 'there are fingers');
});

test('with its own head kept, the head keeps its shape (the shoulders do not pinch it)', () => {
  const { positions, normals, indices } = readBody();
  const f = fitBody(positions, normals, indices, { keepHead: true });
  const rest = restJoints();
  let top = -Infinity;
  let half = 0;
  for (let v = 0; v < positions.length / 3; v++) {
    if (positions[3 * v + 1] < 1.45) continue; // the file's head
    top = Math.max(top, f.positions[3 * v + 1]);
    half = Math.max(half, Math.abs(f.positions[3 * v]));
  }
  assert.ok(top > rest.head[1] + 0.2 && top < rest.head[1] + 0.26, `crown at ${top.toFixed(3)}`);
  assert.ok(half > 0.09 && half < 0.105, `head half width ${half.toFixed(3)} (file: 0.093, times girth)`);
});

/** Every point's weights sum to one, and only `bones` move it. */
function checkWeights(skinIndex: Uint16Array, skinWeight: Float32Array, bones: BoneId[]): void {
  const allowed = new Set(bones.map((id) => BONE_IDS.indexOf(id)));
  for (let k = 0; k < skinWeight.length / 4; k++) {
    let sum = 0;
    for (let c = 0; c < 4; c++) {
      const w = skinWeight[k * 4 + c];
      sum += w;
      if (w > 1e-6) assert.ok(allowed.has(skinIndex[k * 4 + c]), `moved by ${BONE_IDS[skinIndex[k * 4 + c]]}`);
    }
    assert.ok(Math.abs(sum - 1) < 1e-4);
  }
}

test('front and back plates: solid (no dip between the breasts), outside the torso, rigid on the spine', () => {
  const f = fitted();
  const armor = fitArmor(f);
  for (const plate of armor.plates) {
    const { rows, cols } = plate.spec;
    const H = rows + 1;
    checkWeights(plate.shell.skinIndex, plate.shell.skinWeight, ['hips', 'spine', 'chest', 'neck']);

    // Convex across every row: each point lies on or outside the line between its
    // neighbors, the far side from the spine.
    for (let j = 0; j <= rows; j++) {
      const p = (n: number) => [Math.sin(plate.angle[n * H + j]) * plate.radius[n * H + j], Math.cos(plate.angle[n * H + j]) * plate.radius[n * H + j]];
      for (let i = 1; i < cols; i++) {
        const [a, b, c] = [p(i - 1), p(i), p(i + 1)];
        const side = (q: number[]) => (c[0] - a[0]) * (q[1] - a[1]) - (c[1] - a[1]) * (q[0] - a[0]);
        assert.ok(side(b) * side([0, 0]) <= 1e-7, `row ${j} dips inward at column ${i}`);
      }
    }
    // Every torso vertex under it sits inside it.
    let inside = 0;
    let total = 0;
    for (const v of new Set<number>(f.indices)) {
      if (f.armParam[v] >= 0) continue;
      const [x, y, z] = vertex(f, v);
      let a = Math.atan2(x, -(z - AXIS_Z)) - plate.spec.center;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(a) > plate.spec.span) continue;
      const top = plate.spec.top(a + plate.spec.center);
      if (y < plate.spec.bottom + 0.01 || y > top - 0.01) continue;
      const i = Math.round(((a + plate.spec.span) / (2 * plate.spec.span)) * cols);
      const j = Math.round(((y - plate.spec.bottom) / (top - plate.spec.bottom)) * rows);
      total++;
      if (Math.hypot(x, z - AXIS_Z) <= plate.radius[i * H + j] + 0.01) inside++;
    }
    assert.ok(total > 15, `torso under the plate (${total})`);
    assert.ok(inside / total > 0.97, `${inside} of ${total} torso vertices inside the plate`);
  }
});

test('the plates stop under the bust and leave the sides open, crossed by straps', () => {
  const armor = fitArmor(fitted());
  for (const spec of [FRONT, BACK]) {
    assert.ok(spec.bottom > 1.15, 'ends below the bust, well above the belt');
    assert.ok(spec.span < Math.PI / 2 - 0.3, 'an open gap at each side');
  }
  const sides = new Map<number, PlateFit[]>();
  for (const s of armor.straps) sides.set(Math.sign(s.spec.center), [...(sides.get(Math.sign(s.spec.center)) ?? []), s]);
  for (const [, straps] of sides) {
    assert.equal(straps.length, 2, 'two straps a side');
    for (const s of straps) {
      // Reaches under both plates' edges.
      assert.ok(Math.abs(s.spec.center) - s.spec.span < FRONT.span, 'tucks under the front plate');
      assert.ok(Math.abs(s.spec.center) + s.spec.span > Math.PI - BACK.span, 'tucks under the back plate');
      assert.ok(Math.max(...s.shell.outer) < FRONT.out, 'sits under the plates');
      checkWeights(s.shell.skinIndex, s.shell.skinWeight, ['hips', 'spine', 'chest', 'neck']);
    }
  }
});

test('2B bob, side parted: the fringe sweeps from the part, locks to the chin, shorter at the back, moved by the head', () => {
  const { positions, normals, indices } = readBody();
  const f = fitBody(positions, normals, indices, { keepHead: true });
  const rest = restJoints();
  const hair = fitHair(f, rest.head[1]);
  checkWeights(hair.skinIndex, hair.skinWeight, ['neck', 'head']);
  const H = hair.rows + 1;
  const center = headCenter(f, rest.head[1] + 0.01);
  const end = (i: number) => hair.base[(i * H + hair.rows) * 3 + 1];
  for (let k = 0; k < hair.cols * H; k++) {
    assert.ok(hair.outer[k] > hair.inner[k], 'has thickness');
    for (let a = 0; a < 3; a++) assert.ok(Number.isFinite(hair.base[k * 3 + a]));
  }
  const col = (phi: number) => Math.round((((phi / (Math.PI * 2)) % 1) + 1) % 1 * hair.cols) % hair.cols;
  // Fringe: in front, it stops above eye level (the head's middle).
  assert.ok(end(col(0)) > center[1] + 0.01, `fringe ends at ${end(col(0)).toFixed(3)}, head middle ${center[1].toFixed(3)}`);
  assert.equal(hairLength(0), 0);
  // Side part on her right: the fringe is higher there and sweeps lower toward her left.
  assert.ok(end(col(0.4)) > end(col(-0.4)) + 0.015, 'swept from the part on her right');
  assert.ok(fringeEdge(0.45) < fringeEdge(0) && fringeEdge(0) < fringeEdge(-0.5));
  // Side locks frame the face down to about the chin (the head joint).
  for (const phi of [1.0, -1.0]) {
    assert.ok(Math.abs(end(col(phi)) - (rest.head[1] + HAIR.locks)) < 0.012, `lock at ${phi} ends at ${end(col(phi)).toFixed(3)}`);
  }
  // The back is shorter than the side locks.
  assert.ok(end(col(Math.PI)) > end(col(1.0)) + 0.03, 'shorter at the back');
  assert.ok(hairEnd(Math.PI) > hairEnd(Math.PI / 2));
});
