import type { Pose } from './clips';
import { BONES, HIPS_HEIGHT, type BoneId } from './rig';

/*
 * Tiny forward kinematics for clip authoring, engine-free. Same conventions as the
 * render layer: bone-local Euler YXZ in degrees, three.js axes (forward is -Z).
 *
 * Its one job: find the lowest point of a posed body, so poses that touch the floor
 * with something other than the feet (a roll, a kneel, a deep lunge) can be placed on
 * the ground exactly instead of by guessing hipsY.
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
