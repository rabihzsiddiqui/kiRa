import { ATTACKS, attackDuration, AttackId, EVADES, EvadeId, type AttackDef } from '../combat/moves';
import { DEFAULT_TUNING } from '../player/contracts';
import type { BoneId } from './rig';

/*
 * Every animation clip the player states ask for, as plain functions of time.
 * The render layer samples them into three.js AnimationClips; a test checks that every
 * clip name used by the states exists here.
 *
 * Angles are degrees, bone-local, Euler order YXZ. Conventions (rest = arms down):
 *   upright bones (spine, chest, neck, head)  X+ leans back, Y+ turns to her left, Z+ leans left
 *   hanging limbs (arms, legs)                X+ swings forward, Z+ swings toward her right
 *   knees and elbows                          shin X- bends the knee, forearm X+ bends the elbow
 * Sword: the blade points along the right hand's -Z. With no shoulder twist, the blade's
 * pitch is the sum of the right arm chain's X angles (0 = level forward, + = tip up).
 */

export type Euler = [number, number, number];
export interface Pose {
  bones: Partial<Record<BoneId, Euler>>;
  /** Extra hips height (meters): crouches and bobs. */
  hipsY?: number;
}

export interface ClipDef {
  name: string;
  duration: number;
  loop: boolean;
  sample(t: number): Pose;
}

// ------------------------------------------------------------------- poses

const READY: Pose = {
  hipsY: -0.03,
  bones: {
    spine: [-5, 0, 0],
    upperArmR: [25, 0, 8],
    forearmR: [35, 0, 0],
    handR: [-75, 0, 0], // sword low and forward, tip slightly down
    upperArmL: [15, 0, -10],
    forearmL: [25, 0, 0],
    thighL: [10, 0, 0],
    shinL: [-15, 0, 0],
    thighR: [-5, 0, 0],
    shinR: [-10, 0, 0],
  },
};

const GUARD: Pose = {
  hipsY: -0.06,
  bones: {
    spine: [-5, 0, 0],
    shoulderR: [0, 25, 0],
    upperArmR: [55, 0, 10],
    forearmR: [65, 0, 0],
    handR: [-55, 0, 0], // blade up and forward, across her front
    shoulderL: [0, -30, 0],
    upperArmL: [50, 0, 0],
    forearmL: [75, 0, 0],
    thighL: [18, 0, 0],
    shinL: [-28, 0, 0],
    thighR: [5, 0, 0],
    shinR: [-25, 0, 0],
  },
};

/** Arm out forward with the blade level: the base of every horizontal swing. */
const armOut = (shoulderYaw: number, chestYaw: number, extra: Partial<Record<BoneId, Euler>> = {}): Pose => ({
  hipsY: -0.06,
  bones: {
    spine: [-8, chestYaw * 0.25, 0],
    chest: [0, chestYaw, 0],
    shoulderR: [0, shoulderYaw, 0],
    upperArmR: [80, 0, 10],
    forearmR: [10, 0, 0],
    handR: [-90, 0, 0],
    upperArmL: [25, 0, -20],
    forearmL: [30, 0, 0],
    thighL: [15, 0, 0],
    shinL: [-20, 0, 0],
    thighR: [-10, 0, 0],
    shinR: [-20, 0, 0],
    ...extra,
  },
});

const OVERHEAD = (crouch: number, twoHands: boolean): Pose => ({
  hipsY: crouch,
  bones: {
    spine: [8, 0, 0],
    upperArmR: [165, 0, -5],
    forearmR: [20, 0, 0],
    handR: [0, 0, 0], // blade behind her head
    ...(twoHands ? { shoulderL: [0, -15, 0] as Euler, upperArmL: [160, 0, 12] as Euler, forearmL: [20, 0, 0] as Euler } : { upperArmL: [30, 0, -25] as Euler }),
    thighL: [25, 0, 0],
    shinL: [-30, 0, 0],
    thighR: [-10, 0, 0],
    shinR: [-25, 0, 0],
  },
});

const CHOP = (crouch: number, twoHands: boolean): Pose => ({
  hipsY: crouch,
  bones: {
    spine: [-22, 0, 0],
    chest: [-10, 0, 0],
    upperArmR: [35, 0, 5],
    forearmR: [5, 0, 0],
    handR: [-55, 0, 0], // blade forward and down
    ...(twoHands ? { shoulderL: [0, -20, 0] as Euler, upperArmL: [35, 0, 15] as Euler, forearmL: [10, 0, 0] as Euler } : { upperArmL: [-10, 0, -25] as Euler }),
    thighL: [40, 0, 0],
    shinL: [-40, 0, 0],
    thighR: [-20, 0, 0],
    shinR: [-30, 0, 0],
  },
});

