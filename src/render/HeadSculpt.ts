import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * Her head: a smooth, faceless form (a stylized choice for the whole game, so the
 * silhouette, hair and motion carry her). Anime proportions underneath, borrowed from
 * cats: a big round cranium over a short, soft lower face that tapers to a small chin.
 *
 * The shape is a signed distance function (negative inside) built from smooth-blended
 * forms. To mesh it, every vertex of a dense icosphere is pushed out from the middle of
 * the head to where its ray meets that surface (a head is close enough to star-shaped).
 * The bob haircut is built on the same surface.
 *
 * Head space: origin level with the ear canals, midway between them, HEAD_ORIGIN above the
 * head bone. x = her right, y = up, z = back (her face looks down -Z). Meters.
 */

/** Height of head space's origin above the head bone. */
export const HEAD_ORIGIN = 0.11;

type V = readonly [number, number, number];

// ------------------------------------------------------------------ SDF pieces

function ellipsoid(p: V, c: V, r: V): number {
  const x = (p[0] - c[0]) / r[0];
  const y = (p[1] - c[1]) / r[1];
  const z = (p[2] - c[2]) / r[2];
  const k0 = Math.hypot(x, y, z);
  const k1 = Math.hypot(x / r[0], y / r[1], z / r[2]);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r);
}

function sphere(p: V, c: V, r: number): number {
  return Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r;
}

/** Capsule from a to b whose radius goes from ra to rb. */
function taper(p: V, a: V, b: V, ra: number, rb: number): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t) - (ra + (rb - ra) * t);
}

/** Smooth union: blends the two shapes over a band `k` wide. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// ------------------------------------------------------------------ shape

/** The whole head. `p` in head space. */
export function headSDF(p: V): number {
  const q: V = [Math.abs(p[0]), p[1], p[2]]; // mirror: model her right side, get both

  let d = ellipsoid(p, [0, 0.03, 0.008], [0.078, 0.095, 0.094]); // big round cranium
  d = smin(d, ellipsoid(p, [0, -0.018, -0.03], [0.066, 0.06, 0.058]), 0.035); // soft round cheeks
  // A short lower face: the jaw tapers in a soft V to a small, slightly pointed chin.
  d = smin(d, taper(q, [0.05, -0.035, -0.004], [0.006, -0.077, -0.052], 0.017, 0.01), 0.035);
  d = smin(d, sphere(p, [0, -0.076, -0.054], 0.0105), 0.025);
  return d;
}

/** Ray march from the middle of the head out along `dir`, back in to the surface. */
const CENTER: V = [0, 0.0, -0.01];
function surfaceAlong(dir: V, from: V = CENTER, maxR = 0.22): number {
  const at = (r: number): V => [from[0] + dir[0] * r, from[1] + dir[1] * r, from[2] + dir[2] * r];
  let r = maxR;
  let prev = r;
  for (let i = 0; i < 400 && r > 0.005; i++) {
    const d = headSDF(at(r));
    if (d < 0) {
      // Overstepped: bisect between the last outside point and here.
      let lo = r;
      let hi = prev;
      for (let j = 0; j < 12; j++) {
        const mid = (lo + hi) / 2;
        if (headSDF(at(mid)) < 0) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }
    prev = r;
    r -= Math.max(d * 0.8, 0.0004);
  }
  return r;
}

/** Walk from `from` along `dir` until the surface. Throws if it never meets the head. */
function hit(from: V, dir: V, what: string): V {
  let t = 0;
  for (let i = 0; i < 600; i++) {
    const p: V = [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t];
    const d = headSDF(p);
    if (d < 1e-4) return p;
    t += Math.max(d * 0.8, 0.0002);
    if (t > 0.4) break;
  }
  throw new Error(`${what} misses the head at ${from.join(', ')}`);
}

/**
 * Depth of the face's surface at (x, y) in head space, looking straight at her: the z
 * where a ray from in front first meets her. For placing features and hair on her.
 */
export function faceSurfaceZ(x: number, y: number): number {
  return hit([x, y, -0.2], [0, 0, 1], 'faceSurfaceZ')[2];
}


// ------------------------------------------------------------------ mesh

let cached: THREE.BufferGeometry | null = null;

/** The head mesh in head space, shared by every figure (it takes a moment to build). */
export function headGeometry(): THREE.BufferGeometry {
  if (cached) return cached;
  const ico = new THREE.IcosahedronGeometry(1, 40);
  ico.deleteAttribute('uv');
  ico.deleteAttribute('normal');
  const g = mergeVertices(ico);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const r = surfaceAlong([v.x, v.y, v.z]);
    pos.setXYZ(i, CENTER[0] + v.x * r, CENTER[1] + v.y * r, CENTER[2] + v.z * r);
  }
  g.computeVertexNormals();
  cached = g;
  return g;
}

