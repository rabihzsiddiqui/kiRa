import { ATTACKS, attackDuration, AttackId, EVADES, EvadeId, type AttackDef } from '../combat/moves';
import { DEFAULT_TUNING } from '../player/contracts';
import { ANKLE, armIK, jointFrames, legIK, onGround } from './fk';
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
  /** Hips moved forward (meters, + = her forward). Lets a roll turn about its middle, not the hips. */
  hipsZ?: number;
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

/**
 * Lock-on stance (strafing): two-handed, blade forward and up at the target's eyes.
 * Deliberately unlike GUARD, so moving while locked on never reads as blocking.
 */
const STANCE: Pose = {
  hipsY: -0.05,
  bones: {
    spine: [-5, 0, 0],
    upperArmR: [35, 0, -12],
    forearmR: [55, 0, 0],
    handR: [-65, 0, 0], // both hands on the grip at the navel, tip about 20 degrees up
    upperArmL: [30, 0, 30],
    forearmL: [60, 0, 0],
    thighL: [12, 0, 0],
    shinL: [-20, 0, 0],
    thighR: [-5, 0, 0],
    shinR: [-18, 0, 0],
  },
};

/**
 * Her left hand on the sword's grip, just below the right (toward the pommel), by arm IK
 * from where her left shoulder is. For two-handed guards.
 */
function bothHands(p: Pose): Pose {
  const f = jointFrames(p);
  const r = f.handR.r;
  const grip = [0, 0, 0.09]; // along the grip, toward the pommel (the blade runs down -Z)
  const at = [0, 1, 2].map((k) => f.handR.p[k] + r[k * 3] * grip[0] + r[k * 3 + 1] * grip[1] + r[k * 3 + 2] * grip[2]);
  const joint = f.upperArmL.p;
  const s = f.shoulderL.r; // into the shoulder's frame: transpose of its rotation
  const d = [at[0] - joint[0], at[1] - joint[1], at[2] - joint[2]];
  const local: [number, number, number] = [0, 1, 2].map((k) => s[k] * d[0] + s[3 + k] * d[1] + s[6 + k] * d[2]) as [number, number, number];
  const ik = armIK(local);
  return { ...p, bones: { ...p.bones, upperArmL: ik.upperArm, forearmL: ik.forearm } };
}

/** Where the feet go for the block and the parry: wide and planted, left foot forward. */
const GUARD_FEET: { L: [number, number]; R: [number, number] } = { L: [-0.18, -0.15], R: [0.2, 0.2] };

/**
 * Block: braced. Both hands in close at her chest, the blade angled up and across her front
 * to the left, weight low on wide planted feet, eyes over the guard. The parry (parry())
 * is this same guard driven out, so a perfect block reads as the block shoving the hit away.
 */
const GUARD: Pose = bothHands(withFeet(
  {
    hipsY: -0.11,
    bones: {
      spine: [-6, 0, 0],
      chest: [0, 15, 0],
      neck: [4, -12, 0],
      shoulderR: [0, 30, 0],
      upperArmR: [55, 0, 18],
      forearmR: [95, 0, 0],
      handR: [-95, 0, 0],
      shoulderL: [0, -20, 0],
    },
  },
  GUARD_FEET,
));

/**
 * Parry: the guard shoved out. Arms drive forward from the chest, the blade pushed up and
 * out (side 1: toward her left, -1: her right; the two alternate), the chest turning into
 * the push, the hips going forward over a bending front knee while the feet stay planted.
 */
function parry(side: 1 | -1): Pose {
  return bothHands(withFeet(
    {
      hipsY: -0.13,
      hipsZ: 0.07,
      bones: {
        spine: [-16, 0, 0],
        chest: [0, side * 22, 0],
        neck: [8, -side * 16, 0],
        shoulderR: [0, side > 0 ? 40 : -10, 0],
        upperArmR: [88, 0, 15],
        forearmR: [35, 0, 0],
        handR: [-80, 0, 0],
        shoulderL: [0, side > 0 ? -25 : -40, 0],
      },
    },
    GUARD_FEET,
  ));
}

/** Arm out forward with the blade level: the base of every horizontal swing. */
/** Forearm roll that puts the edge first: right-to-left swings, and left-to-right. */
const FOREHAND = -90;
const BACKHAND = 90;

/**
 * Sword arm out to the side for flat cuts. `edgeRoll` turns the forearm (rolls the hand
 * about the blade) so the cutting edge, not the flat, leads the swing: -90 for swings
 * that travel right to left (forehand, counterclockwise spins), 90 for left to right.
 */
