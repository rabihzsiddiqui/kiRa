import type { Vec2 } from '../core/math';

/**
 * Logical actions. Devices (keyboard, gamepad, touch) map physical buttons to these,
 * so nothing past the input layer ever sees a key code.
 */
export enum Action {
  Attack = 'attack',
  Evade = 'evade',
  Block = 'block',
  Target = 'target',
}

export const ALL_ACTIONS: readonly Action[] = [Action.Attack, Action.Evade, Action.Block, Action.Target];

/**
 * One polled frame of input, produced by the device layer.
 * `stick` is the raw left stick in screen space: x = right, y = up/forward, length 0..1.
 *
 * Device layer note: for event-driven sources (keyboard), latch a key that was pressed
 * and released inside a single frame as "down" for that frame, or the tap is lost.
 */
export interface RawInputSample {
  time: number; // seconds, monotonic
  stick: Vec2;
  buttons: Partial<Record<Action, boolean>>;
}
