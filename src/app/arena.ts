import RAPIER from '@dimforge/rapier3d-compat';
import { vec2, type Vec2 } from '../core/math';
import { planarTo3 } from '../physics/space';

/**
 * Static layout of the test arena, in planar coordinates (see src/physics/space.ts).
 * Physics and render both build from this, so colliders and meshes always line up.
 */
export interface BoxSpec {
  center: Vec2;
  /** Half extents along planar x and planar y. */
  half: Vec2;
  height: number;
}

export interface PillarSpec {
  center: Vec2;
  radius: number;
  height: number;
}

export interface ArenaLayout {
  /** Half the floor's side length. */
  half: number;
  walls: BoxSpec[];
  pillars: PillarSpec[];
  playerSpawn: Vec2;
  dummy: { position: Vec2; radius: number; height: number };
}

const HALF = 16;
const WALL = { height: 1.2, thickness: 0.3 };

export const ARENA: ArenaLayout = {
  half: HALF,
  walls: [
    { center: vec2(0, HALF), half: vec2(HALF, WALL.thickness), height: WALL.height },
    { center: vec2(0, -HALF), half: vec2(HALF, WALL.thickness), height: WALL.height },
    { center: vec2(HALF, 0), half: vec2(WALL.thickness, HALF), height: WALL.height },
    { center: vec2(-HALF, 0), half: vec2(WALL.thickness, HALF), height: WALL.height },
  ],
  // Tall enough to read as columns. The radius is the shaft plus its base, so she stops at
  // the stone on every stage.
  pillars: [
    { center: vec2(-8, 8), radius: 0.6, height: 5.5 },
    { center: vec2(8, 8), radius: 0.6, height: 5.5 },
    { center: vec2(-8, -8), radius: 0.6, height: 5.5 },
    { center: vec2(8, -8), radius: 0.6, height: 5.5 },
  ],
  playerSpawn: vec2(0, 0),
  // 5 m ahead of the spawn, the same setup the headless tests use.
  dummy: { position: vec2(0, 5), radius: 0.35, height: 1.8 },
};

/**
 * Static colliders only. Characters add their own (see RapierMotor).
 * Returns the level geometry that should block the camera (everything but the dummy).
 */
export function buildArenaPhysics(world: RAPIER.World, a: ArenaLayout = ARENA): RAPIER.Collider[] {
  const level: RAPIER.Collider[] = [];
  level.push(world.createCollider(RAPIER.ColliderDesc.cuboid(a.half, 0.5, a.half).setTranslation(0, -0.5, 0)));

  for (const w of a.walls) {
    const c = planarTo3(w.center, w.height / 2);
    level.push(world.createCollider(RAPIER.ColliderDesc.cuboid(w.half.x, w.height / 2, w.half.y).setTranslation(c.x, c.y, c.z)));
  }
  for (const p of a.pillars) {
    const c = planarTo3(p.center, p.height / 2);
    level.push(world.createCollider(RAPIER.ColliderDesc.cylinder(p.height / 2, p.radius).setTranslation(c.x, c.y, c.z)));
  }
  const d = planarTo3(a.dummy.position, a.dummy.height / 2);
  world.createCollider(RAPIER.ColliderDesc.cylinder(a.dummy.height / 2, a.dummy.radius).setTranslation(d.x, d.y, d.z));
  return level;
}