const armOut = (shoulderYaw: number, chestYaw: number, extra: Partial<Record<BoneId, Euler>> = {}, edgeRoll = 0): Pose => ({
  hipsY: -0.06,
  bones: {
    spine: [-8, chestYaw * 0.25, 0],
    chest: [0, chestYaw, 0],
    shoulderR: [0, shoulderYaw, 0],
    upperArmR: [80, 0, 10],
    forearmR: [10, 0, 0],
    handR: [-90, 0, edgeRoll],
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

/**
 * Spin charge: coiled low, blade held level out to her right and back so it reads side-on
 * from the camera (the charge sparkle runs along it). Left hand forward for balance.
 */
const CHARGE: Pose = onGround({
  bones: {
    spine: [-12, -10, 0],
    chest: [0, -35, 0],
    neck: [0, 20, 0], // eyes stay forward while the body winds up
    shoulderR: [0, -50, 0],
    upperArmR: [50, 0, 30],
    forearmR: [15, 0, 0],
    handR: [-75, 0, 0],
    upperArmL: [55, 0, 15],
    forearmL: [70, 0, 0],
    thighL: [40, 0, -8],
    shinL: [-55, 0, 0],
    thighR: [-15, 0, 12],
    shinR: [-45, 0, 0],
  },
});

// ------------------------------------------------------ combo swing poses
// Tuned with forward kinematics: hand and blade-tip positions are noted where it matters.

/** "/" wound up: hand above the right shoulder, blade upright and tipped back. */
const DIAG_R_WINDUP: Pose = onGround({
  bones: {
    chest: [8, -30, 0],
    shoulderR: [0, -15, 0],
    upperArmR: [155, 0, 30],
    forearmR: [40, 0, 0],
    handR: [-80, 0, 0],
    upperArmL: [40, 0, -20],
    forearmL: [50, 0, 0],
    thighL: [15, 0, 0],
    shinL: [-20, 0, 0],
    thighR: [-8, 0, 0],
    shinR: [-20, 0, 0],
  },
});

/** "/" finished: hand by the left hip, blade down and forward to her left. Right foot steps in. */
const DIAG_R_STRIKE: Pose = onGround({
  bones: {
    spine: [-15, 10, 0],
    chest: [-5, 15, 0],
    shoulderR: [0, 25, 0],
    upperArmR: [50, 0, -5],
    forearmR: [10, 0, 0],
    handR: [-88, 0, 0],
    upperArmL: [-15, 0, -30],
    forearmL: [20, 0, 0],
    thighR: [30, 0, 0],
    shinR: [-25, 0, 0],
    thighL: [-15, 0, 0],
    shinL: [-20, 0, 0],
  },
});

/** "\" wound up: right hand crossed over above the left shoulder, blade upright. */
const DIAG_L_WINDUP: Pose = onGround({
  bones: {
    chest: [8, 30, 0],
    shoulderR: [0, 80, 0],
    upperArmR: [130, 0, 0],
    forearmR: [40, 0, 0],
    handR: [-100, 0, 30], // wrist turned so the edge, not the flat, leads the cut
    upperArmL: [30, 0, -35],
    forearmL: [40, 0, 0],
    thighR: [15, 0, 0],
    shinR: [-20, 0, 0],
    thighL: [-8, 0, 0],
    shinL: [-20, 0, 0],
  },
});

/** "\" finished: hand by the right hip, blade down and forward to her right. Left foot steps in. */
const DIAG_L_STRIKE: Pose = onGround({
  bones: {
    spine: [-15, -5, 0],
    chest: [-5, -10, 0],
    shoulderR: [0, -5, 0],
    upperArmR: [40, 0, 35],
    forearmR: [10, 0, 0],
    handR: [-85, 0, 30], // same roll as the wind-up
    upperArmL: [-10, 0, -25],
    forearmL: [20, 0, 0],
    thighL: [30, 0, 0],
    shinL: [-25, 0, 0],
    thighR: [-15, 0, 0],
    shinR: [-20, 0, 0],
  },
});

const THRUST_WINDUP: Pose = {
  hipsY: -0.06,
  bones: {
    chest: [0, -25, 0],
    upperArmR: [20, 0, 10],
    forearmR: [100, 0, 0],
    handR: [-120, 0, 0], // pulled back at her right side, blade level
    upperArmL: [40, 0, -20],
    forearmL: [40, 0, 0],
    thighL: [10, 0, 0],
    shinL: [-20, 0, 0],
  },
};

const THRUST_STRIKE: Pose = {
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
};

/** Second thrust: blade drawn back across her left hip, torso wound to the left. */
const THRUST_L_WINDUP: Pose = onGround({
  bones: {
    chest: [0, 40, 0],
    shoulderR: [0, 45, 0],
    upperArmR: [10, 0, -10],
    forearmR: [95, 0, 0],
    handR: [-105, 0, 0],
    upperArmL: [30, 0, -30],
    forearmL: [40, 0, 0],
    thighR: [10, 0, 0],
    shinR: [-20, 0, 0],
  },
});

/** ...unwinding into a stab off the left foot. */
const THRUST_L_STRIKE: Pose = onGround({
  bones: {
    spine: [-15, 0, 0],
    chest: [0, -20, 0],
    shoulderR: [0, 5, 0],
    upperArmR: [85, 0, 0],
    forearmR: [0, 0, 0],
    handR: [-72, 0, 0],
    upperArmL: [-25, 0, -35],
    forearmL: [10, 0, 0],
    thighL: [40, 0, 0],
    shinL: [-35, 0, 0],
    thighR: [-25, 0, 0],
    shinR: [-15, 0, 0],
  },
});

/**
 * Roll thrust, coming up out of the roll: still low like the roll's last crouch
 * (ROLL_RISE), right foot ahead, the blade chambered level at her right hip and her chest
 * turned away to load the stab. Blade pitch: arm chain 35 + spine -30 + chest -5 = level.
 */
const ROLL_THRUST_WINDUP: Pose = onGround({
  bones: {
    spine: [-30, 0, 0],
    chest: [-5, -25, 0],
    neck: [15, 0, 0], // eyes up on where the stab goes
    upperArmR: [15, 0, 15],
    forearmR: [100, 0, 0],
    handR: [-80, 0, 0],
    upperArmL: [45, 0, -15],
    forearmL: [30, 0, 0],
    thighR: [85, 0, 0],
    shinR: [-110, 0, 0],
    thighL: [45, 0, 0],
    shinL: [-120, 0, 0],
  },
});

/** ...driving up and forward into a full-length stab: arm and blade level, back leg long. */
const ROLL_THRUST_STRIKE: Pose = onGround({
  bones: {
    spine: [-20, 0, 0],
    chest: [0, 15, 0],
    neck: [10, 0, 0],
    shoulderR: [0, 5, 0],
    upperArmR: [90, 0, 0],
    forearmR: [0, 0, 0],
    handR: [-70, 0, 0],
    upperArmL: [-35, 0, -30],
    forearmL: [15, 0, 0],
    thighR: [60, 0, 0],
    shinR: [-60, 0, 0],
    thighL: [-35, 0, 0],
    shinL: [-10, 0, 0],
    footL: [25, 0, 0], // back heel up
  },
});

/** Rising ender wound up: crouched, blade low behind her on the left. */
const RISING_WINDUP: Pose = onGround({
  bones: {
    spine: [-20, 10, 0],
    chest: [0, 30, 0],
    shoulderR: [0, 40, 0],
    upperArmR: [-10, 0, -40],
    forearmR: [30, 0, 0],
    handR: [-120, 0, 140], // edge turned up: it cuts on the way up
    upperArmL: [20, 0, -30],
    forearmL: [40, 0, 0],
    thighL: [45, 0, 0],
    shinL: [-60, 0, 0],
    thighR: [-10, 0, 0],
    shinR: [-50, 0, 0],
  },
});

/** ...cut up through to high on her right, body stretched, knee up off the hop. */
const RISING_STRIKE: Pose = onGround({
  bones: {
    spine: [10, -10, 0],
    chest: [5, -15, 0],
    shoulderR: [0, -20, 0],
    upperArmR: [150, 0, 30],
    forearmR: [10, 0, 0],
    handR: [-110, 0, 140],
    upperArmL: [10, 0, -45],
    forearmL: [30, 0, 0],
    thighL: [70, 0, 0],
    shinL: [-90, 0, 0],
    thighR: [-10, 0, 0],
    shinR: [-10, 0, 0],
  },
});

/** Leaping cleave, mid-air: arched back, both hands far behind her head, knees drawn up. */
const CLEAVE_AIR: Pose = {
  hipsY: 0,
  bones: {
    spine: [20, 0, 0],
    chest: [10, 0, 0],
    upperArmR: [175, 0, -5],
    forearmR: [35, 0, 0],
    handR: [10, 0, 0],
    shoulderL: [0, -15, 0],
    upperArmL: [170, 0, 12],
    forearmL: [35, 0, 0],
    thighL: [70, 0, 0],
    shinL: [-90, 0, 0],
    thighR: [40, 0, 0],
    shinR: [-100, 0, 0],
  },
};

/** Leaping cleave, landed: down on the right knee, blade driven to the floor two-handed. */
const CLEAVE_KNEEL: Pose = onGround({
  bones: {
    ...CHOP(0, true).bones,
    spine: [-25, 0, 0],
    chest: [-8, 0, 0],
    upperArmR: [55, 0, 5],
    handR: [-35, 0, 0], // tip just off the floor in front of her
    upperArmL: [55, 0, 15],
    thighL: [92, 0, 0],
    shinL: [-92, 0, 0],
    thighR: [-10, 0, 0],
    shinR: [-80, 0, 0], // shin flat behind her, knee on the floor
    footR: [-75, 0, 0], // foot in line with the shin, toes curled under
  },
});

/** Lunge ender wound up: blade chambered at the right hip, weight sunk on the back leg. */
const LUNGE_WINDUP: Pose = onGround({
  bones: {
    spine: [5, 0, 0],
    chest: [0, -20, 0],
    shoulderR: [0, 0, 0],
    upperArmR: [15, 0, 15],
    forearmR: [100, 0, 0],
    handR: [-115, 0, 0],
    upperArmL: [40, 0, -20],
    forearmL: [60, 0, 0],
    thighL: [20, 0, 0],
    shinL: [-20, 0, 0],
    thighR: [-20, 0, 0],
    shinR: [-35, 0, 0],
  },
});

/** ...full-length lunge: front knee over the toes, back leg straight, arm and blade level. */
const LUNGE_STRIKE: Pose = onGround({
  bones: {
    spine: [-25, 0, 0],
    chest: [0, 0, 0],
    upperArmR: [90, 0, 0],
    forearmR: [0, 0, 0],
    handR: [-65, 0, 0], // spine leans 25 forward, so this holds the blade level
    upperArmL: [-40, 0, -30],
    forearmL: [10, 0, 0],
    thighL: [55, 0, 0],
    shinL: [-55, 0, 0],
    thighR: [-38, 0, 0],
    shinR: [-5, 0, 0],
    footR: [25, 0, 0], // back heel up, ball of the foot down
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
  const mix = (x = 0, y = 0) => x + (y - x) * k;
  return { bones, hipsY: mix(a.hipsY, b.hipsY), hipsZ: mix(a.hipsZ, b.hipsZ) };
}

type Ease = (x: number) => number;
/** Speeds up into the key: a swing accelerating into contact. */
const easeIn: Ease = (x) => clamp01(x) ** 2;
/** Arrives fast and slows down: a follow-through spending what's left of the swing. */
const easeOut: Ease = (x) => 1 - (1 - clamp01(x)) ** 2;

/**
 * Piecewise blend through [time, pose] keys, eased in and out between each pair unless a
 * key names its own easing (for the stretch leading up to it).
 */
function keyed(keys: Array<[number, Pose] | [number, Pose, Ease]>): (t: number) => Pose {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, p1, ease = smooth] = keys[i];
      const [t0, p0] = keys[i - 1];
      if (t <= t1) return lerpPose(p0, p1, ease((t - t0) / Math.max(t1 - t0, 1e-6)));
    }
    return keys[keys.length - 1][1];
  };
}

/**
 * How far ahead of the sword hand each bone moves in a swing (seconds). The legs and hips
 * start it, the chest turns next, and the arm comes last, like the end of a whip. Without
 * this every joint starts and stops together, which reads as one stiff piece.
 */
const LEAD: Partial<Record<BoneId, number>> = {
  hips: 0.045, thighL: 0.045, thighR: 0.045, shinL: 0.045, shinR: 0.045, footL: 0.045, footR: 0.045,
  spine: 0.035, chest: 0.025, neck: 0.03, head: 0.03,
  shoulderR: 0.015, upperArmR: 0.01, forearmR: 0.004,
  shoulderL: 0.02, upperArmL: 0.015, forearmL: 0.008,
};

/**
 * Overlapping action for a clip: each bone plays `LEAD` seconds ahead of the hand. Legs,
 * hips and hip height share one lead, so feet placed on the floor stay there.
 */
function whip(clip: ClipDef): ClipDef {
  const { sample, duration } = clip;
  return {
    ...clip,
    sample: (t) => {
      const cache = new Map<number, Pose>();
      const at = (lead: number) => {
        let p = cache.get(lead);
        if (!p) cache.set(lead, (p = sample(Math.min(duration, t + lead))));
        return p;
      };
      const bones = { ...at(0).bones };
      for (const [id, lead] of Object.entries(LEAD) as Array<[BoneId, number]>) {
        const e = at(lead).bones[id];
        if (e) bones[id] = e;
      }
      const hips = at(LEAD.hips!);
      return { bones, hipsY: hips.hipsY, hipsZ: hips.hipsZ };
    },
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

/** A little extra bend through the body at the moment of contact (degrees, spine and chest). */
const CRUNCH = 5;

/**
 * A swing from `windup` through `strike`. Wound up from the first frame (the crossfade
 * covers the transition), then:
 *  - anticipation: through the startup it keeps winding a little further, never frozen
 *  - the strike speeds up into contact (ease in), so it snaps instead of floating
 *  - follow-through: the blade carries on past the strike pose and slows down
 *  - a small crunch through the torso at contact, for weight
 *  - then it settles back to ready
 * Plus overlap (see whip): the body leads, the arm follows.
 */
function attackClip(def: AttackDef, windup: Pose, strike: Pose): ClipDef {
  const { startup: s, active: a, recovery: r } = def;
  const total = attackDuration(def);
  const coil = lerpPose(strike, windup, 1.12);
  const follow = lerpPose(windup, strike, 1.1);
  const base = keyed([
    [0, windup],
    [s, coil],
    [s + a, strike, easeIn],
    [s + a + r * 0.35, follow, easeOut],
    [total, READY],
  ]);
  const hit = s + a;
  return {
    name: def.anim,
    duration: total,
    loop: false,
    sample: (t) => {
      const p = base(t);
      const k = Math.exp(-(((t - hit - 0.03) / 0.05) ** 2)) * CRUNCH;
      const spine = p.bones.spine ?? [0, 0, 0];
      const chest = p.bones.chest ?? [0, 0, 0];
      return { ...p, bones: { ...p.bones, spine: [spine[0] - k, spine[1], spine[2]], chest: [chest[0] - k * 0.6, chest[1], chest[2]] } };
    },
  };
}

const A = ATTACKS;
const E = EVADES;

/**
 * Spin attack. `turn` 1 = to her left (counterclockwise from above), -1 = to her right.
 * Coiled the other way first, then one low, wide, fast turn with the blade held level out
 * to the side it trails on, leaning into the turn, and a follow-through that carries the
 * blade across her front. Counterclockwise trails the blade on her right (forehand);
 * clockwise reaches it across to her left (backhand).
 */
function spinClip(id: AttackId.Spin | AttackId.SpinClockwise, turn: 1 | -1): ClipDef {
  const d = A[id];
  const s = turn; // mirrors yaw and lean; the sword stays in her right hand
  const legs = {
    thighL: [30, 0, -14] as Euler,
    shinL: [-45, 0, 0] as Euler,
    thighR: [-12, 0, 14] as Euler,
    shinR: [-40, 0, 0] as Euler,
  };
  const lean = (p: Pose): Pose => ({
    ...p,
    bones: { ...p.bones, spine: [-12, 0, s * 8] as Euler, neck: [0, s * 25, 0] as Euler }, // lean in, look ahead
  });
  const roll = turn > 0 ? FOREHAND : BACKHAND; // edge first, whichever way she turns
  const coil = onGround(armOut(-s * 95, -s * 45, legs, roll));
  const sweep = onGround(lean(armOut(-s * 85, 0, legs, roll)));
  const follow = onGround(armOut(s * 55, s * 40, legs, roll));
  const end = d.startup + d.active;
  const base = keyed([
    [0, coil],
    [d.startup, sweep, easeIn],
    [end, sweep],
    [end + 0.1, follow, easeOut],
    [end + d.recovery * 0.45, lerpPose(follow, READY, 0.15)],
    [attackDuration(d), READY],
  ]);
  const wind = -s * 35; // starts wound the other way
  return {
    name: d.anim,
    duration: attackDuration(d),
    loop: false,
    // One full turn plus the unwinding, fastest in the middle of the active window.
    sample: (t) => withHips(base(t), [0, wind + s * (360 + 35) * span(t, d.startup * 0.3, end + 0.08), 0]),
  };
}

/**
 * Spinning ender: coils to her right, then one full turn to the left with the blade held
 * wide and low, finishing in a deep follow-through. Faster and lower than the charged spin.
 */
function finisherSpinClip(): ClipDef {
  const d = A[AttackId.FinisherSpin];
  const low = { thighL: [40, 0, -8] as Euler, shinL: [-45, 0, 0] as Euler, thighR: [-15, 0, 12] as Euler, shinR: [-40, 0, 0] as Euler };
  const coil = onGround(armOut(-70, -45, low, FOREHAND));
  const out = onGround(armOut(-85, 0, low, FOREHAND));
  const follow = onGround(armOut(55, 40, low, FOREHAND));
  const end = d.startup + d.active;
  const base = keyed([
    [0, coil],
    [d.startup, out, easeIn],
    [end, out],
    [end + 0.08, follow, easeOut],
    [end + d.recovery * 0.5, lerpPose(follow, READY, 0.15)],
    [attackDuration(d), READY],
  ]);
  return {
    name: d.anim,
    duration: attackDuration(d),
    loop: false,
    // Hips turn -40 (coiled right) to +360 (a full turn left, back to facing forward).
    sample: (t) => withHips(base(t), [0, -40 + 400 * span(t, d.startup * 0.6, end + 0.06), 0]),
  };
}

const attackClips: ClipDef[] = ([
  // Forehand: blade sweeps from her right to her left.
  attackClip(A[AttackId.Horizontal], armOut(-60, -35, {}, FOREHAND), armOut(55, 40, { thighR: [25, 0, 0], shinR: [-20, 0, 0] }, FOREHAND)),
  // Backhand: left to right.
  attackClip(A[AttackId.ReverseHorizontal], armOut(70, 35, {}, BACKHAND), armOut(-60, -40, { thighR: [25, 0, 0], shinR: [-20, 0, 0] }, BACKHAND)),
  // Diagonals: "/" from over the right shoulder, "\" from over the left. A vertical combo alternates them.
  attackClip(A[AttackId.Vertical], DIAG_R_WINDUP, DIAG_R_STRIKE),
  attackClip(A[AttackId.VerticalLeft], DIAG_L_WINDUP, DIAG_L_STRIKE),
  attackClip(A[AttackId.Thrust], THRUST_WINDUP, THRUST_STRIKE),
  attackClip(A[AttackId.ThrustLeft], THRUST_L_WINDUP, THRUST_L_STRIKE),
  // Out of a roll: the stab rises from the roll's crouch.
  attackClip(A[AttackId.RollThrust], ROLL_THRUST_WINDUP, ROLL_THRUST_STRIKE),
  // Combo enders.
  finisherSpinClip(),
  attackClip(A[AttackId.FinisherRising], RISING_WINDUP, RISING_STRIKE),
  {
    name: A[AttackId.FinisherCleave].anim,
    duration: attackDuration(A[AttackId.FinisherCleave]),
    loop: false,
    sample: (() => {
      const d = A[AttackId.FinisherCleave];
      const strike = d.startup + d.active;
      return keyed([
        [0, onGround(OVERHEAD(-0.15, true))],
        [d.startup * 0.45, CLEAVE_AIR],
        [d.startup, { ...CLEAVE_AIR, bones: { ...CLEAVE_AIR.bones, thighR: [60, 0, 0], shinR: [-60, 0, 0] } }],
        [strike, CLEAVE_KNEEL, easeIn],
        [strike + d.recovery * 0.55, lerpPose(CLEAVE_KNEEL, READY, 0.1)],
        [attackDuration(d), READY],
      ]);
    })(),
  },
  attackClip(A[AttackId.FinisherLunge], LUNGE_WINDUP, LUNGE_STRIKE),
  attackClip(A[AttackId.Overpower], OVERHEAD(-0.12, true), CHOP(-0.2, true)),
  spinClip(AttackId.Spin, 1),
  spinClip(AttackId.SpinClockwise, -1),
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
        [d.startup + d.active, CHOP(-0.25, true), easeIn],
        [d.startup + d.active + d.recovery * 0.5, CHOP(-0.2, true), easeOut],
        [attackDuration(d), READY],
      ]);
    })(),
  },
  (() => {
    const low = { spine: [-35, 0, 0] as Euler, thighL: [50, 0, 0] as Euler, shinL: [-40, 0, 0] as Euler, thighR: [-40, 0, 0] as Euler, shinR: [-20, 0, 0] as Euler };
    return attackClip(A[AttackId.PhantomDash], { ...armOut(-70, -40, low, FOREHAND), hipsY: -0.15 }, { ...armOut(60, 45, low, FOREHAND), hipsY: -0.15 });
  })(),
] satisfies ClipDef[]).map(whip);

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

