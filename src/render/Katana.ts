import * as THREE from 'three';

/*
 * Her katana, modeled in code. Sword space: the blade runs along -Z from HILT_Z, the grip
 * along +Z; the cutting edge faces -Y, the spine +Y.
 *
 * The blade is built from cross-sections along its length, each the shape of a real
 * katana's: a sharp edge, the flat (hira) up to the ridge line (shinogi), a narrower
 * face (shinogi-ji) up to the spine (mune), which peaks in the middle. Every facet is its
 * own strip, so the ridge lines stay crisp. It tapers toward the tip, curves gently (the
 * middle bows toward the edge; hilt and tip stay on the axis, where the trails and the
 * charge glow expect them), and ends in a kissaki: the edge sweeps up in an arc to meet
 * the spine at a sharp point. A brighter band along the edge, with a slight wave, is the
 * temper line (hamon).
 *
 * The mounting: a gold collar on the blade (habaki), washers (seppa) either side of an
 * oval iron guard (tsuba) with a gold rim, a gold collar (fuchi), the grip (tsuka)
 * wrapped in dark cord over pale ray skin in the diamond pattern, small gold ornaments
 * under the wrap (menuki), and a cap (kashira).
 */

export const HILT_Z = -0.11;
export const BLADE_LENGTH = 0.95;

const WIDTH_BASE = 0.034;
const WIDTH_TIP = 0.026;
const THICK_BASE = 0.0075;
const THICK_TIP = 0.005;
/** How far the middle of the blade bows toward the edge. */
const SORI = 0.016;
/** Length of the curved point. */
const KISSAKI = 0.075;
const STATIONS = 48;

export interface KatanaMaterials {
  /** The flats, the temper line by the edge, the ridge faces and spine. */
  steel: THREE.Material;
  hamon: THREE.Material;
  spine: THREE.Material;
  gold: THREE.Material;
  iron: THREE.Material;
  grip: THREE.Material;
}

/**
 * The blade's shape at u (0 = hilt, 1 = tip), sword space: the spine line's height, the
 * width below it (edge to spine), and half the thickness at the ridge line.
 */
export function bladeProfile(u: number): { spine: number; width: number; half: number; z: number } {
  const w = WIDTH_BASE + (WIDTH_TIP - WIDTH_BASE) * u;
  const t = THICK_BASE + (THICK_TIP - THICK_BASE) * u;
  // The spine line: centered on the axis at the hilt, on it at the tip, bowing between.
  const spine = (WIDTH_BASE / 2) * (1 - u) - 4 * SORI * u * (1 - u);
  // Toward the tip the whole section narrows to a point on the spine (the kissaki).
  const k = Math.max(0, (u - (1 - KISSAKI / BLADE_LENGTH)) / (KISSAKI / BLADE_LENGTH));
  const fukura = Math.sqrt(Math.max(0, 1 - k * k)); // the edge's arc up to the point
  return { spine, width: w * fukura, half: (t / 2) * (0.25 + 0.75 * fukura), z: HILT_Z - u * BLADE_LENGTH };
}

/** Middle of the blade's cross-section at u (sword space): where effects ride along it. */
export function bladeMiddle(u: number): { y: number; z: number } {
  const p = bladeProfile(u);
  return { y: p.spine - p.width / 2, z: p.z };
}

/**
 * A smooth shell `pad` meters off the blade all round, following its curve, taper and
 * point: for glows. Built in `stations` slices from hilt to tip, `SHELL_SIDES` triangles
 * pairs per slice, in order, so drawing the first n * SHELL_SIDES * 6 indices shows it
 * filled from the hilt up to slice n.
 */
export const SHELL_SIDES = 12;
export function bladeShell(pad: number, stations = 40): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let s = 0; s <= stations; s++) {
    const u = s / stations;
    const p = bladeProfile(u);
    const cy = p.spine - p.width / 2;
    for (let i = 0; i < SHELL_SIDES; i++) {
      const a = (i / SHELL_SIDES) * Math.PI * 2;
      pos.push(Math.cos(a) * (p.half + pad), cy + Math.sin(a) * (p.width / 2 + pad), p.z);
    }
  }
  const tipCap = pos.length / 3;
  pos.push(0, bladeMiddle(1).y, HILT_Z - BLADE_LENGTH - pad); // round the point off
  const index: number[] = [];
  for (let s = 0; s < stations; s++) {
    for (let i = 0; i < SHELL_SIDES; i++) {
      const a = s * SHELL_SIDES + i;
      const b = s * SHELL_SIDES + ((i + 1) % SHELL_SIDES);
      index.push(a, a + SHELL_SIDES, b, b, a + SHELL_SIDES, b + SHELL_SIDES);
    }
  }
  for (let i = 0; i < SHELL_SIDES; i++) index.push(stations * SHELL_SIDES + i, tipCap, stations * SHELL_SIDES + ((i + 1) % SHELL_SIDES));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** The blade's cross-section at u (0 = hilt, 1 = tip): points around it, edge first, in sword space. */
