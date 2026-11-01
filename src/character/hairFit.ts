import type { FittedBody } from './bodyFit';
import { bodyTriangles, copyWeights, fillMisses, rayHit, type Shell } from './shell';

/*
 * Her hair: a 2B-style bob as one solid shell on her head (engine-free). No simulation:
 * it moves with her head, so it never jitters or tangles.
 *
 * The cut: side-parted, the part on her right. The fringe is short by the part and
 * sweeps across the forehead, longer as it goes, to eye level on her left, where it
 * flows into the lock on that side. Locks frame the face to just under the chin; the back
 * is shorter, ending at the nape. The ends tuck in a little, as a bob does. A groove runs
 * back over the crown along the part.
 *
 * How it's built. Each column goes around the head (0 = her face, + = her right) and runs
 * from the crown down to its end:
 *  - Over the crown the hair follows her scalp (rays from the middle of the head, filled
 *    out over any dips), thicker on top.
 *  - Below the head's widest line it doesn't hug the skull: it falls straight down, the
 *    way hair does, pushed out only where something (ears, cheeks) is in the way, and
 *    keeping that width below it.
 *  - Front columns end in the fringe, up on the forehead; the rest carry on down. The
 *    fringe's edge slants (high by the part, low on the far side), and on the far side
 *    it blends over a few columns into the lock.
 * A little irregular thickness and an uneven cut keep it from looking machined.
 */

export const HAIR = {
  cols: 96,
  rows: 26,
  /** Where the head is widest (radians down from the crown). */
  widest: Math.PI / 2,
  /** The part: on her right, this far around from her face (radians). */
  part: 0.5,
  /** Fringe edge (radians down from the crown): by the part, and swept across to her left. */
  fringeHigh: 1.12,
  fringeLow: 1.45,
  /** Where the swept fringe gives way to her left lock (radians around from her face). */
  sweepTo: 0.62,
  sweepLock: 0.9,
  /** The groove along the part: how far right of center, how deep, how wide (meters). */
  partX: 0.034,
  partDepth: 0.006,
  partWidth: 0.008,
  /** End heights (rest pose, meters, relative to the head joint): face-framing locks, nape. */
  locks: -0.018,
  nape: 0.04,
  /** Thickness at the crown, at the widest line, and at the ends. */
  crown: 0.017,
  side: 0.009,
  ends: 0.005,
  /** How far the ends tuck in toward her, over the last stretch. */
  tuck: 0.007,
  tuckLength: 0.025,
  /** Clearance kept from her face and ears where the hair falls past them. */
  clearance: 0.004,
};

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Fixed, smooth irregularity around the head (-1..1), so she looks the same every load. */
const wobble = (phi: number, seed: number) =>
  0.5 * Math.sin(phi * 7 + seed) + 0.3 * Math.sin(phi * 13 + seed * 2.1) + 0.2 * Math.sin(phi * 23 + seed * 3.7);

/** Folds an angle around the head into 0..PI (front to back). */
const around = (phi: number) => Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi)));

/** Signed angle around the head, -PI..PI (+ = her right). */
const signed = (phi: number) => Math.atan2(Math.sin(phi), Math.cos(phi));

/** How long the hair is at `phi`: 0 = fringe only, 1 = falls past the widest line. */
export function hairLength(phi: number): number {
  const a = signed(phi);
  // By the part a lock falls straight away; on the far side the sweep blends into one.
  return a >= 0 ? smoothstep(HAIR.part, HAIR.part + 0.16, a) : smoothstep(HAIR.sweepTo, HAIR.sweepLock, -a);
}

/** The fringe's edge at `phi` (radians down from the crown): high by the part, low across. */
export function fringeEdge(phi: number): number {
  const a = signed(phi);
  const across = Math.max(0, Math.min(1, (HAIR.part - a) / (HAIR.part + HAIR.sweepLock)));
  return HAIR.fringeHigh + (HAIR.fringeLow - HAIR.fringeHigh) * Math.pow(across, 0.85);
}

