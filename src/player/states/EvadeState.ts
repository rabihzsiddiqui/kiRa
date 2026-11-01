import { length, normalize, rotateToward, scale, type Vec2 } from '../../core/math';
import { EVADES, EvadeId, type EvadeDef } from '../../combat/moves';
import type { Transition } from '../../fsm/StateMachine';
import { PlayerStateId, type Defense, type PlayerContext, type PlayerState } from '../contracts';
import { commitIntent, freeRunSpeed, lockStance, moveVector, readIntent, type EvadeParams } from './shared';

/**
 * Roll, side hops and backflip. Direction was decided by the IntentResolver;
 * this state only executes the motion, the i-frames and the cancel window.
 *
 * Evades with an `attackFrom` (the roll) take an Attack press whenever it comes, and hold
 * the attack it resolves to (the roll thrust) until then. A press early in the roll would
 * otherwise run out of the input buffer long before she's back on her feet.
 */
export class EvadeState implements PlayerState {
  readonly id = PlayerStateId.Evade;

  private def: EvadeDef = EVADES[EvadeId.Roll];
  private t = 0;
  private dir: Vec2 = { x: 0, y: 1 };
  /** Traversal roll (not locked on): ends at run speed instead of a stop. */
  private carry = false;
  /** The attack pressed during this evade, waiting for attackFrom. */
  private followUp: Transition<PlayerStateId> | undefined;

  get evade(): EvadeId {
    return this.def.id;
  }

  /** Player-clock seconds since the evade started. */
  get elapsed(): number {
    return this.t;
  }

  enter(ctx: PlayerContext, params: unknown): void {
    const p = params as EvadeParams;
    this.def = EVADES[p.evade];
    this.dir = normalize(p.dir);
    this.t = 0;
    this.followUp = undefined;
    this.carry = this.def.faceTravel && !lockStance(ctx);

    if (this.def.faceTravel) ctx.motor.turnToward(this.dir, Infinity, 0);
    if (this.def.upSpeed > 0) ctx.motor.launch(this.def.upSpeed);

    ctx.animator.play(this.def.anim, 0.05);
    ctx.events.emit('evadeStarted', { evade: this.def.id, dir: this.dir });
  }

  update(ctx: PlayerContext, dt: number) {
    const { def } = this;
    this.t += dt;

    // Hops and flips keep her eyes on the target the whole time.
    if (!def.faceTravel && ctx.targeting.isLocked) {
      const toTarget = ctx.targeting.directionToTarget();
      if (toTarget) ctx.motor.turnToward(toTarget, ctx.tuning.lockTurnRate, dt);
    }

    // The roll bends toward the stick at a limited rate, so it can curve around things
    // without turning into a free run. She turns with it.
    if (def.steerRate > 0) {
      const move = moveVector(ctx);
      if (length(move) >= ctx.tuning.dirDeadzone) {
        this.dir = rotateToward(this.dir, normalize(move), def.steerRate * dt);
        ctx.motor.turnToward(this.dir, Infinity, 0);
      }
    }

    // Full speed, then ease out over the last quarter. Combat evades ease to a stop so
    // landings don't skate. A traversal roll eases into the run the stick is asking for,
    // so rolling while running keeps her momentum (neutral stick still stops).
    const easeStart = def.duration * 0.75;
    const k = this.t < easeStart ? 1 : Math.max(0, (def.duration - this.t) / (def.duration - easeStart));
    const exitSpeed = this.carry ? Math.min(def.speed, freeRunSpeed(ctx, length(moveVector(ctx)))) : 0;
    ctx.motor.setPlanarVelocity(scale(this.dir, exitSpeed + (def.speed - exitSpeed) * k));

    if (def.attackFrom !== undefined) {
      if (!this.followUp) this.followUp = commitIntent(ctx, readIntent(ctx, { allowAttack: true, allowEvade: false, evading: def.id }));
      if (this.followUp && this.t >= def.attackFrom) return this.followUp;
    }

    if (this.t >= def.cancelFrom) {
      const next = commitIntent(ctx, readIntent(ctx, { allowAttack: true, allowEvade: true, evading: def.id }));
      if (next) return next;
    }

    if (this.t >= def.duration) {
      return { to: ctx.motor.grounded ? PlayerStateId.Grounded : PlayerStateId.Airborne };
    }
  }

  defense(ctx: PlayerContext): Defense {
    const perfect = this.t <= ctx.tuning.perfectDodgeWindow;
    return {
      invulnerable: perfect || (this.t >= this.def.invulnFrom && this.t <= this.def.invulnTo),
      guarding: false,
      perfectDodge: perfect ? { evade: this.def.id, dir: this.dir } : undefined,
    };
  }
}
