import RAPIER from '@dimforge/rapier3d-compat';
import { length, normalize, rotateToward, vec2, type Vec2 } from '../core/math';
import type { CharacterMotor } from '../player/contracts';
import { planarFrom3, planarTo3 } from './space';

export interface RapierMotorConfig {
  radius: number;
  /** Half the length of the capsule's straight section. Total height = 2 * (halfHeight + radius). */
  halfHeight: number;
  /** Same value as SimpleMotor, so the launch speeds in moves.ts give the same airtime. */
  gravity: number;
  /** Gap Rapier keeps between the capsule and the world. Too small and it jitters. */
  skin: number;
  stepHeight: number;
  maxSlopeDeg: number;
}

export const DEFAULT_RAPIER_MOTOR: RapierMotorConfig = {
  radius: 0.35,
  halfHeight: 0.5,
  gravity: 20,
  skin: 0.02,
  stepHeight: 0.3,
  maxSlopeDeg: 45,
};

/**
 * CharacterMotor backed by a Rapier kinematic capsule and its character controller.
 * Same behaviour as SimpleMotor (planar velocity in, gravity, launch), plus collision.
 *
 * Call order each sim frame: step(playerDt), then world.step(). step() queues the
 * move with setNextKinematicTranslation; world.step() applies it.
 */
export class RapierMotor implements CharacterMotor {
  readonly cfg: RapierMotorConfig;
  position: Vec2;
  facing: Vec2 = vec2(0, 1);
  /** Height of her feet above y = 0. Gameplay stays planar; the renderer reads this. */
  height = 0;
  verticalSpeed = 0;

  private velocity: Vec2 = vec2();
  /** She spawns standing on the floor. Starting false would flash Airborne on frame 1. */
  private onGround = true;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  /** Distance from her feet to the capsule's center. */
  private readonly centerOffset: number;

  constructor(world: RAPIER.World, spawn: Vec2 = vec2(), cfg: Partial<RapierMotorConfig> = {}) {
    this.cfg = { ...DEFAULT_RAPIER_MOTOR, ...cfg };
    const { radius, halfHeight, skin } = this.cfg;
    this.centerOffset = halfHeight + radius + skin;
    this.position = { ...spawn };

    const start = planarTo3(spawn, this.centerOffset);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y, start.z));
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius), this.body);

    this.controller = world.createCharacterController(skin);
    // No snap-to-ground: in Rapier 0.21 it pushes a resting capsule a little further into
    // the floor every frame (see test/rapierMotor.test.ts). Gravity alone keeps her down on
    // flat ground. Revisit when the arena gets slopes she should stick to while running.
    this.controller.enableAutostep(this.cfg.stepHeight, radius, false);
    this.controller.setMaxSlopeClimbAngle((this.cfg.maxSlopeDeg * Math.PI) / 180);
    this.controller.setSlideEnabled(true);
  }

  /** Matches SimpleMotor: launching clears grounded on the same frame. */
  get grounded(): boolean {
    return this.onGround && this.verticalSpeed <= 0;
  }

  get planarVelocity(): Readonly<Vec2> {
    return this.velocity;
  }

  setPlanarVelocity(v: Vec2): void {
    this.velocity = { ...v };
  }

  /** Infinity snaps regardless of dt. */
  turnToward(dir: Vec2, turnRate: number, dt: number): void {
    if (length(dir) < 1e-6) return;
    const d = normalize(dir);
    this.facing = turnRate === Infinity ? d : rotateToward(this.facing, d, turnRate * dt);
  }

  launch(upSpeed: number): void {
    this.verticalSpeed = upSpeed;
  }

  /** Physics step with the PLAYER-scaled dt. Runs after the player FSM each frame. */
  step(dt: number): void {
    if (dt <= 0) return;

    this.verticalSpeed -= this.cfg.gravity * dt;
    const planar = planarTo3(this.velocity);
    const desired = { x: planar.x * dt, y: this.verticalSpeed * dt, z: planar.z * dt };

    this.controller.computeColliderMovement(this.collider, desired);
    const moved = this.controller.computedMovement();
    const from = this.body.translation();
    const next = { x: from.x + moved.x, y: from.y + moved.y, z: from.z + moved.z };
    this.body.setNextKinematicTranslation(next);

    this.onGround = this.controller.computedGrounded();
    if (this.onGround && this.verticalSpeed < 0) this.verticalSpeed = 0;
    // Bumped a ceiling on the way up: start falling instead of sticking to it.
    if (this.verticalSpeed > 0 && moved.y < desired.y * 0.5) this.verticalSpeed = 0;

    this.position = planarFrom3(next);
    this.height = next.y - this.centerOffset;
  }
}
