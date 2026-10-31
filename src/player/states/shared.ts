import { clampLength, length, type Vec2 } from '../../core/math';
import { stickToWorld } from '../../combat/direction';
import { resolveIntent, type Intent, type ResolveOptions } from '../../combat/IntentResolver';
import type { AttackId, EvadeId } from '../../combat/moves';
import type { Transition } from '../../fsm/StateMachine';
import { PlayerStateId, type PlayerContext } from '../contracts';

export interface AttackParams {
  attack: AttackId;
  combo: number;
  /** Aim point for counters (the attacker), used when not locked on. */
  aimAt?: Readonly<Vec2>; // kept as a live reference, so dashes home in on a moving attacker
}

export interface EvadeParams {
  evade: EvadeId;
  dir: Vec2;
}

type T = Transition<PlayerStateId>;

/** Reads the current intent with this player's context filled in. */
export function readIntent(ctx: PlayerContext, opts: ResolveOptions): Intent {
  return resolveIntent(
    {
      input: ctx.input,
      camera: ctx.camera,
      facing: ctx.motor.facing,
      locked: ctx.targeting.isLocked,
      grounded: ctx.motor.grounded,
      dirDeadzone: ctx.tuning.dirDeadzone,
      untargetedFrame: ctx.tuning.untargetedFrame,
    },
    opts,
  );
}

/** Consumes the presses behind an intent and returns the matching transition. */
export function commitIntent(ctx: PlayerContext, intent: Intent, combo = 0): T | undefined {
  if (intent.kind === 'attack') {
    ctx.input.consume(...intent.presses);
    if (intent.usedSpinGesture) ctx.input.consumeSpinGesture();
    return { to: PlayerStateId.Attack, params: { attack: intent.attack, combo } satisfies AttackParams };
  }
  if (intent.kind === 'evade') {
    ctx.input.consume(...intent.presses);
    return { to: PlayerStateId.Evade, params: { evade: intent.evade, dir: intent.worldDir } satisfies EvadeParams };
  }
  return undefined;
}

/** Stick as a world-space planar vector, length 0..1. */
export function moveVector(ctx: PlayerContext): Vec2 {
  return clampLength(stickToWorld(ctx.input.stick, ctx.camera), 1);
}

/** Locked: face the target. Free: face the stick (if pushed). */
export function steerFacing(ctx: PlayerContext, move: Vec2, dt: number): void {
  const toTarget = ctx.targeting.isLocked ? ctx.targeting.directionToTarget() : null;
  if (toTarget) ctx.motor.turnToward(toTarget, ctx.tuning.lockTurnRate, dt);
  else if (length(move) >= ctx.tuning.dirDeadzone) ctx.motor.turnToward(move, ctx.tuning.turnRate, dt);
}
