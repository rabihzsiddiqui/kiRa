import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTACKS, AttackId, COMBO } from '../src/combat/moves';
import { vec2 } from '../src/core/math';
import { PlayerStateId } from '../src/player/contracts';
import { HeadlessSandbox, type FrameInput } from '../src/sandbox/HeadlessSandbox';

/*
 * Combo system: repeating an input flows into a matching variant instead of the same
 * swing, and the 4th hit is an ender picked by the input of that 4th press.
 */

const FWD = vec2(0, 1);
const RIGHT = vec2(1, 0);

/** Presses Attack once per entry, each one as soon as the previous swing has started. */
function chain(sb: HeadlessSandbox, presses: FrameInput[], hold: FrameInput = {}, settle = true): AttackId[] {
  for (const p of presses) {
    const before = sb.attacks.length;
    sb.step({ ...hold, ...p, attack: true });
    for (let i = 0; i < 40 && sb.attacks.length === before; i++) sb.step(hold);
    sb.step(hold); // let go, so the next entry is a fresh press
  }
  if (settle) sb.run(60, hold);
  return sb.attacks;
}

function locked() {
  const sb = new HeadlessSandbox();
  sb.addEnemy(0, 8);
  sb.run(2, { target: true });
  assert.ok(sb.targeting.isLocked);
  return sb;
}

const N = {}; // neutral stick

test('horizontal combo: forehand, backhand, forehand, then the rising ender', () => {
  assert.deepEqual(chain(new HeadlessSandbox(), [N, N, N, N]), [
    AttackId.Horizontal,
    AttackId.ReverseHorizontal,
    AttackId.Horizontal,
    AttackId.FinisherRising,
  ]);
});

test('vertical combo goes /, \\, / then the leaping cleave', () => {
  const f = { stick: FWD };
  assert.deepEqual(chain(new HeadlessSandbox(), [f, f, f, f]), [
    AttackId.Vertical,
    AttackId.VerticalLeft,
    AttackId.Vertical,
    AttackId.FinisherCleave,
  ]);
});

test('right combo opens with the backhand and ends with the spinning cut', () => {
  const r = { stick: RIGHT };
  assert.deepEqual(chain(new HeadlessSandbox(), [r, r, r, r]), [
    AttackId.ReverseHorizontal,
    AttackId.Horizontal,
    AttackId.ReverseHorizontal,
    AttackId.FinisherSpin,
  ]);
});

test('locked-on thrust combo alternates sides and ends with the lunge', () => {
  const sb = locked();
  const f = { stick: FWD };
  assert.deepEqual(chain(sb, [f, f, f, f], { target: true }), [
    AttackId.Thrust,
    AttackId.ThrustLeft,
    AttackId.Thrust,
    AttackId.FinisherLunge,
  ]);
});

test('the ender depends on the 4th input, not the first three', () => {
  const cases: Array<[FrameInput, AttackId]> = [
    [N, AttackId.FinisherRising],
    [{ stick: FWD }, AttackId.FinisherCleave],
    [{ stick: RIGHT }, AttackId.FinisherSpin],
  ];
  for (const [last, ender] of cases) {
    const attacks = chain(new HeadlessSandbox(), [N, N, N, last]);
    assert.equal(attacks[3], ender, `4th press ${JSON.stringify(last)}`);
  }
});

test('mixed inputs flow from where the blade is: forehand (ends left) into a \\ from the left shoulder', () => {
  assert.deepEqual(chain(new HeadlessSandbox(), [N, { stick: FWD }]), [AttackId.Horizontal, AttackId.VerticalLeft]);
  assert.deepEqual(chain(new HeadlessSandbox(), [{ stick: RIGHT }, { stick: FWD }]), [
    AttackId.ReverseHorizontal,
    AttackId.Vertical,
  ]);
});

test('the ender closes the combo: mashing through it adds no 5th hit, the next press opens a new combo', () => {
  const sb = new HeadlessSandbox();
  chain(sb, [N, N, N, N], {}, false);
  // Mashing through the ender (stopping early enough that the last press has left the
  // input buffer by the time the ender is over).
  for (let i = 0; i < 16; i++) sb.step({ attack: i % 4 === 0 });
  assert.deepEqual(sb.attacks.slice(3), [AttackId.FinisherRising]);
  assert.equal(sb.player.attack?.attack, AttackId.FinisherRising, 'still in the ender');

  sb.run(40);
  assert.deepEqual(sb.attacks.slice(3), [AttackId.FinisherRising], 'no 5th hit');
  sb.step({ attack: true });
  assert.equal(sb.attacks.at(-1), AttackId.Horizontal, 'fresh opener');
});

test('letting a swing finish resets the combo', () => {
  const sb = new HeadlessSandbox();
  sb.step({ attack: true });
  sb.run(40);
  assert.equal(sb.player.state, PlayerStateId.Grounded);
  sb.step({ attack: true });
  assert.deepEqual(sb.attacks, [AttackId.Horizontal, AttackId.Horizontal]);
});

test('combo table: every variant flows from the side the last one ended on', () => {
  for (const family of Object.values(COMBO)) {
    for (const side of ['left', 'right'] as const) {
      const next = ATTACKS[family.from[side]];
      // A swing that starts on one side ends on the other, so alternation never stalls.
      assert.notEqual(next.endSide, side, `${next.id} starts on the ${side}`);
    }
    assert.equal(ATTACKS[family.finisher].comboOpen, Infinity, 'enders do not chain');
  }
});
