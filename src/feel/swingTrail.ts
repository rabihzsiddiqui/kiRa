import { ATTACKS, AttackId } from '../combat/moves';
import type { AttackReadout } from '../player/PlayerController';
import { AttackPhase } from '../player/states/AttackState';

/*
 * How each swing's sword trail looks, as data. Engine-free: the render layer (SwordTrail)
 * reads the style and draws it. Four tiers:
 *   standard  the basic combo swings: a thin, quick, cool indigo arc
 *   special   enders, the jump attack and the roll thrust: a wider gold arc that lingers and shimmers
 *   spin      the spin attack: the special arc, but faint, so the eye goes to its wave
 *   counter   perfect dodge and perfect block counters: cyan, matching the perfect cues
 *
 * The spin attack adds a wave: a circle of energy out at the edge of its (bigger) hit
 * range, swept round with the blade like a trail. It's drawn as energy, not as a blade
 * trail, in the charge's cyan: the stored charge let out. See spinWave().
 */

export type TrailTier = 'standard' | 'special' | 'spin' | 'counter' | 'wave';

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
  // Additive, so a lower intensity is the same as more see-through.
  spin: { tier: 'spin', core: 0xfef3c7, edge: 0xf59e0b, life: 0.3, base: 0.1, reach: 0.14, shimmer: 0.6, intensity: 0.2 },
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
  [AttackId.Spin]: 'spin',
  [AttackId.SpinClockwise]: 'spin',
  [AttackId.JumpAttack]: 'special',
  [AttackId.RollThrust]: 'special',
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
  /** Where the hot line runs across the band, 0 = inner edge, 1 = outer edge. */
  rim: number;
  /**
   * Vertical thickness (meters). The flat band would be a hairline seen side-on, so a
   * second, upright band crosses it along the hot line (see waveWall).
   */
  thickness: number;
}

/** Where the wave's hot line runs across its band (see SpinWave.rim). */
export const WAVE_RIM = 0.8;

/** Cyan like the blade charge (BladeCharge), so it reads as that energy let out, not as gold steel. */
const WAVE_STYLE: TrailStyle = { tier: 'wave', core: 0xecfeff, edge: 0x22d3ee, life: 0.45, base: 0, reach: 0, shimmer: 1, intensity: 0.85 };

/** The wave an attack throws, or null. Only the spin attack has one. */
export function spinWave(attack: AttackId): SpinWave | null {
  if (attack !== AttackId.Spin && attack !== AttackId.SpinClockwise) return null;
  const hit = ATTACKS[attack].hit;
  return { style: WAVE_STYLE, radius: hit.range, width: 0.6, rim: WAVE_RIM, thickness: 0.4 };
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

/**
 * The upright band that gives the wave its thickness: along the hot line (the same
 * direction and height as wavePoints), from half the thickness below to half above.
 */
export function waveWall(center: P3, tip: P3, wave: SpinWave): { low: P3; high: P3 } | null {
  const dx = tip.x - center.x;
  const dz = tip.z - center.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return null;
  const r = wave.radius - wave.width * (1 - wave.rim);
  const at = (y: number): P3 => ({ x: center.x + (dx / len) * r, y, z: center.z + (dz / len) * r });
  return { low: at(tip.y - wave.thickness / 2), high: at(tip.y + wave.thickness / 2) };
}
