import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vec2, type Vec2 } from '../src/core/math';
import { DUMMY_STRINGS, type AttackString } from '../src/enemies/strings';
import { PlayerStateId } from '../src/player/contracts';
import { HeadlessSandbox, type FrameInput } from '../src/sandbox/HeadlessSandbox';

const RIGHT = vec2(1, 0);
const byId = (id: string): AttackString => {
  const s = DUMMY_STRINGS.find((x) => x.id === id);
  if (!s) throw new Error(`no string ${id}`);
  return s;
};

/** A dummy 2 m in front of her, running one string (or all of them). */
function arena(strings: readonly AttackString[], at: Vec2 = vec2(0, 2)) {
  const sb = new HeadlessSandbox();
  const dummy = sb.addEnemy(at.x, at.y);
  const ai = sb.addDummyAI(dummy, strings);
  const strikes: Array<{ frame: number; id: string }> = [];
  const ends: Array<{ frame: number; id: string; reason: string }> = [];
  ai.events.on('strike', ({ step }) => strikes.push({ frame: sb.frame, id: step.attack.id }));
  ai.events.on('stringEnd', ({ stringId, reason }) => ends.push({ frame: sb.frame, id: stringId, reason }));
  const chains: number[] = [];
  sb.events.on('perfectBlock', ({ chain }) => chains.push(chain));
  const results = () => sb.combatLog.flatMap((x) => (x.type === 'playerHit' ? [x.result] : []));
  return { sb, dummy, ai, strikes, ends, results, chains };
}

/** Frame the first hitbox opens, from an identical run where she stands still. */
function firstStrikeFrame(strings: readonly AttackString[]): number {
  const dry = arena(strings);
  for (let i = 0; i < 240 && dry.strikes.length === 0; i++) dry.sb.step();
  assert.ok(dry.strikes.length > 0, 'the dummy never struck');
  return dry.strikes[0].frame;
}

/**
 * Replays the same fight, starting `input` exactly `lead` frames before the first strike.
 * `hold` keeps applying after the press frame (e.g. keep Block held).
 */
function pressBeforeStrike(
  strings: readonly AttackString[],
  lead: number,
  press: FrameInput,
  hold: FrameInput = {},
  always: FrameInput = {},
) {
  const strikeAt = firstStrikeFrame(strings);
  const a = arena(strings);
  while (a.sb.frame < strikeAt - lead - 1) a.sb.step(always);
  a.sb.step({ ...always, ...press });
  // Long enough for a whole string, including the slow-mo each parry adds.
  for (let i = 0; i < 120; i++) a.sb.step({ ...always, ...hold });
  return a;
}

// ------------------------------------------------------------- the loop

test('all four strings run in order, then it loops', () => {
  // 4.2 m: inside engage range, outside every attack's reach, so nothing interrupts.
  const a = arena(DUMMY_STRINGS, vec2(0, 4.2));
  a.sb.run(60 * 14);
  assert.deepEqual(
    a.strikes.slice(0, 7).map((s) => s.id),
    ['single_slash', 'combo_1', 'combo_2', 'combo_3', 'delayed_overhead', 'unblockable_thrust', 'single_slash'],
  );
  assert.deepEqual(
    a.ends.slice(0, 4).map((e) => `${e.id}:${e.reason}`),
    ['single:done', 'combo3:done', 'delayed:done', 'unblockable:done'],
  );
  assert.deepEqual(a.results(), [], 'out of reach the whole time');
});

test('windup times come from the data', () => {
  for (const s of DUMMY_STRINGS) {
    const a = arena([s], vec2(0, 4.2));
    a.sb.run(60 * 5);
    const gaps = a.strikes.slice(1, s.steps.length).map((x, i) => x.frame - a.strikes[i].frame);
    s.steps.slice(1).forEach((step, i) => {
      const expected = Math.round((s.steps[i].active + s.steps[i].recovery + step.windup) * 60);
      assert.ok(Math.abs(gaps[i] - expected) <= 1, `${s.id} step ${i + 1}: ${gaps[i]} frames, expected ${expected}`);
    });
    const first = Math.round(s.steps[0].windup * 60);
    assert.ok(Math.abs(a.strikes[0].frame - 1 - first) <= 1, `${s.id}: first strike at frame ${a.strikes[0].frame}`);
  }
});

test('stays idle while she is out of engage range', () => {
  const a = arena(DUMMY_STRINGS, vec2(0, 6));
  a.sb.run(60 * 4);
  assert.equal(a.strikes.length, 0);
  assert.equal(a.ai.phase, 'idle');
});

