import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessSandbox, type FrameInput } from '../src/sandbox/HeadlessSandbox';
import { AttackId, EvadeId } from '../src/combat/moves';
import { PlayerStateId } from '../src/player/contracts';
import type { EvadeState } from '../src/player/states/EvadeState';
import { vec2 } from '../src/core/math';

/*
 * View lock, Zelda's Z with no enemy around: the target button on and nothing to lock.
 * She keeps her facing, strafes sideways and backwards, and the lock-on evades apply.
 */

const BACK = vec2(0, -1);
const LEFT = vec2(-1, 0);
const RIGHT = vec2(1, 0);

/** Nothing in range, target held. She starts facing +Y. */
function viewLocked() {
  const sb = new HeadlessSandbox();
  sb.addEnemy(0, 40);
  sb.run(2, { target: true });
  assert.ok(sb.targeting.isViewLocked);
  assert.ok(!sb.targeting.isLocked);
  return { sb, V: (f: FrameInput = {}): FrameInput => ({ ...f, target: true }) };
}

const evadeId = (sb: HeadlessSandbox) => (sb.player.fsm.current as EvadeState).evade;

test('view locked, stick back: she walks backwards still facing ahead', () => {
  const { sb, V } = viewLocked();
  sb.run(40, V({ stick: BACK }));
  assert.ok(sb.motor.facing.y > 0.99, `still facing ahead (${sb.motor.facing.x.toFixed(2)}, ${sb.motor.facing.y.toFixed(2)})`);
  assert.ok(sb.motor.position.y < -0.5, 'moved back');
  assert.equal(sb.anim.params.get('locomotion'), 2, 'strafe locomotion');
  assert.ok((sb.anim.params.get('strafeY') ?? 0) < -0.9);
});

test('view locked, stick right: she side steps, no turning', () => {
  const { sb, V } = viewLocked();
  sb.run(40, V({ stick: RIGHT }));
  assert.ok(sb.motor.facing.y > 0.99);
  assert.ok(sb.motor.position.x > 0.5, 'moved right');
  assert.ok(Math.abs(sb.motor.position.y) < 0.01, 'straight sideways');
});

test('without the button the same stick turns her around and runs', () => {
  const sb = new HeadlessSandbox();
  sb.addEnemy(0, 40);
  sb.run(40, { stick: BACK });
  assert.ok(sb.motor.facing.y < -0.9, 'turned to run back');
  assert.equal(sb.anim.params.get('locomotion'), 1);
});

test('view locked evades: side hops and backflip, never a roll', () => {
  const cases: Array<[ReturnType<typeof vec2>, EvadeId]> = [
    [LEFT, EvadeId.SideHopLeft],
    [RIGHT, EvadeId.SideHopRight],
    [BACK, EvadeId.Backflip],
  ];
  for (const [stick, expected] of cases) {
    const { sb, V } = viewLocked();
    sb.step(V({ stick, evade: true }));
    assert.equal(sb.player.state, PlayerStateId.Evade);
    assert.equal(evadeId(sb), expected);
  }
});

test('view locked, evade with neutral stick: jump attack', () => {
  const { sb, V } = viewLocked();
  sb.step(V({ evade: true }));
  assert.deepEqual(sb.attacks, [AttackId.JumpAttack]);
});

test('letting go of the button ends the view lock', () => {
  const { sb } = viewLocked();
  sb.run(2);
  assert.ok(!sb.targeting.isViewLocked);
  sb.run(40, { stick: BACK });
  assert.ok(sb.motor.facing.y < -0.9, 'free running again');
});

test('a target in range is a lock, not a view lock', () => {
  const sb = new HeadlessSandbox();
  sb.addEnemy(0, 5);
  sb.run(2, { target: true });
  assert.ok(sb.targeting.isLocked);
  assert.ok(!sb.targeting.isViewLocked);
});

test('toggle mode: a tap with nothing in range turns the view lock on, the next tap off', () => {
  const sb = new HeadlessSandbox();
  sb.targeting.cfg.mode = 'toggle';
  const enemy = sb.addEnemy(0, 40);
  sb.step({ target: true });
  sb.run(10);
  assert.ok(sb.targeting.isViewLocked, 'stays on after the tap');
  sb.step({ target: true });
  sb.run(2);
  assert.ok(!sb.targeting.isViewLocked, 'second tap turns it off');

  // On again, then the enemy walks into range: it gets locked, like holding the button.
  sb.step({ target: true });
  sb.run(2);
  enemy.position.y = 5;
  sb.run(2);
  assert.ok(sb.targeting.isLocked);
  assert.ok(!sb.targeting.isViewLocked);
  sb.step({ target: true });
  sb.run(2);
  assert.ok(!sb.targeting.isLocked && !sb.targeting.isViewLocked, 'one tap ends the lock');
});
