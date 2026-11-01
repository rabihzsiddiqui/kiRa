import { BONE_IDS, BONES, type BoneId } from './rig';

/*
 * Rigs the base body mesh to our skeleton, engine-free: plain arrays in, plain arrays out.
 *
 * The mesh ("Female_2500_ Base Mesh" by EbiosDesigner, CC-BY-4.0, public/models) comes
 * with no skeleton: 1.65 m tall, relaxed A-pose, facing +Z. Two steps:
 *
 * 1. Skin weights. Arms and legs are found by shape, not by distance guesses: below the
 *    armpits each arm is its own connected piece of the mesh, and so is each leg below the
 *    crotch. Along a limb, weights blend from one bone to the next across each joint.
 *    Torso weights blend up the spine; the hips hand over to the thighs near the crotch
 *    and the chest to the shoulders and upper arms near the armpits. A few smoothing
 *    passes over the mesh's edges then soften every seam.
 *
 * 2. Fit. Every bone maps its stretch of the mesh onto its bone in our rig: the joint
 *    moves to our joint, the length stretches to our bone's, and the girth scales by
 *    GIRTH. Each vertex blends those maps with its skin weights. Neighboring bones agree
 *    at their shared joint, so the result has no seams, and the arms swing in from the
 *    A-pose to our rest pose (hanging straight down).
 *
 * The output is in rig rest space (her feet at the origin, facing -Z, x = her right),
 * which is also the bind pose: bone inverses are just the rest joint positions.
 */

type V3 = [number, number, number];

/** Her right side; the left is the mirror image. In the mesh turned to face -Z. */
const MESH_JOINTS_R: Partial<Record<BoneId, V3>> = {
  hips: [0, 0.95, 0.01],
  spine: [0, 1.04, 0],
  chest: [0, 1.2, 0.01],
  neck: [0, 1.37, 0.035],
  head: [0, 1.44, 0.02],
  shoulderR: [0.03, 1.355, 0.03],
  upperArmR: [0.135, 1.325, 0.05],
  forearmR: [0.192, 1.09, 0.06],
  handR: [0.256, 0.905, 0.022],
  thighR: [0.09, 0.91, 0.01],
  shinR: [0.105, 0.48, 0.03],
  footR: [0.118, 0.08, 0.05],
};
/** Where the bones with no child end, on the mesh and on the rig (relative to the joint). */
const MESH_TIPS_R: Partial<Record<BoneId, V3>> = { head: [0, 1.65, 0], handR: [0.315, 0.77, 0], footR: [0.13, 0.02, -0.11] };
const RIG_TIPS_R: Partial<Record<BoneId, V3>> = { head: [0, 0.23, 0], handR: [0, -0.16, 0], footR: [0, -0.06, -0.16] };

/** Heights on the mesh that split it: arms hang free below ARMPIT, legs below CROTCH. */
const ARMPIT = 1.27;
const CROTCH = 0.855;
/** Where the mesh's own head is cut off, when another head goes on top. */
const NECK_CUT = 1.425;
/** Mesh girth to ours: the mesh is 1.65 m, she's about 1.78. */
const GIRTH = 1.05;
const SMOOTH_PASSES = 8;

export interface FittedBody {
  /** Rest pose, rig space. */
  positions: Float32Array;
  /** The file's own normals, turned with the fit (smoother than recomputing on 2.5k triangles). */
  normals: Float32Array;
  indices: Uint32Array;
  /** Four bones per vertex, as indices into BONE_IDS. */
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  /** Distance along the arm from the shoulder joint (rig meters), -1 off the arms. */
  armParam: Float32Array;
}

const mirror = (id: BoneId): BoneId => (id.endsWith('R') ? (id.slice(0, -1) + 'L') as BoneId : id);
const flipX = ([x, y, z]: V3): V3 => [-x, y, z];

function sideTable(table: Partial<Record<BoneId, V3>>): Partial<Record<BoneId, V3>> {
  const out: Partial<Record<BoneId, V3>> = { ...table };
  for (const [id, p] of Object.entries(table) as Array<[BoneId, V3]>) if (id.endsWith('R')) out[mirror(id)] = flipX(p);
  return out;
}
const MESH_JOINTS = sideTable(MESH_JOINTS_R) as Record<BoneId, V3>;
const MESH_TIPS = sideTable(MESH_TIPS_R);
const RIG_TIPS = sideTable(RIG_TIPS_R);

