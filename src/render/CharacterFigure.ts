import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BONES, type BoneId } from '../character/rig';
import { COLORS } from './ArenaView';
import type { SwordLayout } from './BladeCharge';

/**
 * Placeholder rigged character built in code: real three.js bones (Mixamo names, from
 * src/character/rig.ts) with rigid shaped meshes attached. Swap for a skinned glTF later;
 * the clips and the sword socket keep working as long as the bone names match.
 *
 * Look: an action-game lead in the spirit of EVE, 2B and Zero Suit Samus, in our own
 * palette. Heroic proportions (long legs, slender neck, a head with real hair volume),
 * a fitted dark bodysuit with indigo piping, an indigo tunic over it with a sash, gloves,
 * leather bracers, knee guards and armored knee boots. Feminine and modest.
 *
 * Shapes are lathe profiles (radius by height, revolved, flattened front to back) or
 * sculpted spheres, so nothing is a plain capsule: thighs taper into the knee, calves
 * swell at the back, the waist narrows between ribcage and hips, the jaw narrows to the
 * chin. Hair is tapered strands along curves, not blobs.
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
  lips: 0xc98c86,
  suit: 0x232327, // near zinc-800 bodysuit
  boots: 0x18181b, // zinc-900
  leather: 0x3f3f46, // zinc-700: bracers, plates, sole
  tunic: 0x312e81, // indigo-900
  trim: COLORS.indigoLight, // indigo-400 piping and fittings
  hair: 0x15151c,
  eyeWhite: 0xf4f4f5, // zinc-100
  iris: COLORS.indigoLight,
  dark: 0x09090b, // zinc-950: pupils, lash line
  blade: 0xd4d4d8,
  grip: 0x18181b,
};

/** [radius, height] pairs, top to bottom or bottom to top. */
type Profile = ReadonlyArray<readonly [number, number]>;

/** A revolved profile, flattened to `depth` front to back (1 = round). */
function lathe(profile: Profile, depth = 1, segments = 20): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y));
  if (pts[0].y > pts[pts.length - 1].y) pts.reverse(); // lathe wants bottom to top
  const g = new THREE.LatheGeometry(pts, segments);
  g.scale(1, 1, depth);
  g.computeVertexNormals();
  return g;
}

const ellipsoid = (rx: number, ry: number, rz: number, w = 16, h = 12) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);

/** A lock of hair: a tube along the points, `r0` thick at the root, tapering to `r1`. */
function strand(points: ReadonlyArray<[number, number, number]>, r0: number, r1: number, flat = 0.6): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const tubular = 20;
  const radial = 6;
  const g = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular;
    curve.getPointAt(u, c);
    const r = r0 + (r1 - r0) * u ** 0.8;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c);
      // Flatten the cross-section front to back so locks lie on the head like real hair.
      v.z *= flat;
      v.multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Her head as one smooth shape: a fuller back of the skull, a jaw that narrows to a soft
 * chin, and a slightly forward chin. About 19 cm wide, 24 cm tall.
 */
function headGeometry(): THREE.BufferGeometry {
  const base = new THREE.SphereGeometry(1, 36, 28);
  base.deleteAttribute('uv'); // so the seam vertices merge and the normals come out smooth
  const g = mergeVertices(base);
  const p = g.attributes.position as THREE.BufferAttribute;
  const smooth = (x: number) => {
    const c = Math.max(0, Math.min(1, x));
    return c * c * (3 - 2 * c);
  };
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    const y = p.getY(i);
    let z = p.getZ(i);
    const jaw = smooth((0.05 - y) / 1.05); // 0 above the cheekbones, 1 at the chin
    x *= 1 - 0.3 * jaw;
    z *= 1 - 0.12 * jaw;
    if (z < 0) z -= 0.04 * jaw * (1 - Math.abs(x)); // chin forward a touch (front is -Z)
    if (z > 0) z *= 1.08; // fuller back of the skull
    p.setXYZ(i, x * 0.094, y * 0.12, z * 0.106);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Ribcage and chest: a lathe for the ribcage, with a soft forward swell shaped into the
 * front of the same mesh for the bust. Modest, and seamless.
 */
function chestGeometry(): THREE.BufferGeometry {
  const g = lathe([[0.122, -0.03], [0.128, 0.04], [0.132, 0.1], [0.127, 0.15], [0.102, 0.185], [0.062, 0.2], [0.042, 0.206]], 0.72, 32);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    if (z >= 0) continue; // front is -Z
    const height = Math.exp(-(((y - 0.08) / 0.045) ** 2));
    const twin = 0.55 + 0.45 * Math.exp(-(((Math.abs(x) - 0.048) / 0.034) ** 2));
    const front = Math.min(1, -z / 0.08); // fades out toward the sides
    p.setZ(i, z - 0.02 * height * twin * front);
  }
  g.computeVertexNormals();
  return g;
}

