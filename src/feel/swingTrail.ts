import { ATTACKS, AttackId } from '../combat/moves';
import type { AttackReadout } from '../player/PlayerController';
import { AttackPhase } from '../player/states/AttackState';

/*
 * How each swing's sword trail looks, as data. Engine-free: the render layer (SwordTrail)
 * reads the style and draws it. Three tiers:
 *   standard  the basic combo swings: a thin, quick, cool indigo arc
 *   special   enders, spins and the jump attack: a wider gold arc that lingers and shimmers
 *   counter   perfect dodge and perfect block counters: cyan, matching the perfect cues
 *
 * The spin attack adds a wave: a circle of energy out at the edge of its (bigger) hit
 * range, swept round with the blade like a trail. See spinWave().
 */

export type TrailTier = 'standard' | 'special' | 'counter' | 'wave';

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

/** Blade trail tiers (the wave is not a blade trail). */
type BladeTier = Exclude<TrailTier, 'wave'>;

export const TRAIL_STYLES: Readonly<Record<BladeTier, TrailStyle>> = {
  standard: { tier: 'standard', core: 0xe0e7ff, edge: 0x818cf8, life: 0.16, base: 0.35, reach: 0, shimmer: 0, intensity: 1 },
  special: { tier: 'special', core: 0xfef3c7, edge: 0xf59e0b, life: 0.3, base: 0.1, reach: 0.14, shimmer: 1, intensity: 1.7 },
  counter: { tier: 'counter', core: 0xecfeff, edge: 0x22d3ee, life: 0.26, base: 0.15, reach: 0.1, shimmer: 0.6, intensity: 1.5 },
};

/** Every attack's tier. A Record, so a new attack won't compile until it gets one. */
const TIERS: Readonly<Record<AttackId, BladeTier>> = {
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

/**
 * The spin's wave: a band of energy whose outer edge is the edge of the spin's hit range,
 * at the blade's height, pointing the way the blade points. Swept round with the blade
 * and fading like a trail, it draws a circle round her as she turns: how far the spin
 * reaches. (`base` and `reach` don't apply: the band is placed by wavePoints.)
 */
export interface SpinWave {
  style: TrailStyle;
  /** Outer edge, from her center (meters): the attack's hit range. */
  radius: number;
  /** Band width, inward from the outer edge (meters). */
  width: number;
}

const WAVE_STYLE: TrailStyle = { tier: 'wave', core: 0xfffbeb, edge: 0xf59e0b, life: 0.4, base: 0, reach: 0, shimmer: 1, intensity: 2 };

/** The wave an attack throws, or null. Only the spin attack has one. */
export function spinWave(attack: AttackId): SpinWave | null {
  if (attack !== AttackId.Spin && attack !== AttackId.SpinClockwise) return null;
  const hit = ATTACKS[attack].hit;
  return { style: WAVE_STYLE, radius: hit.range, width: 0.4 };
}

type P3 = { x: number; y: number; z: number };

/**
 * Where the wave's band sits this frame: along the blade's direction from her center,
 * flattened to horizontal, at the tip's height. Inner and outer edge of the band.
 */
export function wavePoints(center: P3, tip: P3, wave: SpinWave): { inner: P3; outer: P3 } | null {
  const dx = tip.x - center.x;
  const dz = tip.z - center.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return null;
  const at = (r: number): P3 => ({ x: center.x + (dx / len) * r, y: tip.y, z: center.z + (dz / len) * r });
  return { inner: at(wave.radius - wave.width), outer: at(wave.radius) };
}
