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
 * Shapes are lathe profiles (radius by height, revolved, then flattened front to back),
 * so limbs taper the way real ones do: full thighs into the knee, a calf that swells at
 * the back, a narrow waist between the ribcage and the hips. Her outfit: dark bodysuit
 * and leggings, an indigo tunic over it (chest to mid thigh, with a sash), knee boots and
 * leather bracers. Feminine, and modest: the tunic covers the chest and hips.
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
  skin: COLORS.skin, // zinc-200, stylized
  suit: 0x27272a, // zinc-800 bodysuit and leggings
  boots: 0x18181b, // zinc-900
  leather: 0x3f3f46, // zinc-700 bracers
  tunic: 0x312e81, // indigo-900
  trim: COLORS.indigoLight, // indigo-400
  hair: 0x101014,
  features: 0x3f3f46, // zinc-700: brows, eyes
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

/**
 * Her head as one smooth shape (no seams): a sphere with a fuller back of the skull, a jaw
 * that narrows toward a soft chin, and a slightly forward chin. Unit radii are scaled to
 * about 18 cm wide, 22 cm tall.
 */
function headGeometry(): THREE.BufferGeometry {
  const base = new THREE.SphereGeometry(1, 32, 24);
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
    x *= 1 - 0.28 * jaw;
    z *= 1 - 0.12 * jaw;
    if (z < 0) z -= 0.04 * jaw * (1 - Math.abs(x)); // chin forward a touch (front is -Z)
    if (z > 0) z *= 1.07; // fuller back of the skull
    p.setXYZ(i, x * 0.088, y * 0.112, z * 0.1);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Ribcage and chest under the tunic: a lathe for the ribcage, with a soft forward swell
 * shaped into the front of the same mesh for the bust. Modest, and seamless.
 */
function chestGeometry(): THREE.BufferGeometry {
  const g = lathe([[0.128, -0.03], [0.135, 0.04], [0.14, 0.1], [0.137, 0.15], [0.112, 0.19], [0.07, 0.212], [0.048, 0.22]], 0.72, 32);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    if (z >= 0) continue; // front is -Z
    const height = Math.exp(-(((y - 0.085) / 0.045) ** 2));
    const twin = 0.55 + 0.45 * Math.exp(-(((Math.abs(x) - 0.05) / 0.035) ** 2));
    const front = Math.min(1, -z / 0.08); // fades out toward the sides
    p.setZ(i, z - 0.02 * height * twin * front);
  }
  g.computeVertexNormals();
  return g;
}

const ellipsoid = (rx: number, ry: number, rz: number, w = 16, h = 12) => new THREE.SphereGeometry(1, w, h).scale(rx, ry, rz);

