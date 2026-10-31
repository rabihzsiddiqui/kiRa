import { add, length, normalize, scale, sub, ZERO2, type Vec2 } from '../../core/math';
import { Action } from '../../input/actions';
import { ATTACKS, attackDuration, AttackId, type AttackDef } from '../../combat/moves';
import { PlayerStateId, type Defense, type PlayerContext, type PlayerState } from '../contracts';
import { commitIntent, readIntent, type AttackParams } from './shared';

export enum AttackPhase {
  Startup = 'startup',
  Active = 'active',
  Recovery = 'recovery',
}

/**
 * One state runs every sword move. The AttackDef supplies timing, motion and
 * cancel windows, so adding a new attack is a data entry, not a new class.
 *
 *   |-- startup --|-- active --|------ recovery ------|
 *          comboOpen ^      evadeCancel ^   blockCancel ^
 */
export class AttackState implements PlayerState {
  readonly id = PlayerStateId.Attack;

  private def: AttackDef = ATTACKS[AttackId.Horizontal];
  private t = 0;
  private combo = 0;
  private _phase = AttackPhase.Startup;
  private hitboxOn = false;
  /** Meters of leap left to spend (the maxDistance budget). */
  private leapLeft = 0;
  private leapTime = 0;
  /** Live reference when it comes from a counter, so the dash chases a moving attacker. */
  private aimAt: Readonly<Vec2> | null = null;

  get attack(): AttackId {
    return this.def.id;
  }

  get phase(): AttackPhase {
    return this._phase;
  }

  get comboIndex(): number {
    return this.combo;
  }

  enter(ctx: PlayerContext, params: unknown): void {
    const p = params as AttackParams;
    this.def = ATTACKS[p.attack];
    this.combo = p.combo;
    this.t = 0;
    this._phase = AttackPhase.Startup;
    this.hitboxOn = false;
    this.aimAt = p.aimAt ?? null;

    const toTarget = this.aimDirection(ctx);

    if (this.def.leap) {
      const { upSpeed, maxDistance, travelTime } = this.def.leap;
      // No target: a short hop forward. With one, the budget is the cap; homing decides the rest.
      this.leapLeft = toTarget ? maxDistance : maxDistance * 0.5;
      this.leapTime = travelTime ?? this.def.startup + this.def.active;
      if (toTarget) ctx.motor.turnToward(toTarget, Infinity, 0);
      if (upSpeed > 0) ctx.motor.launch(upSpeed);
    } else if (toTarget && this.aimAt) {
      ctx.motor.turnToward(toTarget, Infinity, 0); // counters always face the attacker
    }

    ctx.animator.play(this.def.anim, 0.05);
    ctx.events.emit('attackStarted', { attack: this.def.id, combo: this.combo });
  }

  update(ctx: PlayerContext, dt: number) {
    const { def } = this;
    const { input, motor, tuning } = ctx;
    this.t += dt;
    this.updatePhase(ctx);

    // Soft aim: during wind-up, rotate toward the locked target.
    if (this.t < def.startup && def.tracking > 0) {
      const toTarget = this.aimDirection(ctx);
      if (toTarget) motor.turnToward(toTarget, def.tracking, dt);
    }

    if (def.leap) {
      motor.setPlanarVelocity(this.leapVelocity(ctx, dt));
    } else {
      motor.setPlanarVelocity(this._phase === AttackPhase.Recovery ? { ...ZERO2 } : scale(motor.facing, def.lunge));
    }

    // ---- cancels
    if (this.t >= def.blockCancel && input.isHeld(Action.Block)) return { to: PlayerStateId.Guard };

    const canCombo = this.t >= def.comboOpen && this.combo + 1 < tuning.maxCombo;
    const canEvade = this.t >= def.evadeCancel;
    if (canCombo || canEvade) {
      const combo = { from: def.id, step: this.combo + 1 };
      const intent = readIntent(ctx, { allowAttack: canCombo, allowEvade: canEvade, combo });
      const next = commitIntent(ctx, intent, intent.kind === 'attack' ? this.combo + 1 : 0);
      if (next) return next;
    }

    // ---- natural end
    if (this.t >= attackDuration(def)) {
      if (def.chargeable && input.isHeld(Action.Attack)) return { to: PlayerStateId.SpinCharge };
      return { to: motor.grounded ? PlayerStateId.Grounded : PlayerStateId.Airborne };
    }
  }

  defense(): Defense {
    return { invulnerable: !!this.def.invulnerable, guarding: false };
  }

  /**
   * Homing leap: each frame, aim at where the target is NOW and spread what's left of the
   * trip evenly over the time left. Steady speed reads as a natural jump; the budget caps
   * the total distance, and stopShort keeps her from landing on top of the target.
   */
  private leapVelocity(ctx: PlayerContext, dt: number): Vec2 {
    const leap = this.def.leap!;
    const timeLeft = this.leapTime - (this.t - dt); // time left at the start of this frame
    if (timeLeft <= 0 || this.leapLeft <= 0 || dt <= 0) return { ...ZERO2 };

    const aim = this.aimPoint(ctx);
    let dir: Vec2 = ctx.motor.facing;
    let wanted = this.leapLeft;
    if (aim) {
      const to = sub(aim, ctx.motor.position);
      dir = normalize(to);
      wanted = Math.max(0, length(to) - leap.stopShort);
    }
    const trip = Math.min(wanted, this.leapLeft);
    const step = Math.min(trip, (trip / Math.max(timeLeft, dt)) * dt);
    this.leapLeft -= step;
    return scale(dir, step / dt);
  }

  private aimPoint(ctx: PlayerContext): Readonly<Vec2> | null {
    if (this.aimAt) return this.aimAt;
    const dir = ctx.targeting.isLocked ? ctx.targeting.directionToTarget() : null;
    return dir ? add(ctx.motor.position, scale(dir, ctx.targeting.distanceToTarget())) : null;
  }

  /** Counter aim point first, then the locked target. */
  private aimDirection(ctx: PlayerContext): Vec2 | null {
    if (this.aimAt) return normalize(sub(this.aimAt, ctx.motor.position));
    return ctx.targeting.isLocked ? ctx.targeting.directionToTarget() : null;
  }

  exit(ctx: PlayerContext): void {
    if (this.hitboxOn) {
      ctx.combat.setHitboxActive(this.def, false);
      this.hitboxOn = false;
    }
  }

  private updatePhase(ctx: PlayerContext): void {
    const { def, t } = this;
    const next =
      t < def.startup ? AttackPhase.Startup
      : t < def.startup + def.active ? AttackPhase.Active
      : AttackPhase.Recovery;
    if (next === this._phase) return;

    const wantHitbox = next === AttackPhase.Active;
    if (wantHitbox !== this.hitboxOn) {
      ctx.combat.setHitboxActive(def, wantHitbox);
      this.hitboxOn = wantHitbox;
    }
    this._phase = next;
  }
}