const TUCK: Pose = {
  hipsY: 0,
  bones: {
    spine: [-40, 0, 0],
    neck: [-20, 0, 0],
    upperArmR: [40, 0, 10],
    forearmR: [90, 0, 0],
    handR: [-90, 0, 0],
    upperArmL: [40, 0, -10],
    forearmL: [90, 0, 0],
    thighL: [100, 0, 0],
    shinL: [-130, 0, 0],
    thighR: [100, 0, 0],
    shinR: [-130, 0, 0],
  },
};

const SPREAD: Pose = {
  bones: {
    upperArmR: [0, 0, 150],
    upperArmL: [0, 0, -150],
    handR: [-90, 0, 0],
    thighR: [0, 0, 35],
    thighL: [0, 0, -35],
  },
};

const HURT: Pose = {
  hipsY: -0.06,
  bones: {
    spine: [22, 0, 0],
    chest: [10, 0, 0],
    head: [18, 0, 0],
    upperArmR: [-15, 0, 30],
    forearmR: [30, 0, 0],
    handR: [-40, 0, 0],
    upperArmL: [-15, 0, -35],
    forearmL: [30, 0, 0],
    thighL: [-8, 0, 0],
    shinL: [-20, 0, 0],
    thighR: [10, 0, 0],
    shinR: [-25, 0, 0],
  },
};

const CHARGE: Pose = {
  hipsY: -0.14,
  bones: {
    spine: [-15, -10, 0],
    chest: [0, -45, 0],
    shoulderR: [0, -90, 0],
    upperArmR: [60, 0, 10],
    forearmR: [20, 0, 0],
    handR: [-100, 0, 0], // blade trailing low behind her
    upperArmL: [45, 0, 10],
    forearmL: [60, 0, 0],
    thighL: [35, 0, 0],
    shinL: [-45, 0, 0],
    thighR: [-15, 0, 0],
    shinR: [-35, 0, 0],
  },
};

const CLASH = (shoulderYaw: number, armPitch: number): Pose => ({
  hipsY: -0.08,
  bones: {
    spine: [-12, 0, 0],
    shoulderR: [0, shoulderYaw, 0],
    upperArmR: [armPitch, 0, 20],
    forearmR: [60, 0, 0],
    handR: [-armPitch - 30, 0, 0], // blade 30 degrees up, held high in front
    shoulderL: [0, -30, 0],
    upperArmL: [armPitch - 10, 0, 0],
    forearmL: [50, 0, 0],
    thighL: [35, 0, 0],
    shinL: [-35, 0, 0],
    thighR: [-15, 0, 0],
    shinR: [-25, 0, 0],
  },
});

// ----------------------------------------------------------------- helpers

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

function lerpPose(a: Pose, b: Pose, k: number): Pose {
  const bones: Partial<Record<BoneId, Euler>> = {};
  for (const id of new Set([...Object.keys(a.bones), ...Object.keys(b.bones)]) as Set<BoneId>) {
    const x = a.bones[id] ?? [0, 0, 0];
    const y = b.bones[id] ?? [0, 0, 0];
    bones[id] = [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
  }
  return { bones, hipsY: (a.hipsY ?? 0) + ((b.hipsY ?? 0) - (a.hipsY ?? 0)) * k };
}

/** Piecewise blend through [time, pose] keys with ease in/out between each pair. */
function keyed(keys: Array<[number, Pose]>): (t: number) => Pose {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, p1] = keys[i];
      const [t0, p0] = keys[i - 1];
      if (t <= t1) return lerpPose(p0, p1, smooth((t - t0) / Math.max(t1 - t0, 1e-6)));
    }
    return keys[keys.length - 1][1];
  };
}

/** Adds whole-body rotation (degrees) on the hips on top of a pose. */
function withHips(p: Pose, rot: Euler): Pose {
  const h = p.bones.hips ?? [0, 0, 0];
  return { ...p, bones: { ...p.bones, hips: [h[0] + rot[0], h[1] + rot[1], h[2] + rot[2]] } };
}

/** 0 to 1 over [t0, t1], eased. */
const span = (t: number, t0: number, t1: number) => smooth((t - t0) / (t1 - t0));