// ------------------------------------------------------------- ground roll

/** Sword hand for the roll: blade turned out to her right, along the roll's axis, so it never digs in. */
const ROLL_SWORD = { upperArmR: [50, 0, 0] as Euler, forearmR: [70, 0, 0] as Euler, handR: [0, -90, 0] as Euler };

/** Loading the dive: a quick deep crouch, chest out over the lead knee, eyes still ahead. */
const ROLL_LOAD: Pose = {
  bones: {
    spine: [-35, 0, 0],
    chest: [-10, 0, 0],
    neck: [12, 0, 0],
    head: [8, 0, 0],
    upperArmR: [40, 0, 10],
    forearmR: [60, 0, 0],
    handR: [0, -90, 0],
    upperArmL: [55, 0, -10],
    forearmL: [25, 0, 0],
    thighL: [70, 0, 0],
    shinL: [-100, 0, 0],
    thighR: [40, 0, 0],
    shinR: [-95, 0, 0],
  },
};

/**
 * The dive: legs pushing off long behind her, the free hand reaching for the floor,
 * chin starting to tuck. With the body tipped forward this puts the hand down first.
 */
const ROLL_REACH: Pose = {
  bones: {
    spine: [-15, 0, 0],
    chest: [-15, 0, 0],
    neck: [-30, 0, 0],
    head: [-25, 0, 0],
    ...ROLL_SWORD,
    upperArmL: [100, 0, -8],
    forearmL: [70, 0, 0],
    thighL: [30, 0, 0],
    shinL: [-35, 0, 0],
    thighR: [-8, 0, 0],
    shinR: [-15, 0, 0],
  },
};

