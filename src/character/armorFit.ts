import type { FittedBody } from './bodyFit';
import { bodyTriangles, copyWeights, fillMisses, rayHit, type Shell } from './shell';

/*
 * Her armor's shape, measured off the fitted body (engine-free, plain arrays).
 *
 * A front plate and a back plate worn over the tunic, both ending just below the bust.
 * They don't meet: each side is left open (cloth) and two leather straps with gold
 * buckles cross the gap, so she can twist and reach without a stiff shell around her.
 *
 * Each plate is a grid: columns go around (angle, 0 = straight ahead, + = her right),
 * rows go up from the bottom edge to the top edge, which dips toward the armholes and
 * scoops a little at the neck. At each grid point a ray from her spine finds the body.
 * Then the shape is made convex both ways, the way a forged plate is: across each row it
 * spans straight from high point to high point (no dip between the breasts), and down
 * each column it runs straight (no tuck under the bust). A low ridge runs down the
 * middle. Straps are the same thing, one row high, sitting closer to the body so their
 * ends tuck under the plates.
 *
 * Weights come from the torso under them, spine bones only, so the pieces stay rigid on
 * her chest instead of creasing with her arms.
 */

export interface PlateSpec {
  /** Middle of the piece (radians, 0 = her front, PI = her back), and how far it reaches each way. */
  center: number;
  span: number;
  cols: number;
  rows: number;
  /** Bottom edge height, and top edge height by angle (rest pose, meters). */
  bottom: number;
  top: (a: number) => number;
  /** Outer and inner surfaces off the convex shape; edges rolled out by `lip`. */
  out: number;
  in: number;
  lip: number;
  /** Center ridge: height and half width (radians). */
  ridge: number;
  ridgeWidth: number;
  /** Which cells are trim: a band around the edge (plates), or a buckle in the middle (straps). */
  trim: 'edge' | 'buckle';
}

/** Spine axis the rays start from. */
export const AXIS_Z = 0.01;

/** Plate top edge at angle `a`: high front and back, dipping at the sides, a scoop at the neck. */
export function plateTop(a: number): number {
  const sides = Math.pow(Math.abs(Math.cos(a)), 0.6); // 1 front and back, 0 at the sides
  const neck = 0.018 * Math.exp(-((a / 0.35) ** 2)); // the front's neckline
  return 1.42 - 0.11 * (1 - sides) - neck;
}

/** Just below the bust (the mesh's underbust fold sits near 1.24 on the rig). */
const PLATE_BOTTOM = 1.2;
const PLATE_SPAN = 1.2; // about 69 degrees each way, leaving about 42 degrees open at each side

const plate = (center: number): PlateSpec => ({
  center,
  span: PLATE_SPAN,
  cols: 36,
  rows: 12,
  bottom: PLATE_BOTTOM,
  top: plateTop,
  out: 0.014,
  in: 0.004,
  lip: 0.003,
  ridge: 0.006,
  ridgeWidth: 0.22,
  trim: 'edge',
});
export const FRONT = plate(0);
export const BACK = plate(Math.PI);

/** Two straps each side, crossing the open gap and tucked under both plates' edges. */
export const STRAPS: PlateSpec[] = [1.225, 1.29].flatMap((y) =>
  [Math.PI / 2, -Math.PI / 2].map((center) => ({
    center,
    span: Math.PI / 2 - PLATE_SPAN + 0.1,
    cols: 12,
    rows: 1,
    bottom: y,
    top: () => y + 0.022,
    out: 0.008,
    in: 0.003,
    lip: 0,
    ridge: 0,
    ridgeWidth: 1,
    trim: 'buckle' as const,
  })),
);

export interface PlateFit {
  spec: PlateSpec;
  /** Per grid point: angle, height, and the convex shape's radius (before the offsets). */
  angle: Float32Array;
  height: Float32Array;
  radius: Float32Array;
  shell: Shell;
}

/**
 * Radius where ray `a` crosses the straight line between polar points (a0, r0) and (a1, r1):
 * the chord a convex outline would take between them.
 */
function chord(a0: number, r0: number, a1: number, r1: number, a: number): number {
  const [x0, y0, x1, y1] = [r0 * Math.sin(a0), r0 * Math.cos(a0), r1 * Math.sin(a1), r1 * Math.cos(a1)];
  const [dx, dy] = [Math.sin(a), Math.cos(a)];
  const den = dx * (y1 - y0) - dy * (x1 - x0);
  if (Math.abs(den) < 1e-9) return 0;
  return (x0 * y1 - y0 * x1) / den;
}

