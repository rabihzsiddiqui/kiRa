import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessSandbox, type FrameInput } from '../src/sandbox/HeadlessSandbox';
import { PlayerStateId } from '../src/player/contracts';
import { actionPrompts, controlsFor, promptKeys, targetStatus, type PromptAction } from '../src/app/hudModel';
import { padLabels } from '../src/app/input/padLayout';

/*
 * The player HUD's button prompts: each button says what it does this moment.
 * Driven by a headless sandbox, the same readouts the browser HUD paints.
 */

function verbs(sb: HeadlessSandbox): Record<PromptAction, string> {
  const prompts = actionPrompts({
    state: sb.player.state,
    locked: sb.targeting.isLocked,
    viewLocked: sb.targeting.isViewLocked,
    targetNearby: sb.targeting.targetNearby,
    spinCharge: sb.player.spinCharge,
  });
  return Object.fromEntries(prompts.map((p) => [p.action, p.verb])) as Record<PromptAction, string>;
}

const hot = (sb: HeadlessSandbox) =>
  actionPrompts({
    state: sb.player.state,
    locked: sb.targeting.isLocked,
    viewLocked: sb.targeting.isViewLocked,
    targetNearby: sb.targeting.targetNearby,
    spinCharge: sb.player.spinCharge,
  }).find((p) => p.action === 'attack')?.hot;

test('standing alone: attack, roll, guard, and target centers the view', () => {
  const sb = new HeadlessSandbox();
  sb.step();
  assert.deepEqual(verbs(sb), { attack: 'attack', evade: 'roll', block: 'guard', target: 'center view' });
});

test('an enemy in range: target says lock on, and once locked, evade turns into jump', () => {
  const sb = new HeadlessSandbox();
  sb.addEnemy(0, 3);
  sb.step();
  assert.equal(verbs(sb).target, 'lock on');
  sb.run(2, { target: true });
  assert.ok(sb.targeting.isLocked);
  assert.equal(verbs(sb).target, 'release');
  assert.equal(verbs(sb).evade, 'jump');
});

test('view lock with nothing around also reads jump and release', () => {
  const sb = new HeadlessSandbox();
  sb.addEnemy(0, 40);
  sb.run(2, { target: true });
  assert.ok(sb.targeting.isViewLocked);
  assert.equal(verbs(sb).evade, 'jump');
  assert.equal(verbs(sb).target, 'release');
});

test('holding attack: charging, then a lit spin prompt once the charge is full', () => {
  const sb = new HeadlessSandbox();
  const hold: FrameInput = { attack: true };
  sb.step(hold);
  // Hold through the opening slash until the charge starts.
  for (let i = 0; i < 120 && sb.player.state !== PlayerStateId.SpinCharge; i++) sb.step(hold);
  assert.equal(sb.player.state, PlayerStateId.SpinCharge);
  assert.equal(verbs(sb).attack, 'charging');
  assert.equal(hot(sb), false);

  for (let i = 0; i < 120 && (sb.player.spinCharge ?? 0) < 1; i++) sb.step(hold);
  assert.equal(verbs(sb).attack, 'let go: spin');
  assert.equal(hot(sb), true);
});

test('perfect dodge lights the attack prompt as phantom dash', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(3, 3);
  sb.step({ evade: true });
  sb.hitFrom(e);
  sb.step();
  assert.equal(sb.player.state, PlayerStateId.PerfectDodge);
  assert.equal(verbs(sb).attack, 'phantom dash');
  assert.equal(hot(sb), true);
});

test('perfect block lights the attack prompt as overpower', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 1.5);
  sb.step({ block: true });
  assert.equal(sb.hitFrom(e), 'perfectBlock');
  sb.step({ block: true });
  assert.equal(sb.player.state, PlayerStateId.PerfectBlock);
  assert.equal(verbs(sb).attack, 'overpower');
});

test('prompt keys follow the device: keyboard keys, or the pad family names', () => {
  assert.deepEqual(promptKeys('keyboard', padLabels('xbox')), { attack: 'j', evade: 'space', block: 'k', target: 'shift' });
  assert.deepEqual(promptKeys('gamepad', padLabels('playstation')), { attack: '□', evade: '×', block: 'r1', target: 'l2' });
});

test('every controls list says how to open the debug panels', () => {
  for (const kind of ['keyboard', 'gamepad', 'touch'] as const) {
    const rows = controlsFor(kind, padLabels('xbox'));
    assert.ok(rows.some(([k]) => k === 'debug'), `${kind} lists debug`);
    assert.ok(rows.some(([k]) => k === 'spin'), `${kind} lists the spin`);
  }
});

test('target status: quiet when ready, plain words otherwise', () => {
  assert.equal(targetStatus('ready'), '');
  assert.equal(targetStatus('staggered'), 'posture broken');
  assert.equal(targetStatus('parried'), 'parried');
});
