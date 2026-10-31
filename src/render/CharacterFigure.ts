import * as THREE from 'three';
import { BONES, type BoneId } from '../character/rig';
import type { SwordLayout } from './BladeCharge';
import { bobGeometry, faceSurfaceZ, fringeY, HEAD_ORIGIN, headGeometry, onBob } from './HeadSculpt';

/**
 * Placeholder rigged character built in code: real three.js bones (Mixamo names, from
 * src/character/rig.ts) with rigid shaped meshes attached. Swap for a skinned glTF later;
 * the clips and the sword socket keep working as long as the bone names match.
 *
 * Look: a young swordswoman, faceless by design, with a short dark bob. A midnight indigo
 * tunic with a cream front panel and gold trim, a standing collar, short sleeves over
 * cream undersleeves, a leather harness across the chest, a wide leather belt with a
 * sword belt slung low on the left, the empty scabbard hanging from it, long leather
 * bracers and fingerless gloves, dark trousers and tall brown boots with turned-down
 * cuffs.
 *
 * Shapes are lathe profiles (radius by height, revolved, flattened front to back) or
 * sculpted surfaces, so nothing is a plain capsule. Straps and hair locks are tapered
 * tubes along curves, flattened against whatever they lie on.
 */
export interface Figure {
  /** Holds the hips bone. The AnimationMixer runs on this. */
  root: THREE.Group;
  bones: Record<BoneId, THREE.Bone>;
  blade: THREE.Mesh;
  sword: SwordLayout;
  /** Materials that fade and glow for the Phantom Dash dissolve. */
  materials: THREE.MeshStandardMaterial[];
  /** Swings the tunic's skirt panels out of the way of her thighs. Call after posing. */
  updateCloth(): void;
}

const PALETTE = {
  // A natural fair skin tone: the stylized grey-white read as a porcelain doll (uncanny).
  skin: 0xf0d2c0,
  tunic: 0x272a66, // midnight indigo, in the brand's family
  cream: 0xe7dcc2, // front panel and undersleeves
  gold: 0xc9a246, // trim, buckles, sword fittings
  leather: 0x4b3022, // harness, belt, bracers
  leatherDark: 0x2e1d15, // strap bands, gloves
  pants: 0x1d1d20,
  boots: 0x4a2e20,
  bootCuff: 0x5a3828,
  sole: 0x1f1712,
  hair: 0x1e1916, // near black, a little warm
  scabbard: 0x121214,
  blade: 0xd4d4d8,
  grip: 0x18181b,
};

/** [radius, height] pairs, top to bottom or bottom to top. */
type Profile = ReadonlyArray<readonly [number, number]>;
type P3 = [number, number, number];

/** A revolved profile, flattened to `depth` front to back (1 = round). */
function lathe(profile: Profile, depth = 1, segments = 20): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y));
  if (pts[0].y > pts[pts.length - 1].y) pts.reverse(); // lathe wants bottom to top
  const g = new THREE.LatheGeometry(pts, segments);
  g.scale(1, 1, depth);
  g.computeVertexNormals();
  return g;
}

/** A thin band around a lathe: radius `r` (or the profile's at that height) from y0 to y1. */
const ring = (r: number, y0: number, y1: number, depth = 1) => lathe([[r, y0], [r, y1]], depth, 24);

const ellipsoid = (rx: number, ry: number, rz: number, w = 16, h = 12) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);

/** Profile radius at height y (linear between points). */
function radiusAt(profile: Profile, y: number): number {
  const pts = [...profile].sort((a, b) => b[1] - a[1]);
  if (y >= pts[0][1]) return pts[0][0];
  for (let i = 1; i < pts.length; i++) {
    const [r0, y0] = pts[i - 1];
    const [r1, y1] = pts[i];
    if (y <= y0 && y >= y1) return r0 + ((r1 - r0) * (y0 - y)) / (y0 - y1);
  }
  return pts[pts.length - 1][0];
}

