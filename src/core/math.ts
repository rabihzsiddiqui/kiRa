/**
 * Planar vector on the ground plane.
 * x = world right (X axis), y = world forward (Z axis).
 * Height is owned by the physics layer, so gameplay logic stays 2D wherever it can.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;
export const ZERO2: Readonly<Vec2> = Object.freeze({ x: 0, y: 0 });

export const vec2 = (x = 0, y = 0): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l > 1e-6 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

export function clampLength(a: Vec2, max: number): Vec2 {
  const l = length(a);
  return l > max ? scale(a, max / l) : { ...a };
}

/** Right-hand side of a facing vector, seen from above. Facing (0,1) gives (1,0). */
export const rightOf = (f: Vec2): Vec2 => ({ x: f.y, y: -f.x });

/** Wraps an angle into [-PI, PI). */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Rotates unit vector `from` toward `to` by at most `maxRad`. */
export function rotateToward(from: Vec2, to: Vec2, maxRad: number): Vec2 {
  const a = Math.atan2(from.y, from.x);
  const b = Math.atan2(to.y, to.x);
  const d = wrapAngle(b - a);
  const step = Math.max(-maxRad, Math.min(maxRad, d));
  return { x: Math.cos(a + step), y: Math.sin(a + step) };
}
