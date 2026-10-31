import { normalize, scale, sub, type Vec2 } from '../../core/math';
import { Action } from '../../input/actions';
import { AttackId } from '../../combat/moves';
import { PlayerStateId, type Defense, type PlayerContext, type PlayerState } from '../contracts';
import { commitIntent, moveVector, readIntent, steerFacing, type AttackParams } from './shared';

/** Katana raised. Frontal hits are nullified by PlayerController.receiveHit. */
export class GuardState implements PlayerState {
  readonly id = PlayerStateId.Guard;

  enter(ctx: PlayerContext, _p: unknown, from: PlayerStateId | null): void {
    if (from !== PlayerStateId.GuardRecoil) ctx.animator.play('guard_raise', 0.06);
  }

  update(ctx: PlayerContext, dt: number) {
    if (!ctx.input.isHeld(Action.Block)) return { to: PlayerStateId.Grounded };
    if (!ctx.motor.grounded) return { to: PlayerStateId.Airborne };

    // Evading out of guard is allowed. Attacks are not (no free guard-cancel slashes).
    const next = commitIntent(ctx, readIntent(ctx, { allowAttack: false, allowEvade: true }));
    if (next) return next;

    const move = moveVector(ctx);
    steerFacing(ctx, move, dt);
    ctx.motor.setPlanarVelocity(scale(move, ctx.tuning.guardMoveSpeed));
  }

  defense(ctx: PlayerContext): Defense {
    return { invulnerable: false, guarding: true, perfectBlock: inPerfectBlockWindow(ctx) };
  }
}

/**
 * Perfect block = Block was pressed very recently and wasn't being mashed.
 * Measured on the input buffer's real-time clock, so slow-mo can't widen it.
 */
export function inPerfectBlockWindow(ctx: PlayerContext): boolean {
  const { input, tuning } = ctx;
  return (
    input.isHeld(Action.Block) &&
    input.heldFor(Action.Block) <= tuning.perfectBlockWindow &&
    input.pressGap(Action.Block) >= tuning.perfectBlockSpamLockout
  );
}

export interface ImpactParams {
  from: Vec2;
}

/** Short pushback after blocking a hit. Still guarding, so multi-hits stay blocked. */
export class GuardRecoilState implements PlayerState {
  readonly id = PlayerStateId.GuardRecoil;
  private t = 0;
  private push: Vec2 = { x: 0, y: 0 };

  enter(ctx: PlayerContext, params: unknown): void {
    const { from } = params as ImpactParams;
    this.t = 0;
    this.push = normalize(sub(ctx.motor.position, from));
    ctx.animator.play('guard_impact', 0.02);
    ctx.events.emit('guardImpact', { from });
  }

  update(ctx: PlayerContext, dt: number) {
    const { guardRecoilTime, guardPushback } = ctx.tuning;
    this.t += dt;
    const k = Math.max(0, 1 - this.t / guardRecoilTime);
    ctx.motor.setPlanarVelocity(scale(this.push, guardPushback * k));
    if (this.t >= guardRecoilTime) {
      return { to: ctx.input.isHeld(Action.Block) ? PlayerStateId.Guard : PlayerStateId.Grounded };
    }
  }

  defense(ctx: PlayerContext): Defense {
    return { invulnerable: false, guarding: true, perfectBlock: inPerfectBlockWindow(ctx) };
  }
}

/** Took a hit. Buffered presses are flushed so panic-mashing doesn't fire on recovery. */
export class HitStunState implements PlayerState {
  readonly id = PlayerStateId.HitStun;
  private t = 0;
  private push: Vec2 = { x: 0, y: 0 };

  enter(ctx: PlayerContext, params: unknown): void {
    const { from } = params as ImpactParams;
    this.t = 0;
    this.push = normalize(sub(ctx.motor.position, from));
    ctx.input.flush();
    ctx.animator.play('hurt', 0.02);
  }

  update(ctx: PlayerContext, dt: number) {
    const { hitStunTime, hitKnockback } = ctx.tuning;
    this.t += dt;
    const k = Math.max(0, 1 - this.t / hitStunTime);
    ctx.motor.setPlanarVelocity(scale(this.push, hitKnockback * k));
    if (this.t >= hitStunTime) {
      return { to: ctx.motor.grounded ? PlayerStateId.Grounded : PlayerStateId.Airborne };
    }
  }
}

/**
 * Hold Attack to charge, release to spin. Release before the charge completes
 * just lowers the sword. Block cancels the charge.
 */
export class SpinChargeState implements PlayerState {
  readonly id = PlayerStateId.SpinCharge;
  private charge = 0;
  private readyFired = false;

  get chargeTime(): number {
    return this.charge;
  }

  enter(ctx: PlayerContext): void {
    this.charge = 0;
    this.readyFired = false;
    ctx.animator.play('spin_charge', 0.1);
  }

  update(ctx: PlayerContext, dt: number) {
    const { input, tuning } = ctx;
    this.charge += dt;

    if (!this.readyFired && this.charge >= tuning.spinChargeTime) {
      this.readyFired = true;
      ctx.events.emit('spinChargeReady', {}); // sword glint, sfx, controller rumble
    }

    if (input.isHeld(Action.Block)) return { to: PlayerStateId.Guard };

    if (!input.isHeld(Action.Attack)) {
      if (this.charge >= tuning.spinChargeTime) {
        return { to: PlayerStateId.Attack, params: { attack: AttackId.Spin, combo: 0 } satisfies AttackParams };
      }
      return { to: PlayerStateId.Grounded };
    }

    // Evade cancels the charge (a roll is never more than a button away).
    const next = commitIntent(ctx, readIntent(ctx, { allowAttack: false, allowEvade: true }));
    if (next) return next;

    const move = moveVector(ctx);
    steerFacing(ctx, move, dt);
    ctx.motor.setPlanarVelocity(scale(move, tuning.chargeMoveSpeed));
  }
}
