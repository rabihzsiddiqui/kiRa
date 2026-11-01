import { dot, length, rightOf, scale } from '../../core/math';
import { Action } from '../../input/actions';
import { PlayerStateId, type PlayerContext, type PlayerState } from '../contracts';
import { commitIntent, freeRunSpeed, moveVector, readIntent, steerFacing } from './shared';

/**
 * Idle / Run / Strafe as one state. They share every exit, and differ only in
 * how velocity and facing are computed, so splitting them would just copy the
 * same transition checks three times. The animator gets a `locomotion` param:
 * 0 idle, 1 run, 2 strafe.
 */
export class GroundedState implements PlayerState {
  readonly id = PlayerStateId.Grounded;

  enter(ctx: PlayerContext): void {
    ctx.animator.play('locomotion', 0.15);
  }

  update(ctx: PlayerContext, dt: number) {
    const { input, motor, targeting, tuning } = ctx;

    if (!motor.grounded) return { to: PlayerStateId.Airborne };
    if (input.isHeld(Action.Block)) return { to: PlayerStateId.Guard };

    // Attack held past the charge delay with nothing pending: start charging.
    // (Normally reached by holding through the end of a slash.)
    if (input.heldFor(Action.Attack) >= tuning.chargeDelay && !input.peek(Action.Attack)) {
      return { to: PlayerStateId.SpinCharge };
    }

    const t = commitIntent(ctx, readIntent(ctx, { allowAttack: true, allowEvade: true }));
    if (t) return t;

    const move = moveVector(ctx);
    const mag = length(move);
    steerFacing(ctx, move, dt);

    if (targeting.isLocked) {
      // Strafe: move along the stick, body stays on the target.
      motor.setPlanarVelocity(scale(move, tuning.strafeSpeed));
      ctx.animator.setFloat('locomotion', 2);
      ctx.animator.setFloat('strafeX', dot(move, rightOf(motor.facing)));
      ctx.animator.setFloat('strafeY', dot(move, motor.facing));
    } else {
      // Free run: travel along facing so turns arc instead of sliding.
      const speed = freeRunSpeed(ctx, mag);
      motor.setPlanarVelocity(scale(motor.facing, speed));
      ctx.animator.setFloat('locomotion', speed > 0 ? 1 : 0);
      ctx.animator.setFloat('speed', speed);
      // Near an enemy she stands ready (the alert idle), like Link with a foe close by.
      ctx.animator.setFloat('alert', targeting.targetNearby ? 1 : 0);
    }
  }
}

/** Falling off ledges. No actions; presses stay buffered for a landing attack. */
export class AirborneState implements PlayerState {
  readonly id = PlayerStateId.Airborne;

  enter(ctx: PlayerContext): void {
    ctx.animator.play('fall', 0.1);
  }

  update(ctx: PlayerContext, dt: number) {
    if (ctx.motor.grounded) return { to: PlayerStateId.Grounded };
    const move = moveVector(ctx);
    steerFacing(ctx, move, dt);
    ctx.motor.setPlanarVelocity(scale(move, ctx.tuning.runSpeed * 0.6));
  }
}
