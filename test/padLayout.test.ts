import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUTTON, padFamily, padLabels, pickPad, readPad, type PadLike } from '../src/app/input/padLayout';
import { Action } from '../src/input/actions';

/** A fake pad: 17 buttons, 4 axes, everything at rest unless set. */
function pad(opts: { id?: string; mapping?: string; axes?: number[]; pressed?: number[]; values?: Record<number, number> } = {}): PadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: opts.pressed?.includes(i) ?? false,
    value: opts.values?.[i] ?? (opts.pressed?.includes(i) ? 1 : 0),
  }));
  return {
    id: opts.id ?? 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
    mapping: opts.mapping ?? 'standard',
    connected: true,
    axes: opts.axes ?? [0, 0, 0, 0],
    buttons,
  };
}

test('recognises xbox, playstation and switch pads, with their own button names', () => {
  assert.equal(padFamily('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)'), 'xbox');
  assert.equal(padFamily('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'), 'playstation');
  assert.equal(padFamily('Wireless Controller (Vendor: 054c Product: 09cc)'), 'playstation');
  assert.equal(padFamily('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'), 'switch');
  assert.equal(padFamily('8BitDo SN30 Pro'), 'generic');
  assert.deepEqual(padLabels('playstation'), {
    attack: '□', evade: '×', block: 'r1', target: 'l2', leftClick: 'l3', rightClick: 'r3',
  });
  assert.equal(padLabels('generic').attack, 'x');
});

test('face buttons by position: west attacks, south evades, rb blocks, lt (analog) targets', () => {
  const f = readPad(pad({ pressed: [BUTTON.west, BUTTON.south, BUTTON.rb] }));
  assert.deepEqual(f.buttons, { [Action.Attack]: true, [Action.Evade]: true, [Action.Block]: true });
  assert.equal(readPad(pad({ values: { [BUTTON.lt]: 0.3 } })).buttons[Action.Target], undefined, 'light trigger touch');
  assert.equal(readPad(pad({ values: { [BUTTON.lt]: 0.6 } })).buttons[Action.Target], true, 'trigger past threshold');
});

test('left stick: y flipped to forward, deadzone removed, still reaches full length', () => {
  assert.deepEqual(readPad(pad({ axes: [0.1, -0.1, 0, 0] })).stick, { x: 0, y: 0 }, 'inside the deadzone');
  const up = readPad(pad({ axes: [0, -1, 0, 0] })).stick;
  assert.ok(Math.abs(up.y - 1) < 1e-9 && up.x === 0, 'pushing up is forward, full length');
  const half = readPad(pad({ axes: [0.5, 0, 0, 0] })).stick;
  assert.ok(half.x > 0.35 && half.x < 0.5, 'rescaled past the deadzone');
});

test('right stick look uses a squared curve for fine aim', () => {
  const small = readPad(pad({ axes: [0, 0, 0.4, 0] })).look.x;
  const full = readPad(pad({ axes: [0, 0, 1, 0] })).look.x;
  assert.ok(Math.abs(full - 1) < 1e-9);
  assert.ok(small > 0 && small < 0.15, `small push turns slowly (${small.toFixed(3)})`);
});

test('pads with no standard mapping are still used; standard ones are preferred', () => {
  const odd = pad({ id: 'Generic USB Joystick', mapping: '' });
  const std = pad();
  assert.equal(pickPad([null, odd]), odd, 'a non-standard pad is better than none');
  assert.equal(pickPad([odd, std]), std);
  assert.equal(pickPad([null, { ...std, connected: false }]), null);
});

test('activity and debug buttons', () => {
  assert.equal(readPad(pad()).active, false, 'a resting pad is not the active device');
  assert.equal(readPad(pad({ axes: [0, 0, 0.5, 0] })).active, true);
  const f = readPad(pad({ pressed: [BUTTON.start, BUTTON.dpadRight] }));
  assert.deepEqual([...f.debug].sort(), ['nextString', 'pause']);
  assert.equal(f.active, true);
  const clicks = readPad(pad({ pressed: [BUTTON.l3, BUTTON.r3] }));
  assert.deepEqual([...clicks.debug].sort(), ['infinitePerfect', 'slowmo'], 'stick clicks toggle the hud switches');
});
