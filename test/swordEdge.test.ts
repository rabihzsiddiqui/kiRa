import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRIP_RADIUS, KNUCKLES } from '../src/character/bodyFit';
import { CLIPS } from '../src/character/clips';
import { jointFrames } from '../src/character/fk';
import { ATTACKS, AttackId } from '../src/combat/moves';
import { BLADE_LENGTH, HILT_Z } from '../src/render/Katana';

/*
 * The katana has one cutting edge (the hand's -Y). Every cut should lead with it, not the
 * flat or the spine: during the active window, the edge points along the way the blade
 * is moving. Thrusts move along the blade, so they're left out.
 */

type V = [number, number, number];
const apply = (m: number[], v: V): V => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/** Blade point near the tip, and which way the edge faces, at time t of a clip. */
function blade(anim: string, t: number): { tip: V; edge: V } {
  const f = jointFrames(CLIPS.get(anim)!.sample(t)).handR;
  const o = apply(f.r, [-GRIP_RADIUS, -KNUCKLES, HILT_Z - BLADE_LENGTH * 0.8]);
  return { tip: [f.p[0] + o[0], f.p[1] + o[1], f.p[2] + o[2]], edge: apply(f.r, [0, -1, 0]) };
}

/** Average of edge . direction of travel over the active window (1 = edge straight ahead). */
function edgeLead(id: AttackId): number {
  const a = ATTACKS[id];
  let sum = 0;
  const N = 10;
  for (let k = 0; k < N; k++) {
    const t = a.startup + (a.active * (k + 0.5)) / N;
    const [p0, p1] = [blade(a.anim, t - 0.005), blade(a.anim, t + 0.005)];
    const v = [p1.tip[0] - p0.tip[0], p1.tip[1] - p0.tip[1], p1.tip[2] - p0.tip[2]];
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    sum += (p0.edge[0] * v[0] + p0.edge[1] * v[1] + p0.edge[2] * v[2]) / len;
  }
  return sum / N;
}

const THRUSTS = new Set([AttackId.Thrust, AttackId.ThrustLeft, AttackId.FinisherLunge]);

test('every cut leads with the edge, spins and flat cuts included', () => {
  for (const id of Object.values(AttackId)) {
    if (THRUSTS.has(id)) continue;
    const lead = edgeLead(id);
    assert.ok(lead > 0.5, `${id}: edge leads by ${lead.toFixed(2)}`);
  }
  for (const id of [AttackId.Spin, AttackId.SpinClockwise, AttackId.FinisherSpin, AttackId.Horizontal, AttackId.ReverseHorizontal]) {
    assert.ok(edgeLead(id) > 0.85, `${id} cuts edge first, not with the flat`);
  }
});
