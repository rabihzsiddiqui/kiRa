import { add, length, normalize, rotateToward, scale, vec2, type Vec2 } from '../core/math';
import type { CharacterMotor } from '../player/contracts';

/**
 * Reference CharacterMotor: flat ground, gravity, no collision.
 * Good enough for the headless tests and a first browser prototype.
 * Replace with a capsule controller (Rapier KinematicCharacterController,
 * Unity CharacterController, Godot CharacterBody3D) behind the same interface.
 */
export class SimpleMotor implements CharacterMotor {
  position: Vec2 = vec2();
  facing: Vec2 = vec2(0, 1);
  height = 0;
  verticalSpeed = 0;
  gravity = 20;

  private velocity: Vec2 = vec2();

  get grounded(): boolean {
    return this.height <= 0 && this.verticalSpeed <= 0;
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

  /** Physics step. Runs after the player FSM each frame. */
  step(dt: number): void {
    this.position = add(this.position, scale(this.velocity, dt));
    if (this.height > 0 || this.verticalSpeed > 0) {
      this.verticalSpeed -= this.gravity * dt;
      this.height += this.verticalSpeed * dt;
      if (this.height <= 0) {
        this.height = 0;
        this.verticalSpeed = 0;
      }
    }
  }
}
