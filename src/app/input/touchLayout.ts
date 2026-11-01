import { length, scale, vec2, type Vec2 } from '../../core/math';

/*
 * Touch layout math, pure functions only (no DOM), so it is tested like padLayout.
 * Screen space here is CSS pixels with y pointing down; the stick it produces has y up
 * (forward), like every other device.
 */

/** How far (px) the thumb travels from where it landed to reach full stick. */
export const JOYSTICK_RADIUS = 56;
/** Stick length below which the thumb counts as resting. */
export const JOYSTICK_DEADZONE = 0.12;
/** Camera turn per pixel dragged on the look side, radians. */
export const LOOK_SENSITIVITY = 0.006;
/** Share of the screen width, from the left, where a touch grabs the joystick. */
export const STICK_ZONE = 0.45;

/** Thumb offset from where it landed (px, y down) to a stick vector (y up, length 0..1). */
export function stickFromDrag(dx: number, dy: number, radius = JOYSTICK_RADIUS, deadzone = JOYSTICK_DEADZONE): Vec2 {
  const raw = vec2(dx / radius, -dy / radius);
  const l = length(raw);
  if (l < deadzone) return vec2();
  // Rescale past the deadzone so the stick still reaches full length at the rim.
  const k = Math.min(1, (l - deadzone) / (1 - deadzone));
  return scale(raw, k / l);
}

/** Where the knob is drawn: the thumb offset, clamped to the ring. */
export function knobOffset(dx: number, dy: number, radius = JOYSTICK_RADIUS): Vec2 {
  const l = Math.hypot(dx, dy);
  return l <= radius ? vec2(dx, dy) : vec2((dx / l) * radius, (dy / l) * radius);
}

/** Which control a touch that lands at x (on a screen `width` wide) belongs to. */
export function zoneAt(x: number, width: number): 'stick' | 'look' {
  return x < width * STICK_ZONE ? 'stick' : 'look';
}

/** Show touch controls on touch-first devices (a phone or tablet), not on laptops with a touchscreen. */
export function wantsTouchControls(env: { coarsePointer: boolean; maxTouchPoints: number }): boolean {
  return env.coarsePointer && env.maxTouchPoints > 0;
}

/**
 * What the evade button does right now, as its label: locked on, evade is the jump attack
 * (or a hop or backflip with the stick); free, it's a roll.
 */
export function evadeLabel(locked: boolean): 'jump' | 'roll' {
  return locked ? 'jump' : 'roll';
}
