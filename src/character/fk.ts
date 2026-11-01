import type { Pose } from './clips';
import { BONES, HIPS_HEIGHT, type BoneId } from './rig';

/*
 * Tiny forward kinematics for clip authoring, engine-free. Same conventions as the
 * render layer: bone-local Euler YXZ in degrees, three.js axes (forward is -Z).
 *
 * Two jobs: find the lowest point of a posed body, so poses that touch the floor with
 * something other than the feet (a roll, a kneel, a deep lunge) can be placed on the
 * ground exactly instead of by guessing hipsY; and leg IK (legIK), so stepping clips can
 * put each foot exactly where it should be on the floor.
 */

type V3 = [number, number, number];
/** Row-major 3x3. */
type M3 = [number, number, number, number, number, number, number, number, number];

const DEG = Math.PI / 180;

/** Ry * Rx * Rz, matching THREE.Euler order 'YXZ'. */
function rotation([x, y, z]: readonly [number, number, number]): M3 {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x * DEG), Math.sin(x * DEG), Math.cos(y * DEG), Math.sin(y * DEG), Math.cos(z * DEG), Math.sin(z * DEG)];
  return [
    cy * cz + sy * sx * sz, cy * -sz + sy * sx * cz, sy * cx,
    cx * sz, cx * cz, -sx,
    -sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx,
  ];
}

function mul(a: M3, b: M3): M3 {
  const r = new Array<number>(9) as M3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return r;
}

const apply = (m: M3, v: V3): V3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/**
 * The placeholder body as spheres: [bone, offset from the joint, radius]. Rough fit of the
 * meshes in src/render/CharacterFigure.ts. The sword is left out on purpose: a chop that
 * ends with the blade at the floor should not lift her off it.
 */
export const BODY: ReadonlyArray<[BoneId, V3, number]> = [
  ['hips', [0, 0, 0], 0.15],
  ['hips', [0, -0.2, 0], 0.18], // tunic hem
  ['spine', [0, 0.08, 0], 0.11],
  ['chest', [0, 0.1, 0], 0.14],
  ['chest', [0, 0.2, 0], 0.12],
  ['neck', [0, 0.04, 0], 0.05],
  ['head', [0, 0.12, 0], 0.135], // the anime head: chin 2.5 cm below the joint, crown 25.5 cm above
  ['shoulderL', [-0.1, 0, 0], 0.055],
  ['shoulderR', [0.1, 0, 0], 0.055],
  ['upperArmL', [0, -0.135, 0], 0.045],
  ['upperArmR', [0, -0.135, 0], 0.045],
  ['forearmL', [0, 0, 0], 0.045],
  ['forearmR', [0, 0, 0], 0.045],
  ['handL', [0, -0.045, 0], 0.045],
  ['handR', [0, -0.045, 0], 0.045],
  ['thighL', [0, -0.2, 0], 0.07],
  ['thighR', [0, -0.2, 0], 0.07],
  ['shinL', [0, 0, 0], 0.06], // knee
  ['shinR', [0, 0, 0], 0.06],
  ['shinL', [0, -0.2, 0], 0.05],
  ['shinR', [0, -0.2, 0], 0.05],
  ['footL', [0, -0.07, -0.15], 0], // toe
  ['footR', [0, -0.07, -0.15], 0],
  ['footL', [0, -0.07, 0.05], 0], // heel
  ['footR', [0, -0.07, 0.05], 0],
];

/** World position and rotation of every joint for a pose, feet origin, three.js axes. */
export function jointFrames(pose: Pose): Record<BoneId, { p: V3; r: M3 }> {
  const out = {} as Record<BoneId, { p: V3; r: M3 }>;
  for (const b of BONES) {
    const local = rotation(pose.bones[b.id] ?? [0, 0, 0]);
    if (!b.parent) {
      const p: V3 = [b.offset[0], HIPS_HEIGHT + (pose.hipsY ?? 0), b.offset[2] - (pose.hipsZ ?? 0)];
      out[b.id] = { p, r: local };
      continue;
    }
    const parent = out[b.parent];
    const o = apply(parent.r, b.offset);
    out[b.id] = { p: [parent.p[0] + o[0], parent.p[1] + o[1], parent.p[2] + o[2]], r: mul(parent.r, local) };
  }
  return out;
}

/** Height of the lowest point of the body (not the sword). 0 = touching the floor. */
export function lowestPoint(pose: Pose): number {
  const frames = jointFrames(pose);
  let low = Infinity;
  for (const [bone, offset, radius] of BODY) {
    const f = frames[bone];
    low = Math.min(low, f.p[1] + apply(f.r, offset)[1] - radius);
  }
  return low;
}

/**
 * The same pose, lifted or lowered so its lowest point sits on the floor. `clearance`
 * covers where the spheres above run a little inside the real meshes.
 */
export function onGround(pose: Pose, clearance = 0): Pose {
  return { ...pose, hipsY: (pose.hipsY ?? 0) - lowestPoint(pose) + clearance };
}

const THIGH = 0.44;
const SHIN = 0.43;
const UPPER_ARM = 0.27;
const FOREARM = 0.235;
/** Ankle to sole (meters): an ankle this high has the foot flat on the floor. */
export const ANKLE = 0.07;

/**
 * Two-bone IK for a limb hanging down at rest (-Y): pitch (X) after roll (Z) at the root,
 * and the middle joint bending about the root's X, backward (a knee). In the root's frame
 * the end is at (0, -h, v), h = upper + lower cos(bend), v = -lower sin(bend); the roll
 * swings that out to the side and the pitch turns it forward. Radians. A target out of
 * reach gets the limb pointed at it as far as it goes.
 */
