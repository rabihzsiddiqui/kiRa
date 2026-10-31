import { normalize, scale, sub, type Vec2 } from '../../core/math';
import { Action } from '../../input/actions';
import { AttackId, EvadeId } from '../../combat/moves';
import { PlayerStateId, type Defense, type PlayerContext, type PlayerState } from '../contracts';
import { commitIntent, readIntent, type AttackParams } from './shared';

/*
 * Stellar Blade layer. Both states are entered ONLY by PlayerController.receiveHit,
 * never by input, so the rest of the FSM doesn't know they exist.
 *
 * The drama (slow-mo, afterimages, camera, sound) is not in here. These states
 * emit perfectDodge / perfectBlock, and src/feel/CombatFeel.ts reacts. That keeps
 * gameplay timing testable and lets art tune the spectacle without touching logic.
 */

export interface PerfectDodgeParams {
  /** Attacker position. Pass a live reference so the counter tracks a moving enemy. */
  from: Readonly<Vec2>;
  evade: EvadeId;
  dir: Vec2;
}

export interface PerfectBlockParams {
  from: Readonly<Vec2>;
  chain: number;
}

/** Each base evade flows into its own flourish, so the perfect version reads as an upgrade. */
const FLIP_ANIM: Record<EvadeId, string> = {
  [EvadeId.Roll]: 'pd_aerial_cartwheel',
  [EvadeId.SideHopLeft]: 'pd_corkscrew_left',
  [EvadeId.SideHopRight]: 'pd_corkscrew_right',
  [EvadeId.Backflip]: 'pd_backflip_twist',
};

const PD_UP_SPEED = 4.5; // airtime ~0.45 s at g = 20
const PD_TRAVEL_SPEED = 5;
const PD_COUNTER_OPEN = 0.12; // a short beat so the flip always reads before the counter
const PB_COUNTER_OPEN = 0.06;
const PB_EVADE_OPEN = 0.2;
const PB_STEP_IN = 2.5; // m/s toward the attacker: she pushes INTO the clash, not away

export class PerfectDodgeState implements PlayerState {
  readonly id = PlayerStateId.PerfectDodge;
  private t = 0;
  private from: Readonly<Vec2> = { x: 0, y: 0 };
  private dir: Vec2 = { x: 0, y: 0 };
  private counterQueued = false;

  enter(ctx: PlayerContext, params: unknown): void {
    const p = params as PerfectDodgeParams;
    this.t = 0;
    this.from = p.from;
    this.dir = normalize(p.dir);
    this.counterQueued = false;

    // Only presses made AFTER the perfect dodge count toward the counter.
    ctx.input.flush();

    ctx.motor.turnToward(normalize(sub(this.from, ctx.motor.position)), Infinity, 0);
    ctx.motor.launch(PD_UP_SPEED);
    ctx.animator.play(FLIP_ANIM[p.evade], 0.03);
    ctx.events.emit('perfectDodge', { from: { ...this.from }, evade: p.evade, dir: this.dir });
  }

  update(ctx: PlayerContext, dt: number) {
    const { motor, tuning } = ctx;
    this.t += dt;

    motor.turnToward(normalize(sub(this.from, motor.position)), tuning.lockTurnRate, dt);
    const k = Math.max(0, 1 - this.t / tuning.perfectDodgeDuration);
    motor.setPlanarVelocity(scale(this.dir, PD_TRAVEL_SPEED * k));

    // Latch the press: this state runs on the slowed player clock, the buffer on real
    // time, so an early press must not be allowed to expire before the counter opens.
    this.counterQueued ||= latchPress(ctx);
    if (this.t >= PD_COUNTER_OPEN && this.counterQueued) {
      return {
        to: PlayerStateId.Attack,
        params: { attack: AttackId.PhantomDash, combo: 0, aimAt: this.from } satisfies AttackParams,
      };
    }

    if (this.t >= tuning.perfectDodgeDuration) {
      return { to: motor.grounded ? PlayerStateId.Grounded : PlayerStateId.Airborne };
    }
  }

  defense(): Defense {
    return { invulnerable: true, guarding: false };
  }
}

export class PerfectBlockState implements PlayerState {
  readonly id = PlayerStateId.PerfectBlock;
  private t = 0;
  private from: Readonly<Vec2> = { x: 0, y: 0 };
  private _chain = 0;
  private counterQueued = false;

  /** How many perfect blocks in a row (multi-hit enemy strings). */
  get chain(): number {
    return this._chain;
  }

  enter(ctx: PlayerContext, params: unknown): void {
    const p = params as PerfectBlockParams;
    this.t = 0;
    this.from = p.from;
    this._chain = p.chain;
    this.counterQueued = false;

    ctx.input.flush();
    ctx.motor.turnToward(normalize(sub(this.from, ctx.motor.position)), Infinity, 0);
    // Alternate clash poses so chained parries don't look like one clip looping.
    ctx.animator.play(this._chain % 2 === 0 ? 'pb_clash_a' : 'pb_clash_b', 0.02);
    ctx.events.emit('perfectBlock', { from: { ...this.from }, chain: this._chain });
  }

  update(ctx: PlayerContext, dt: number) {
    const { input, motor, tuning } = ctx;
    this.t += dt;

    const toAttacker = normalize(sub(this.from, motor.position));
    const step = Math.max(0, 1 - this.t / 0.15);
    motor.setPlanarVelocity(scale(toAttacker, PB_STEP_IN * step));

    this.counterQueued ||= latchPress(ctx);
    if (this.t >= PB_COUNTER_OPEN && this.counterQueued) {
      return {
        to: PlayerStateId.Attack,
        params: { attack: AttackId.Overpower, combo: 0, aimAt: this.from } satisfies AttackParams,
      };
    }

    if (this.t >= PB_EVADE_OPEN) {
      const next = commitIntent(ctx, readIntent(ctx, { allowAttack: false, allowEvade: true }));
      if (next) return next;
    }

    if (this.t >= tuning.perfectBlockDuration) {
      return { to: input.isHeld(Action.Block) ? PlayerStateId.Guard : PlayerStateId.Grounded };
    }
  }

  /** Stays perfect so the next hit of a multi-hit string can chain another perfect block. */
  defense(): Defense {
    return { invulnerable: false, guarding: true, perfectBlock: true };
  }
}

function latchPress(ctx: PlayerContext): boolean {
  const press = ctx.input.peek(Action.Attack);
  if (!press) return false;
  ctx.input.consume(press);
  return true;
}
