import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOYSTICK_RADIUS,
  knobOffset,
  stickFromDrag,
  wantsTouchControls,
  zoneAt,
} from '../src/app/input/touchLayout';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('joystick: dragging up the screen is forward, right is right', () => {
  const up = stickFromDrag(0, -JOYSTICK_RADIUS);
  assert.ok(near(up.x, 0) && near(up.y, 1), 'thumb up = full forward');
  const right = stickFromDrag(JOYSTICK_RADIUS, 0);
  assert.ok(near(right.x, 1) && near(right.y, 0));
});

test('joystick: a resting thumb is neutral, and past the rim it stays at full length', () => {
  assert.deepEqual(stickFromDrag(3, -3), { x: 0, y: 0 }, 'inside the deadzone');
  const far = stickFromDrag(JOYSTICK_RADIUS * 3, JOYSTICK_RADIUS * 3);
  assert.ok(near(Math.hypot(far.x, far.y), 1), 'clamped to 1');
  const half = stickFromDrag(JOYSTICK_RADIUS * 0.5, 0);
  assert.ok(half.x > 0.35 && half.x < 0.5, `rescaled past the deadzone (${half.x.toFixed(2)})`);
});

test('joystick knob stays on the ring', () => {
  const k = knobOffset(JOYSTICK_RADIUS * 2, 0);
  assert.equal(k.x, JOYSTICK_RADIUS);
  assert.deepEqual(knobOffset(10, -5), { x: 10, y: -5 }, 'follows the thumb inside the ring');
});

test('left side grabs the stick, the rest of the screen looks around', () => {
  assert.equal(zoneAt(100, 1000), 'stick');
  assert.equal(zoneAt(700, 1000), 'look');
});

test('touch controls show on phones and tablets, not on laptops with a touchscreen', () => {
  assert.equal(wantsTouchControls({ coarsePointer: true, maxTouchPoints: 5 }), true);
  assert.equal(wantsTouchControls({ coarsePointer: false, maxTouchPoints: 10 }), false, 'touch laptop with a mouse');
  assert.equal(wantsTouchControls({ coarsePointer: false, maxTouchPoints: 0 }), false);
});