/** Rig joints at rest (every bone unrotated), relative to her feet. */
export function restJoints(): Record<BoneId, V3> {
  const out = {} as Record<BoneId, V3>;
  for (const b of BONES) {
    const p = b.parent ? out[b.parent] : ([0, 0, 0] as V3);
    out[b.id] = [p[0] + b.offset[0], p[1] + b.offset[1], p[2] + b.offset[2]];
  }
  return out;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => scale(a, 1 / (len(a) || 1));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Rotates v by the shortest rotation taking unit a to unit b (Rodrigues). */
function rotateBetween(v: V3, a: V3, b: V3): V3 {
  const axis = cross(a, b);
  const s = len(axis);
  const c = dot(a, b);
  if (s < 1e-9) return c > 0 ? v : scale(v, -1);
  const k = scale(axis, 1 / s);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

/** The main child of each bone: where its segment ends. */
const CHILD: Partial<Record<BoneId, BoneId>> = {};
for (const b of BONES) {
  if (b.parent && !CHILD[b.parent] && !b.id.startsWith('shoulder') && !b.id.startsWith('thigh')) CHILD[b.parent] = b.id;
}

interface Segment {
  from: V3;
  to: V3;
}

/** Each bone's segment on the mesh and on the rig. */
function segments(): { mesh: Record<BoneId, Segment>; rig: Record<BoneId, Segment> } {
  const rest = restJoints();
  const mesh = {} as Record<BoneId, Segment>;
  const rig = {} as Record<BoneId, Segment>;
  for (const id of BONE_IDS) {
    const child = CHILD[id];
    mesh[id] = { from: MESH_JOINTS[id], to: child ? MESH_JOINTS[child] : MESH_TIPS[id]! };
    rig[id] = { from: rest[id], to: child ? rest[child] : add(rest[id], RIG_TIPS[id]!) };
  }
  return { mesh, rig };
}

/** Maps a mesh point by one bone: joint to joint, stretched along the bone, girth scaled. */
function mapByBone(p: V3, m: Segment, r: Segment): V3 {
  const am = sub(m.to, m.from);
  const ar = sub(r.to, r.from);
  const dm = norm(am);
  const dr = norm(ar);
  const u = sub(p, m.from);
  const along = dot(u, dm);
  const perp = sub(u, scale(dm, along));
  return add(add(r.from, scale(dr, (along * len(ar)) / len(am))), scale(rotateBetween(perp, dm, dr), GIRTH));
}

/** Distance along a chain of segments to the point's projection (arc length). */
function chainParam(p: V3, chain: Segment[]): number {
  let best = Infinity;
  let at = 0;
  let start = 0;
  for (const s of chain) {
    const d = sub(s.to, s.from);
    const l = len(d);
    const t = Math.max(0, Math.min(l, dot(sub(p, s.from), d) / l));
    const q = add(s.from, scale(d, t / l));
    const dist = len(sub(p, q));
    if (dist < best) {
      best = dist;
      at = start + t;
    }
    start += l;
  }
  return at;
}

/** Weights along a chain: each joint hands over from one bone to the next over +-blend. */
function chainWeights(s: number, bones: BoneId[], chain: Segment[], blend: number[]): Array<[BoneId, number]> {
  const out: Array<[BoneId, number]> = [];
  let joint = 0;
  let prevStep = 1;
  for (let i = 0; i < bones.length; i++) {
    let step = 0;
    if (i + 1 < bones.length) {
      joint += len(sub(chain[i].to, chain[i].from));
      step = smoothstep(joint - blend[i], joint + blend[i], s);
    }
    const w = prevStep - step;
    if (w > 1e-4) out.push([bones[i], w]);
    prevStep = step;
  }
  return out;
}

/** Connected pieces of the vertices that pass `keep`, over the welded mesh's edges. */
function components(n: number, neighbors: number[][], keep: (v: number) => boolean): Int32Array {
  const label = new Int32Array(n).fill(-1);
  let next = 0;
  for (let v = 0; v < n; v++) {
    if (label[v] >= 0 || !keep(v)) continue;
    const stack = [v];
    label[v] = next;
    while (stack.length) {
      const a = stack.pop()!;
      for (const b of neighbors[a]) {
        if (label[b] < 0 && keep(b)) {
          label[b] = next;
          stack.push(b);
        }
      }
    }
    next++;
  }
  return label;
}

/**
 * `positions`, `normals` and `indices` straight from the file (facing +Z, feet at y = 0). Returns the
 * mesh fitted to the rig and weighted. `keepHead: false` cuts its head off at the neck
 * (for a separate head model on top).
 */
export function fitBody(
  positionsIn: ArrayLike<number>,
  normalsIn: ArrayLike<number>,
  indicesIn: ArrayLike<number>,
  opts: { keepHead?: boolean } = {},
): FittedBody {
  // Turn to face -Z (her right becomes +X).
  const n = positionsIn.length / 3;
  const P: V3[] = [];
  for (let i = 0; i < n; i++) P.push([-positionsIn[3 * i], positionsIn[3 * i + 1], -positionsIn[3 * i + 2]]);

  // Weld by position for connectivity (files often split vertices along hard edges).
  const weld = new Int32Array(n);
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const key = P[i].map((c) => Math.round(c * 1e5)).join(',');
    const at = seen.get(key);
    if (at === undefined) seen.set(key, i);
    weld[i] = at ?? i;
  }
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  const link = (a: number, b: number) => {
    const [wa, wb] = [weld[a], weld[b]];
    if (wa !== wb && !neighbors[wa].includes(wb)) {
      neighbors[wa].push(wb);
      neighbors[wb].push(wa);
    }
  };
  for (let t = 0; t < indicesIn.length; t += 3) {
    link(indicesIn[t], indicesIn[t + 1]);
    link(indicesIn[t + 1], indicesIn[t + 2]);
    link(indicesIn[t + 2], indicesIn[t]);
  }
  const isRoot = (v: number) => weld[v] === v;

  // Limbs by shape: pieces that come loose below the armpits (arms) and crotch (legs).
  const centroidX = (label: Int32Array) => {
    const sum = new Map<number, [number, number]>();
    for (let v = 0; v < n; v++) {
      if (label[v] < 0) continue;
      const s = sum.get(label[v]) ?? [0, 0];
      sum.set(label[v], [s[0] + P[v][0], s[1] + 1]);
    }
    return (l: number) => {
      const s = sum.get(l)!;
      return s[0] / s[1];
    };
  };
  const below = (y: number) => (v: number) => isRoot(v) && P[v][1] < y;
  const armLabel = components(n, neighbors, below(ARMPIT));
  const armX = centroidX(armLabel);
  const legLabel = components(n, neighbors, below(CROTCH));
  const legX = centroidX(legLabel);
  const limb = (v: number): 'armR' | 'armL' | 'legR' | 'legL' | 'torso' => {
    const r = weld[v];
    if (armLabel[r] >= 0 && Math.abs(armX(armLabel[r])) > 0.15) return armX(armLabel[r]) > 0 ? 'armR' : 'armL';
    if (legLabel[r] >= 0 && Math.abs(legX(legLabel[r])) < 0.2) return legX(legLabel[r]) > 0 ? 'legR' : 'legL';
    return 'torso';
  };

  const { mesh, rig } = segments();
  const chainOf = (ids: BoneId[]) => ids.map((id) => mesh[id]);
  const ARM = { R: ['upperArmR', 'forearmR', 'handR'] as BoneId[], L: ['upperArmL', 'forearmL', 'handL'] as BoneId[] };
  const LEG = { R: ['thighR', 'shinR', 'footR'] as BoneId[], L: ['thighL', 'shinL', 'footL'] as BoneId[] };
  const SPINE: BoneId[] = ['hips', 'spine', 'chest', 'neck', 'head'];

  // Raw weights per (welded) vertex.
  const B = BONE_IDS.length;
  const boneIndex = new Map(BONE_IDS.map((id, i) => [id, i]));
  let W = new Float32Array(n * B);
  const put = (v: number, list: Array<[BoneId, number]>, k = 1) => {
    for (const [id, w] of list) W[v * B + boneIndex.get(id)!] += w * k;
  };
  for (let v = 0; v < n; v++) {
    if (!isRoot(v)) continue;
    const p = P[v];
    const part = limb(v);
    if (part === 'armR' || part === 'armL') {
      const bones = ARM[part === 'armR' ? 'R' : 'L'];
      put(v, chainWeights(chainParam(p, chainOf(bones)), bones, chainOf(bones), [0.04, 0.03]));
    } else if (part === 'legR' || part === 'legL') {
      const bones = LEG[part === 'legR' ? 'R' : 'L'];
      put(v, chainWeights(chainParam(p, chainOf(bones)), bones, chainOf(bones), [0.05, 0.03]));
    } else {
      // Torso: up the spine, with the thighs taking over toward the crotch and the
      // shoulders and upper arms toward the armpits.
      const spine = chainWeights(chainParam(p, chainOf(SPINE)), SPINE, chainOf(SPINE), [0.05, 0.06, 0.06, 0.03]);
      const side = p[0] >= 0 ? 'R' : 'L';
      const x = Math.abs(p[0]);
      const thigh = smoothstep(0.99, CROTCH, p[1]);
      const rightShare = smoothstep(-0.03, 0.03, p[0]);
      // Shoulder height only: above it is the neck and head, whose sides are not shoulders.
      const high = smoothstep(1.18, 1.27, p[1]) * (1 - smoothstep(1.37, 1.41, p[1]));
      const arm = smoothstep(0.11, 0.16, x) * high;
      const shoulder = smoothstep(0.04, 0.1, x) * high * (1 - arm);
      const rest = (1 - thigh) * (1 - arm - shoulder);
      put(v, spine, rest);
      put(v, [['thighR', rightShare], ['thighL', 1 - rightShare]], thigh * (1 - arm - shoulder));
      put(v, [[`upperArm${side}`, arm], [`shoulder${side}`, shoulder]]);
    }
  }

  // Smooth over the mesh's edges, so seams between regions blend.
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    const next = new Float32Array(W);
    for (let v = 0; v < n; v++) {
      if (!isRoot(v) || neighbors[v].length === 0) continue;
      for (let b = 0; b < B; b++) {
        let s = 0;
        for (const u of neighbors[v]) s += W[u * B + b];
        next[v * B + b] = 0.5 * W[v * B + b] + (0.5 * s) / neighbors[v].length;
      }
    }
    W = next;
  }

  // Top four bones per vertex, normalized; then the fit, blended by those weights.
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const normalIn: V3 = [-normalsIn[3 * v], normalsIn[3 * v + 1], -normalsIn[3 * v + 2]];
    let normal: V3 = [0, 0, 0];
    const r = weld[v];
    const ranked = Array.from({ length: B }, (_, b) => [b, W[r * B + b]] as [number, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    const total = ranked.reduce((s, [, w]) => s + w, 0) || 1;
    let out: V3 = [0, 0, 0];
    ranked.forEach(([b, w], k) => {
      const wn = w / total;
      skinIndex[v * 4 + k] = b;
      skinWeight[v * 4 + k] = wn;
      if (wn <= 0) return;
      const [m, r] = [mesh[BONE_IDS[b]], rig[BONE_IDS[b]]];
      out = add(out, scale(mapByBone(P[v], m, r), wn));
      normal = add(normal, scale(rotateBetween(normalIn, norm(sub(m.to, m.from)), norm(sub(r.to, r.from))), wn));
    });
    positions.set(out, v * 3);
    normals.set(norm(normal), v * 3);
  }

  // Arms: how far along the arm each vertex is (for the outfit), then the fingers curled
  // into a grip.
  const armParam = new Float32Array(n).fill(-1);
  for (let v = 0; v < n; v++) {
    const part = limb(v);
    if (part !== 'armR' && part !== 'armL') continue;
    const side = part === 'armR' ? 'R' : 'L';
    const at: V3 = [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]];
    armParam[v] = chainParam(at, ARM[side].map((id) => rig[id]));
    const curled = curlFinger(at, [normals[3 * v], normals[3 * v + 1], normals[3 * v + 2]], rig[`hand${side}`].from, side === 'R' ? 1 : -1);
    positions.set(curled.p, 3 * v);
    normals.set(curled.n, 3 * v);
  }

  // Its own head, or a neck for another one.
  const kept: number[] = [];
  for (let t = 0; t < indicesIn.length; t += 3) {
    const tri = [indicesIn[t], indicesIn[t + 1], indicesIn[t + 2]];
    if (opts.keepHead || tri.every((i) => P[i][1] < NECK_CUT)) kept.push(...tri);
  }
  return { positions, normals, indices: Uint32Array.from(kept), skinIndex, skinWeight, armParam };
}