// ------------------------------------------------------------------ clips

function attackClip(def: AttackDef, windup: Pose, strike: Pose): ClipDef {
  const { startup: s, active: a, recovery: r } = def;
  const total = attackDuration(def);
  return {
    name: def.anim,
    duration: total,
    loop: false,
    // Wound up from the first frame (the crossfade covers the transition), swing through
    // the active window, hold the follow-through, then settle back to ready.
    sample: keyed([
      [0, windup],
      [s, windup],
      [s + a, strike],
      [s + a + r * 0.45, strike],
      [total, READY],
    ]),
  };
}

const A = ATTACKS;
const E = EVADES;

const attackClips: ClipDef[] = [
  // Forehand: blade sweeps from her right to her left.
  attackClip(A[AttackId.Horizontal], armOut(-60, -35), armOut(55, 40, { thighR: [25, 0, 0], shinR: [-20, 0, 0] })),
  // Backhand: left to right.
  attackClip(A[AttackId.ReverseHorizontal], armOut(70, 35), armOut(-60, -40, { thighR: [25, 0, 0], shinR: [-20, 0, 0] })),
  attackClip(A[AttackId.Vertical], OVERHEAD(-0.04, false), CHOP(-0.1, false)),
  attackClip(
    A[AttackId.Thrust],
    {
      hipsY: -0.06,
      bones: {
        chest: [0, -25, 0],
        upperArmR: [20, 0, 10],
        forearmR: [100, 0, 0],
        handR: [-120, 0, 0], // pulled back at her side, blade level
        upperArmL: [40, 0, -20],
        forearmL: [40, 0, 0],
        thighL: [10, 0, 0],
        shinL: [-20, 0, 0],
      },
    },
    {
      hipsY: -0.1,
      bones: {
        spine: [-15, 0, 0],
        chest: [0, 15, 0],
        upperArmR: [85, 0, 0],
        forearmR: [0, 0, 0],
        handR: [-85, 0, 0], // arm and blade fully extended
        upperArmL: [-25, 0, -25],
        thighR: [40, 0, 0],
        shinR: [-35, 0, 0],
        thighL: [-25, 0, 0],
        shinL: [-15, 0, 0],
      },
    },
  ),
  attackClip(A[AttackId.Overpower], OVERHEAD(-0.12, true), CHOP(-0.2, true)),
  {
    name: A[AttackId.Spin].anim,
    duration: attackDuration(A[AttackId.Spin]),
    loop: false,
    sample: (t) => {
      const d = A[AttackId.Spin];
      const out = armOut(-80, 0);
      const base = t < d.startup + d.active + 0.1 ? out : lerpPose(out, READY, span(t, d.startup + d.active + 0.1, attackDuration(d)));
      return withHips(base, [0, 360 * span(t, d.startup * 0.5, d.startup + d.active + 0.1), 0]);
    },
  },
  {
    name: A[AttackId.JumpAttack].anim,
    duration: attackDuration(A[AttackId.JumpAttack]),
    loop: false,
    sample: (() => {
      const d = A[AttackId.JumpAttack];
      const airborne = lerpPose(OVERHEAD(0, true), TUCK, 0.45);
      return keyed([
        [0, OVERHEAD(-0.15, true)],
        [d.startup * 0.4, airborne],
        [d.startup, OVERHEAD(0, true)],
        [d.startup + d.active, CHOP(-0.25, true)],
        [d.startup + d.active + d.recovery * 0.5, CHOP(-0.2, true)],
        [attackDuration(d), READY],
      ]);
    })(),
  },
  {
    name: A[AttackId.PhantomDash].anim,
    duration: attackDuration(A[AttackId.PhantomDash]),
    loop: false,
    sample: (() => {
      const d = A[AttackId.PhantomDash];
      const low = { spine: [-35, 0, 0] as Euler, thighL: [50, 0, 0] as Euler, shinL: [-40, 0, 0] as Euler, thighR: [-40, 0, 0] as Euler, shinR: [-20, 0, 0] as Euler };
      const windup = { ...armOut(-70, -40, low), hipsY: -0.15 };
      const strike = { ...armOut(60, 45, low), hipsY: -0.15 };
      return keyed([
        [0, windup],
        [d.startup, windup],
        [d.startup + d.active, strike],
        [d.startup + d.active + d.recovery * 0.4, strike],
        [attackDuration(d), READY],
      ]);
    })(),
  },
];