/**
 * The catch: the hand on the floor bends to take her weight and lower her onto the back of
 * her shoulder, chin tucked, while the legs start to fold. Without it the straight arm props
 * her up like a handstand for a moment and she drops.
 */
const ROLL_CATCH: Pose = {
  bones: {
    spine: [-45, 0, 0],
    chest: [-35, 0, 0],
    neck: [-55, 0, 0],
    head: [-35, 0, 0],
    ...ROLL_SWORD,
    upperArmL: [70, 0, -10],
    forearmL: [110, 0, 0],
    thighL: [75, 0, 0],
    shinL: [-90, 0, 0],
    thighR: [55, 0, 0],
    shinR: [-80, 0, 0],
  },
};

/** Balled up: chin in, knees to the chest, left arm hugging the shins. */
const ROLL_TUCK: Pose = {
  bones: {
    spine: [-45, 0, 0],
    chest: [-35, 0, 0],
    neck: [-45, 0, 0],
    head: [-30, 0, 0],
    ...ROLL_SWORD,
    upperArmL: [70, 0, -5],
    forearmL: [60, 0, 0],
    thighL: [115, 0, 0],
    shinL: [-140, 0, 0],
    thighR: [115, 0, 0],
    shinR: [-140, 0, 0],
  },
};

/** Coming up onto the feet, still low. */
const ROLL_RISE: Pose = {
  bones: {
    spine: [-30, 0, 0],
    chest: [-5, 0, 0],
    ...ROLL_SWORD,
    upperArmL: [45, 0, -15],
    forearmL: [30, 0, 0],
    thighL: [85, 0, 0],
    shinL: [-115, 0, 0],
    thighR: [70, 0, 0],
    shinR: [-120, 0, 0],
  },
};

