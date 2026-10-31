import { ATTACKS, attackDuration, AttackId, EVADES, EvadeId, type AttackDef } from '../combat/moves';
import { DEFAULT_TUNING } from '../player/contracts';
import { onGround } from './fk';
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
 * Block: high horizontal guard. Blade level across her front just above her head, tip to
 * her left, the left palm braced under the blade. Low, wide stance.
 */
const GUARD: Pose = {
  hipsY: -0.1,
  bones: {
    spine: [4, 0, 0],
    neck: [-6, 0, 0],
    upperArmR: [118, 0, 30],
    forearmR: [75, 0, 0],
    handR: [10, 75, 0],
    upperArmL: [112, 0, 20],
    forearmL: [60, 0, 0],
    thighL: [22, 0, -6],
    shinL: [-35, 0, 0],
    thighR: [-8, 0, 8],
    shinR: [-30, 0, 0],
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
    handR: [-100, 0, 0],
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
    handR: [-85, 0, 0],
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

/** Rising ender wound up: crouched, blade low behind her on the left. */
const RISING_WINDUP: Pose = onGround({
  bones: {
    spine: [-20, 10, 0],
    chest: [0, 30, 0],
    shoulderR: [0, 40, 0],
    upperArmR: [-10, 0, -40],
    forearmR: [30, 0, 0],
    handR: [-120, 0, 0],
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
    handR: [-110, 0, 0],
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
  const coil = onGround(armOut(-s * 95, -s * 45, legs));
  const sweep = onGround(lean(armOut(-s * 85, 0, legs)));
  const follow = onGround(armOut(s * 55, s * 40, legs));
  const end = d.startup + d.active;
  const base = keyed([
    [0, coil],
    [d.startup, sweep],
    [end, sweep],
    [end + 0.1, follow],
    [end + d.recovery * 0.45, follow],
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
  const coil = onGround(armOut(-70, -45, low));
  const out = onGround(armOut(-85, 0, low));
  const follow = onGround(armOut(55, 40, low));
  const end = d.startup + d.active;
  const base = keyed([
    [0, coil],
    [d.startup, out],
    [end, out],
    [end + 0.08, follow],
    [end + d.recovery * 0.5, follow],
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

const attackClips: ClipDef[] = [
  // Forehand: blade sweeps from her right to her left.
  attackClip(A[AttackId.Horizontal], armOut(-60, -35), armOut(55, 40, { thighR: [25, 0, 0], shinR: [-20, 0, 0] })),
  // Backhand: left to right.
  attackClip(A[AttackId.ReverseHorizontal], armOut(70, 35), armOut(-60, -40, { thighR: [25, 0, 0], shinR: [-20, 0, 0] })),
  // Diagonals: "/" from over the right shoulder, "\" from over the left. A vertical combo alternates them.
  attackClip(A[AttackId.Vertical], DIAG_R_WINDUP, DIAG_R_STRIKE),
  attackClip(A[AttackId.VerticalLeft], DIAG_L_WINDUP, DIAG_L_STRIKE),
  attackClip(A[AttackId.Thrust], THRUST_WINDUP, THRUST_STRIKE),
  attackClip(A[AttackId.ThrustLeft], THRUST_L_WINDUP, THRUST_L_STRIKE),
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
        [strike, CLEAVE_KNEEL],
        [strike + d.recovery * 0.55, CLEAVE_KNEEL],
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
    // Held steady and coiled: a slow breath only. The blade does the trembling (render
    // side, BladeCharge), so the body reads as gathering power, not shaking.
    sample: (t) => {
      const b = Math.sin(t * Math.PI * 2);
      return { ...CHARGE, hipsY: (CHARGE.hipsY ?? 0) - 0.006 * (1 + b), bones: { ...CHARGE.bones, chest: [1.5 * b, -35, 0] } };
    },
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

function gait(period: number, stride: number, lean: number, arms: 'swing' | 'stance') {
  return (t: number): Pose => {
    const p = (t / period) * Math.PI * 2;
    const s = Math.sin(p);
    const base = arms === 'stance' ? STANCE : READY;
    return {
      hipsY: -0.05 + 0.035 * (0.5 + 0.5 * Math.cos(2 * p)), // same rhythm as |cos p|, no kink at footfall
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
      hipsY: -0.07 + 0.025 * (0.5 + 0.5 * Math.cos(2 * p)),
      bones: {
        ...STANCE.bones,
        thighR: [10, 0, dir * 22 * open],
        shinR: [-22, 0, 0],
        thighL: [10, 0, dir * 12 * (1 - open)],
        shinL: [-22, 0, 0],
      },
    };
  };
}

export const LOCOMOTION_CLIPS = {
  idle: { name: 'loco_idle', duration: 2, loop: true, sample: (t: number) => ({ ...READY, bones: { ...READY.bones, chest: [2 * Math.sin((t / 2) * Math.PI * 2), 0, 0] as Euler } }) },
  run: { name: 'loco_run', duration: RUN_PERIOD, loop: true, sample: gait(RUN_PERIOD, 40, -12, 'swing') },
  strafeF: { name: 'loco_strafe_f', duration: STRAFE_PERIOD, loop: true, sample: gait(STRAFE_PERIOD, 25, -6, 'stance') },
  strafeB: { name: 'loco_strafe_b', duration: STRAFE_PERIOD, loop: true, sample: (t: number) => gait(STRAFE_PERIOD, 20, 0, 'stance')(STRAFE_PERIOD - t) },
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
