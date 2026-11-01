import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTACKS, AttackId, EVADES, EvadeId } from '../src/combat/moves';
import { vec2 } from '../src/core/math';
import { PlayerStateId } from '../src/player/contracts';
import { HeadlessSandbox, type FrameInput } from '../src/sandbox/HeadlessSandbox';

/*
 * Roll + Attack: a stab coming out of the roll (Twilight Princess's roll attack). The
 * press can come at any point in the roll; the stab waits until she's up out of the
 * tumble (EvadeDef.attackFrom), and carries the roll's speed into it.
 */

const ROLL = EVADES[EvadeId.Roll];
const FROM = ROLL.attackFrom!;

/** Rolls, presses Attack `after` frames into it, and returns the frame the roll started on. */
function rollThenAttack(sb: HeadlessSandbox, after: number, f: FrameInput = {}): number {
  sb.step({ ...f, evade: true });
  const start = sb.frame;
  sb.run(after - 1, f);
  sb.step({ ...f, attack: true });
  return start;
}

test('attack early in a roll: the stab comes out of the roll, once she is back up', () => {
  const sb = new HeadlessSandbox();
  let startedAt = -1;
  sb.events.on('attackStarted', () => {
    if (startedAt < 0) startedAt = sb.frame;
  });
  const start = rollThenAttack(sb, 3); // far longer before attackFrom than the 0.2 s buffer
  sb.run(40);
  assert.deepEqual(sb.attacks, [AttackId.RollThrust]);
  const t = (startedAt - start) / 60;
  assert.ok(t >= FROM - 1e-9 && t < FROM + 0.03, `out of the roll at ${t.toFixed(3)} s, not mid-tumble`);
  assert.ok(sb.trace.some((s) => s.endsWith('Evade -> Attack')), 'straight from the roll');
});

test('attack late in the roll: the stab comes out at once', () => {
  const sb = new HeadlessSandbox();
  rollThenAttack(sb, 36); // 0.6 s: she's already up
  assert.equal(sb.player.state, PlayerStateId.Attack);
  assert.deepEqual(sb.attacks, [AttackId.RollThrust]);
});

test('attack after the roll is over is an ordinary swing', () => {
  const sb = new HeadlessSandbox();
  sb.step({ evade: true });
  sb.run(Math.ceil(ROLL.duration * 60) + 2);
  assert.equal(sb.player.state, PlayerStateId.Grounded);
  sb.step({ attack: true });
  assert.deepEqual(sb.attacks, [AttackId.Horizontal]);
});

test('the roll thrust carries her forward and stabs what is ahead', () => {
  const sb = new HeadlessSandbox();
  sb.addEnemy(0, 7); // past where the roll alone ends up
  rollThenAttack(sb, 3, { stick: vec2(0, 1) });
  sb.run(40, { stick: vec2(0, 1) });
  const hits = sb.combatLog.filter((e) => e.type === 'enemyHit');
  assert.equal(hits.length, 1, 'one stab, one hit');
  assert.ok('attack' in hits[0] && hits[0].attack === AttackId.RollThrust);

  // It's a stab: a straight line forward, reaching further than an ordinary thrust.
  const def = ATTACKS[AttackId.RollThrust];
  assert.equal(def.hit.kind, 'line');
  assert.ok(def.hit.range > ATTACKS[AttackId.Thrust].hit.range);
  assert.ok(def.lunge > ATTACKS[AttackId.Thrust].lunge, 'keeps the roll moving');
});

test('only the roll does this: a locked-on side hop + Attack is an ordinary swing', () => {
  const sb = new HeadlessSandbox();
  sb.addEnemy(0, 5);
  sb.run(2, { target: true });
  sb.step({ target: true, stick: vec2(-1, 0), evade: true });
  sb.run(18, { target: true });
  sb.step({ target: true, attack: true });
  sb.run(4, { target: true });
  assert.ok(sb.attacks.length > 0 && !sb.attacks.includes(AttackId.RollThrust), `${sb.attacks}`);
});
