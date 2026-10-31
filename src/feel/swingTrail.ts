import { AttackId } from '../combat/moves';
import type { AttackReadout } from '../player/PlayerController';
import { AttackPhase } from '../player/states/AttackState';

/*
 * How each swing's sword trail looks, as data. Engine-free: the render layer (SwordTrail)
 * reads the style and draws it. Three tiers:
 *   standard  the basic combo swings: a thin, quick, cool indigo arc
 *   special   enders, spins and the jump attack: a wider gold arc that lingers and shimmers
 *   counter   perfect dodge and perfect block counters: cyan, matching the perfect cues
 */

export type TrailTier = 'standard' | 'special' | 'counter';

export interface TrailStyle {
  tier: TrailTier;
  /** Bright color at the leading edge, toward the tip. */
  core: number;
  /** Color the trail fades into, toward the hilt and with age. */
  edge: number;
  /** Seconds (player clock) a point of the trail lasts. */
  life: number;
  /** Where along the blade the trail starts, 0 = hilt, 1 = tip. */
  base: number;
  /** How far past the tip the trail reaches, as a share of the blade's length. */
  reach: number;
  /** 0..1: moving bands and glints along the trail. */
  shimmer: number;
  /** Brightness multiplier (above 1 blooms). */
  intensity: number;
}

export const TRAIL_STYLES: Readonly<Record<TrailTier, TrailStyle>> = {
  standard: { tier: 'standard', core: 0xe0e7ff, edge: 0x818cf8, life: 0.16, base: 0.35, reach: 0, shimmer: 0, intensity: 1 },
  special: { tier: 'special', core: 0xfef3c7, edge: 0xf59e0b, life: 0.3, base: 0.1, reach: 0.14, shimmer: 1, intensity: 1.7 },
  counter: { tier: 'counter', core: 0xecfeff, edge: 0x22d3ee, life: 0.26, base: 0.15, reach: 0.1, shimmer: 0.6, intensity: 1.5 },
};

/** Every attack's tier. A Record, so a new attack won't compile until it gets one. */
const TIERS: Readonly<Record<AttackId, TrailTier>> = {
  [AttackId.Horizontal]: 'standard',
  [AttackId.ReverseHorizontal]: 'standard',
  [AttackId.Vertical]: 'standard',
  [AttackId.VerticalLeft]: 'standard',
  [AttackId.Thrust]: 'standard',
  [AttackId.ThrustLeft]: 'standard',
  [AttackId.Spin]: 'special',
  [AttackId.SpinClockwise]: 'special',
  [AttackId.JumpAttack]: 'special',
  [AttackId.FinisherSpin]: 'special',
  [AttackId.FinisherRising]: 'special',
  [AttackId.FinisherCleave]: 'special',
  [AttackId.FinisherLunge]: 'special',
  [AttackId.PhantomDash]: 'counter',
  [AttackId.Overpower]: 'counter',
};

export function trailStyle(attack: AttackId): TrailStyle {
  return TRAIL_STYLES[TIERS[attack]];
}

/** The trail draws while the blade is live (the swing itself), not the wind-up or follow-through. */
export function trailEmitting(attack: Pick<AttackReadout, 'phase'> | null): boolean {
  return attack?.phase === AttackPhase.Active;
}