/** Which way a strand lies flat: across x, across z, or against a surface normal. */
type Flatten = 'x' | 'z' | ((p: THREE.Vector3) => THREE.Vector3);

/**
 * A tube along the points, `r0` thick at the start, tapering to `r1`, squashed to `flat`
 * so it lies on what is under it: a lock of hair, or (with r0 = r1) a leather strap.
 */
function strand(points: ReadonlyArray<P3>, r0: number, r1: number, flat = 0.6, axis: Flatten = 'z'): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const tubular = 24;
  const radial = 8;
  const g = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular;
    curve.getPointAt(u, c);
    const r = r0 + (r1 - r0) * u ** 0.8;
    if (typeof axis === 'function') n.copy(axis(c)).normalize();
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c);
      if (typeof axis === 'function') v.addScaledVector(n, -(1 - flat) * v.dot(n));
      else v[axis] *= flat;
      v.multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ chest

const CHEST: Profile = [[0.122, -0.03], [0.128, 0.04], [0.132, 0.1], [0.127, 0.15], [0.102, 0.185], [0.062, 0.2], [0.042, 0.206]];
const CHEST_DEPTH = 0.72;

/** The soft forward swell of the bust at (x, y), for a front surface at depth z. */
function bust(x: number, y: number, z: number): number {
  const height = Math.exp(-(((y - 0.08) / 0.045) ** 2));
  const twin = 0.55 + 0.45 * Math.exp(-(((Math.abs(x) - 0.048) / 0.034) ** 2));
  const front = Math.min(1, -z / 0.08); // fades out toward the sides
  return 0.02 * height * twin * front;
}

/**
 * Ribcage and chest: a lathe for the ribcage, with a soft forward swell shaped into the
 * front of the same mesh for the bust. Modest, and seamless.
 */
function chestGeometry(): THREE.BufferGeometry {
  const g = lathe(CHEST, CHEST_DEPTH, 32);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    if (z < 0) p.setZ(i, z - bust(p.getX(i), p.getY(i), z)); // front is -Z
  }
  g.computeVertexNormals();
  return g;
}

/** A point on the chest's surface in chest space, front (-1) or back (1), lifted off it. */
function onChest(x: number, y: number, side: -1 | 1, lift: number): P3 {
  const r = radiusAt(CHEST, y) + lift;
  let z = side * Math.sqrt(Math.max(r * r - x * x, 0)) * CHEST_DEPTH;
  if (side < 0) z -= bust(x, y, z);
  return [x, y, z];
}

/** Outward from the chest's middle (and up, over the shoulders): straps lie flat on it. */
const chestNormal = (p: THREE.Vector3) => new THREE.Vector3(p.x * 0.6, Math.max(0, p.y - 0.17) * 6, p.z);

// ------------------------------------------------------------------ cloth textures

const panelTextures = new Map<string, THREE.Texture | null>();

/**
 * The tunic's front: indigo with a cream panel down the middle, gold trim at its edges,
 * and a gold seam down the center. Painted once across u (around a lathe, or across a
 * skirt panel); `half` is the panel's half width in u. Null without a canvas (tests).
 */
