import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitBody } from '../src/character/bodyFit';
import { CLIPS, LOCOMOTION_CLIPS, type ClipDef } from '../src/character/clips';
import { jointFrames } from '../src/character/fk';
import { readBody } from './support/readBody';

/*
 * Two-handed holds put the left hand on the grip by arm IK. The elbow points out to her
 * side, so the arm reaching across her never sinks into her chest and armor any deeper
 * than it rests against her side standing still.
 */

const raw = readBody();
const body = fitBody(raw.positions, raw.normals, raw.indices, { keepHead: true });
const torso: number[] = [];
for (let v = 0; v < body.positions.length / 3; v++) {
  const y = body.positions[3 * v + 1];
  if (body.armParam[v] < 0 && y > 0.95 && y < 1.45) torso.push(v);
}
const REST_CHEST = jointFrames({ bones: {} }).chest;
const ARMOR = 0.015;

/** How far the left arm (below the shoulder) sinks into her torso and armor, at its worst (m). */
function sinks(clip: ClipDef, t: number): number {
  const f = jointFrames(clip.sample(t));
  const { p: c, r } = f.chest;
  // The torso moves with the chest bone: take the arm into its rest frame.
  const toRest = (p: number[]) => {
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    return [0, 1, 2].map((k) => r[k] * d[0] + r[3 + k] * d[1] + r[6 + k] * d[2] + REST_CHEST.p[k]);
  };
  const P = body.positions;
  const N = body.normals;
  let worst = -Infinity;
  for (const [a, b, radius, from] of [[f.upperArmL.p, f.forearmL.p, 0.045, 4], [f.forearmL.p, f.handL.p, 0.04, 0]] as const) {
    for (let k = from; k <= 10; k++) {
      const p = toRest([0, 1, 2].map((i) => a[i] + ((b[i] - a[i]) * k) / 10));
      let [best, at] = [Infinity, -1];
      for (const v of torso) {
        const d = Math.hypot(P[3 * v] - p[0], P[3 * v + 1] - p[1], P[3 * v + 2] - p[2]);
        if (d < best) [best, at] = [d, v];
      }
      const out = (p[0] - P[3 * at]) * N[3 * at] + (p[1] - P[3 * at + 1]) * N[3 * at + 1] + (p[2] - P[3 * at + 2]) * N[3 * at + 2];
      worst = Math.max(worst, radius + ARMOR - out);
    }
  }
  return worst;
}

test('the left arm on the grip stays clear of her chest (no deeper than resting at her side)', () => {
  const idle = Math.max(sinks(LOCOMOTION_CLIPS.idle, 0), sinks(LOCOMOTION_CLIPS.idle, 2));
  const holds: Array<[string, number[]]> = [
    ['atk_horizontal', [0, 0.1, 0.2, 0.3]],
    ['atk_vertical', [0, 0.1, 0.22, 0.3]],
    ['guard_raise', [0.15]],
    ['pb_clash_a', [0.1]],
    ['pb_clash_b', [0.1]],
  ];
  for (const [name, times] of holds) {
    for (const t of times) {
      const d = sinks(CLIPS.get(name)!, t);
      assert.ok(d <= idle + 1e-3, `${name} at ${t}: ${(d * 100).toFixed(1)} cm (resting: ${(idle * 100).toFixed(1)})`);
    }
  }
});
