import { normalize, scale, type Vec2 } from '../../core/math';
import { EVADES, EvadeId, type EvadeDef } from '../../combat/moves';
import { PlayerStateId, type Defense, type PlayerContext, type PlayerState } from '../contracts';
import { commitIntent, readIntent, type EvadeParams } from './shared';

/**
 * Roll, side hops and backflip. Direction was decided by the IntentResolver;
 * this state only executes the motion, the i-frames and the cancel window.
 */
export class EvadeState implements PlayerState {
  readonly id = PlayerStateId.Evade;

  private def: EvadeDef = EVADES[EvadeId.Roll];
  private t = 0;
  private dir: Vec2 = { x: 0, y: 1 };

  get evade(): EvadeId {
    return this.def.id;
  }

  enter(ctx: PlayerContext, params: unknown): void {
    const p = params as EvadeParams;
    this.def = EVADES[p.evade];
    this.dir = normalize(p.dir);
    this.t = 0;

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

    // Full speed, then ease out over the last quarter so landings don't skate.
    const easeStart = def.duration * 0.75;
    const k = this.t < easeStart ? 1 : Math.max(0, (def.duration - this.t) / (def.duration - easeStart));
    ctx.motor.setPlanarVelocity(scale(this.dir, def.speed * k));

    if (this.t >= def.cancelFrom) {
      const next = commitIntent(ctx, readIntent(ctx, { allowAttack: true, allowEvade: true }));
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