test('tracks her during windup, then locks its aim just before the strike', () => {
  const s = byId('delayed');
  const a = arena([s], vec2(0, 2.4));
  const lockFrame = Math.round((s.steps[0].windup - a.ai.cfg.trackLock) * 60);
  let facingAtLock: Vec2 | null = null;
  // Walk right the whole windup.
  for (let f = 1; a.strikes.length === 0 && f < 200; f++) {
    a.sb.step({ stick: RIGHT });
    if (f === lockFrame + 2) facingAtLock = { ...a.dummy.facing };
  }
  assert.ok(facingAtLock, 'reached the lock frame');
  assert.ok(facingAtLock!.x > 0.3, 'turned to follow her');
  assert.deepEqual(a.dummy.facing, facingAtLock, 'no turning after the lock');
});

test('disabling it mid-windup cancels the string', () => {
  const a = arena([byId('delayed')]);
  a.sb.run(30);
  assert.equal(a.ai.phase, 'windup');
  a.ai.setEnabled(false);
  a.sb.run(120);
  assert.equal(a.strikes.length, 0);
  assert.deepEqual(a.ends.map((e) => e.reason), ['disabled']);
});

// ---------------------------------------------------- timing windows hold

test('perfect block triggers on every frame inside the window, and not outside it', () => {
  for (const id of ['single', 'delayed']) {
    const strings = [byId(id)];
    // Window 0.12 s = 7 frames. Pressed 1 to 7 frames early: perfect.
    for (let lead = 1; lead <= 7; lead++) {
      const a = pressBeforeStrike(strings, lead, { block: true }, { block: true });
      assert.equal(a.results()[0], 'perfectBlock', `${id}, block ${lead} frames early`);
      assert.equal(a.dummy.poise.value, 30, 'perfect block deals poise');
    }
    for (const lead of [9, 15]) {
      const a = pressBeforeStrike(strings, lead, { block: true }, { block: true });
      assert.equal(a.results()[0], 'blocked', `${id}, block ${lead} frames early is a normal block`);
    }
  }
});

test('one perfect block chains through the whole 3-hit combo', () => {
  const a = pressBeforeStrike([byId('combo3')], 3, { block: true }, { block: true });
  assert.deepEqual(a.results(), ['perfectBlock', 'perfectBlock', 'perfectBlock']);
  assert.equal(a.strikes.length, 3, 'parries do not end the string');
  assert.deepEqual(a.chains, [0, 1, 2], 'one chain, three links');
  assert.equal(a.dummy.poise.value, 90);
});

test('unblockable thrust: blocking fails, a timed perfect dodge works', () => {
  const strings = [byId('unblockable')];
  const blocked = pressBeforeStrike(strings, 3, { block: true }, { block: true });
  assert.deepEqual(blocked.results(), ['hit']);

  const locked: FrameInput = { target: true };
  // Perfect dodge window 0.15 s = 9 frames. Side hop out of the thrust line.
  for (let lead = 1; lead <= 8; lead++) {
    const a = pressBeforeStrike(strings, lead, { stick: RIGHT, evade: true }, {}, locked);
    assert.equal(a.results()[0], 'perfectDodge', `side hop ${lead} frames early`);
    assert.ok(a.sb.attacks.length === 0 || a.sb.player.state !== PlayerStateId.HitStun);
  }
  const early = pressBeforeStrike(strings, 14, { stick: RIGHT, evade: true }, {}, locked);
  assert.ok(!early.results().includes('perfectDodge'), 'too early: already clear, no perfect dodge');
  assert.ok(!early.results().includes('hit'), 'and not hit either');
});

// ------------------------------------------------------------ stagger

test('a posture break ends the string; it starts again after the stagger', () => {
  const strings = [byId('combo3')];
  const strikeAt = firstStrikeFrame(strings);
  const a = arena(strings);
  a.dummy.poise.add(80); // like real hits: one perfect block (30) now breaks it
  while (a.sb.frame < strikeAt - 4) a.sb.step();
  a.sb.step({ block: true });
  for (let i = 0; i < 30; i++) a.sb.step({ block: true });

  assert.deepEqual(a.results(), ['perfectBlock']);
  assert.equal(a.strikes.length, 1, 'combo_2 and combo_3 never came');
  assert.deepEqual(a.ends.map((e) => e.reason), ['staggered']);
  assert.ok(a.sb.combatLog.some((x) => x.type === 'enemyStaggered'));

  a.sb.run(60 * 4);
  assert.ok(a.strikes.length > 1, 'back to work after the stagger');
});