function section(u: number): Array<[number, number]> {
  const { spine, width, half } = bladeProfile(u);
  const down = (frac: number) => spine - width * frac; // frac of the width below the spine
  const hamon = 0.78 - 0.04 * Math.sin(u * 47) - 0.02 * Math.sin(u * 113); // a gentle wave
  // On the flat, thickness grows from the edge (frac 1) to the ridge line (frac 0.28).
  return [
    [0, down(1)], // edge
    [half * (1 - hamon) / 0.72, down(hamon)], // temper line, right
    [half, down(0.28)], // ridge line (shinogi), right
    [half * 0.62, down(0.04)], // spine shoulder, right
    [0, spine + 0.0012 * Math.min(1, width / WIDTH_TIP)], // spine peak (flattens into the point)
    [-half * 0.62, down(0.04)],
    [-half, down(0.28)],
    [-half * (1 - hamon) / 0.72, down(hamon)],
  ];
}

/** Facet strips around the section: [from point, to point, material slot]. */
const FACETS: Array<[number, number, number]> = [
  [0, 1, 1], // edge to temper line: bright
  [1, 2, 0], // the flat
  [2, 3, 2], // ridge face
  [3, 4, 2], // spine
  [4, 5, 2],
  [5, 6, 2],
  [6, 7, 0],
  [7, 0, 1],
];

function bladeGeometry(): THREE.BufferGeometry {
  const sections = Array.from({ length: STATIONS + 1 }, (_, s) => {
    // More stations toward the point, where the shape changes fastest.
    const u = 1 - (1 - s / STATIONS) ** 1.6;
    return { z: HILT_Z - u * BLADE_LENGTH, pts: section(u) };
  });
  const pos: number[] = [];
  const groups: number[][] = [[], [], []];
  for (const [a, b, slot] of FACETS) {
    const start = pos.length / 3;
    for (const { z, pts } of sections) pos.push(pts[a][0], pts[a][1], z, pts[b][0], pts[b][1], z);
    for (let s = 0; s < STATIONS; s++) {
      const [p, q] = [start + s * 2, start + (s + 1) * 2];
      // Wound to face out (tested in test/katana.test.ts).
      groups[slot].push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex([...groups[0], ...groups[1], ...groups[2]]);
  let at = 0;
  groups.forEach((list, slot) => {
    g.addGroup(at, list.length, slot);
    at += list.length;
  });
  g.computeVertexNormals();
  return g;
}

/** Tsuka-ito: dark cord crossing over pale ray skin, leaving diamonds. Null without a DOM. */
let gripTexture: THREE.Texture | null | undefined;
function gripWrap(): THREE.Texture | null {
  if (gripTexture !== undefined) return gripTexture;
  if (typeof document === 'undefined') return (gripTexture = null);
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e7dcc2';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#18181b';
  g.lineWidth = 15;
  g.lineCap = 'butt';
  // One diamond per tile; crossing diagonals leave the pale diamond in the middle.
  for (const [x0, x1] of [[0, 128], [128, 0]]) {
    for (const off of [-64, 0, 64]) {
      g.beginPath();
      g.moveTo(x0, off);
      g.lineTo(x1, off + 64);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 7);
  tex.anisotropy = 4;
  return (gripTexture = tex);
}

/** The finished sword, in a group. `blade` is the blade mesh. */
export function buildKatana(m: KatanaMaterials): { group: THREE.Group; blade: THREE.Mesh } {
  const group = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], z: number) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = z;
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  const alongZ = (geo: THREE.BufferGeometry) => geo.rotateX(Math.PI / 2);

  const blade = add(bladeGeometry(), [m.steel, m.hamon, m.spine], 0);

  // Habaki: the collar locking the blade into the guard.
  add(new THREE.BoxGeometry(THICK_BASE + 0.006, WIDTH_BASE + 0.006, 0.032), m.gold, HILT_Z - 0.016);
  // Seppa and tsuba.
  const oval = (rx: number, ry: number, depth: number) => alongZ(new THREE.CylinderGeometry(1, 1, depth, 32)).scale(rx, ry, 1);
  add(oval(0.024, 0.03, 0.003), m.gold, HILT_Z + 0.002);
  add(oval(0.04, 0.046, 0.006), m.iron, HILT_Z + 0.0065);
  add(new THREE.TorusGeometry(0.043, 0.0025, 6, 40).scale(0.04 / 0.043, 0.046 / 0.043, 1), m.gold, HILT_Z + 0.0065);
  add(oval(0.024, 0.03, 0.003), m.gold, HILT_Z + 0.011);
  // Fuchi, the wrapped grip, menuki, kashira.
  const GRIP_FROM = HILT_Z + 0.0125;
  const GRIP = 0.25;
  add(oval(0.0175, 0.0215, 0.014), m.gold, GRIP_FROM + 0.007);
  const grip = alongZ(new THREE.CylinderGeometry(1, 1, GRIP - 0.03, 20, 1, true)).scale(0.0165, 0.0205, 1);
  add(grip, m.grip, GRIP_FROM + 0.014 + (GRIP - 0.03) / 2);
  for (const side of [-1, 1]) {
    const menuki = new THREE.SphereGeometry(1, 10, 6).scale(0.004, 0.009, 0.016);
    const mesh = add(menuki, m.gold, GRIP_FROM + GRIP * 0.42);
    mesh.position.x = side * 0.0158;
  }
  add(alongZ(new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2)).scale(0.0175, 0.0215, 0.016), m.iron, GRIP_FROM + GRIP - 0.016);
  add(oval(0.018, 0.022, 0.006), m.gold, GRIP_FROM + GRIP - 0.016);

  return { group, blade };
}

/** The grip's material map (null without a DOM: plain color then). */
export const katanaGripMap = gripWrap;
