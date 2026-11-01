import * as THREE from 'three';
import { grassTexture, rng } from './textures';

/*
 * The land round the training grounds, in three.js coordinates (x right, z toward the
 * spawn camera, y up). Flat out past the village so props sit on level ground, then
 * rolling hills, a hill for the castle, and a ring of mountains the fog turns blue.
 */

/** Flat inside this radius. The courtyard, the props and the village all fit. */
export const FLAT_RADIUS = 46;
/**
 * Where the castle stands: ahead of the spawn camera, a little to the left, far enough out
 * that the whole thing fits under the top of the frame from the yard.
 */
export const CASTLE = { x: -50, z: -175, hillHeight: 10, hillRadius: 28, scale: 0.65 };
/** Ground under the courtyard floor, so the sand never fights the grass for depth. */
export const GRASS_Y = -0.03;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Value noise on a lattice, smooth between points. Deterministic. */
function valueNoise(seed: number): (x: number, y: number) => number {
  const r = rng(seed);
  const size = 256;
  const table = new Float32Array(size * size).map(() => r());
  const at = (i: number, j: number) => table[(((j % size) + size) % size) * size + (((i % size) + size) % size)];
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * ux;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * ux;
    return a + (b - a) * uy;
  };
}

const noise = valueNoise(7);
function fbm(x: number, y: number, octaves: number): number {
  let v = 0;
  let a = 0.5;
  for (let i = 0; i < octaves; i++) {
    v += a * noise(x, y);
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 3.7;
    a *= 0.5;
  }
  return v;
}

/** Ground height at (x, z). Zero inside FLAT_RADIUS. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r < FLAT_RADIUS) return 0;
  const hills = smooth(FLAT_RADIUS, FLAT_RADIUS + 60, r) * fbm(x * 0.012, z * 0.012, 4) * 22;
  // A low blue ridge behind the castle (it stays under the castle's skyline from the
  // yard), and taller peaks far beyond everything.
  const mountains =
    smooth(200, 260, r) * (0.25 + fbm(x * 0.006 + 40, z * 0.006, 5)) * 55 + smooth(300, 380, r) * (0.5 + fbm(x * 0.004, z * 0.004 + 9, 4)) * 110;
  const dx = x - CASTLE.x;
  const dz = z - CASTLE.z;
  const castleHill = CASTLE.hillHeight * Math.exp(-(dx * dx + dz * dz) / (2 * CASTLE.hillRadius * CASTLE.hillRadius));
  // The castle needs a level top: blend toward the hill's crown near its middle.
  const plateau = smooth(14, 4, Math.hypot(dx, dz));
  const h = hills + mountains + castleHill;
  return h + (CASTLE.hillHeight + hills - h) * plateau;
}

export interface TerrainLook {
  grass: number;
  grassDry: number;
  rock: number;
  snow: number;
}

/** A polar grid, dense near the middle and stretched out toward the mountains. */
export function terrainMesh(look: TerrainLook): THREE.Mesh {
  const RINGS = 96;
  const SEGMENTS = 192;
  const MAX_R = 400;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const grass = new THREE.Color(look.grass);
  const dry = new THREE.Color(look.grassDry);
  const rock = new THREE.Color(look.rock);
  const snow = new THREE.Color(look.snow);
  const c = new THREE.Color();

  for (let i = 0; i <= RINGS; i++) {
    const r = MAX_R * (i / RINGS) ** 1.7;
    for (let j = 0; j < SEGMENTS; j++) {
      const a = (j / SEGMENTS) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = terrainHeight(x, z);
      positions.push(x, i === 0 ? GRASS_Y : y + GRASS_Y, z);
      uvs.push(x / 7, z / 7);
      // Patches of drier grass, rock on the high slopes, snow on the peaks.
      c.copy(grass).lerp(dry, smooth(0.45, 0.75, fbm(x * 0.03, z * 0.03, 3)) * 0.8);
      c.lerp(rock, smooth(30, 70, y));
      c.lerp(snow, smooth(95, 120, y));
      colors.push(c.r, c.g, c.b);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a = i * SEGMENTS + j;
      const b = i * SEGMENTS + ((j + 1) % SEGMENTS);
      const c2 = a + SEGMENTS;
      const d = b + SEGMENTS;
      // Counterclockwise seen from above, so the faces (and normals) point up.
      index.push(a, b, c2, b, d, c2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();

  const tex = grassTexture(1);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 1, metalness: 0 }),
  );
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return mesh;
}

export interface Scatter {
  x: number;
  z: number;
  y: number;
  scale: number;
  yaw: number;
  /** 0..1, for color variation. */
  tint: number;
}

/**
 * Tree spots: a ring of woods outside the walls, thinning toward the hills. Keeps clear of
 * the village sector (to the right), the castle's crown and the courtyard's surroundings.
 */
export function scatterTrees(count: number, seed: number, minR: number, maxR: number): Scatter[] {
  const r = rng(seed);
  const out: Scatter[] = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    // Area-uniform in radius, so trees don't bunch near the middle.
    const rad = Math.sqrt(minR * minR + r() * (maxR * maxR - minR * minR));
    const a = r() * Math.PI * 2;
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    if (inVillage(x, z)) continue;
    if (Math.hypot(x - CASTLE.x, z - CASTLE.z) < 20) continue;
    out.push({ x, z, y: terrainHeight(x, z) + GRASS_Y, scale: 0.8 + r() * 0.9, yaw: r() * Math.PI * 2, tint: r() });
  }
  return out;
}

/** The village sits to the right of the courtyard (+x), between these radii and angles. */
export const VILLAGE = { minR: 25, maxR: 44, fromAngle: -0.65, toAngle: 0.55 };

export function inVillage(x: number, z: number): boolean {
  const rad = Math.hypot(x, z);
  const a = Math.atan2(z, x);
  return rad > VILLAGE.minR - 4 && rad < VILLAGE.maxR + 6 && a > VILLAGE.fromAngle - 0.12 && a < VILLAGE.toAngle + 0.12;
}