/** Full-body flip: rotation on the hips over [t0, t1], tucked in the middle. */
function flipClip(name: string, duration: number, rot: Euler, shape: Pose, t0: number, t1: number, hipsDrop = 0): ClipDef {
  return {
    name,
    duration,
    loop: false,
    sample: (t) => {
      const k = span(t, t0, t1);
      const tuck = Math.sin(Math.PI * clamp01((t - t0) / (t1 - t0)));
      const pose = lerpPose(READY, shape, tuck);
      pose.hipsY = (pose.hipsY ?? 0) + hipsDrop * tuck;
      const settled = t > t1 ? lerpPose(pose, READY, span(t, t1, duration)) : pose;
      return withHips(settled, [rot[0] * k, rot[1] * k, rot[2] * k]);
    },
  };
}

const PD = DEFAULT_TUNING.perfectDodgeDuration;
const evadeClips: ClipDef[] = [
  flipClip(E[EvadeId.Roll].anim, E[EvadeId.Roll].duration, [-360, 0, 0], TUCK, 0.04, 0.42, -0.4),
  flipClip(E[EvadeId.Backflip].anim, E[EvadeId.Backflip].duration, [360, 0, 0], TUCK, 0.06, 0.46),
  flipClip(E[EvadeId.SideHopLeft].anim, E[EvadeId.SideHopLeft].duration, [0, 0, 0], withHips(lerpPose(READY, TUCK, 0.35), [0, 0, 15]), 0, 0.36),
  flipClip(E[EvadeId.SideHopRight].anim, E[EvadeId.SideHopRight].duration, [0, 0, 0], withHips(lerpPose(READY, TUCK, 0.35), [0, 0, -15]), 0, 0.36),
  // Perfect dodge flourishes: each base evade flows into a bigger version.
  flipClip('pd_aerial_cartwheel', PD, [0, 0, 360], SPREAD, 0, 0.45),
  flipClip('pd_corkscrew_left', PD, [360, 360, 0], TUCK, 0, 0.45),
  flipClip('pd_corkscrew_right', PD, [360, -360, 0], TUCK, 0, 0.45),
  flipClip('pd_backflip_twist', PD, [360, 0, 0], TUCK, 0, 0.45),
];

/** One-shot that hits `pose` fast, holds, then returns to `to`. */
function impact(name: string, duration: number, pose: Pose, to: Pose, hit = 0.06): ClipDef {
  return { name, duration, loop: false, sample: keyed([[0, to], [hit, pose], [duration * 0.45, pose], [duration, to]]) };
}

const T = DEFAULT_TUNING;
const reactionClips: ClipDef[] = [
  impact('pb_clash_a', T.perfectBlockDuration, CLASH(35, 95), GUARD, 0.03),
  impact('pb_clash_b', T.perfectBlockDuration, CLASH(-15, 80), GUARD, 0.03),
  { name: 'guard_raise', duration: 0.15, loop: false, sample: keyed([[0, READY], [0.12, GUARD]]) },
  impact('guard_impact', T.guardRecoilTime, { ...withHips(GUARD, [0, 0, 0]), hipsY: -0.1, bones: { ...GUARD.bones, spine: [12, 0, 0], head: [6, 0, 0] } }, GUARD, 0.03),
  impact('hurt', T.hitStunTime, HURT, READY, 0.05),
  {
    name: 'spin_charge',
    duration: 1,
    loop: true,
    // Coiled, with a fine tremble while the charge builds.
    sample: (t) => withHips(CHARGE, [0, Math.sin(t * Math.PI * 2 * 8) * 2, 0]),
  },
  {
    name: 'fall',
    duration: 0.8,
    loop: true,
    sample: (t) => {
      const w = Math.sin((t / 0.8) * Math.PI * 2);
      return {
        bones: {
          upperArmR: [30, 0, 50 + w * 8],
          upperArmL: [30, 0, -50 - w * 8],
          handR: [-60, 0, 0],
          thighL: [30 + w * 6, 0, 0],
          shinL: [-40, 0, 0],
          thighR: [-10 - w * 6, 0, 0],
          shinR: [-20, 0, 0],
        },
      };
    },
  },
];

// ---------------------------------------------------- locomotion (blended)

const RUN_PERIOD = 0.66; // two steps at full run speed
const STRAFE_PERIOD = 0.7;

