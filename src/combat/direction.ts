import { add, dot, length, rightOf, scale, type Vec2 } from '../core/math';

export enum Dir {
  Neutral = 'neutral',
  Forward = 'forward',
  Back = 'back',
  Left = 'left', // away from her sword hand
  Right = 'right',
}

/** Camera's planar basis, refreshed by the camera module every frame. */
export interface CameraBasis {
  forward: Vec2;
  right: Vec2;
}

/** Converts a screen-space stick into a world-space planar direction (keeps magnitude). */
export function stickToWorld(stick: Readonly<Vec2>, cam: CameraBasis): Vec2 {
  return add(scale(cam.right, stick.x), scale(cam.forward, stick.y));
}

/**
 * Buckets a world direction into 4 sectors relative to `frameForward`
 * (her facing when locked on). Each sector is 90 degrees wide.
 */
export function classifyDir(world: Vec2, frameForward: Vec2, deadzone: number): Dir {
  if (length(world) < deadzone) return Dir.Neutral;
  const f = dot(world, frameForward);
  const r = dot(world, rightOf(frameForward));
  const ang = Math.atan2(r, f); // 0 = forward, +PI/2 = right
  const a = Math.abs(ang);
  if (a <= Math.PI / 4) return Dir.Forward;
  if (a >= (3 * Math.PI) / 4) return Dir.Back;
  return ang > 0 ? Dir.Right : Dir.Left;
}