export function buildFigure(): Figure {
  const materials: THREE.MeshStandardMaterial[] = [];
  const mat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
    materials.push(m);
    return m;
  };
  const skin = mat(PALETTE.skin, { roughness: 0.6 });
  const lips = mat(PALETTE.lips, { roughness: 0.5 });
  const suit = mat(PALETTE.suit, { roughness: 0.55, metalness: 0.1 }); // a little sheen, like a fitted suit
  const boots = mat(PALETTE.boots, { roughness: 0.5, metalness: 0.15 });
  const leather = mat(PALETTE.leather, { roughness: 0.7 });
  const tunic = mat(PALETTE.tunic, { roughness: 0.75, side: THREE.DoubleSide });
  const trim = mat(PALETTE.trim, { metalness: 0.4, roughness: 0.35 });
  const hair = mat(PALETTE.hair, { roughness: 0.5, metalness: 0.1 });
  const eyeWhite = mat(PALETTE.eyeWhite, { roughness: 0.3 });
  const iris = mat(PALETTE.iris, { roughness: 0.25, emissive: PALETTE.iris, emissiveIntensity: 0.15 });
  const dark = mat(PALETTE.dark, { roughness: 0.4 });

  const root = new THREE.Group();
  const bones = {} as Record<BoneId, THREE.Bone>;
  for (const def of BONES) {
    const b = new THREE.Bone();
    b.name = def.name;
    b.position.set(...def.offset);
    bones[def.id] = b;
    (def.parent ? bones[def.parent] : root).add(b);
  }

  /** A mesh hanging off a bone, offset from the joint. */
  const part = (
    bone: BoneId,
    geo: THREE.BufferGeometry,
    m: THREE.Material,
    pos: [number, number, number] = [0, 0, 0],
    rot: [number, number, number] = [0, 0, 0],
  ) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    mesh.castShadow = true;
    bones[bone].add(mesh);
    return mesh;
  };
  /**
   * Piping that runs down a lathe-shaped limb on its surface, at `angle` around it
   * (0 = back, PI/2 = her right, PI = front), from height `from` to `to`.
   */
  const piping = (bone: BoneId, profile: Profile, depth: number, angle: number, from: number, to: number, offset: [number, number, number] = [0, 0, 0]) => {
    const radiusAt = (y: number) => {
      const pts = [...profile].sort((a, b) => b[1] - a[1]);
      for (let i = 1; i < pts.length; i++) {
        const [r0, y0] = pts[i - 1];
        const [r1, y1] = pts[i];
        if (y <= y0 && y >= y1) return r0 + ((r1 - r0) * (y0 - y)) / (y0 - y1);
      }
      return pts[pts.length - 1][0];
    };
    const points: Array<[number, number, number]> = [];
    for (let i = 0; i <= 8; i++) {
      const y = from + ((to - from) * i) / 8;
      const r = radiusAt(y) + 0.002;
      points.push([Math.sin(angle) * r + offset[0], y + offset[1], Math.cos(angle) * r * depth + offset[2]]);
    }
    return part(bone, strand(points, 0.0035, 0.0035, 1), trim);
  };

  // ------------------------------------------------------------------ torso
  // Pelvis in the bodysuit (seen when the skirt lifts), rounded at the back.
  part('hips', lathe([[0.001, -0.13], [0.09, -0.125], [0.14, -0.09], [0.15, -0.04], [0.142, 0.02], [0.118, 0.065]], 0.72), suit);
  for (const x of [-0.06, 0.06]) part('hips', ellipsoid(0.072, 0.068, 0.058), suit, [x, -0.06, 0.04]);

  // Waist: the tunic narrows here, then flares into the skirt below the sash.
  part('spine', lathe([[0.112, -0.04], [0.098, 0.03], [0.1, 0.1], [0.115, 0.17], [0.122, 0.2]], 0.74), tunic);
  // Sash with a knot and a tail at her left hip.
  part('hips', lathe([[0.122, 0.05], [0.126, 0.075], [0.12, 0.1]], 0.76), trim);
  part('hips', ellipsoid(0.024, 0.019, 0.016), trim, [-0.095, 0.075, -0.066]);
  part('hips', new THREE.BoxGeometry(0.016, 0.1, 0.005), trim, [-0.1, 0.015, -0.07], [0.05, 0, 0.12]);

  // Chest, and a round collar.
  part('chest', chestGeometry(), tunic);
  part('chest', new THREE.TorusGeometry(0.046, 0.007, 6, 20).scale(1, 0.85, 1), trim, [0, 0.198, -0.002], [Math.PI / 2, 0, 0]);
  // Shoulders in the bodysuit, and a single leather pauldron on the left (off-hand) side.
  for (const side of ['L', 'R'] as const) {
    part(`shoulder${side}`, ellipsoid(0.044, 0.04, 0.043), suit, [side === 'L' ? -0.085 : 0.085, -0.012, 0]);
  }
  part('upperArmL', new THREE.SphereGeometry(0.062, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.75, 1), leather, [-0.004, 0.012, 0], [0, 0, 0.35]);
  part('upperArmL', lathe([[0.058, 0.005], [0.058, -0.003]]), trim, [-0.004, 0.012, 0], [0, 0, 0.35]);

  // ------------------------------------------------------------------ skirt
  // Four panels hinged at the waist (front, back, left, right), each a quarter cone with
  // a little overlap. updateCloth() swings them with her thighs.
  const skirt: Record<'front' | 'back' | 'left' | 'right', THREE.Group> = {
    back: skirtPanel(0),
    right: skirtPanel(Math.PI / 2),
    front: skirtPanel(Math.PI),
    left: skirtPanel(-Math.PI / 2),
  };
  function skirtPanel(center: number): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.y = 0.06;
    // Side panels sit a hair inside the front and back ones, so the overlaps layer instead of flickering.
    const k = Math.abs(Math.sin(center)) > 0.5 ? 0.985 : 1;
    const arc = (r0: number, r1: number, h: number, y: number) =>
      new THREE.CylinderGeometry(r0 * k, r1 * k, h, 8, 1, true, center - 0.95, 1.9).translate(0, y, 0).scale(1, 1, 0.78);
    const mesh = new THREE.Mesh(arc(0.14, 0.205, 0.28, -0.14), tunic);
    mesh.castShadow = true;
    pivot.add(mesh, new THREE.Mesh(arc(0.207, 0.207, 0.014, -0.277), trim)); // hem piping
    bones.hips.add(pivot);
    return pivot;
  }

  // ------------------------------------------------------------------ head
  // Slender neck with a choker band.
  part('neck', lathe([[0.043, -0.01], [0.036, 0.05], [0.038, 0.1], [0.042, 0.13]], 0.9), skin);
  part('neck', lathe([[0.038, 0.03], [0.038, 0.048]], 0.9), trim);

  const C = 0.12; // head center height above the head joint
  part('head', headGeometry(), skin, [0, C, 0.004]);
  // Nose: a soft ridge and tip. Lips: a little fuller below.
  part('head', ellipsoid(0.0055, 0.016, 0.0075), skin, [0, C - 0.014, -0.1005], [-0.4, 0, 0]);
  part('head', ellipsoid(0.0105, 0.0026, 0.0028), lips, [0, C - 0.046, -0.0925]);
  part('head', ellipsoid(0.0095, 0.0034, 0.003), lips, [0, C - 0.0525, -0.0905]);
  // Eyes: white, indigo iris, dark pupil, a lash line that flicks out at the outer corner.
  for (const out of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(out * 0.034, C + 0.004, -0.0925);
    eye.rotation.y = -out * 0.32; // the face curves away, so each eye turns with it
    bones.head.add(eye);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, p: [number, number, number], r: [number, number, number] = [0, 0, 0]) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(...p);
      mesh.rotation.set(...r);
      eye.add(mesh);
    };
    add(ellipsoid(0.0145, 0.0085, 0.004), eyeWhite, [0, 0, 0]);
    add(new THREE.CircleGeometry(0.0068, 18), iris, [0, -0.0005, -0.0042], [0, Math.PI, 0]);
    add(new THREE.CircleGeometry(0.0031, 14), dark, [0, -0.0005, -0.0044], [0, Math.PI, 0]);
    add(new THREE.BoxGeometry(0.031, 0.0032, 0.004), dark, [0, 0.0083, -0.002], [0, 0, -out * 0.08]); // upper lash line
    add(new THREE.BoxGeometry(0.008, 0.0026, 0.004), dark, [out * 0.017, 0.0068, -0.001], [0, 0, out * 0.5]); // wing
    add(new THREE.BoxGeometry(0.027, 0.003, 0.004), hair, [out * 0.002, 0.024, 0.002], [0.15, 0, -out * 0.1]); // brow, gently arched
  }

  // Hair: volume over the crown and back, pulled up into the high ponytail; the lower back
  // and sides cover the ears. Then strands: a side-swept fringe and two long face-framing
  // locks from the temples to below the jaw.
  const cap = part('head', new THREE.SphereGeometry(1, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.58), hair, [0, C + 0.008, 0.012]);
  cap.scale.set(0.104, 0.13, 0.124);
  cap.rotation.x = 0.5;
  part('head', ellipsoid(0.102, 0.1, 0.104, 24, 16), hair, [0, C - 0.02, 0.04]);
  part('head', ellipsoid(0.034, 0.03, 0.038), hair, [0, 0.212, 0.078], [0.6, 0, 0]); // gathered at the tie
  part('head', new THREE.TorusGeometry(0.027, 0.01, 8, 16), trim, [0, 0.213, 0.086], [0.6, 0, 0]); // tie
  // Fringe: thin locks from the hairline, lying on the forehead, swept toward her right.
  const jitter = [0.4, -0.7, 0.9, -0.2, 0.6, -0.9, 0.1, 0.8, -0.5]; // fixed, so she looks the same every load
  for (let i = 0; i < 9; i++) {
    const x = -0.055 + i * 0.013 + jitter[i] * 0.003;
    const reach = 0.03 + 0.02 * Math.sin((i / 8) * Math.PI) + jitter[(i + 3) % 9] * 0.008;
    const drop = 0.04 + 0.014 * Math.sin((i / 8) * Math.PI) + jitter[(i + 5) % 9] * 0.007; // longest in the middle
    part('head', strand([[x - 0.006, C + 0.1, -0.07], [x + 0.004, C + 0.08, -0.098], [x + reach * 0.55, C + 0.1 - drop * 0.8, -0.106], [x + reach, C + 0.1 - drop - 0.02, -0.101]], 0.0075, 0.0015, 0.4), hair);
  }
  for (const out of [-1, 1]) {
    // Face-framing locks: down past the cheek, curling in under the jaw.
    part('head', strand([[out * 0.07, C + 0.08, -0.07], [out * 0.088, C + 0.02, -0.074], [out * 0.084, C - 0.05, -0.062], [out * 0.068, C - 0.1, -0.05]], 0.01, 0.002, 0.5), hair);
    part('head', strand([[out * 0.08, C + 0.07, -0.055], [out * 0.096, C + 0.0, -0.05], [out * 0.09, C - 0.07, -0.04]], 0.009, 0.002, 0.5), hair);
  }

  // ------------------------------------------------------------------ arms
  for (const side of ['L', 'R'] as const) {
    const out = side === 'R' ? 1 : -1;
    const upperArm: Profile = [[0.04, 0.01], [0.043, -0.05], [0.04, -0.12], [0.034, -0.22], [0.031, -0.27]];
    part(`upperArm${side}`, lathe(upperArm, 0.92), suit);
    piping(`upperArm${side}`, upperArm, 0.92, (out * Math.PI) / 2, -0.03, -0.25);
    part(`forearm${side}`, ellipsoid(0.031, 0.031, 0.031), suit); // elbow
    part(`forearm${side}`, lathe([[0.031, 0], [0.034, -0.05], [0.03, -0.11], [0.023, -0.23]], 0.85), suit);
    // Leather bracer with trim edges, from mid forearm to the wrist.
    part(`forearm${side}`, lathe([[0.034, -0.095], [0.033, -0.16], [0.027, -0.225]], 0.88), leather);
    part(`forearm${side}`, lathe([[0.036, -0.09], [0.036, -0.1]], 0.88), trim);
    part(`forearm${side}`, lathe([[0.029, -0.218], [0.029, -0.228]], 0.88), trim);

    // Gloved hand: palm, four curled fingers around the grip axis, and a thumb.
    part(`hand${side}`, new THREE.BoxGeometry(0.047, 0.06, 0.028), suit, [0, -0.034, 0]);
    for (let f = 0; f < 4; f++) {
      const z = -0.016 + f * 0.011;
      part(`hand${side}`, new THREE.CapsuleGeometry(0.0082, 0.025 - Math.abs(f - 1.5) * 0.003, 3, 6), suit, [out * 0.006, -0.07, z], [0, 0, Math.PI / 2]);
    }
    part(`hand${side}`, new THREE.CapsuleGeometry(0.0085, 0.022, 3, 6), suit, [-out * 0.021, -0.048, -0.012], [0.5, 0, 0]);
  }

  // ------------------------------------------------------------------ legs
  for (const side of ['L', 'R'] as const) {
    const out = side === 'R' ? 1 : -1;
    // Full at the top, tapering into the knee. The top tucks in under the hips so it
    // never pushes through the skirt's side panels.
    const thigh: Profile = [[0.048, 0.02], [0.066, -0.02], [0.073, -0.07], [0.07, -0.13], [0.059, -0.26], [0.048, -0.37], [0.043, -0.44]];
    part(`thigh${side}`, lathe(thigh, 0.95), suit, [-out * 0.008, 0, 0]);
    piping(`thigh${side}`, thigh, 0.95, (out * Math.PI) / 2, -0.09, -0.41, [-out * 0.008, 0, 0]);
    part(`shin${side}`, ellipsoid(0.044, 0.048, 0.046), suit); // knee
    part(`shin${side}`, ellipsoid(0.034, 0.042, 0.016), leather, [0, 0.008, -0.044], [-0.15, 0, 0]); // knee guard
    part(`shin${side}`, lathe([[0.043, 0], [0.044, -0.06]], 0.95), suit);
    // Knee boot: the calf swells at the back, then slims to the ankle; a plate down the shin.
    const boot: Profile = [[0.048, -0.05], [0.051, -0.12], [0.045, -0.2], [0.034, -0.33], [0.031, -0.43]];
    part(`shin${side}`, lathe(boot, 0.92), boots, [0, 0, 0.006]);
    part(`shin${side}`, lathe([[0.052, -0.045], [0.052, -0.058]], 0.92), trim); // boot cuff
    piping(`shin${side}`, boot, 0.92, Math.PI, -0.07, -0.4, [0, 0, 0.006]); // seam down the front

    // Boot foot: heel, a rounded vamp narrowing to the toe, flat sole at the floor.
    part(`foot${side}`, new THREE.BoxGeometry(0.056, 0.05, 0.064), boots, [0, -0.04, 0.018]);
    part(`foot${side}`, ellipsoid(0.034, 0.03, 0.094), boots, [0, -0.042, -0.06]);
    part(`foot${side}`, new THREE.BoxGeometry(0.056, 0.012, 0.18), boots, [0, -0.064, -0.04]); // sole, flush with the boot
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
  const steelTrim = mat(COLORS.indigoLight, { metalness: 0.6, roughness: 0.3 });
  swordPart(new THREE.BoxGeometry(0.032, 0.036, 0.24), mat(PALETTE.grip, { roughness: 0.9 }), 0.02);
  swordPart(new THREE.CylinderGeometry(0.022, 0.022, 0.016, 12).rotateX(Math.PI / 2), steelTrim, 0.145); // pommel
  swordPart(new THREE.CylinderGeometry(0.042, 0.042, 0.01, 16).rotateX(Math.PI / 2).scale(1, 0.8, 1), steelTrim, -0.105); // tsuba
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
