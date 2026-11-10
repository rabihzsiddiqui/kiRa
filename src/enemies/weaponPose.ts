import { vec2, type Vec2 } from '../core/math';
import type { HitShape } from '../combat/moves';
import type { DummyPhase } from './TrainingDummyAI';
import type { StringStep, SwingMotion } from './strings';

/**
 * Where the training dummy's glaive is, as plain numbers, so the swing can be checked
 * against the hit shapes without a renderer. DummyView puts this pose on the meshes.
 *
 * The rig: the arm crossbar turns about the post at shoulder height (`yaw`). The glaive is
 * held in the right hand, `handX` out along the bar, and tips up or down in the bar's
 * vertical plane (`lift`), turns about its own shaft (`roll`, which way the edge faces),
 * and slides through the hand (`slide`, for the thrust). Because the blade stays in the
 * bar's plane, its tip traces a fan around the post, the same fan an arc hit shape is.
 */
export const DUMMY_WEAPON = {
  /** Shoulder (crossbar) height, as a fraction of the dummy's height. */
  shoulderAt: 0.74,
  /** Right hand, out along the bar from the post. */
  handX: 0.53,
  /** Hand to blade tip at slide 0. */
  length: 2.0,
  /** Shaft behind the hand. */
  butt: 0.35,
  /** Blade length (the rest is shaft). */
  blade: 0.55,
};

export interface WeaponPose {
  /** Bar yaw, radians. 0 points the right hand out to its right, PI/2 straight ahead. */
  yaw: number;
  /** Radians up from level, in the bar's vertical plane. */
  lift: number;
  /** About the shaft. 0 puts the edge forward (leading a forehand), -PI/2 down. */
  roll: number;
  /** Meters the glaive slides forward through the hand. */
  slide: number;
}

/** Guard: glaive low and to its right, edge down, tip clear of the ground. */
export const WEAPON_REST: WeaponPose = { yaw: 0.55, lift: -0.5, roll: -Math.PI / 2, slide: 0 };

const AHEAD = Math.PI / 2;
const EDGE_FORWARD = 0;
const EDGE_BACK = Math.PI;
const EDGE_DOWN = -Math.PI / 2;
/** Windup: seconds to reach the wound pose, and the fast drop into the strike at its end. */
const WIND_TIME = 0.35;
const DROP_TIME = 0.1;
/** Fraction of recovery spent finishing the follow through. */
const FOLLOW_SHARE = 0.3;

interface Keys {
  wound: WeaponPose;
  /** Hitbox opens. */
  strikeFrom: WeaponPose;
  /** Hitbox closes. The tip is at the shape's range here. */
  strikeTo: WeaponPose;
  follow: WeaponPose;
}

/**
 * How far the glaive slides so its tip lands on the shape's range at `lift`. This is what
 * keeps the blade honest: change a range in strings.ts and the swing reaches it.
 */
function slideFor(range: number, lift: number): number {
  const s = (range - DUMMY_WEAPON.handX) / Math.cos(lift) - DUMMY_WEAPON.length;
  return Math.max(-0.6, Math.min(1.2, s));
}

const halfArc = (hit: HitShape) => (hit.kind === 'arc' ? Math.min(hit.arcDeg, 300) / 2 : 30) * (Math.PI / 180);

