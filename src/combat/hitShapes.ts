import { dot, length, rightOf, sub, vec2, type Vec2 } from '../core/math';
import type { HitShape } from './moves';

/*
 * Hit shape geometry on the ground plane. A shape sits at the attacker's position,
 * centered on their facing. "Local" space: x = attacker's right, y = attacker's forward.
 *
 * The debug view draws shapeOutline(), and the overlap test uses shapeHitsCircle(), both
 * from the same HitShape data. test/combatWorld.test.ts checks that they agree.
 */

const DEG = Math.PI / 180;

/** World point into the attacker's local space. */
export function toLocal(p: Readonly<Vec2>, origin: Readonly<Vec2>, facing: Readonly<Vec2>): Vec2 {
  const d = sub(p, origin);
  return vec2(dot(d, rightOf(facing)), dot(d, facing));
}

/** Does a circle (a hurtbox) overlap the shape? radius 0 tests a single point. */
export function shapeHitsCircle(
  shape: HitShape,
  origin: Readonly<Vec2>,
  facing: Readonly<Vec2>,
  center: Readonly<Vec2>,
  radius: number,
): boolean {
  const p = toLocal(center, origin, facing);
  return distanceToShape(shape, p) <= radius;
}

/** Distance from a local-space point to the shape (0 inside). */
export function distanceToShape(shape: HitShape, p: Readonly<Vec2>): number {
  if (shape.kind === 'line') {
    // Box from the attacker's center out to `range`, `width` wide.
    const half = shape.width / 2;
    const cx = Math.max(-half, Math.min(half, p.x));
    const cy = Math.max(0, Math.min(shape.range, p.y));
    return Math.hypot(p.x - cx, p.y - cy);
  }

  const dist = length(p);
  const half = (shape.arcDeg / 2) * DEG;
  // Inside the angular span: only the radial distance matters.
  if (half >= Math.PI || Math.abs(Math.atan2(p.x, p.y)) <= half) return Math.max(0, dist - shape.range);
  // Outside it: nearest point is on one of the two straight edges.
  const edge = vec2(Math.sin(half) * Math.sign(p.x || 1), Math.cos(half));
  const along = Math.max(0, Math.min(shape.range, dot(p, edge)));
  return Math.hypot(p.x - edge.x * along, p.y - edge.y * along);
}

/**
 * Closed outline of the shape in local space, for debug drawing.
 * Arcs are a fan from the attacker's center; a full circle has no center point.
 */
export function shapeOutline(shape: HitShape, segments = 32): Vec2[] {
  if (shape.kind === 'line') {
    const h = shape.width / 2;
    return [vec2(-h, 0), vec2(h, 0), vec2(h, shape.range), vec2(-h, shape.range)];
  }
  const half = Math.min(shape.arcDeg / 2, 180) * DEG;
  const full = half >= Math.PI;
  const steps = Math.max(2, Math.ceil((segments * (2 * half)) / (2 * Math.PI)));
  const points: Vec2[] = full ? [] : [vec2(0, 0)];
  const count = full ? steps : steps + 1;
  for (let i = 0; i < count; i++) {
    const a = -half + (2 * half * i) / steps;
    points.push(vec2(Math.sin(a) * shape.range, Math.cos(a) * shape.range));
  }
  return points;
}
