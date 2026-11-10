import { test } from 'node:test';
import assert from 'node:assert/strict';
import { length } from '../src/core/math';
import { distanceToShape } from '../src/combat/hitShapes';
import { DUMMY_STRINGS } from '../src/enemies/strings';
import type { DummyPhase } from '../src/enemies/TrainingDummyAI';
import { WEAPON_REST, weaponPose, weaponTip, type WeaponPose } from '../src/enemies/weaponPose';

const HEIGHT = 1.8; // ARENA.dummy.height
const DEG = Math.PI / 180;
const steps = DUMMY_STRINGS.flatMap((s) => s.steps.map((step, i) => ({ string: s, step, i })));

const close = (a: WeaponPose, b: WeaponPose, msg: string) => {
  for (const k of ['yaw', 'lift', 'roll', 'slide'] as const) assert.ok(Math.abs(a[k] - b[k]) < 1e-6, `${msg}: ${k} ${a[k]} vs ${b[k]}`);
};

test('when the hitbox closes, the blade tip is on the edge of the hit shape', () => {
  for (const { string, step, i } of steps) {
    const tip = weaponTip(weaponPose(string.steps, i, 'active', 1), HEIGHT).at;
    const hit = step.attack.hit;
    assert.ok(distanceToShape(hit, tip) < 0.03, `${step.attack.id}: tip ${distanceToShape(hit, tip).toFixed(3)} m outside`);
    const reach = hit.kind === 'line' ? tip.y : length(tip);
    assert.ok(Math.abs(reach - hit.range) < 0.03, `${step.attack.id}: reaches ${reach.toFixed(2)} m, range is ${hit.range}`);
  }
});

test('while the hitbox is live, the blade is inside the hit shape', () => {
  for (const { string, step, i } of steps) {
    for (let k = 0; k <= 1; k += 0.1) {
      const tip = weaponTip(weaponPose(string.steps, i, 'active', k), HEIGHT).at;
      assert.ok(distanceToShape(step.attack.hit, tip) < 0.03, `${step.attack.id} at ${k.toFixed(1)}`);
    }
  }
});

test('slashes sweep the whole arc: edge to edge, forehand right to left, backhand back', () => {
  for (const { string, step, i } of steps) {
    const hit = step.attack.hit;
    if (step.motion !== 'forehand' && step.motion !== 'backhand') continue;
    assert.equal(hit.kind, 'arc');
    if (hit.kind !== 'arc') continue;
    // Angle off her facing, positive to its right (local x).
    const angle = (k: number) => {
      const t = weaponTip(weaponPose(string.steps, i, 'active', k), HEIGHT).at;
      return Math.atan2(t.x, t.y) / DEG;
    };
    const half = hit.arcDeg / 2;
    const side = step.motion === 'forehand' ? 1 : -1;
    assert.ok(Math.abs(angle(0) - side * half) < 1, `${step.attack.id} starts at ${angle(0).toFixed(1)}`);
    assert.ok(Math.abs(angle(1) + side * half) < 1, `${step.attack.id} ends at ${angle(1).toFixed(1)}`);
  }
});

test('the glaive moves without jumps: phases and steps hand over where they left off', () => {
  for (const s of DUMMY_STRINGS) {
    close(weaponPose(s.steps, 0, 'windup', 0), WEAPON_REST, `${s.id} starts from guard`);
    s.steps.forEach((step, i) => {
      const at = (phase: DummyPhase, k: number) => weaponPose(s.steps, i, phase, k);
      close(at('windup', 1), at('active', 0), `${step.attack.id} windup into active`);
      close(at('active', 1), at('recovery', 0), `${step.attack.id} active into recovery`);
      if (i + 1 < s.steps.length) close(at('recovery', 1), weaponPose(s.steps, i + 1, 'windup', 0), `${step.attack.id} into the next step`);
      else close(at('recovery', 1), WEAPON_REST, `${s.id} ends at guard`);
    });
  }
});

test('the blade tip never goes into the ground', () => {
  for (const { string, i } of steps) {
    for (const phase of ['windup', 'active', 'recovery'] as const) {
      for (let k = 0; k <= 1.0001; k += 0.02) {
        const { y } = weaponTip(weaponPose(string.steps, i, phase, k), HEIGHT);
        assert.ok(y > 0.1, `${string.steps[i].attack.id} ${phase} ${k.toFixed(2)}: tip at ${y.toFixed(2)} m`);
      }
    }
  }
});