function keys(motion: SwingMotion, hit: HitShape): Keys {
  const pose = (yaw: number, lift: number, roll: number, slide: number): WeaponPose => ({ yaw, lift, roll, slide });
  switch (motion) {
    case 'forehand':
    case 'backhand': {
      // Level sweep across the arc at chest height. A backhand is the mirror image.
      const a = halfArc(hit);
      const dir = motion === 'forehand' ? 1 : -1;
      const roll = motion === 'forehand' ? EDGE_FORWARD : EDGE_BACK;
      const lift = -0.12;
      const s = slideFor(hit.range, lift);
      return {
        wound: pose(AHEAD - dir * (a + 0.7), 0.15, roll, -0.1),
        strikeFrom: pose(AHEAD - dir * a, lift, roll, s),
        strikeTo: pose(AHEAD + dir * a, lift, roll, s),
        follow: pose(AHEAD + dir * (a + 0.45), -0.3, roll, 0),
      };
    }
    case 'overhead': {
      // Raised over its head and a little behind, then down the middle of the arc. The tip
      // reaches farthest when level, so the hit window ends there and the follow through
      // carries it on down. Ending lower would push the tip past the range on the way.
      const s = slideFor(hit.range, 0);
      return {
        wound: pose(AHEAD, 1.95, EDGE_DOWN, 0),
        strikeFrom: pose(AHEAD, 0.6, EDGE_DOWN, s),
        strikeTo: pose(AHEAD, 0, EDGE_DOWN, s),
        follow: pose(AHEAD, -0.5, EDGE_DOWN, 0),
      };
    }
    case 'thrust': {
      // Pulled back through the hand, then driven straight out along the line.
      const lift = -0.06;
      return {
        wound: pose(AHEAD, lift, EDGE_DOWN, -0.45),
        strikeFrom: pose(AHEAD, lift, EDGE_DOWN, 0),
        strikeTo: pose(AHEAD, lift, EDGE_DOWN, slideFor(hit.range, lift)),
        follow: pose(AHEAD, lift - 0.04, EDGE_DOWN, slideFor(hit.range, lift) * 0.9),
      };
    }
  }
}

const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const easeOut = (k: number) => 1 - (1 - clamp01(k)) ** 3;
const easeIn = (k: number) => clamp01(k) ** 2;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function mixPose(a: WeaponPose, b: WeaponPose, k: number): WeaponPose {
  return { yaw: lerp(a.yaw, b.yaw, k), lift: lerp(a.lift, b.lift, k), roll: lerp(a.roll, b.roll, k), slide: lerp(a.slide, b.slide, k) };
}

/**
 * The glaive's pose for a step of a string, `k` (0..1) through `phase`. The windup winds
 * back in WIND_TIME, holds (the delayed overhead's long hold is the read), then drops into
 * the strike in the last DROP_TIME, so the blade is moving when the hitbox opens. The
 * active phase sweeps strikeFrom to strikeTo. A step that isn't the last holds its follow
 * through, so the next step winds from where this one ended.
 */
export function weaponPose(steps: readonly StringStep[], index: number, phase: DummyPhase, k: number): WeaponPose {
  const step = steps[index];
  if (!step || phase === 'idle') return WEAPON_REST;
  const key = keys(step.motion, step.attack.hit);

  switch (phase) {
    case 'windup': {
      const prev = steps[index - 1];
      const from = prev ? keys(prev.motion, prev.attack.hit).follow : WEAPON_REST;
      const t = clamp01(k) * step.windup;
      const drop = Math.min(DROP_TIME, step.windup * 0.5);
      const wind = Math.min(WIND_TIME, step.windup - drop);
      if (t < step.windup - drop) return mixPose(from, key.wound, easeOut(wind > 0 ? t / wind : 1));
      return mixPose(key.wound, key.strikeFrom, easeIn((t - (step.windup - drop)) / drop));
    }
    case 'active':
      return mixPose(key.strikeFrom, key.strikeTo, clamp01(k));
    case 'recovery': {
      if (k < FOLLOW_SHARE) return mixPose(key.strikeTo, key.follow, easeOut(k / FOLLOW_SHARE));
      const last = index === steps.length - 1;
      return last ? mixPose(key.follow, WEAPON_REST, easeOut((k - FOLLOW_SHARE) / (1 - FOLLOW_SHARE))) : key.follow;
    }
  }
}

/**
 * The blade tip on the ground plane, in the dummy's local space (x its right, y its
 * forward, as in hitShapes.ts), and its height off the ground for a dummy `height` tall.
 */
export function weaponTip(p: WeaponPose, height: number): { at: Vec2; y: number } {
  const reach = DUMMY_WEAPON.length + p.slide;
  const r = DUMMY_WEAPON.handX + reach * Math.cos(p.lift);
  return { at: vec2(Math.cos(p.yaw) * r, Math.sin(p.yaw) * r), y: height * DUMMY_WEAPON.shoulderAt + reach * Math.sin(p.lift) };
}