// ------------------------------------------------------------------ bob haircut

/*
 * A chin-length bob as one shell around the head. Columns go around the head (angle phi,
 * 0 = the back, PI = the face); rows go down from the crown. The top half hugs the skull
 * with a little volume. Below the crown's middle the hair hangs: each row is at least as
 * wide as the one above, so past the widest point it falls straight instead of following
 * the head in under the jaw, then curls in a touch at the ends. The face is cut out with
 * vertex alpha (alphaTest), so the edge is smooth instead of following the grid.
 */
const BOB_CENTER: V = [0, 0.03, 0.008]; // middle of the cranium
const BOB_COLS = 96;
const DOME_ROWS = 18;
const HANG_ROWS = 16;
/** Half the face opening, radians either side of straight ahead. */
const FACE_HALF = 0.92;
/**
 * Bottom edge of the fringe over the forehead (head-space y at x): parted high on her
 * right, sweeping down to just above the brow on her left.
 */
export const fringeY = (x: number) => 0.05 - 0.018 * smoothstep(0.06, -0.05, x);

/** Bottom of the bob (head-space y): a touch longer at the front, like the reference cut. */
const bobBottom = (phi: number) => -0.058 - 0.02 * (0.5 - 0.5 * Math.cos(phi));

interface Bob {
  geometry: THREE.BufferGeometry;
  /** Rows x columns of points on the outside of the hair, for laying strands on it. */
  grid: THREE.Vector3[][];
  normals: THREE.Vector3[][];
}
let bob: Bob | null = null;

/** Angle from straight ahead (0) to straight back (PI). */
const fromFront = (phi: number) => Math.abs(Math.atan2(Math.sin(phi - Math.PI), Math.cos(phi - Math.PI)));

