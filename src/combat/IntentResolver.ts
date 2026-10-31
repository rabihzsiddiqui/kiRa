import { Action } from '../input/actions';
import type { BufferedPress, InputBuffer } from '../input/InputBuffer';
import { length, normalize, rightOf, scale, type Vec2 } from '../core/math';
import { classifyDir, Dir, stickToWorld, type CameraBasis } from './direction';
import { AttackId, ATTACKS, COMBO, EvadeId, SwingFamily } from './moves';

/**
 * What the player is asking for this frame. Pure data: the FSM decides whether
 * the current state allows it and commits it.
 */
export type Intent =
  | { kind: 'none' }
  | { kind: 'attack'; attack: AttackId; presses: BufferedPress[]; usedSpinGesture: boolean }
  | { kind: 'evade'; evade: EvadeId; worldDir: Vec2; presses: BufferedPress[] };

export interface ResolveContext {
  input: InputBuffer;
  camera: CameraBasis;
  facing: Vec2;
  locked: boolean;
  grounded: boolean;
  dirDeadzone: number;
  /**
   * Which frame decides Forward/Left when NOT locked on.
   * 'character': relative to her facing (running + Attack = vertical).
   * 'camera': relative to the camera (stick up + Attack = vertical, always).
   */
  untargetedFrame: 'character' | 'camera';
  /** Hits in a full combo. The last one is the ender (PlayerTuning.maxCombo). */
  maxCombo: number;
}

export interface ResolveOptions {
  allowAttack: boolean;
  allowEvade: boolean;
  /**
   * Set when chaining from an attack. `from` is the swing in progress (the next one flows
   * from where it leaves the blade), `step` the 0-based index of the swing being picked.
   */
  combo?: { from: AttackId; step: number };
}

const NONE: Intent = { kind: 'none' };

/**
 * The whole button-to-move table lives here, in one readable function.
 * Oldest press wins (Attack or Evade):
 *   Attack: 360 gesture -> Spin, else directional table -> swing family, then COMBO
 *           picks the swing: opener, the variant that flows from the last swing, or
 *           (on the last hit of a full combo) that family's ender
 *   Evade:  untargeted -> Roll
 *           targeted   -> Left/Right = side hop, Back = backflip,
 *                         Neutral/Forward = jump attack (no rolling while locked on)
 */
export function resolveIntent(ctx: ResolveContext, opts: ResolveOptions): Intent {
  // Airborne: keep presses buffered so an attack pressed just before landing fires on touchdown.
  if (!ctx.grounded) return NONE;

  const { input } = ctx;
  const atk = opts.allowAttack ? input.peek(Action.Attack) : undefined;
  const evd = opts.allowEvade ? input.peek(Action.Evade) : undefined;

  const first = atk && evd ? (atk.time <= evd.time ? atk : evd) : atk ?? evd;
  if (!first) return NONE;

  return first.action === Action.Attack ? attackIntent(ctx, first, opts) : evadeIntent(ctx, first, opts);
}

function attackIntent(ctx: ResolveContext, press: BufferedPress, opts: ResolveOptions): Intent {
  if (ctx.input.hasSpinGesture()) {
    // The spin turns the way the stick went round.
    const attack = ctx.input.spinGestureDirection === 'clockwise' ? AttackId.SpinClockwise : AttackId.Spin;
    return { kind: 'attack', attack, presses: [press], usedSpinGesture: true };
  }

  const frame = ctx.locked || ctx.untargetedFrame === 'character' ? ctx.facing : ctx.camera.forward;
  const dir = classifyDir(stickToWorld(press.stick, ctx.camera), frame, ctx.dirDeadzone);

  const family = COMBO[pickFamily(dir, ctx.locked)];
  const { combo } = opts;
  const attack =
    !combo ? family.opener
    : combo.step >= ctx.maxCombo - 1 ? family.finisher
    : family.from[ATTACKS[combo.from].endSide];
  return { kind: 'attack', attack, presses: [press], usedSpinGesture: false };
}

/**
 * Side slashes travel the way the stick points: Horizontal opens with a sweep right to
 * left (her forehand), Reverse with a sweep left to right. So Right + Attack = Reverse.
 */
export function pickFamily(dir: Dir, locked: boolean): SwingFamily {
  if (locked) {
    switch (dir) {
      case Dir.Forward: return SwingFamily.Thrust;
      case Dir.Right: return SwingFamily.Reverse;
      case Dir.Neutral: return SwingFamily.Vertical;
      default: return SwingFamily.Horizontal;
    }
  }
  switch (dir) {
    case Dir.Forward: return SwingFamily.Vertical;
    case Dir.Right: return SwingFamily.Reverse;
    default: return SwingFamily.Horizontal;
  }
}

function evadeIntent(ctx: ResolveContext, press: BufferedPress, opts: ResolveOptions): Intent {
  const world = stickToWorld(press.stick, ctx.camera);
  const hasDir = length(world) >= ctx.dirDeadzone;
  const travel = hasDir ? normalize(world) : ctx.facing;

  if (!ctx.locked) {
    return { kind: 'evade', evade: EvadeId.Roll, worldDir: travel, presses: [press] };
  }

  const right = rightOf(ctx.facing);
  switch (classifyDir(world, ctx.facing, ctx.dirDeadzone)) {
    case Dir.Left:
      return { kind: 'evade', evade: EvadeId.SideHopLeft, worldDir: scale(right, -1), presses: [press] };
    case Dir.Right:
      return { kind: 'evade', evade: EvadeId.SideHopRight, worldDir: right, presses: [press] };
    case Dir.Back:
      return { kind: 'evade', evade: EvadeId.Backflip, worldDir: scale(ctx.facing, -1), presses: [press] };
    default:
      // Locked + Neutral/Forward: jump attack. It is an attack, so the state must allow
      // one; if not, the press stays buffered until it does (or expires).
      if (!opts.allowAttack) return NONE;
      return { kind: 'attack', attack: AttackId.JumpAttack, presses: [press], usedSpinGesture: false };
  }
}