function twoBone(to: readonly [number, number, number], upper: number, lower: number): { pitch: number; roll: number; bend: number } {
  const [x, y, z] = to;
  const d = Math.min(upper + lower - 1e-4, Math.max(Math.abs(upper - lower) + 0.05, Math.hypot(x, y, z)));
  const bend = -Math.acos(Math.max(-1, Math.min(1, (d * d - upper * upper - lower * lower) / (2 * upper * lower))));
  const h = upper + lower * Math.cos(bend);
  const v = -lower * Math.sin(bend);
  const roll = Math.asin(Math.max(-1, Math.min(1, x / h)));
  const c = h * Math.cos(roll);
  const pitch = Math.atan2(z, y) - Math.atan2(v, -c);
  // atan2 differences can wrap: keep the pitch in -180..180.
  return { pitch: Math.atan2(Math.sin(pitch), Math.cos(pitch)), roll, bend };
}

/**
 * Leg IK: thigh, shin and foot angles (degrees, clip conventions) that put the ankle at
 * `to`, given relative to the hip joint in the hips' frame (x her right, y up, -z her
 * forward). The knee bends the natural way and the foot is kept flat.
 */
export function legIK(to: readonly [number, number, number]): { thigh: [number, number, number]; shin: [number, number, number]; foot: [number, number, number] } {
  const { pitch, roll, bend } = twoBone(to, THIGH, SHIN);
  const deg = (r: number) => r / DEG;
  return {
    thigh: [deg(pitch), 0, deg(roll)],
    shin: [deg(bend), 0, 0],
    foot: [-deg(pitch + bend), 0, -deg(roll)],
  };
}

/**
 * Arm IK: upper arm and forearm angles (degrees, clip conventions) that put the wrist at
 * `to`, relative to the shoulder joint in the shoulder bone's frame. The elbow bends
 * forward and points toward `pole` (same frame) as far as the reach allows: out and down,
 * away from her body, so an arm reaching across her doesn't fold into her chest.
 *
 * How: the elbow is placed on the circle the two lengths allow, on the pole's side; the
 * upper arm then points at it (its -Y), with its X the elbow hinge (the forearm folds
 * toward its -Z); the angles are read back off that frame (Euler YXZ).
 */
export function armIK(
  to: readonly [number, number, number],
  pole: readonly [number, number, number] = [-1, -0.3, 0.3],
): { upperArm: [number, number, number]; forearm: [number, number, number] } {
  const a = UPPER_ARM;
  const b = FOREARM;
  const len = Math.hypot(to[0], to[1], to[2]) || 1e-6;
  const d = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 0.05, len));
  const u: V3 = [to[0] / len, to[1] / len, to[2] / len];
  const dot = (x: V3, y: readonly number[]) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const norm = (x: V3): V3 => {
    const l = Math.hypot(x[0], x[1], x[2]) || 1;
    return [x[0] / l, x[1] / l, x[2] / l];
  };
  // The pole, square to the reach.
  const pu = dot(u, pole);
  let side: V3 = [pole[0] - pu * u[0], pole[1] - pu * u[1], pole[2] - pu * u[2]];
  if (Math.hypot(...side) < 1e-6) side = [0, 0, 1];
  side = norm(side);
  const cosA = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const e: V3 = [u[0] * cosA + side[0] * sinA, u[1] * cosA + side[1] * sinA, u[2] * cosA + side[2] * sinA];
  const f = norm([u[0] * d - e[0] * a, u[1] * d - e[1] * a, u[2] * d - e[2] * a]);
  // Upper arm frame: -Y along the upper arm, the forearm folding toward -Z.
  const y: V3 = [-e[0], -e[1], -e[2]];
  const fe = dot(f, e);
  let fold: V3 = [f[0] - fe * e[0], f[1] - fe * e[1], f[2] - fe * e[2]];
  if (Math.hypot(...fold) < 1e-6) fold = [-side[0], -side[1], -side[2]]; // straight arm: any hinge square to it
  const z = norm([-fold[0], -fold[1], -fold[2]]);
  const x: V3 = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
  // Euler YXZ off the matrix [x y z] (columns): see rotation() above.
  const deg = (r: number) => r / DEG;
  const rx = Math.asin(Math.max(-1, Math.min(1, -z[1])));
  const ry = Math.atan2(z[0], z[2]);
  const rz = Math.atan2(x[1], y[1]);
  const bend = Math.acos(Math.max(-1, Math.min(1, fe)));
  return { upperArm: [deg(rx), deg(ry), deg(rz)], forearm: [deg(bend), 0, 0] };
}

/**
 * The local Euler (degrees, YXZ, clip conventions) that gives a bone the world rotation
 * `world`, under a parent whose world rotation is `parent` (row-major, as jointFrames).
 */
export function localEuler(parent: readonly number[], world: readonly number[]): [number, number, number] {
  // local = parent^T * world
  const m = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) m[r * 3 + c] = parent[r] * world[c] + parent[3 + r] * world[3 + c] + parent[6 + r] * world[6 + c];
  }
  const x = Math.asin(Math.max(-1, Math.min(1, -m[5])));
  return [x / DEG, Math.atan2(m[2], m[8]) / DEG, Math.atan2(m[3], m[4]) / DEG];
}