/** Out of the roll leaning into a run, sword back in the ready grip. */
const ROLL_EXIT: Pose = {
  bones: {
    ...READY.bones,
    spine: [-15, 0, 0],
    thighL: [25, 0, 0],
    shinL: [-35, 0, 0],
    thighR: [-10, 0, 0],
    shinR: [-40, 0, 0],
  },
};

/** Weighted sum of poses (weights add up to 1). */
function blendPoses(poses: readonly Pose[], w: readonly number[]): Pose {
  const bones: Partial<Record<BoneId, Euler>> = {};
  const ids = new Set(poses.flatMap((p) => Object.keys(p.bones))) as Set<BoneId>;
  for (const id of ids) {
    const e: Euler = [0, 0, 0];
    poses.forEach((p, i) => {
      const b = p.bones[id] ?? [0, 0, 0];
      for (let a = 0; a < 3; a++) e[a] += b[a] * w[i];
    });
    bones[id] = e;
  }
  const sum = (f: (p: Pose) => number) => poses.reduce((acc, p, i) => acc + f(p) * w[i], 0);
  return { bones, hipsY: sum((p) => p.hipsY ?? 0), hipsZ: sum((p) => p.hipsZ ?? 0) };
}

/**
 * Smooth curve through [time, pose] keys (Catmull-Rom). Unlike keyed(), it doesn't stop
 * at every key, so a move made of several poses flows from one into the next.
 */
function splined(keys: Array<[number, Pose]>): (t: number) => Pose {
  const n = keys.length;
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    if (t >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 1;
    while (keys[i][0] < t) i++;
    const [t0, p1] = keys[i - 1];
    const [t1, p2] = keys[i];
    const p0 = keys[Math.max(0, i - 2)][1];
    const p3 = keys[Math.min(n - 1, i + 1)][1];
    const u = (t - t0) / (t1 - t0);
    const u2 = u * u;
    const u3 = u2 * u;
    return blendPoses([p0, p1, p2, p3], [
      (-u3 + 2 * u2 - u) / 2,
      (3 * u3 - 5 * u2 + 2) / 2,
      (-3 * u3 + 4 * u2 + u) / 2,
      (u3 - u2) / 2,
    ]);
  };
}

/** Center of the tuck in hips space (meters up, forward). The roll turns about this point. */
const ROLL_CENTER = { up: 0.27, forward: 0 };

/** Roll timing (seconds): start tipping, hand on the floor, back on the feet. */
const ROLL_TIP = 0.07;
const ROLL_HANDS = 0.2;
const ROLL_UP = 0.5;
/** How far she has tipped over when the hand meets the floor (degrees). */
const ROLL_DIVE_ANGLE = 85;

/**
 * Total forward turn at time t. Speeds up through the dive (she tips over her hand), rolls
 * on at the same rate, then eases to a stop as her feet come under her. Each piece starts
 * at the speed the last one ended on, so the spin never jerks.
 */
function rollTurn(t: number): number {
  const A = ROLL_DIVE_ANGLE;
  if (t <= ROLL_TIP) return 0;
  const dive = ROLL_HANDS - ROLL_TIP;
  if (t <= ROLL_HANDS) return A * ((t - ROLL_TIP) / dive) ** 2;
  if (t >= ROLL_UP) return 360;
  // Cubic from the dive's end speed down to zero (Hermite): f(0)=0, f(1)=1, f'(1)=0.
  const span = ROLL_UP - ROLL_HANDS;
  const s0 = ((2 * A) / dive) * (span / (360 - A)); // dive's end speed, in this piece's units
  const u = (t - ROLL_HANDS) / span;
  const f = s0 * (u - 2 * u * u + u * u * u) + (3 * u * u - 2 * u * u * u);
  return A + (360 - A) * f;
}

/** How far smoothing may let her dip into the floor (meters). */
const ROLL_SINK = 0.018;

/**
 * Hip height that keeps the lowest part of her on the floor, smoothed. Placing every frame
 * exactly makes the hips snap whenever a different part becomes the lowest (feet, hand,
 * back, feet again). So: sample the exact heights, then blur them over and over, each time
 * lifting back any spot that sank more than ROLL_SINK below the exact height. Repeating
 * rounds off the corners a single blur-and-lift would leave.
 */
function smoothedFloorHeights(pose: (t: number) => Pose, duration: number, step: number): number[] {
  const n = Math.round(duration / step);
  const exact: number[] = [];
  for (let i = 0; i <= n; i++) exact.push(onGround(pose(i * step), 0.04).hipsY ?? 0);
  const sigma = 0.008 / step;
  const radius = Math.ceil(sigma * 2.5);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, k) => Math.exp(-(((k - radius) / sigma) ** 2) / 2));
  const total = kernel.reduce((a, b) => a + b, 0);
  let h = exact.slice();
  for (let pass = 0; pass < 6; pass++) {
    h = h.map((_, i) => {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += h[Math.max(0, Math.min(n, i + k))] * kernel[k + radius];
      return Math.max(sum / total, exact[i] - ROLL_SINK);
    });
  }
  return h;
}

/**
 * Dive roll along the ground: a crouch, a dive forward onto the free hand, one turn balled
 * up, then up onto the feet. Two things make it a roll and not a flip in the air: it turns
 * about the middle of the tucked body (hipsZ shifts the hips around that point), and her
 * lowest part stays on the floor (smoothed, see smoothedFloorHeights). The motor supplies
 * the travel.
 */