export function fitPlate(body: FittedBody, spec: PlateSpec, tris = torsoTriangles(body)): PlateFit {
  const { cols, rows } = spec;
  const H = rows + 1;
  const C = cols + 1;
  const N = C * H;
  const at = (i: number, j: number) => i * H + j;

  const angle = new Float32Array(N);
  const height = new Float32Array(N);
  const r = new Float32Array(N);
  for (let i = 0; i < C; i++) {
    const a = spec.center - spec.span + (2 * spec.span * i) / cols;
    const top = spec.top(a);
    for (let j = 0; j < H; j++) {
      const y = spec.bottom + ((top - spec.bottom) * j) / rows;
      angle[at(i, j)] = a;
      height[at(i, j)] = y;
      r[at(i, j)] = rayHit(body, tris, [0, y, AXIS_Z], [Math.sin(a), 0, -Math.cos(a)]);
    }
  }
  fillMisses(r, C, H, 0.12);

  // Convex both ways: rise to the chord between neighbors (k apart) across each row, and
  // to the average of the points above and below down each column. Never sink.
  for (let pass = 0; pass < 80; pass++) {
    for (const k of [1, 2, 4]) {
      for (let i = k; i + k < C; i++) {
        for (let j = 0; j < H; j++) {
          const c = chord(angle[at(i - k, j)], r[at(i - k, j)], angle[at(i + k, j)], r[at(i + k, j)], angle[at(i, j)]);
          if (c > r[at(i, j)]) r[at(i, j)] = c;
        }
      }
    }
    for (let i = 0; i < C; i++) {
      for (let j = 1; j < rows; j++) {
        const avg = (r[at(i, j - 1)] + r[at(i, j + 1)]) / 2;
        if (avg > r[at(i, j)]) r[at(i, j)] = avg;
      }
    }
  }

  const base = new Float32Array(N * 3);
  const dir = new Float32Array(N * 3);
  const outer = new Float32Array(N);
  const inner = new Float32Array(N).fill(spec.in);
  for (let i = 0; i < C; i++) {
    for (let j = 0; j < H; j++) {
      const k = at(i, j);
      const [s, c] = [Math.sin(angle[k]), Math.cos(angle[k])];
      base.set([s * r[k], height[k], AXIS_Z - c * r[k]], k * 3);
      dir.set([s, 0, -c], k * 3);
      const edge = i === 0 || i === cols || j === 0 || j === rows;
      const off = Math.abs(angle[k] - spec.center);
      outer[k] = spec.out + (edge ? spec.lip : 0) + spec.ridge * Math.max(0, 1 - off / spec.ridgeWidth);
    }
  }
  const cellGroup = new Uint8Array(cols * rows);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const edgeCell = i === 0 || i === cols - 1 || j === 0 || j === rows - 1;
      const buckle = Math.abs(i - (cols - 1) / 2) < 1;
      cellGroup[i * rows + j] = (spec.trim === 'edge' ? edgeCell : buckle) ? 1 : 0;
    }
  }
  if (spec.trim === 'buckle') {
    // The buckle stands a little proud of the strap.
    for (let i = 0; i < C; i++) if (Math.abs(i - cols / 2) <= 1) for (let j = 0; j < H; j++) outer[at(i, j)] += 0.003;
  }

  const near = Array.from(new Set(tris));
  const weights = copyWeights(body, near, base, ['hips', 'spine', 'neck', 'chest']);
  const shell: Shell = { cols, rows, wrap: false, pole: false, base, dir, outer, inner, cellGroup, wallGroup: spec.trim === 'edge' ? 1 : 0, ...weights };
  return { spec, angle, height, radius: r, shell };
}

/** Torso triangles only: the arms hang right beside it. */
export function torsoTriangles(body: FittedBody): Int32Array {
  return bodyTriangles(body, (v) => body.armParam[v] < 0);
}

export function fitArmor(body: FittedBody): { plates: PlateFit[]; straps: PlateFit[] } {
  const tris = torsoTriangles(body);
  return {
    plates: [FRONT, BACK].map((s) => fitPlate(body, s, tris)),
    straps: STRAPS.map((s) => fitPlate(body, s, tris)),
  };
}