export function buildFigure(): Figure {
  const materials: THREE.MeshStandardMaterial[] = [];
  const mat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
    materials.push(m);
    return m;
  };
  const skin = mat(PALETTE.skin, { roughness: 0.55 });
  const suit = mat(PALETTE.suit, { roughness: 0.8 });
  const boots = mat(PALETTE.boots, { roughness: 0.65 });
  const leather = mat(PALETTE.leather, { roughness: 0.7 });
  const tunic = mat(PALETTE.tunic, { roughness: 0.75, side: THREE.DoubleSide });
  const trim = mat(PALETTE.trim, { metalness: 0.4, roughness: 0.35 });
  const hair = mat(PALETTE.hair, { roughness: 0.6, metalness: 0.05 });
  const features = mat(PALETTE.features, { roughness: 0.5 });

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

  // ------------------------------------------------------------------ torso
  // Pelvis in the bodysuit (seen only when the skirt lifts), rounded at the back.
  part('hips', lathe([[0.001, -0.13], [0.09, -0.125], [0.14, -0.09], [0.15, -0.04], [0.142, 0.02], [0.12, 0.065]], 0.72), suit);
  for (const x of [-0.062, 0.062]) part('hips', ellipsoid(0.074, 0.07, 0.06), suit, [x, -0.06, 0.04]);

  // Waist: the tunic narrows here, then flares into the skirt below the sash.
  part('spine', lathe([[0.118, -0.04], [0.108, 0.03], [0.11, 0.1], [0.124, 0.17], [0.13, 0.2]], 0.74), tunic);
  // Sash with a knot at her left hip.
  part('hips', lathe([[0.128, 0.05], [0.131, 0.075], [0.125, 0.1]], 0.76), trim);
  part('hips', ellipsoid(0.026, 0.02, 0.018), trim, [-0.1, 0.075, -0.07]);
  part('hips', new THREE.BoxGeometry(0.018, 0.08, 0.006), trim, [-0.105, 0.025, -0.075], [0, 0, 0.15]);

  // Ribcage and chest, tunic over the bodysuit. A modest bust shaped into the tunic.
  part('chest', chestGeometry(), tunic);
  // Round collar where the tunic meets the bodysuit.
  part('chest', new THREE.TorusGeometry(0.055, 0.008, 6, 20).scale(1, 0.8, 1), trim, [0, 0.205, -0.004], [Math.PI / 2, 0, 0]);
  // Shoulders in the bodysuit.
  for (const side of ['L', 'R'] as const) {
    part(`shoulder${side}`, ellipsoid(0.047, 0.042, 0.046), suit, [side === 'L' ? -0.092 : 0.092, -0.012, 0]);
  }

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
    const geo = new THREE.CylinderGeometry(0.14 * k, 0.21 * k, 0.3, 8, 1, true, center - 0.95, 1.9).translate(0, -0.15, 0);
    geo.scale(1, 1, 0.78);
    const mesh = new THREE.Mesh(geo, tunic);
    mesh.castShadow = true;
    pivot.add(mesh);
    // Trim along the hem.
    const hem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.212 * k, 0.212 * k, 0.014, 8, 1, true, center - 0.95, 1.9).translate(0, -0.297, 0).scale(1, 1, 0.78),
      trim,
    );
    pivot.add(hem);
    bones.hips.add(pivot);
    return pivot;
  }

  // ------------------------------------------------------------------ head
  part('neck', lathe([[0.048, -0.01], [0.043, 0.06], [0.048, 0.12]], 0.92), skin);
  // Egg-shaped cranium, with a narrower jaw and a soft pointed chin in front of it.
  part('head', headGeometry(), skin, [0, 0.115, 0.004]);
  part('head', ellipsoid(0.0065, 0.016, 0.008), skin, [0, 0.105, -0.095], [-0.45, 0, 0]); // nose: a soft ridge
  for (const x of [-0.085, 0.085]) part('head', ellipsoid(0.008, 0.018, 0.013), skin, [x, 0.112, 0.01]); // ears
  for (const x of [-0.031, 0.031]) {
    const out = x > 0 ? 1 : -1;
    part('head', ellipsoid(0.013, 0.006, 0.005), features, [x, 0.123, -0.088], [0, 0, out * 0.1]); // eyes, tilted up at the outer corner
    part('head', new THREE.BoxGeometry(0.024, 0.0035, 0.005), features, [x + out * 0.002, 0.141, -0.087], [0.15, 0, -out * 0.08]); // brows, soft arch
  }

  // Hair: a cap over the crown and back (tilted back so the face stays clear), swept bangs
  // and two locks framing her face. The braid hangs from the tie at the back.
  const cap = part('head', new THREE.SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.56), hair, [0, 0.122, 0.012]);
  cap.scale.set(0.095, 0.119, 0.114);
  cap.rotation.x = 0.55;
  // A fringe swept to her right, lying on the forehead rather than standing off it.
  part('head', ellipsoid(0.046, 0.024, 0.007), hair, [-0.02, 0.168, -0.08], [-0.2, 0, 0.55]);
  part('head', ellipsoid(0.03, 0.018, 0.006), hair, [0.034, 0.172, -0.077], [-0.2, 0, -0.35]);
  part('head', new THREE.TorusGeometry(0.026, 0.011, 8, 16), trim, [0, 0.17, 0.092]); // hair tie at the braid

  // ------------------------------------------------------------------ arms
  for (const side of ['L', 'R'] as const) {
    part(`upperArm${side}`, lathe([[0.042, 0.01], [0.046, -0.05], [0.043, -0.12], [0.037, -0.22], [0.034, -0.27]], 0.92), suit);
    part(`forearm${side}`, ellipsoid(0.034, 0.034, 0.034), suit); // elbow
    part(`forearm${side}`, lathe([[0.037, 0.012], [0.037, -0.022]], 0.88), suit); // sleeve cuff
    part(`forearm${side}`, lathe([[0.033, 0], [0.036, -0.05], [0.032, -0.11], [0.025, -0.235]], 0.85), skin);
    part(`forearm${side}`, lathe([[0.036, -0.1], [0.035, -0.16], [0.029, -0.225]], 0.88), leather); // bracer
    part(`forearm${side}`, lathe([[0.038, -0.095], [0.038, -0.105]], 0.88), trim);

    // Hand: palm, four curled fingers around the grip axis, and a thumb.
    const s = side === 'R' ? 1 : -1;
    part(`hand${side}`, new THREE.BoxGeometry(0.05, 0.062, 0.03), skin, [0, -0.035, 0]);
    for (let f = 0; f < 4; f++) {
      const z = -0.017 + f * 0.0115;
      part(`hand${side}`, new THREE.CapsuleGeometry(0.0085, 0.026 - Math.abs(f - 1.5) * 0.003, 3, 6), skin, [s * 0.006, -0.072, z], [0, 0, Math.PI / 2]);
    }
    part(`hand${side}`, new THREE.CapsuleGeometry(0.009, 0.024, 3, 6), skin, [-s * 0.022, -0.05, -0.012], [0.5, 0, 0]);
  }

  // ------------------------------------------------------------------ legs
  for (const side of ['L', 'R'] as const) {
    // Full at the top, tapering into the knee. The top tucks in under the hips so it never
    // pushes through the skirt's side panels.
    part(`thigh${side}`, lathe([[0.05, 0.02], [0.068, -0.02], [0.075, -0.07], [0.072, -0.13], [0.061, -0.25], [0.05, -0.36], [0.045, -0.42]], 0.95), suit, [side === 'L' ? 0.008 : -0.008, 0, 0]);
    part(`shin${side}`, ellipsoid(0.046, 0.05, 0.048), suit); // knee
    part(`shin${side}`, lathe([[0.045, 0], [0.046, -0.06]], 0.95), suit);
    // Knee boot: the calf swells at the back, then slims to the ankle.
    part(`shin${side}`, lathe([[0.05, -0.05], [0.053, -0.12], [0.047, -0.2], [0.036, -0.32], [0.033, -0.42]], 0.92), boots, [0, 0, 0.006]);
    part(`shin${side}`, lathe([[0.054, -0.045], [0.054, -0.058]], 0.92), trim); // boot cuff

    // Boot foot: heel, a rounded vamp that narrows to the toe, flat sole at the floor.
    part(`foot${side}`, new THREE.BoxGeometry(0.066, 0.05, 0.07), boots, [0, -0.04, 0.02]);
    part(`foot${side}`, ellipsoid(0.038, 0.032, 0.095), boots, [0, -0.04, -0.06]);
    part(`foot${side}`, new THREE.BoxGeometry(0.07, 0.016, 0.2), leather, [0, -0.062, -0.045]);
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