function rollClip(): ClipDef {
  const d = E[EvadeId.Roll];
  const shape = splined([
    [0, ROLL_EXIT],
    [0.1, ROLL_LOAD],
    [ROLL_HANDS, ROLL_REACH],
    [0.21, ROLL_CATCH],
    [0.29, ROLL_TUCK],
    [0.4, ROLL_TUCK],
    [ROLL_UP, ROLL_RISE],
    [d.duration, ROLL_EXIT],
  ]);
  const turned = (t: number): Pose => {
    const turn = rollTurn(t);
    const a = turn * (Math.PI / 180);
    const c = ROLL_CENTER;
    // Where the center would go if the body turned about the hips, undone by moving the hips.
    const hipsZ = c.forward - (c.up * Math.sin(a) + c.forward * Math.cos(a));
    return { ...withHips(shape(t), [-turn, 0, 0]), hipsZ };
  };
  const STEP = 1 / 240;
  const heights = smoothedFloorHeights(turned, d.duration, STEP);
  return {
    name: d.anim,
    duration: d.duration,
    loop: false,
    sample: (t) => {
      const x = Math.max(0, Math.min(heights.length - 1, t / STEP));
      const i = Math.min(heights.length - 2, Math.floor(x));
      const hipsY = heights[i] + (heights[i + 1] - heights[i]) * (x - i);
      return { ...turned(t), hipsY };
    },
  };
}

const PD = DEFAULT_TUNING.perfectDodgeDuration;
const evadeClips: ClipDef[] = [
  rollClip(),
  flipClip(E[EvadeId.Backflip].anim, E[EvadeId.Backflip].duration, [360, 0, 0], TUCK, 0.06, 0.46),
  flipClip(E[EvadeId.SideHopLeft].anim, E[EvadeId.SideHopLeft].duration, [0, 0, 0], withHips(lerpPose(READY, TUCK, 0.35), [0, 0, 15]), 0, 0.36),
  flipClip(E[EvadeId.SideHopRight].anim, E[EvadeId.SideHopRight].duration, [0, 0, 0], withHips(lerpPose(READY, TUCK, 0.35), [0, 0, -15]), 0, 0.36),
  // Perfect dodge flourishes: each base evade flows into a bigger version.
  flipClip('pd_aerial_cartwheel', PD, [0, 0, 360], SPREAD, 0, 0.45),
  flipClip('pd_corkscrew_left', PD, [360, 360, 0], TUCK, 0, 0.45),
  flipClip('pd_corkscrew_right', PD, [360, -360, 0], TUCK, 0, 0.45),
  flipClip('pd_backflip_twist', PD, [360, 0, 0], TUCK, 0, 0.45),
];

/**
 * One-shot that's knocked into `pose`: it snaps a little past it, springs back, eases off a
 * touch while it holds, then returns to `to`.
 */
function impact(name: string, duration: number, pose: Pose, to: Pose, hit = 0.06): ClipDef {
  const past = lerpPose(to, pose, 1.18);
  return {
    name,
    duration,
    loop: false,
    sample: keyed([
      [0, to],
      [hit, past, easeOut],
      [hit + Math.min(0.1, duration * 0.2), pose],
      [duration * 0.5, lerpPose(to, pose, 0.92)],
      [duration, to],
    ]),
  };
}

