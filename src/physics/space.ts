import type { Vec2 } from '../core/math';

/**
 * Maps the core's planar space to the 3D world shared by Rapier and three.js.
 *
 * The core uses x = right, y = forward, with rightOf((0, 1)) = (1, 0).
 * three.js is right-handed with Y up, and "forward" is -Z (where a default camera looks).
 * Facing -Z, your right hand points at +X. So planar y maps to -Z, not +Z;
 * mapping it to +Z would mirror the world and swap left and right slashes.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const planarTo3 = (p: Readonly<Vec2>, height = 0): Vec3 => ({ x: p.x, y: height, z: -p.y });

export const planarFrom3 = (v: Readonly<Vec3>): Vec2 => ({ x: v.x, y: -v.z });

/**
 * Yaw (rotation around +Y) that turns an object's local -Z toward planar `facing`.
 * Rotating -Z by yaw gives (-sin yaw, 0, -cos yaw); solve that against planarTo3(facing).
 */
export const yawFromFacing = (facing: Readonly<Vec2>): number => Math.atan2(-facing.x, facing.y);