function gait(period: number, stride: number, lean: number, arms: 'swing' | 'guard') {
  return (t: number): Pose => {
    const p = (t / period) * Math.PI * 2;
    const s = Math.sin(p);
    const base = arms === 'guard' ? GUARD : READY;
    return {
      hipsY: -0.05 + 0.035 * Math.abs(Math.cos(p)),
      bones: {
        ...base.bones,
        spine: [lean, 0, 0],
        thighL: [stride * s, 0, 0],
        thighR: [-stride * s, 0, 0],
        // The knee folds on the back swing.
        shinL: [-15 - stride * 1.2 * Math.max(0, -s), 0, 0],
        shinR: [-15 - stride * 1.2 * Math.max(0, s), 0, 0],
        ...(arms === 'swing'
          ? {
              upperArmL: [-stride * 0.8 * s, 0, -10] as Euler,
              forearmL: [40, 0, 0] as Euler,
              upperArmR: [15 + stride * 0.3 * s, 0, 10] as Euler,
            }
          : {}),
      },
    };
  };
}

function sideStep(dir: 1 | -1) {
  return (t: number): Pose => {
    const p = (t / STRAFE_PERIOD) * Math.PI * 2;
    const open = 0.5 + 0.5 * Math.sin(p);
    // dir 1 = to her right: right leg reaches out (Z+), left follows.
    return {
      hipsY: -0.07 + 0.025 * Math.abs(Math.cos(p)),
      bones: {
        ...GUARD.bones,
        thighR: [10, 0, dir * 22 * open],
        shinR: [-25, 0, 0],
        thighL: [10, 0, dir * 12 * (1 - open)],
        shinL: [-25, 0, 0],
      },
    };
  };
}

export const LOCOMOTION_CLIPS = {
  idle: { name: 'loco_idle', duration: 2, loop: true, sample: (t: number) => ({ ...READY, bones: { ...READY.bones, chest: [2 * Math.sin((t / 2) * Math.PI * 2), 0, 0] as Euler } }) },
  run: { name: 'loco_run', duration: RUN_PERIOD, loop: true, sample: gait(RUN_PERIOD, 40, -12, 'swing') },
  strafeF: { name: 'loco_strafe_f', duration: STRAFE_PERIOD, loop: true, sample: gait(STRAFE_PERIOD, 25, -6, 'guard') },
  strafeB: { name: 'loco_strafe_b', duration: STRAFE_PERIOD, loop: true, sample: (t: number) => gait(STRAFE_PERIOD, 20, 0, 'guard')(STRAFE_PERIOD - t) },
  strafeL: { name: 'loco_strafe_l', duration: STRAFE_PERIOD, loop: true, sample: sideStep(-1) },
  strafeR: { name: 'loco_strafe_r', duration: STRAFE_PERIOD, loop: true, sample: sideStep(1) },
} satisfies Record<string, ClipDef>;

/** The FSM asks for 'locomotion'; the animator blends LOCOMOTION_CLIPS by its params. */
export const LOCOMOTION = 'locomotion';

export interface LocomotionParams {
  locomotion: number; // 0 idle, 1 run, 2 strafe
  speed: number; // m/s, free run
  strafeX: number; // -1..1, her right
  strafeY: number; // -1..1, her forward
}

/** Weights for each locomotion clip (they sum to 1), plus the run's playback rate. */
export function locomotionWeights(p: LocomotionParams, runSpeed = DEFAULT_TUNING.runSpeed) {
  const w = { idle: 1, run: 0, strafeF: 0, strafeB: 0, strafeL: 0, strafeR: 0 };
  let runRate = 1;
  if (p.locomotion === 1) {
    const k = clamp01(p.speed / runSpeed);
    w.run = k;
    w.idle = 1 - k;
    runRate = Math.max(0.4, k);
  } else if (p.locomotion === 2) {
    const x = p.strafeX;
    const y = p.strafeY;
    const m = clamp01(Math.hypot(x, y));
    const sum = Math.abs(x) + Math.abs(y) || 1;
    w.strafeR = (Math.max(0, x) / sum) * m;
    w.strafeL = (Math.max(0, -x) / sum) * m;
    w.strafeF = (Math.max(0, y) / sum) * m;
    w.strafeB = (Math.max(0, -y) / sum) * m;
    w.idle = 1 - m;
  }
  return { weights: w, runRate };
}

/** Every one-shot or looping clip the states can request by name. */
export const CLIPS: ReadonlyMap<string, ClipDef> = new Map([...attackClips, ...evadeClips, ...reactionClips].map((c) => [c.name, c]));
