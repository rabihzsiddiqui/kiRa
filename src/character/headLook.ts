import { AttackId, EvadeId } from '../combat/moves';
import { PlayerStateId } from '../player/contracts';

/*
 * Where her head looks: at what she's targeting (or would target), on top of whatever the
 * animation is doing. Engine-free: the render layer measures the posed chest and head,
 * asks HeadLook for a gaze, and turns the neck and head toward it.
 *
 * Angles are degrees in the world: yaw about straight up, pitch up from level.
 *
 * What keeps it natural:
 *  - the gaze eases toward the target (a quick start that settles), never snaps
 *  - it's held in the world, so when her body twists in a swing her eyes stay on the target
 *  - limits relative to her chest: 75 to either side, 30 up, 35 down; past them she looks
 *    as far as she can
 *  - something well behind her (past 120) isn't worth straining for: she looks ahead
 *  - it fades in and out, so starting or stopping (a spin, a roll) blends instead of popping
 */

export const HEAD_LOOK = {
  maxYaw: 75,
  maxUp: 30,
  maxDown: 35,
  /** Past this far round from her chest she gives up and looks ahead. */
  giveUp: 120,
  /** Seconds for the gaze to close half the gap to where it's going. */
  halfLife: 0.07,
  /** Seconds to fade fully in or out. */
  fade: 0.2,
  /** Share of the turn the neck takes; the head does the rest. */
  neckShare: 0.4,
};

export interface Gaze {
  yaw: number;
  pitch: number;
}

/** Spins, rolls and flips turn her whole body over: the head goes with the move. */
const SPINS = new Set<AttackId>([AttackId.Spin, AttackId.SpinClockwise, AttackId.FinisherSpin]);

export function lookAllowed(state: PlayerStateId, attack: AttackId | null, evade: EvadeId | null): boolean {
  switch (state) {
    case PlayerStateId.PerfectDodge:
      return false; // mid-flip
    case PlayerStateId.Evade:
      return evade === EvadeId.SideHopLeft || evade === EvadeId.SideHopRight; // eyes stay on the target
    case PlayerStateId.Attack:
      return attack === null || !SPINS.has(attack);
    default:
      return true;
  }
}

/** -180..180 */
const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface LookInput {
  /** Direction from her eyes to the target, or null when there's nothing to look at. */
  target: Gaze | null;
  /** Where her chest and her head face this frame, as animated. */
  chest: Gaze;
  head: Gaze;
  allowed: boolean;
}

export class HeadLook {
  /** The smoothed gaze, in the world. */
  private gaze: Gaze | null = null;
  /** 0..1, how much the look overrides the animated head. */
  weight = 0;

  /** The direction to turn her head to this frame, or null to leave the animation alone. */
  update(dt: number, i: LookInput): Gaze | null {
    const c = HEAD_LOOK;
    const want = i.allowed && i.target !== null && Math.abs(wrap(i.target.yaw - i.chest.yaw)) <= c.giveUp;
    this.weight = clamp(this.weight + (want ? dt : -dt) / c.fade, 0, 1);

    // Ease toward the target. While fading out it keeps following it (or holds, if there's
    // none): only the weight hands back to the animation, so there's one smooth blend.
    if (!this.gaze) this.gaze = { ...i.head };
    const goal = i.target ?? this.gaze;
    const k = dt > 0 ? 1 - 2 ** (-dt / c.halfLife) : 0;
    this.gaze = { yaw: wrap(this.gaze.yaw + wrap(goal.yaw - this.gaze.yaw) * k), pitch: this.gaze.pitch + (goal.pitch - this.gaze.pitch) * k };
    if (this.weight === 0) {
      this.gaze = { ...i.head };
      return null;
    }

    // As far as her neck goes, measured from her chest.
    const yaw = i.chest.yaw + clamp(wrap(this.gaze.yaw - i.chest.yaw), -c.maxYaw, c.maxYaw);
    const pitch = i.chest.pitch + clamp(this.gaze.pitch - i.chest.pitch, -c.maxDown, c.maxUp);

    const w = this.weight * this.weight * (3 - 2 * this.weight);
    return { yaw: wrap(i.head.yaw + wrap(yaw - i.head.yaw) * w), pitch: i.head.pitch + (pitch - i.head.pitch) * w };
  }
}
