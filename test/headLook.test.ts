import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HEAD_LOOK, HeadLook, lookAllowed, type Gaze } from '../src/character/headLook';
import { AttackId, EvadeId } from '../src/combat/moves';
import { vec2 } from '../src/core/math';
import { PlayerStateId } from '../src/player/contracts';
import { PlayerView } from '../src/render/PlayerView';
import { ThreeAnimator } from '../src/render/ThreeAnimator';
import { HeadlessSandbox } from '../src/sandbox/HeadlessSandbox';

/*
 * Her head turns to what she's targeting, or would target: smoothly, within what a neck
 * can do, through attacks but not spins, rolls or flips.
 */

const AHEAD: Gaze = { yaw: 0, pitch: 0 };
const run = (look: HeadLook, seconds: number, target: Gaze | null, opts: { chest?: Gaze; head?: Gaze; allowed?: boolean } = {}) => {
  let out: Gaze | null = null;
  for (let t = 0; t < seconds; t += 1 / 60) {
    out = look.update(1 / 60, { target, chest: opts.chest ?? AHEAD, head: opts.head ?? AHEAD, allowed: opts.allowed ?? true });
  }
  return out;
};

test('the head turns to the target smoothly: no snap, settled in a few tenths of a second', () => {
  const look = new HeadLook();
  const first = run(look, 1 / 60, { yaw: 40, pitch: 10 })!;
  assert.ok(first.yaw < 5, `first frame barely moves (${first.yaw.toFixed(1)})`);
  const settled = run(look, 0.5, { yaw: 40, pitch: 10 })!;
  assert.ok(Math.abs(settled.yaw - 40) < 0.5 && Math.abs(settled.pitch - 10) < 0.5, `${settled.yaw}, ${settled.pitch}`);
});

test('within what a neck can do, and never strains for something behind her', () => {
  const look = new HeadLook();
  const far = run(look, 1, { yaw: 100, pitch: -60 })!;
  assert.ok(Math.abs(far.yaw - HEAD_LOOK.maxYaw) < 0.5, `turns as far as it goes (${far.yaw.toFixed(1)})`);
  assert.ok(Math.abs(far.pitch + HEAD_LOOK.maxDown) < 0.5, `looks down as far as it goes (${far.pitch.toFixed(1)})`);
  // Limits are from her chest: a chest turned 40 lets the head reach 115.
  const twisted = run(new HeadLook(), 1, { yaw: 110, pitch: 0 }, { chest: { yaw: 40, pitch: 0 } })!;
  assert.ok(Math.abs(twisted.yaw - 110) < 0.5);
  // Behind her: she looks ahead (fades out to the animation).
  assert.equal(run(new HeadLook(), 1, { yaw: 170, pitch: 0 }), null);
});

test('her eyes stay on the target while her body twists', () => {
  const look = new HeadLook();
  run(look, 1, { yaw: 10, pitch: 0 });
  // The chest and the animated head swing 50 to her side in a few frames: the gaze holds.
  const out = run(look, 0.1, { yaw: 10, pitch: 0 }, { chest: { yaw: 50, pitch: 0 }, head: { yaw: 50, pitch: 0 } })!;
  assert.ok(Math.abs(out.yaw - 10) < 0.5, `still on the target (${out.yaw.toFixed(1)})`);
});

test('fades out instead of popping when looking stops (a spin, a roll)', () => {
  const look = new HeadLook();
  run(look, 1, { yaw: 50, pitch: 0 });
  const fading = run(look, 0.05, { yaw: 50, pitch: 0 }, { allowed: false })!;
  assert.ok(fading.yaw > 30, `still mostly there just after (${fading.yaw.toFixed(1)})`);
  assert.equal(run(look, HEAD_LOOK.fade, { yaw: 50, pitch: 0 }, { allowed: false }), null, 'then back to the animation');
});

test('looks during attacks and side hops; not during spins, rolls, flips', () => {
  assert.ok(lookAllowed(PlayerStateId.Attack, AttackId.Horizontal, null));
  assert.ok(lookAllowed(PlayerStateId.Attack, AttackId.JumpAttack, null));
  assert.ok(lookAllowed(PlayerStateId.Evade, null, EvadeId.SideHopLeft));
  assert.ok(lookAllowed(PlayerStateId.SpinCharge, null, null));
  for (const spin of [AttackId.Spin, AttackId.SpinClockwise, AttackId.FinisherSpin]) assert.ok(!lookAllowed(PlayerStateId.Attack, spin, null), spin);
  assert.ok(!lookAllowed(PlayerStateId.Evade, null, EvadeId.Roll));
  assert.ok(!lookAllowed(PlayerStateId.Evade, null, EvadeId.Backflip));
  assert.ok(!lookAllowed(PlayerStateId.PerfectDodge, null, null));
});

test('she looks at something targetable in range before locking on, and not at things out of range', () => {
  const near = new HeadlessSandbox();
  const enemy = near.addEnemy(2, 5);
  near.run(2);
  assert.equal(near.targeting.isLocked, false);
  assert.equal(near.targeting.lookTarget, enemy, 'in range: her eyes find it');
  const far = new HeadlessSandbox();
  far.addEnemy(0, 40);
  far.run(2);
  assert.equal(far.targeting.lookTarget, null);
  // Locked: the lock, even if the camera turns away.
  near.run(2, { target: true });
  near.step({ target: true, stick: vec2(0, 0) });
  assert.equal(near.targeting.lookTarget, enemy);
});

test('on the real body: the head ends up facing the point, and the neck shares the turn', () => {
  const animator = new ThreeAnimator();
  const view = new PlayerView(animator);
  animator.play('locomotion');
  animator.tick(0);
  view.sync(0, 0, 0, 0);
  const head = view.body.getObjectByName('mixamorigHead')!;
  const neck = view.body.getObjectByName('mixamorigNeck')!;
  const eye = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0));
  // Up and to her left (she faces -Z; her left is -X).
  const point = eye.clone().add(new THREE.Vector3(-1.2, 0.3, -1.6));
  const neckBefore = neck.quaternion.clone();
  for (let i = 0; i < 60; i++) view.lookAt(1 / 60, point, true);
  const fwd = head.getWorldDirection(new THREE.Vector3()).negate();
  const want = point.clone().sub(eye).normalize();
  assert.ok(fwd.angleTo(want) < THREE.MathUtils.degToRad(2), `head off by ${THREE.MathUtils.radToDeg(fwd.angleTo(want)).toFixed(1)} degrees`);
  assert.ok(neck.quaternion.angleTo(neckBefore) > THREE.MathUtils.degToRad(5), 'the neck turned too');
  // Calling again with no new animation frame doesn't stack the turn.
  const q = head.quaternion.clone();
  view.lookAt(1 / 60, point, true);
  assert.ok(head.quaternion.angleTo(q) < 1e-4);
});