/** Where the hair ends at `phi`, as a height relative to the head joint (long columns only). */
export function hairEnd(phi: number): number {
  const back = smoothstep(1.5, 2.4, around(phi));
  return HAIR.locks + (HAIR.nape - HAIR.locks) * back + 0.004 * wobble(phi, 1.7);
}

/** Unit direction from the head's middle: `theta` down from straight up, `phi` around. */
export function hairDir(theta: number, phi: number): [number, number, number] {
  return [Math.sin(theta) * Math.sin(phi), Math.cos(theta), -Math.sin(theta) * Math.cos(phi)];
}

/** Middle of her head at rest: the middle of everything above the neck. */
export function headCenter(body: FittedBody, neckTop: number): [number, number, number] {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of new Set(body.indices)) {
    if (body.positions[3 * v + 1] < neckTop) continue;
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], body.positions[3 * v + a]);
      max[a] = Math.max(max[a], body.positions[3 * v + a]);
    }
  }
  if (!Number.isFinite(min[1])) return [0, neckTop + 0.1, 0]; // no head on this body
  return [0, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

export function fitHair(body: FittedBody, headY: number): Shell {
  const { cols, rows } = HAIR;
  const H = rows + 1;
  const center = headCenter(body, headY + 0.01);
  // The head and the top of the neck.
  const tris = bodyTriangles(body, (v) => body.positions[3 * v + 1] > headY - 0.1 && body.armParam[v] < 0);

  // The scalp over the crown, on a regular grid down to the widest line, filled out over
  // dips (rise to the neighbors' average, never sink). The crown row is one point.
  const SCALP = 24;
  const SH = SCALP + 1;
  const scalp = new Float32Array(cols * SH);
  const sAt = (i: number, j: number) => (((i % cols) + cols) % cols) * SH + j;
  for (let i = 0; i < cols; i++) {
    const p = (i / cols) * Math.PI * 2;
    for (let j = 0; j < SH; j++) scalp[sAt(i, j)] = rayHit(body, tris, center, hairDir((HAIR.widest * j) / SCALP, p));
  }
  fillMisses(scalp, cols, SH, 0.1);
  for (let pass = 0; pass < 30; pass++) {
    let crown = 0;
    for (let i = 0; i < cols; i++) crown += scalp[sAt(i, 0)];
    for (let i = 0; i < cols; i++) scalp[sAt(i, 0)] = crown / cols;
    const next = Float32Array.from(scalp);
    for (let i = 0; i < cols; i++) {
      for (let j = 1; j < SH; j++) {
        const below = j < SCALP ? scalp[sAt(i, j + 1)] : scalp[sAt(i, j)];
        const avg = (scalp[sAt(i - 1, j)] + scalp[sAt(i + 1, j)] + scalp[sAt(i, j - 1)] + below) / 4;
        next[sAt(i, j)] = Math.max(scalp[sAt(i, j)], avg);
      }
    }
    scalp.set(next);
  }
  const scalpAt = (i: number, theta: number) => {
    const f = Math.min(SCALP, Math.max(0, (theta / HAIR.widest) * SCALP));
    const j = Math.min(SCALP - 1, Math.floor(f));
    return scalp[sAt(i, j)] + (scalp[sAt(i, j + 1)] - scalp[sAt(i, j)]) * (f - j);
  };

  /** Distance from the head's vertical axis to her face or ears, at height y, toward phi. */
  const sideOf = (y: number, phi: number) => rayHit(body, tris, [center[0], y, center[2]], [Math.sin(phi), 0, -Math.cos(phi)]);

  const base = new Float32Array(cols * H * 3);
  const dir = new Float32Array(cols * H * 3);
  const outer = new Float32Array(cols * H);
  const inner = new Float32Array(cols * H);
  const R = 0.1; // rough head radius, to measure the crown's arc in meters
  for (let i = 0; i < cols; i++) {
    const phi = (i / cols) * Math.PI * 2;
    const long = hairLength(phi);
    const clumps = 0.0018 * wobble(phi, 0.4);
    // Over the crown: to the fringe in front, to the widest line elsewhere.
    const fringe = fringeEdge(phi) + 0.01 * wobble(phi, 2.9);
    const domeEnd = fringe + (HAIR.widest - fringe) * long;
    const wDir = hairDir(HAIR.widest, phi);
    const wR = scalpAt(i, HAIR.widest);
    const ringY = center[1] + wDir[1] * wR;
    const hang = long * Math.max(0, ringY - (headY + hairEnd(phi)));
    const arc = R * domeEnd;
    const total = arc + hang;
    // Horizontal distance of the hair's inside from the head axis as it falls: never
    // closer than at the widest line, pushed out past the ears and face, and kept that
    // wide below them (hair falls straight past things, it doesn't wrap under them).
    let reach = Math.hypot(wDir[0], wDir[2]) * (wR + 0.0015);
    for (let j = 0; j < H; j++) {
      const k = i * H + j;
      const t = (total * j) / rows;
      if (t <= arc || hang <= 0) {
        const theta = Math.min(t / R, domeEnd);
        const d = hairDir(theta, phi);
        const r = scalpAt(i, theta);
        base.set([center[0] + d[0] * r, center[1] + d[1] * r, center[2] + d[2] * r], k * 3);
        dir.set(d, k * 3);
        inner[k] = 0.0015;
        const onTop = 1 - Math.min(1, theta / HAIR.widest);
        outer[k] = HAIR.side + (HAIR.crown - HAIR.side) * onTop * onTop + clumps * (1 - onTop);
        // The part: a groove back over the crown, on top only (not down the fringe).
        const x = base[k * 3] - center[0];
        const ahead = smoothstep(center[2] + 0.04, center[2], base[k * 3 + 2]);
        const groove = Math.exp(-(((x - HAIR.partX) / HAIR.partWidth) ** 2)) * ahead * (1 - smoothstep(0.95, 1.1, theta));
        // The hair lifts a little just across the part, on the side it's swept toward.
        const top = 1 - smoothstep(0.95, 1.1, theta);
        const lift = x < HAIR.partX ? Math.exp(-(((HAIR.partX - x - 0.013) / 0.012) ** 2)) * ahead * top : 0;
        outer[k] = Math.max(0.003, outer[k] - HAIR.partDepth * groove + 0.004 * lift);
        if (hang <= 0 && j === rows) outer[k] = Math.max(HAIR.ends + 0.003, outer[k] * 0.7); // the blunt fringe
      } else {
        const fall = t - arc;
        const y = ringY - fall;
        const s = sideOf(y, phi);
        if (!Number.isNaN(s)) reach = Math.max(reach, s + HAIR.clearance);
        const toEnd = hang - fall; // meters left to the end
        const tuck = HAIR.tuck * (1 - smoothstep(0, HAIR.tuckLength, toEnd)) ** 2;
        const rho = Math.max(reach - tuck, Number.isNaN(s) ? 0 : s + 0.002);
        const d: [number, number, number] = [Math.sin(phi), 0, -Math.cos(phi)];
        base.set([center[0] + d[0] * rho, y, center[2] + d[2] * rho], k * 3);
        dir.set(d, k * 3);
        inner[k] = 0;
        const end = smoothstep(0, hang, fall);
        outer[k] = HAIR.side + (HAIR.ends - HAIR.side) * end * end + clumps;
      }
    }
  }

  const near = Array.from(new Set(tris));
  const weights = copyWeights(body, near, base, ['neck', 'head']);
  return { cols, rows, wrap: true, pole: true, base, dir, outer, inner, cellGroup: new Uint8Array(cols * rows), wallGroup: 0, ...weights };
}