function panelTexture(half: number): THREE.Texture | null {
  const key = half.toFixed(3);
  if (panelTextures.has(key)) return panelTextures.get(key)!;
  if (typeof document === 'undefined') {
    panelTextures.set(key, null);
    return null;
  }
  const W = 1024;
  const H = 16;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
  g.fillStyle = hex(PALETTE.tunic);
  g.fillRect(0, 0, W, H);
  const x0 = (0.5 - half) * W;
  const x1 = (0.5 + half) * W;
  g.fillStyle = hex(PALETTE.cream);
  g.fillRect(x0, 0, x1 - x0, H);
  g.fillStyle = hex(PALETTE.gold);
  const trim = W * 0.006;
  g.fillRect(x0 - trim, 0, trim * 1.6, H);
  g.fillRect(x1 - trim * 0.6, 0, trim * 1.6, H);
  g.fillRect(W / 2 - trim * 0.4, 0, trim * 0.8, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  panelTextures.set(key, tex);
  return tex;
}

export function buildFigure(): Figure {
  const materials: THREE.MeshStandardMaterial[] = [];
  const mat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
    materials.push(m);
    return m;
  };
  /** Tunic cloth with the front panel painted on, or plain indigo where there's no canvas. */
  const panelMat = (half: number) => {
    const map = panelTexture(half);
    return mat(map ? 0xffffff : PALETTE.tunic, { map, roughness: 0.8, side: THREE.DoubleSide });
  };
  const skin = mat(PALETTE.skin, { roughness: 0.6 });
  const tunic = mat(PALETTE.tunic, { roughness: 0.8, side: THREE.DoubleSide });
  const tunicFront = panelMat(0.065); // chest and waist
  const skirtFront = panelMat(0.2);
  const cream = mat(PALETTE.cream, { roughness: 0.85 });
  const gold = mat(PALETTE.gold, { metalness: 0.7, roughness: 0.35 });
  const leather = mat(PALETTE.leather, { roughness: 0.65 });
  const leatherDark = mat(PALETTE.leatherDark, { roughness: 0.6 });
  const pants = mat(PALETTE.pants, { roughness: 0.85 });
  const boots = mat(PALETTE.boots, { roughness: 0.55, metalness: 0.05 });
  const bootCuff = mat(PALETTE.bootCuff, { roughness: 0.6 });
  const sole = mat(PALETTE.sole, { roughness: 0.8 });
  const hair = mat(PALETTE.hair, { roughness: 0.5, metalness: 0.1 });
  // The bob's shell: its vertex alpha cuts out the face.
  const bobMat = mat(PALETTE.hair, { roughness: 0.5, metalness: 0.1, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });

  const root = new THREE.Group();
  const bones = {} as Record<BoneId, THREE.Bone>;
  for (const def of BONES) {
    const b = new THREE.Bone();
    b.name = def.name;
    b.position.set(...def.offset);
    bones[def.id] = b;
    (def.parent ? bones[def.parent] : root).add(b);
  }

  /** A mesh hanging off a bone (or any group), offset from its origin. */
  const part = (bone: BoneId | THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, pos: P3 = [0, 0, 0], rot: P3 = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    mesh.castShadow = true;
    (typeof bone === 'string' ? bones[bone] : bone).add(mesh);
    return mesh;
  };
  /** A leather strap through points: flat, even width, lying against `normal`. */
  const strap = (bone: BoneId | THREE.Object3D, points: P3[], width: number, normal: Flatten, m: THREE.Material = leather) =>
    part(bone, strand(points, width / 2, width / 2, 0.2, normal), m);

  // ------------------------------------------------------------------ torso
  // Pelvis in the trousers (seen when the skirt lifts), rounded at the back.
  part('hips', lathe([[0.001, -0.13], [0.09, -0.125], [0.14, -0.09], [0.15, -0.04], [0.142, 0.02], [0.118, 0.065]], 0.72), pants);
  for (const x of [-0.06, 0.06]) part('hips', ellipsoid(0.072, 0.068, 0.058), pants, [x, -0.06, 0.04]);

  // Waist: the tunic narrows here, then flares into the skirt below the belt. The cream
  // front panel runs down from the collar to the hem.
  part('spine', lathe([[0.112, -0.04], [0.098, 0.03], [0.1, 0.1], [0.115, 0.17], [0.122, 0.2]], 0.74, 32), tunicFront);
  part('chest', chestGeometry(), tunicFront);

  // Standing collar, indigo with a gold edge and a clasp at the front.
  part('chest', lathe([[0.049, 0.186], [0.047, 0.232]], 0.95, 24), tunic);
  part('chest', ring(0.0485, 0.229, 0.236, 0.95), gold);
  part('chest', new THREE.BoxGeometry(0.012, 0.016, 0.006), gold, [0, 0.214, -0.047]);

  // Shoulders, each capped by an indigo shoulder panel edged in gold.
  for (const side of ['L', 'R'] as const) {
    const out = side === 'R' ? 1 : -1;
    part(`shoulder${side}`, ellipsoid(0.046, 0.042, 0.045), tunic, [out * 0.085, -0.012, 0]);
    const cap = new THREE.SphereGeometry(0.056, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.6, 0.95);
    part(`upperArm${side}`, cap, tunic, [out * 0.002, 0.008, 0], [0, 0, -out * 0.3]);
    part(`upperArm${side}`, ring(0.0565, 0.0, 0.006, 0.95), gold, [out * 0.002, 0.008, 0], [0, 0, -out * 0.3]);
  }

  // Harness: a strap down each side of the chest, over the shoulders and down the back,
  // joined by one across the upper chest, and a diagonal from her left shoulder to her
  // right side. Buckles in gold.
  for (const out of [-1, 1]) {
    const x = out * 0.06;
    strap('chest', [onChest(x, -0.02, -1, 0.006), onChest(x, 0.06, -1, 0.006), onChest(x, 0.14, -1, 0.006), onChest(x, 0.19, -1, 0.006), [x, 0.214, -0.012], [x, 0.214, 0.014], onChest(x, 0.19, 1, 0.006), onChest(x, 0.1, 1, 0.006), onChest(x, -0.02, 1, 0.006)], 0.02, chestNormal);
  }
  const across = [-0.07, -0.035, 0, 0.035, 0.07].map((x) => onChest(x, 0.145, -1, 0.009));
  strap('chest', across, 0.016, chestNormal);
  part('chest', new THREE.TorusGeometry(0.011, 0.0025, 4, 4), gold, onChest(0.035, 0.145, -1, 0.012), [0, 0, Math.PI / 4]);
  const diagonal: P3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    diagonal.push(onChest(-0.065 + 0.18 * t, 0.17 - 0.2 * t, -1, 0.011));
  }
  strap('chest', diagonal, 0.022, chestNormal);
  part('chest', new THREE.TorusGeometry(0.012, 0.0028, 4, 4), gold, onChest(-0.04, 0.142, -1, 0.015), [0, 0, Math.PI / 4]);

  // Wide leather belt over the waist, a buckle off center, and a sword belt slung low
  // toward her left hip, where the scabbard hangs.
  part('hips', lathe([[0.158, 0.028], [0.149, 0.06], [0.14, 0.09], [0.132, 0.115]], 0.78, 32), leather);
  part('hips', ring(0.159, 0.034, 0.041, 0.78), leatherDark);
  part('hips', ring(0.141, 0.096, 0.103, 0.78), leatherDark);
  part('hips', new THREE.TorusGeometry(0.019, 0.004, 4, 4), gold, [0.035, 0.07, -0.118], [0, 0, Math.PI / 4]);
  part('hips', lathe([[0.178, -0.013], [0.178, 0.013]], 0.8, 40), leather, [0, 0.0, 0], [0, 0, 0.2]);
  part('hips', new THREE.TorusGeometry(0.013, 0.003, 4, 4), gold, [0.05, 0.01, -0.144], [0, 0, Math.PI / 4]);

  // ------------------------------------------------------------------ skirt
  // Four panels hinged at the waist (front, back, left, right), each a quarter cone with
  // a little overlap. updateCloth() swings them with her thighs. The front one carries
  // the cream panel.
  const skirt: Record<'front' | 'back' | 'left' | 'right', THREE.Group> = {
    back: skirtPanel(0, tunic),
    right: skirtPanel(Math.PI / 2, tunic),
    front: skirtPanel(Math.PI, skirtFront),
    left: skirtPanel(-Math.PI / 2, tunic),
  };
  function skirtPanel(center: number, m: THREE.Material): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.y = 0.06;
    // Side panels sit a hair inside the front and back ones, so the overlaps layer instead of flickering.
    const k = Math.abs(Math.sin(center)) > 0.5 ? 0.985 : 1;
    const arc = (r0: number, r1: number, h: number, y: number) =>
      new THREE.CylinderGeometry(r0 * k, r1 * k, h, 12, 1, true, center - 0.95, 1.9).translate(0, y, 0).scale(1, 1, 0.78);
    const mesh = new THREE.Mesh(arc(0.14, 0.205, 0.28, -0.14), m);
    mesh.castShadow = true;
    pivot.add(mesh, new THREE.Mesh(arc(0.207, 0.207, 0.014, -0.277), gold)); // hem trim
    bones.hips.add(pivot);
    return pivot;
  }
  // The belt's tail hangs from the buckle down the front panel, so it moves with it.
  strap(skirt.front, [[0.05, 0.005, -0.124], [0.055, -0.06, -0.13], [0.06, -0.13, -0.142]], 0.018, () => new THREE.Vector3(0, 0, -1));
  part(skirt.front, new THREE.BoxGeometry(0.02, 0.008, 0.004), gold, [0.06, -0.135, -0.144]); // tip

  // ------------------------------------------------------------------ scabbard
  // Empty (the sword is in her hand), hung from the sword belt at her left hip and angled
  // back so her legs clear it.
  const saya = new THREE.Group();
  saya.position.set(-0.165, -0.005, -0.04);
  saya.rotation.set(-0.55, 0, -0.12);
  bones.hips.add(saya);
  const SAYA = 0.98;
  part(saya, new THREE.CylinderGeometry(0.019, 0.016, SAYA, 14).scale(1, 1, 0.72).translate(0, -SAYA / 2, 0), mat(PALETTE.scabbard, { roughness: 0.3, metalness: 0.2 }));
  part(saya, new THREE.CylinderGeometry(0.021, 0.021, 0.04, 14).scale(1, 1, 0.74).translate(0, -0.02, 0), gold); // mouth
  part(saya, new THREE.CylinderGeometry(0.0205, 0.0205, 0.012, 14).scale(1, 1, 0.74).translate(0, -0.1, 0), gold); // cord fitting
  part(saya, new THREE.CylinderGeometry(0.018, 0.012, 0.05, 14).scale(1, 1, 0.74).translate(0, -SAYA + 0.022, 0), gold); // end cap

  // ------------------------------------------------------------------ head
  part('neck', lathe([[0.043, -0.01], [0.036, 0.05], [0.038, 0.1], [0.042, 0.13]], 0.9), skin);

  // Faceless head (see HeadSculpt.ts). The hair below is placed in head space, on its
  // actual surface.
  const O = HEAD_ORIGIN;
  const onFace = (x: number, y: number, lift = 0): P3 => [x, O + y, faceSurfaceZ(x, y) - lift];
  part('head', headGeometry(), skin, [0, O, 0]);

  // Hair: a chin-length bob (one shell, see HeadSculpt) with locks laid over it so it
  // reads as hair and not a helmet. Blunt ends, like a fresh cut.
  part('head', bobGeometry(), bobMat, [0, O, 0]);
  const fromCrown = (p: THREE.Vector3) => new THREE.Vector3(p.x, Math.max(0, p.y - O - 0.03), p.z - 0.008);
  const lock = (pts: P3[], r0: number, r1: number) => part('head', strand(pts, r0, r1, 0.4, fromCrown), hair);
  const bobAt = (around: number, down: number, lift: number): P3 => {
    const [x, y, z] = onBob(around, down, lift);
    return [x, y + O, z];
  };
  const LOCKS = 30;
  for (let i = 0; i < LOCKS; i++) {
    // Around the back, from one side of the face to the other (0.5 is the face).
    const around = 0.66 + (0.68 * i) / (LOCKS - 1);
    const pts: P3[] = [];
    for (let k = 0; k <= 7; k++) {
      const d = 0.02 + (0.98 * k) / 7;
      pts.push(bobAt(around + 0.004 * Math.sin(i * 2.3), d, 0.0015 + 0.002 * Math.sin(Math.PI * Math.min(1, d * 1.1))));
    }
    lock(pts, 0.004, 0.0095);
  }
  // Fringe: locks from the crown down over the forehead, sweeping from the part on her
  // right toward her left and ending at the fringe's clean edge.
  const jitter = [0.4, -0.7, 0.9, -0.2, 0.6, -0.9, 0.1, 0.8, -0.5]; // fixed, so she looks the same every load
  const aroundAt = (x: number) => (Math.PI - Math.asin(Math.max(-1, Math.min(1, x / 0.088)))) / (Math.PI * 2);
  for (let i = 0; i < 9; i++) {
    const j = jitter[i];
    const x = 0.056 - i * 0.0135 + j * 0.002;
    const tipX = x - 0.01 - 0.004 * Math.sin((i / 8) * Math.PI);
    const tipY = fringeY(tipX) + 0.004 + jitter[(i + 4) % 9] * 0.001; // ends at the fringe's edge, off the face
    const a = aroundAt(x);
    const b = aroundAt(x - 0.006);
    lock([bobAt(a, 0.02, 0.0015), bobAt(a, 0.2, 0.003), bobAt(b, 0.36, 0.003), bobAt(aroundAt(tipX + 0.004), 0.46, 0.002), onFace(tipX, tipY, 0.009)], 0.008, 0.004);
  }

  // ------------------------------------------------------------------ arms
  for (const side of ['L', 'R'] as const) {
    const out = side === 'R' ? 1 : -1;
    // Indigo short sleeve with a gold hem over a cream undersleeve.
    part(`upperArm${side}`, lathe([[0.047, 0.012], [0.049, -0.05], [0.048, -0.11], [0.047, -0.125]], 0.95), tunic);
    part(`upperArm${side}`, ring(0.0498, -0.111, -0.126, 0.95), gold);
    part(`upperArm${side}`, lathe([[0.04, 0.01], [0.043, -0.05], [0.04, -0.12], [0.034, -0.22], [0.031, -0.27]], 0.92), cream);
    part(`forearm${side}`, ellipsoid(0.031, 0.031, 0.031), cream); // elbow
    part(`forearm${side}`, lathe([[0.031, 0], [0.034, -0.05], [0.03, -0.11], [0.023, -0.23]], 0.85), cream);
    // Long leather bracer, flared at the elbow end, with two strap bands.
    part(`forearm${side}`, lathe([[0.043, -0.045], [0.038, -0.08], [0.033, -0.15], [0.029, -0.232]], 0.88), leather);
    part(`forearm${side}`, ring(0.0395, -0.085, -0.097, 0.88), leatherDark);
    part(`forearm${side}`, ring(0.0335, -0.165, -0.177, 0.88), leatherDark);

    // Fingerless glove: a leather palm, then bare fingers curled round the grip axis, and a thumb.
    part(`hand${side}`, new THREE.BoxGeometry(0.047, 0.06, 0.028), leatherDark, [0, -0.034, 0]);
    for (let f = 0; f < 4; f++) {
      const z = -0.016 + f * 0.011;
      part(`hand${side}`, new THREE.CapsuleGeometry(0.0078, 0.025 - Math.abs(f - 1.5) * 0.003, 3, 6), skin, [out * 0.006, -0.07, z], [0, 0, Math.PI / 2]);
    }
    part(`hand${side}`, new THREE.CapsuleGeometry(0.008, 0.022, 3, 6), skin, [-out * 0.021, -0.048, -0.012], [0.5, 0, 0]);
  }

  // ------------------------------------------------------------------ legs
  for (const side of ['L', 'R'] as const) {
    const out = side === 'R' ? 1 : -1;
    // Trousers: full at the top, tapering into the knee. The top tucks in under the hips
    // so it never pushes through the skirt's side panels.
    const thigh: Profile = [[0.05, 0.02], [0.068, -0.02], [0.075, -0.07], [0.072, -0.13], [0.062, -0.26], [0.051, -0.37], [0.046, -0.44]];
    part(`thigh${side}`, lathe(thigh, 0.95), pants, [-out * 0.008, 0, 0]);
    part(`shin${side}`, ellipsoid(0.046, 0.05, 0.048), pants); // knee
    part(`shin${side}`, lathe([[0.045, 0], [0.046, -0.06]], 0.95), pants);
    // Tall boot to just below the knee: the calf swells at the back, then slims to the
    // ankle. A turned-down cuff at the top.
    part(`shin${side}`, lathe([[0.05, -0.06], [0.053, -0.12], [0.047, -0.2], [0.036, -0.33], [0.033, -0.43]], 0.92), boots, [0, 0, 0.006]);
    part(`shin${side}`, lathe([[0.061, -0.03], [0.059, -0.1], [0.057, -0.105]], 0.92), bootCuff, [0, 0, 0.004]);

    // Boot foot: heel, a rounded vamp narrowing to the toe, a dark sole at the floor.
    part(`foot${side}`, new THREE.BoxGeometry(0.058, 0.05, 0.064), boots, [0, -0.04, 0.018]);
    part(`foot${side}`, ellipsoid(0.035, 0.031, 0.094), boots, [0, -0.042, -0.06]);
    part(`foot${side}`, new THREE.BoxGeometry(0.06, 0.012, 0.182), sole, [0, -0.064, -0.04]);
  }

  // ------------------------------------------------------------------ katana
  // In the right hand. The blade points along the hand's -Z (see clips.ts).
  const sword = new THREE.Group();
  sword.position.set(0, -0.06, 0);
  bones.handR.add(sword);
  const swordPart = (geo: THREE.BufferGeometry, m: THREE.Material, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.z = z;
    mesh.castShadow = true;
    sword.add(mesh);
    return mesh;
  };
  swordPart(new THREE.BoxGeometry(0.032, 0.036, 0.24), mat(PALETTE.grip, { roughness: 0.9 }), 0.02);
  swordPart(new THREE.CylinderGeometry(0.022, 0.022, 0.016, 12).rotateX(Math.PI / 2), gold, 0.145); // pommel
  swordPart(new THREE.CylinderGeometry(0.042, 0.042, 0.01, 16).rotateX(Math.PI / 2).scale(1, 0.8, 1), gold, -0.105); // tsuba
  // Brushed rather than mirror steel: a mirror-flat face can catch the key light head-on
  // and blow out into a bloom halo that reads like an effect.
  const HILT_Z = -0.11;
  const LENGTH = 0.95;
  const blade = swordPart(new THREE.BoxGeometry(0.02, 0.048, LENGTH), mat(PALETTE.blade, { metalness: 0.6, roughness: 0.45 }), HILT_Z - LENGTH / 2);

  // ------------------------------------------------------------------ cloth
  const down = new THREE.Vector3();
  /** Thigh direction in hips space: how far forward and out to the side it swings (radians). */
  const swing = (thigh: THREE.Bone) => {
    down.set(0, -1, 0).applyQuaternion(thigh.quaternion);
    const below = Math.max(1e-3, -down.y);
    return { forward: Math.atan2(-down.z, below), side: Math.atan2(down.x, below) };
  };
  const CLOTH_FOLLOW = 0.85;
  const MAX_LIFT = 1.4;
  const clamp = (a: number) => Math.max(-MAX_LIFT, Math.min(MAX_LIFT, a * CLOTH_FOLLOW));
  const updateCloth = () => {
    const l = swing(bones.thighL);
    const r = swing(bones.thighR);
    // Each panel moves only out of the way of a leg, never into it.
    skirt.front.rotation.x = clamp(Math.max(0, l.forward, r.forward));
    skirt.back.rotation.x = clamp(Math.min(0, l.forward, r.forward));
    skirt.right.rotation.z = clamp(Math.max(0, r.side) + 0.25 * Math.abs(r.forward));
    skirt.left.rotation.z = clamp(Math.min(0, l.side) - 0.25 * Math.abs(l.forward));
  };

  return { root, bones, blade, sword: { group: sword, hiltZ: HILT_Z, tipZ: HILT_Z - LENGTH }, materials, updateCloth };
}