/** Wrist to knuckles, at rest (the hand hangs straight down). The grip sits at this depth. */
export const KNUCKLES = 0.075;
/** Radius the fingers wrap around, centered this far toward the palm: the grip's axis. */
export const GRIP_RADIUS = 0.02;
const CURL_MAX = 3.3;

/**
 * Bends what lies past the knuckles around a grip running front to back (the sword's
 * axis), palm side inward: a bend deformer, so the knuckles round off instead of
 * kinking. `out` is +1 for her right hand, -1 for her left.
 */
function curlFinger(p: V3, n: V3, wrist: V3, out: 1 | -1): { p: V3; n: V3 } {
  const t = wrist[1] - KNUCKLES - p[1]; // along the fingers, past the knuckles
  if (t <= 0) return { p, n };
  const u = (wrist[0] - p[0]) * out; // toward the palm
  const r = GRIP_RADIUS - u;
  const bent = Math.min(t, GRIP_RADIUS * CURL_MAX);
  const phi = bent / GRIP_RADIUS;
  const extra = t - bent; // past the full curl: carry on straight
  let un = GRIP_RADIUS - r * Math.cos(phi) + extra * Math.sin(phi);
  let tn = r * Math.sin(phi) + extra * Math.cos(phi);
  if (!Number.isFinite(un) || !Number.isFinite(tn)) [un, tn] = [u, t];
  // The normal turns with the bend: about Z, palm-ward.
  const a = -phi * out;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return {
    p: [wrist[0] - un * out, wrist[1] - KNUCKLES - tn, p[2]],
    n: [n[0] * c - n[1] * s, n[0] * s + n[1] * c, n[2]],
  };
}
