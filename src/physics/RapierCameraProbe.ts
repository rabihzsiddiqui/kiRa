import RAPIER from '@dimforge/rapier3d-compat';
import type { CameraCollider } from '../camera/CameraRig';
import type { Vec3 } from './space';

/**
 * Spring-arm collision for the CameraRig: a sphere cast through the Rapier world.
 * Only colliders in `blockers` stop the camera (level geometry). Characters are left
 * out on purpose, or every enemy walking behind her would shove the camera in.
 */
export class RapierCameraProbe implements CameraCollider {
  private readonly blockers: Set<number>;
  private readonly rotation = { x: 0, y: 0, z: 0, w: 1 };
  private readonly balls = new Map<number, RAPIER.Ball>();

  constructor(
    private readonly world: RAPIER.World,
    blockers: Iterable<RAPIER.Collider>,
  ) {
    this.blockers = new Set([...blockers].map((c) => c.handle));
  }

  cast(from: Readonly<Vec3>, to: Readonly<Vec3>, radius: number): number {
    const travel = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    if (travel.x === 0 && travel.y === 0 && travel.z === 0) return 1;

    // With maxToi = 1 and the full travel as velocity, time of impact is the free fraction.
    const hit = this.world.castShape(
      from,
      this.rotation,
      travel,
      this.ball(radius),
      0,
      1,
      false, // the focus can graze the floor; ignore shapes it is already touching and leaving
      undefined,
      undefined,
      undefined,
      undefined,
      (c) => this.blockers.has(c.handle),
    );
    return hit ? hit.time_of_impact : 1;
  }

  private ball(radius: number): RAPIER.Ball {
    let b = this.balls.get(radius);
    if (!b) {
      b = new RAPIER.Ball(radius);
      this.balls.set(radius, b);
    }
    return b;
  }
}
