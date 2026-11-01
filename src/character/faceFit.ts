import type { FittedBody } from './bodyFit';
import { BONE_IDS } from './rig';
import { bodyTriangles, rayHit } from './shell';

/*
 * Where her eyes and brows go (engine-free). The base mesh's face is smooth, so the eyes
 * are drawn: a thin patch laid over the front of her face, covering both eyes and brows,
 * that the render layer paints (src/render/FaceView.ts). Measured off the fitted body:
 * a grid of points shot straight back onto the face, lifted a hair off the skin, all on
 * the head bone.
 *
 * Face coordinates (`face`) are meters: x across (+ = her right), y up from the eye line.
 * The painter works in those, so the eyes keep their shape whatever the patch's grid is.
 */

export const FACE = {
  /** Eye line height (rig space, rest pose) and how far each eye's middle is from center. */
  eyeY: 1.628,
  eyeX: 0.033,
  /** Half an eye's width. */
  eyeHalf: 0.0148,
  /** The patch: half its width, and how far it reaches below and above the eye line. */
  halfWidth: 0.064,
  below: 0.028,
  above: 0.062,
  cols: 36,
  rows: 26,
  /** Lift off the skin (meters). */
  lift: 0.0012,
};

export interface FaceFit {
  positions: Float32Array;
  normals: Float32Array;
  /** Face coordinates per vertex (see above). */
  face: Float32Array;
  indices: Uint32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
}

export function fitFace(body: FittedBody, headY: number): FaceFit {
  const { cols, rows } = FACE;
  const tris = bodyTriangles(body, (v) => body.positions[3 * v + 1] > headY && body.armParam[v] < 0);
  const n = (cols + 1) * (rows + 1);
  const positions = new Float32Array(n * 3);
  const face = new Float32Array(n * 2);
  const START = -0.4; // in front of her: rays go back (+Z) onto the face
  let fallback = -0.09;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const k = j * (cols + 1) + i;
      const x = -FACE.halfWidth + (2 * FACE.halfWidth * i) / cols;
      const dy = -FACE.below + ((FACE.below + FACE.above) * j) / rows;
      const t = rayHit(body, tris, [x, FACE.eyeY + dy, START], [0, 0, 1]);
      const z = Number.isFinite(t) ? START + t : fallback;
      fallback = z;
      positions.set([x, FACE.eyeY + dy, z - FACE.lift], k * 3);
      face.set([x, dy], k * 2);
    }
  }
  // Normals from the grid's neighbors, pointing out of the face (-Z).
  const normals = new Float32Array(n * 3);
  const at = (i: number, j: number) => {
    const k = (Math.min(rows, Math.max(0, j)) * (cols + 1) + Math.min(cols, Math.max(0, i))) * 3;
    return [positions[k], positions[k + 1], positions[k + 2]];
  };
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const [a, b, c, d] = [at(i + 1, j), at(i - 1, j), at(i, j + 1), at(i, j - 1)];
      const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const v = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
      let nx = u[1] * v[2] - u[2] * v[1];
      let ny = u[2] * v[0] - u[0] * v[2];
      let nz = u[0] * v[1] - u[1] * v[0];
      if (nz > 0) [nx, ny, nz] = [-nx, -ny, -nz];
      const len = Math.hypot(nx, ny, nz) || 1;
      normals.set([nx / len, ny / len, nz / len], (j * (cols + 1) + i) * 3);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + cols + 1;
      // Wound to face -Z, out of her face (+x then +y would face into her head).
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const head = BONE_IDS.indexOf('head');
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) {
    skinIndex[k * 4] = head;
    skinWeight[k * 4] = 1;
  }
  return { positions, normals, face, indices: Uint32Array.from(indices), skinIndex, skinWeight };
}