const T = DEFAULT_TUNING;
const reactionClips: ClipDef[] = [
  // Perfect block: the guard shoves the hit away, then settles back into the guard.
  impact('pb_clash_a', T.perfectBlockDuration, parry(1), GUARD, 0.05),
  impact('pb_clash_b', T.perfectBlockDuration, parry(-1), GUARD, 0.05),
  { name: 'guard_raise', duration: 0.15, loop: false, sample: keyed([[0, READY], [0.12, GUARD]]) },
  // A hit on the guard: knocked back over the back foot, feet planted.
  impact('guard_impact', T.guardRecoilTime, withFeet({ ...GUARD, hipsZ: -0.05, bones: { ...GUARD.bones, spine: [8, 0, 0], head: [6, 0, 0] } }, GUARD_FEET), GUARD, 0.03),
  impact('hurt', T.hitStunTime, HURT, READY, 0.05),
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
const STRAFE_PERIOD = 0.5; // two steps, locked on
const STRAFE_SIDE_PERIOD = 0.36;
const CHARGE_PERIOD = 0.6; // two small steps, charging a spin
const CHARGE_SIDE_PERIOD = 0.36;
const IDLE_PERIOD = 6;
/**
 * One leg over its cycle (u, any number; the fraction is used). First it's off the floor,
 * carried from behind her to out ahead; then, for the last `duty` of the cycle, planted
 * and sliding steadily back under her as she moves over it (steady, so it doesn't skid).
 * A duty of a half is a walk; less leaves moments with both feet up, a jog.
 * `along` -1..1, `lift` 0..1.
 */
function stepCycle(u: number, duty = 0.5): { along: number; lift: number } {
  const k = u - Math.floor(u);
  const swing = 1 - duty;
  if (k < swing) {
    // The swing leaves and lands moving back at the planted speed (cubic Hermite), so a
    // foot touches down already matching the ground instead of skidding as it lands.
    const x = k / swing;
    // Capped so a short stance (a jog) doesn't fling the foot far past its spot.
    const m = Math.max(-2.5, (-2 * swing) / duty);
    const along = -(2 * x ** 3 - 3 * x ** 2 + 1) + m * (x ** 3 - 2 * x ** 2 + x) + (-2 * x ** 3 + 3 * x ** 2) + m * (x ** 3 - x ** 2);
    return { along, lift: Math.sin(Math.PI * x) };
  }
  return { along: 1 - (2 * (k - swing)) / duty, lift: 0 };
}

/** Furthest a foot gets from its spot over a cycle, in `along` units (the swing overshoots a little). */
function alongMax(duty: number): number {
  let most = 1;
  for (let i = 0; i <= 200; i++) most = Math.max(most, Math.abs(stepCycle(i / 200, duty).along));
  return most;
}

/** Longest reach from hip to ankle the IK may use (a hair short of straight). */
const REACH = 0.85;

/**
 * Steps in any direction (dx her right, dy her forward) at `speed`, on top of a stance.
 * The feet are placed, not swung: each starts on its spot from the stance (both on the
 * floor), and over its cycle is carried ahead in an arc `lift` high, then planted and
 * slid back under her at exactly her speed, so it stays put on the ground while she moves
 * over it. Leg IK turns those spots into thigh, knee and foot angles. Side steps open the
 * stance so the feet close up, never cross. The hips dip a little as each foot lands.
 */
interface StepOptions {
  speed: number;
  /** Seconds for two steps (one with each foot). */
  period: number;
  /** How high a foot is carried through its step (meters). */
  lift: number;
  /** Share of the cycle each foot is on the floor (see stepCycle). */
  duty?: number;
  /**
   * Longest a foot may travel either side of its spot (meters). Past this the steps stop
   * growing and the planted foot slides some: only for speeds no natural step can match.
   */
  maxHalf?: number;
  /** Bob and sway with the steps (off for a still stance). */
  bounce?: boolean;
}

function stepGait(base: Pose, dx: number, dy: number, o: StepOptions): (t: number) => Pose {
  const { speed, period, lift, duty = 0.5, maxHalf = Infinity, bounce = true } = o;
  const frames = jointFrames(base);
  const len = Math.hypot(dx, dy) || 1;
  const [ux, uz] = [dx / len, -dy / len]; // her forward is -Z
  const half = Math.min(maxHalf, (speed * period * duty) / 2); // each foot goes this far either side of its spot
  const reach = alongMax(duty);
  // Side steps: the feet come together and part again by 4 * half. Open the stance just
  // enough that at their closest they're still 20 cm apart (closer and the knees knock).
  const gap = frames.footR.p[0] - frames.footL.p[0];
  const splay = Math.abs(ux) * Math.max(0, (0.2 - gap + 2 * half * reach * Math.abs(ux)) / 2);
  const legs = (['L', 'R'] as const).map((side, i) => {
    const hip = frames[`thigh${side}`].p;
    const foot = frames[`foot${side}`].p;
    return { side, offset: i * 0.5, hip, spot: [foot[0] + (side === 'L' ? -splay : splay), foot[2]] as [number, number] };
  });
  // Every foot has to reach the floor at both ends of its stride. Sink the hips as far as
  // that takes (up to 12 cm), then bring any spot still out of reach in toward her.
  const far = (l: (typeof legs)[number]) =>
    Math.max(...[-reach, reach].map((a) => Math.hypot(l.spot[0] + ux * a * half - l.hip[0], l.spot[1] + uz * a * half - l.hip[2])));
  const height = (l: (typeof legs)[number]) => l.hip[1] - ANKLE;
  const sink = Math.min(0.12, Math.max(0, ...legs.map((l) => height(l) - Math.sqrt(Math.max(0, REACH ** 2 - far(l) ** 2)))));
  for (const l of legs) {
    const allowed = Math.sqrt(Math.max(0, REACH ** 2 - (height(l) - sink) ** 2));
    const over = far(l) - allowed;
    if (over > 0) {
      const [ox, oz] = [l.spot[0] - l.hip[0], l.spot[1] - l.hip[2]];
      const r = Math.hypot(ox, oz) || 1;
      l.spot = [l.spot[0] - (ox / r) * over, l.spot[1] - (oz / r) * over];
    }
  }
  return (t) => {
    const u = t / period;
    const dip = -sink + (bounce ? -0.012 * (0.5 + 0.5 * Math.cos(4 * Math.PI * u)) : 0); // lowest as each foot lands
    const bones = { ...base.bones };
    for (const { side, offset, hip, spot } of legs) {
      const step = stepCycle(u + offset, duty);
      const at: [number, number, number] = [
        spot[0] + ux * step.along * half - hip[0],
        ANKLE + lift * step.lift - (hip[1] + dip),
        spot[1] + uz * step.along * half - hip[2],
      ];
      const ik = legIK(at);
      bones[`thigh${side}`] = ik.thigh;
      bones[`shin${side}`] = ik.shin;
      bones[`foot${side}`] = ik.foot;
    }
    // The body rides the steps: a little side to side over the planted foot.
    const sway = bounce ? Math.sin(u * Math.PI * 2) : 0;
    const spine = base.bones.spine ?? [0, 0, 0];
    bones.spine = [spine[0], spine[1], spine[2] + 2 * sway];
    return { ...base, hipsY: (base.hipsY ?? 0) + dip, bones };
  };
}

/**
 * The run. Each leg: thigh swinging, the knee folding high as it comes through behind her
 * and giving a little on landing, the heel peeling up as it pushes off. The hips turn with
 * the legs and dip on the swinging side; the chest turns against them, the free arm swings
 * against its leg with the elbow bending as it comes forward, and the neck undoes the turn
 * so her head stays level. A short float off the floor at each stride's widest point.
 */
function runPose(t: number): Pose {
  const p = (t / RUN_PERIOD) * Math.PI * 2;
  const s = Math.sin(p);
  const c = Math.cos(p);
  const STRIDE = 40;
  const leg = (phi: number): { thigh: number; shin: number; foot: number } => ({
    thigh: STRIDE * Math.sin(phi),
    shin: -12 - 80 * Math.max(0, Math.cos(phi + 0.5)) ** 1.5 - 16 * Math.max(0, -Math.cos(phi)) ** 2,
    foot: 22 * Math.max(0, -Math.sin(phi)) ** 2,
  });
  const L = leg(p);
  const R = leg(p + Math.PI);
  const pose = onGround({
    ...READY,
    bones: {
      ...READY.bones,
      hips: [0, -7 * s, 3 * c],
      spine: [-12, 6 * s, -2 * c],
      chest: [0, 9 * s, 0],
      neck: [6, -8 * s, 0],
      thighL: [L.thigh, 0, 0],
      shinL: [L.shin, 0, 0],
      footL: [L.foot, 0, 0],
      thighR: [R.thigh, 0, 0],
      shinR: [R.shin, 0, 0],
      footR: [R.foot, 0, 0],
      upperArmL: [-32 * s, 0, -12],
      forearmL: [50 + 30 * Math.max(0, -s), 0, 0],
      upperArmR: [18 + 12 * s, 0, 12],
      forearmR: [38 + 12 * Math.max(0, s), 0, 0],
    },
  });
  const float = 0.03 * Math.max(0, (s * s - 0.55) / 0.45);
  return { ...pose, hipsY: (pose.hipsY ?? 0) + float };
}

/**
 * Standing: two breaths a loop (chest and shoulders rise), weight drifting from leg to leg,
 * a slow look around, and the sword hand never quite still.
 */
function idlePose(t: number): Pose {
  const w = (n: number, phase = 0) => Math.sin((t / IDLE_PERIOD) * Math.PI * 2 * n + phase);
  const breath = w(2);
  const sway = w(1);
  return onGround({
    ...READY,
    bones: {
      ...READY.bones,
      spine: [-5 + 0.8 * breath, 0, 1.2 * sway],
      chest: [1.8 * breath, 0, -0.6 * sway],
      neck: [0, 5 * w(1, 1.3), 0],
      head: [w(3, 0.5), 0, 0],
      upperArmL: [15 + 1.5 * w(2, 0.4), 0, -10 - 1.5 * breath],
      upperArmR: [25 + w(2, 0.6), 0, 8 + 1.2 * breath],
      handR: [-75 + 2 * w(2, 0.9), 0, 0],
      shinL: [-15 + 3 * sway, 0, 0],
      shinR: [-10 - 3 * sway, 0, 0],
    },
  });
}

/**
 * `base` with its feet put on the floor at `feet` (rig space x, z; her forward is -Z), by
 * leg IK from where its hips are. For stances: say where the feet go, get the legs.
 */
function withFeet(base: Pose, feet: { L: [number, number]; R: [number, number] }): Pose {
  const frames = jointFrames(base);
  const bones = { ...base.bones };
  for (const side of ['L', 'R'] as const) {
    const hip = frames[`thigh${side}`].p;
    const ik = legIK([feet[side][0] - hip[0], ANKLE - hip[1], feet[side][1] - hip[2]]);
    bones[`thigh${side}`] = ik.thigh;
    bones[`shin${side}`] = ik.shin;
    bones[`foot${side}`] = ik.foot;
  }
  return { ...base, bones };
}

/**
 * Locked on: the fighting stance. The two-handed guard of STANCE (blade up at the target's
 * eyes) on wide, planted feet: left foot forward and out, right foot back and out, hips
 * down, knees bent. Strafing steps from here too.
 */
/** The fighting stance's feet: wide, left foot forward and out, right back and out. */
const COMBAT_FEET: { L: [number, number]; R: [number, number] } = { L: [-0.2, -0.18], R: [0.22, 0.22] };

const COMBAT: Pose = withFeet({ ...STANCE, hipsY: -0.12, bones: { ...STANCE.bones, spine: [-8, 0, 0] } }, COMBAT_FEET);

/** Standing locked on: the combat stance breathing, weight easing a little front to back. */
function combatPose(t: number): Pose {
  const b = Math.sin((t / 3) * Math.PI * 2);
  const shift = Math.sin((t / 3) * Math.PI * 2 + 1.2);
  const base = { ...COMBAT, hipsY: (COMBAT.hipsY ?? 0) - 0.008 * (1 + b), bones: { ...COMBAT.bones, chest: [1.5 * b, 0, 0] as Euler, spine: [-8 + 1.5 * shift, 0, 0] as Euler } };
  return withFeet(base, COMBAT_FEET);
}

/**
 * Near an enemy, not locked on: still relaxed above the waist, but the feet set apart and
 * staggered, knees soft, the sword hand up a little. Says "there's something here".
 */
function alertPose(t: number): Pose {
  const p = idlePose(t);
  const r = p.bones;
  const base: Pose = {
    ...p,
    hipsY: -0.06,
    bones: {
      ...r,
      spine: [(r.spine?.[0] ?? 0) - 4, r.spine?.[1] ?? 0, r.spine?.[2] ?? 0],
      upperArmR: [(r.upperArmR?.[0] ?? 0) + 10, 0, r.upperArmR?.[2] ?? 0],
      forearmR: [45, 0, 0],
    },
  };
  return withFeet(base, { L: [-0.15, -0.08], R: [0.16, 0.1] });
}

/**
 * Charging a spin, standing: held steady and coiled, a slow breath only. The blade does
 * the trembling (render side, BladeCharge), so the body reads as gathering power.
 */
function chargePose(t: number): Pose {
  const b = Math.sin(t * Math.PI * 2);
  return { ...CHARGE_PLANTED, bones: { ...CHARGE_PLANTED.bones, chest: [1.5 * b, -35, 0] } };
}

/** The charge stance with both feet flat on the floor (the back one hovers in CHARGE). */
const CHARGE_PLANTED: Pose = stepGait(CHARGE, 0, 1, { speed: 0, period: 1, lift: 0, bounce: false })(0);

// Strafing is a jog (4 m/s): forward and back, feet on the floor a third of the time with a
// float between. Sideways there's no natural step that fast: a quick, light shuffle (feet
// down a quarter of the time) with capped steps, so they slide some instead of straddling.
const strafe = (dx: number, dy: number) =>
  dx === 0
    ? stepGait(COMBAT, dx, dy, { speed: T.strafeSpeed, period: STRAFE_PERIOD, lift: 0.09, duty: 0.34 })
    : stepGait(COMBAT, dx, dy, { speed: T.strafeSpeed, period: STRAFE_SIDE_PERIOD, lift: 0.07, maxHalf: 0.12, duty: 0.25 });
// Charging: a walk. Side steps a little quicker, so they stay small.
const charge = (dx: number, dy: number) =>
  stepGait(CHARGE, dx, dy, { speed: T.chargeMoveSpeed, period: dx === 0 ? CHARGE_PERIOD : CHARGE_SIDE_PERIOD, lift: 0.06 });
const loop = (name: string, duration: number, sample: (t: number) => Pose): ClipDef => ({ name, duration, loop: true, sample });

export const LOCOMOTION_CLIPS = {
  idle: loop('loco_idle', IDLE_PERIOD, idlePose),
  // Near an enemy, not locked on.
  alert: loop('loco_alert', IDLE_PERIOD, alertPose),
  // Locked on, standing: the fighting stance the strafes step out of.
  stance: loop('loco_stance', 3, combatPose),
  run: loop('loco_run', RUN_PERIOD, runPose),
  strafeF: loop('loco_strafe_f', STRAFE_PERIOD, strafe(0, 1)),
  strafeB: loop('loco_strafe_b', STRAFE_PERIOD, strafe(0, -1)),
  strafeL: loop('loco_strafe_l', STRAFE_SIDE_PERIOD, strafe(-1, 0)),
  strafeR: loop('loco_strafe_r', STRAFE_SIDE_PERIOD, strafe(1, 0)),
  // Charging a spin: coiled, and small steps the way she's moving, so she never glides.
  charge: loop('charge_idle', 1, chargePose),
  chargeF: loop('charge_step_f', CHARGE_PERIOD, charge(0, 1)),
  chargeB: loop('charge_step_b', CHARGE_PERIOD, charge(0, -1)),
  chargeL: loop('charge_step_l', CHARGE_SIDE_PERIOD, charge(-1, 0)),
  chargeR: loop('charge_step_r', CHARGE_SIDE_PERIOD, charge(1, 0)),
} satisfies Record<string, ClipDef>;

/** The FSM asks for 'locomotion'; the animator blends LOCOMOTION_CLIPS by its params. */
export const LOCOMOTION = 'locomotion';

/** `locomotion` param values. */
export const LOCO_MODE = { idle: 0, run: 1, strafe: 2, charge: 3 } as const;

export interface LocomotionParams {
  locomotion: number; // LOCO_MODE
  speed: number; // m/s, free run
  strafeX: number; // -1..1, her right (strafing and charging)
  strafeY: number; // -1..1, her forward
  /** 0..1: something targetable is near (not locked on). Standing turns into the alert idle. */
  alert?: number;
}

export type LocoKey = keyof typeof LOCOMOTION_CLIPS;

/** Weights for each locomotion clip (they sum to 1), plus the run's playback rate. */
export function locomotionWeights(p: LocomotionParams, runSpeed = DEFAULT_TUNING.runSpeed) {
  const w = Object.fromEntries(Object.keys(LOCOMOTION_CLIPS).map((k) => [k, 0])) as Record<LocoKey, number>;
  let runRate = 1;
  /** Splits the stick between four directional clips and a standing one. */
  const directional = (stand: LocoKey, f: LocoKey, b: LocoKey, l: LocoKey, r: LocoKey) => {
    const { strafeX: x, strafeY: y } = p;
    const m = clamp01(Math.hypot(x, y));
    const sum = Math.abs(x) + Math.abs(y) || 1;
    w[r] = (Math.max(0, x) / sum) * m;
    w[l] = (Math.max(0, -x) / sum) * m;
    w[f] = (Math.max(0, y) / sum) * m;
    w[b] = (Math.max(0, -y) / sum) * m;
    w[stand] = 1 - m;
  };
  const alert = clamp01(p.alert ?? 0);
  /** Standing still, free: the relaxed idle, or the alert one near an enemy. */
  const stand = (share: number) => {
    w.idle = share * (1 - alert);
    w.alert = share * alert;
  };
  if (p.locomotion === LOCO_MODE.run) {
    const k = clamp01(p.speed / runSpeed);
    w.run = k;
    stand(1 - k);
    runRate = Math.max(0.4, k);
  } else if (p.locomotion === LOCO_MODE.strafe) {
    directional('stance', 'strafeF', 'strafeB', 'strafeL', 'strafeR');
  } else if (p.locomotion === LOCO_MODE.charge) {
    directional('charge', 'chargeF', 'chargeB', 'chargeL', 'chargeR');
  } else {
    stand(1);
  }
  return { weights: w, runRate };
}

/** Every one-shot or looping clip the states can request by name. */
export const CLIPS: ReadonlyMap<string, ClipDef> = new Map([...attackClips, ...evadeClips, ...reactionClips].map((c) => [c.name, c]));