function buildBob(): Bob {
  const C = BOB_CENTER;
  const grid: THREE.Vector3[][] = [];
  const alpha: number[][] = [];
  const rows = DOME_ROWS + HANG_ROWS;
  const hangR: number[] = new Array(BOB_COLS).fill(0);
  for (let j = 0; j <= rows; j++) {
    const row: THREE.Vector3[] = [];
    const arow: number[] = [];
    for (let i = 0; i < BOB_COLS; i++) {
      const phi = (i / BOB_COLS) * Math.PI * 2;
      const sx = Math.sin(phi);
      const sz = Math.cos(phi);
      const open = smoothstep(FACE_HALF - 0.06, FACE_HALF + 0.06, fromFront(phi)); // 1 = away from the face
      let p: THREE.Vector3;
      if (j <= DOME_ROWS) {
        // Crown: hug the skull, fuller on top.
        const theta = (j / DOME_ROWS) * (Math.PI / 2);
        const dir: V = [Math.sin(theta) * sx, Math.cos(theta), Math.sin(theta) * sz];
        const r = surfaceAlong(dir, C) + 0.009 + 0.006 * Math.cos(theta);
        p = new THREE.Vector3(C[0] + dir[0] * r, C[1] + dir[1] * r, C[2] + dir[2] * r);
        hangR[i] = Math.hypot(p.x - C[0], p.z - C[2]);
        // Over the face the dome stops at the fringe's edge.
        const edge = fringeY(p.x);
        arow.push(Math.max(open, smoothstep(edge - 0.003, edge + 0.003, p.y)));
      } else {
        // Hanging part: straight down from the widest point, curling in at the ends.
        const k = (j - DOME_ROWS) / HANG_ROWS;
        const y = C[1] + (bobBottom(phi) - C[1]) * k;
        const skin = surfaceAlong([sx, 0, sz], [C[0], y, C[2]]) + 0.009;
        hangR[i] = Math.max(hangR[i], skin);
        const r = hangR[i] * (1 - 0.07 * smoothstep(0.7, 1, k));
        p = new THREE.Vector3(C[0] + sx * r, y, C[2] + sz * r);
        arow.push(open);
      }
      row.push(p);
    }
    grid.push(row);
    alpha.push(arow);
  }

  // Outer surface, then a lip folding back up inside the ends so they have thickness.
  const lipRow = grid[rows].map((p) => {
    const q = p.clone().sub(new THREE.Vector3(C[0], p.y, C[2])).multiplyScalar(0.88);
    return new THREE.Vector3(C[0] + q.x, p.y + 0.008, C[2] + q.z);
  });
  const all = [...grid, lipRow];
  const allAlpha = [...alpha, alpha[rows]];

  const positions: number[] = [];
  const colors: number[] = [];
  for (let j = 0; j < all.length; j++) {
    for (let i = 0; i < BOB_COLS; i++) {
      const p = all[j][i];
      positions.push(p.x, p.y, p.z);
      colors.push(1, 1, 1, allAlpha[j][i]);
    }
  }
  const at = (j: number, i: number) => j * BOB_COLS + (i % BOB_COLS);
  const index: number[] = [];
  for (let j = 0; j < all.length - 1; j++) {
    for (let i = 0; i < BOB_COLS; i++) {
      const quad = [at(j, i), at(j + 1, i), at(j + 1, i + 1), at(j, i + 1)];
      // Skip quads wholly over the face: nothing to draw, and no shadow cast on her.
      if (quad.every((q) => colors[q * 4 + 3] < 0.5)) continue;
      // Wound counterclockwise seen from outside, so normals point out.
      index.push(quad[0], quad[1], quad[3], quad[3], quad[1], quad[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  g.setIndex(index);
  g.computeVertexNormals();
  // The crown's first row is a single point: point it straight up.
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < BOB_COLS; i++) n.setXYZ(i, 0, 1, 0);

  const normals = grid.map((row, j) => row.map((_, i) => new THREE.Vector3().fromBufferAttribute(n, at(j, i))));
  return { geometry: g, grid, normals };
}

/**
 * The bob's shell, in head space. Shared by every figure. Its color attribute carries
 * alpha (the face opening): use a material with vertexColors, alphaTest and DoubleSide.
 */
export function bobGeometry(): THREE.BufferGeometry {
  return (bob ??= buildBob()).geometry;
}

/**
 * A point on the outside of the bob: `around` 0..1 from the back round her right side
 * (0.5 = the face), `down` 0 (crown) to 1 (the ends), lifted `lift` off the surface.
 */
export function onBob(around: number, down: number, lift = 0): [number, number, number] {
  const b = (bob ??= buildBob());
  const rows = b.grid.length - 1;
  const fi = (((around % 1) + 1) % 1) * BOB_COLS;
  const fj = Math.max(0, Math.min(rows, down * rows));
  const i0 = Math.floor(fi);
  const j0 = Math.min(rows - 1, Math.floor(fj));
  const u = fi - i0;
  const v = fj - j0;
  const pick = (m: THREE.Vector3[][], j: number, i: number) => m[j][i % BOB_COLS];
  const mix = (m: THREE.Vector3[][]) =>
    pick(m, j0, i0).clone().lerp(pick(m, j0, i0 + 1), u).lerp(pick(m, j0 + 1, i0).clone().lerp(pick(m, j0 + 1, i0 + 1), u), v);
  const p = mix(b.grid).add(mix(b.normals).normalize().multiplyScalar(lift));
  return [p.x, p.y, p.z];
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
