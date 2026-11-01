import type { FittedBody } from './bodyFit';
import { BONE_IDS, type BoneId } from './rig';

/*
 * Shells: armor plates, straps and hair are all thin solids laid over the fitted body,
 * built from a grid of points measured off it (engine-free). The render layer turns a
 * Shell into geometry: an outer surface, an inner one, and walls along its open edges.
 */

export interface Shell {
  /** Grid size in cells. Points: `C` columns (cols, or cols + 1 when not wrapped) by rows + 1. */
  cols: number;
  rows: number;
  /** Columns close into a ring (hair), or the grid has side edges (a plate). */
  wrap: boolean;
  /** Row 0 shrinks to a single point (the crown of the hair), so it has no edge there. */
  pole: boolean;
  /** Per point (c * (rows + 1) + j): where it sits on the body, and which way is out. */
  base: Float32Array;
  dir: Float32Array;
  /** How far out along `dir` the outer and inner surfaces are, per point. */
  outer: Float32Array;
  inner: Float32Array;
  /** Per cell (i * rows + j): 0 = main material, 1 = trim. Walls use `wallGroup`. */
  cellGroup: Uint8Array;
  wallGroup: 0 | 1;
  /** Four bones and weights per point (indices into BONE_IDS). */
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
}

/** Number of point columns in a shell. */
export const shellColumns = (s: Pick<Shell, 'cols' | 'wrap'>) => (s.wrap ? s.cols : s.cols + 1);

/** Triangles of the body whose vertices all pass `keep`. */
export function bodyTriangles(body: FittedBody, keep: (v: number) => boolean): Int32Array {
  const out: number[] = [];
  for (let t = 0; t < body.indices.length; t += 3) {
    const tri = [body.indices[t], body.indices[t + 1], body.indices[t + 2]];
    if (tri.every(keep)) out.push(...tri);
  }
  return Int32Array.from(out);
}

/** Distance along the ray to the nearest triangle it crosses, or NaN (Moller-Trumbore). */
export function rayHit(body: FittedBody, tris: Int32Array, o: readonly number[], d: readonly number[]): number {
  const P = body.positions;
  const level = d[1] === 0; // horizontal rays skip triangles that don't straddle their height
  let best = Infinity;
  for (let t = 0; t < tris.length; t += 3) {
    const [i0, i1, i2] = [tris[t] * 3, tris[t + 1] * 3, tris[t + 2] * 3];
    if (level) {
      const y = o[1];
      const [y0, y1, y2] = [P[i0 + 1], P[i1 + 1], P[i2 + 1]];
      if ((y0 < y && y1 < y && y2 < y) || (y0 > y && y1 > y && y2 > y)) continue;
    }
    const e1 = [P[i1] - P[i0], P[i1 + 1] - P[i0 + 1], P[i1 + 2] - P[i0 + 2]];
    const e2 = [P[i2] - P[i0], P[i2 + 1] - P[i0 + 1], P[i2 + 2] - P[i0 + 2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const s = [o[0] - P[i0], o[1] - P[i0 + 1], o[2] - P[i0 + 2]];
    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
    if (u < 0 || u > 1) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
    if (v < 0 || u + v > 1) continue;
    const dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
    if (dist > 1e-4 && dist < best) best = dist;
  }
  return Number.isFinite(best) ? best : NaN;
}

/** Fills NaNs in a column-major grid from the nearest valid point in the same row. */
export function fillMisses(r: Float32Array, columns: number, H: number, fallback: number): void {
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < H; j++) {
      if (!Number.isNaN(r[i * H + j])) continue;
      let found = NaN;
      for (let s = 1; s <= columns && Number.isNaN(found); s++) {
        for (const n of [i - s, i + s]) {
          const c = ((n % columns) + columns) % columns;
          if (!Number.isNaN(r[c * H + j])) found = r[c * H + j];
        }
      }
      r[i * H + j] = Number.isNaN(found) ? fallback : found;
    }
  }
}

/**
 * Skin weights for points laid on the body: an inverse-distance blend of the four nearest
 * body vertices among `near`, keeping only `bones` (so a plate can ignore the arms). If
 * none of those move the nearby body, the last of `bones` takes it all.
 */
export function copyWeights(body: FittedBody, near: number[], points: ArrayLike<number>, bones: BoneId[]): { skinIndex: Uint16Array; skinWeight: Float32Array } {
  const allowed = new Set(bones.map((id) => BONE_IDS.indexOf(id)));
  const n = points.length / 3;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) {
    const [px, py, pz] = [points[3 * k], points[3 * k + 1], points[3 * k + 2]];
    const nearest: Array<[number, number]> = [];
    for (const v of near) {
      const d = Math.hypot(body.positions[3 * v] - px, body.positions[3 * v + 1] - py, body.positions[3 * v + 2] - pz);
      if (nearest.length < 4 || d < nearest[3][1]) {
        nearest.push([v, d]);
        nearest.sort((x, y) => x[1] - y[1]);
        if (nearest.length > 4) nearest.pop();
      }
    }
    const sum = new Map<number, number>();
    for (const [v, d] of nearest) {
      const w = 1 / Math.max(d, 1e-4);
      for (let c = 0; c < 4; c++) {
        const b = body.skinIndex[v * 4 + c];
        const bw = body.skinWeight[v * 4 + c];
        if (bw > 0 && allowed.has(b)) sum.set(b, (sum.get(b) ?? 0) + w * bw);
      }
    }
    if (sum.size === 0) sum.set(BONE_IDS.indexOf(bones[bones.length - 1]), 1);
    const top = [...sum].sort((x, y) => y[1] - x[1]).slice(0, 4);
    const total = top.reduce((s, [, w]) => s + w, 0) || 1;
    top.forEach(([b, w], c) => {
      skinIndex[k * 4 + c] = b;
      skinWeight[k * 4 + c] = w / total;
    });
  }
  return { skinIndex, skinWeight };
}
