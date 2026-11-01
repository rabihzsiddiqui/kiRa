import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTACKS, attackDuration, AttackId } from '../src/combat/moves';
import { rightOf, vec2 } from '../src/core/math';
import { spinWave, trailStyle, wavePoints } from '../src/feel/swingTrail';
import { HeadlessSandbox } from '../src/sandbox/HeadlessSandbox';

const TAU = Math.PI * 2;
const SPIN = ATTACKS[AttackId.Spin];

/** A quick 360 on the stick, then Attack: a spin. Returns the frame the spin started on. */
function spin(sb: HeadlessSandbox, enemyAt?: number): number {
  for (let i = 0; i <= 18; i++) {
    const a = (i / 18) * TAU * 0.95;
    sb.step({ stick: vec2(Math.cos(a), Math.sin(a)) });
  }
  // Straight out to her right, so her small forward drift during the spin doesn't change
  // the distance much.
  if (enemyAt !== undefined) {
    const side = rightOf(sb.motor.facing);
    sb.addEnemy(sb.motor.position.x + side.x * enemyAt, sb.motor.position.y + side.y * enemyAt);
  }
  sb.step({ attack: true });
  return sb.frame;
}

test('spins come out fast: a short wind-up and half a second in all', () => {
  for (const id of [AttackId.Spin, AttackId.SpinClockwise]) {
    const d = ATTACKS[id];
    assert.ok(d.startup <= 0.05, 'blade live almost at once');
    assert.ok(attackDuration(d) <= 0.5, `${id} lasts ${attackDuration(d)} s`);
  }
  assert.ok(attackDuration(ATTACKS[AttackId.FinisherSpin]) < 0.6, 'the spinning ender is quicker too');
});

test('the spin reaches well past an ordinary swing, during the swing itself', () => {
  assert.ok(SPIN.hit.range > ATTACKS[AttackId.Horizontal].hit.range + 0.8);
  const sb = new HeadlessSandbox();
  const start = spin(sb, 2.9); // past where a normal swing reaches
  assert.deepEqual(sb.attacks, [AttackId.Spin]);
  sb.run(40);
  const hits = sb.combatLog.filter((e) => e.type === 'enemyHit');
  assert.equal(hits.length, 1, 'hit, once');
  const bladeOver = start + Math.ceil((SPIN.startup + SPIN.active) * 60);
  assert.ok(hits[0].frame <= bladeOver, 'while the blade is live, not after');
});

test('the spin stops at its range', () => {
  const sb = new HeadlessSandbox();
  spin(sb, SPIN.hit.range + 0.6); // beyond the range plus the target's body
  sb.run(40);
  assert.equal(sb.combatLog.filter((e) => e.type === 'enemyHit').length, 0);
});

test('the spin throws a circle of energy at the edge of its reach, following the blade', () => {
  for (const id of [AttackId.Spin, AttackId.SpinClockwise]) {
    const wave = spinWave(id);
    assert.ok(wave, `${id} has a wave`);
    assert.equal(wave.radius, ATTACKS[id].hit.range, 'its outer edge is the hit range');
    assert.equal(trailStyle(id).tier, 'special', 'and the blade keeps its usual trail');
  }
  for (const id of Object.values(AttackId)) {
    if (id !== AttackId.Spin && id !== AttackId.SpinClockwise) assert.equal(spinWave(id), null, `${id}: no wave`);
  }

  // Wherever the blade points, the band sits out along it at the blade's height.
  const wave = spinWave(AttackId.Spin)!;
  const center = { x: 1, y: 0, z: 2 };
  for (const a of [0, 1, 2.5, -2]) {
    const tip = { x: center.x + Math.cos(a) * 1.5, y: 1.4, z: center.z + Math.sin(a) * 1.5 };
    const p = wavePoints(center, tip, wave)!;
    const r = (q: { x: number; z: number }) => Math.hypot(q.x - center.x, q.z - center.z);
    assert.ok(Math.abs(r(p.outer) - wave.radius) < 1e-9 && Math.abs(r(p.inner) - (wave.radius - wave.width)) < 1e-9);
    assert.ok(Math.abs(Math.atan2(p.outer.z - center.z, p.outer.x - center.x) - a) < 1e-9, 'same direction as the blade');
    assert.equal(p.outer.y, 1.4);
  }
});
