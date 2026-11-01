import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AttackId } from '../src/combat/moves';
import { vec2 } from '../src/core/math';
import { Action } from '../src/input/actions';
import { HeadlessSandbox } from '../src/sandbox/HeadlessSandbox';
import { PlayerStateId } from '../src/player/contracts';
import { AttackPhase } from '../src/player/states/AttackState';

/*
 * Phase 7: what the debug HUD reads from the core, and its two debug switches.
 * The HUD itself is DOM; everything it shows comes from these readouts.
 */

// ------------------------------------------------------------ readouts

test('pending presses: a press made mid-roll waits in the buffer, then ages out', () => {
  const sb = new HeadlessSandbox();
  sb.step({ evade: true });
  sb.step();
  sb.step({ evade: true }); // a second roll: the first can't cancel yet
  const pending = sb.input.pending;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].action, Action.Evade);
  assert.equal(sb.input.now - pending[0].time, 0, 'fresh press, age 0');

  sb.run(13); // 0.22 s, past the 0.2 s buffer window
  assert.equal(sb.input.pending.length, 0, 'aged out');
});

test('pending presses: a used press leaves the buffer', () => {
  const sb = new HeadlessSandbox();
  sb.step({ attack: true });
  assert.equal(sb.input.pending.length, 0, 'fired on the frame it landed');
});

test('attack readout follows the phases of the move', () => {
  const sb = new HeadlessSandbox();
  // Read through a function: an assert on the getter would narrow its type for the rest of the test.
  const attack = () => sb.player.attack;
  assert.equal(attack(), null);
  sb.step({ attack: true });
  assert.deepEqual(attack(), { attack: AttackId.Horizontal, phase: AttackPhase.Startup, combo: 0 });

  const seen = new Set<AttackPhase>();
  for (let i = 0; i < 60; i++) {
    const a = attack();
    if (!a) break;
    seen.add(a.phase);
    sb.step();
  }
  assert.deepEqual([...seen], [AttackPhase.Startup, AttackPhase.Active, AttackPhase.Recovery]);
  assert.equal(attack(), null, 'back to grounded');
});

test('perfect dodge window bar: full at the start of an evade, drains, then closes', () => {
  const sb = new HeadlessSandbox();
  assert.equal(sb.player.perfectWindows().dodge, 0);
  sb.step({ evade: true });
  const first = sb.player.perfectWindows().dodge;
  sb.run(4);
  const later = sb.player.perfectWindows().dodge;
  assert.ok(first > later && later > 0, `drains (${first.toFixed(2)} -> ${later.toFixed(2)})`);
  sb.run(6); // past 0.15 s
  assert.equal(sb.player.perfectWindows().dodge, 0);
});

test('perfect block window bar: open on a fresh press, closed when held, locked out when mashed', () => {
  const sb = new HeadlessSandbox();
  sb.step({ block: true });
  assert.ok(sb.player.perfectWindows().block > 0.8);
  sb.run(10, { block: true }); // 0.18 s held
  assert.equal(sb.player.perfectWindows().block, 0);
  assert.equal(sb.player.perfectWindows().blockLockedOut, false, 'just held too long, not mashing');

  sb.step({});
  sb.step({ block: true }); // re-press right away
  const w = sb.player.perfectWindows();
  assert.equal(w.block, 0);
  assert.equal(w.blockLockedOut, true);
});

test('perfect block bar stays full during a perfect block, so the next hit can chain', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 2.5);
  sb.step({ block: true });
  assert.equal(sb.hitFrom(e), 'perfectBlock');
  sb.run(5, { block: true });
  assert.equal(sb.player.state, PlayerStateId.PerfectBlock);
  assert.equal(sb.player.perfectWindows().block, 1);
});

// ------------------------------------------------------------ infinite perfect window

test('infinite perfect window: late dodges and long-held guards count as perfect', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 3);
  sb.player.infinitePerfectWindows = true;
  assert.equal(sb.player.infinitePerfectWindows, true);

  sb.step({ evade: true });
  sb.run(20); // 0.35 s, normally past every window
  assert.equal(sb.player.perfectWindows().dodge, 1);
  assert.equal(sb.hitFrom(e), 'perfectDodge');

  const g = new HeadlessSandbox();
  const ge = g.addEnemy(0, 2.5);
  g.player.infinitePerfectWindows = true;
  g.run(60, { block: true }); // held a full second
  assert.equal(g.hitFrom(ge), 'perfectBlock');
});

test('infinite perfect window: turning it off restores the tuned windows', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 2.5);
  const before = { ...sb.player.ctx.tuning };
  sb.player.infinitePerfectWindows = true;
  sb.player.infinitePerfectWindows = false;
  assert.deepEqual(sb.player.ctx.tuning, before);
  sb.run(12, { block: true });
  assert.equal(sb.hitFrom(e), 'blocked', 'late block is normal again');
});

// ------------------------------------------------------------ slow-mo off

test('slow-mo off: perfect dodge still fires its cue and the counter, at full speed', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(3, 3);
  sb.feel.slowmo = false;
  sb.step({ stick: vec2(1, 0), evade: true });
  assert.equal(sb.hitFrom(e), 'perfectDodge');
  sb.step();
  assert.equal(sb.time.worldScale, 1);
  assert.equal(sb.time.playerScale, 1);
  assert.ok(sb.cues.includes('perfectDodge'), 'presentation still gets the cue');

  sb.step({ attack: true });
  sb.run(30);
  assert.deepEqual(sb.attacks, [AttackId.PhantomDash]);
});

test('slow-mo off: hit stops stay, and switching off mid slow-mo releases the clocks', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 2.5);
  sb.step({ block: true });
  sb.hitFrom(e); // perfect block: hit stop then slow-mo
  sb.step({ block: true });
  assert.ok(sb.time.worldScale < 0.1, 'hit stop');

  sb.run(8, { block: true });
  assert.ok(sb.time.worldScale < 1, 'in slow-mo');
  sb.feel.slowmo = false;
  sb.step({ block: true });
  assert.equal(sb.time.worldScale, 1);
  assert.ok(sb.cues.includes('slowmo.end'), 'post-processing is told to ease back');
});

test('spin charge readout: null until charging, fills to 1, null again after the spin', () => {
  const sb = new HeadlessSandbox();
  assert.equal(sb.player.spinCharge, null);
  sb.run(30, { attack: true }); // slash, then holding into the charge
  const early = sb.player.spinCharge;
  assert.ok(early !== null && early > 0 && early < 0.5, `building (${early})`);
  sb.run(50, { attack: true });
  assert.equal(sb.player.spinCharge, 1);
  sb.step({});
  assert.equal(sb.player.spinCharge, null, 'released into the spin');
});
