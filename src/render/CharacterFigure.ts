import * as THREE from 'three';
import { BONES, type BoneId } from '../character/rig';
import { COLORS } from './ArenaView';

/**
 * Placeholder rigged character built in code: real three.js bones (Mixamo names, from
 * src/character/rig.ts) with simple rigid meshes attached. Swap for a skinned glTF later;
 * the clips and the sword socket keep working as long as the bone names match.
 */
export interface Figure {
  /** Holds the hips bone. The AnimationMixer runs on this. */
  root: THREE.Group;
  bones: Record<BoneId, THREE.Bone>;
  blade: THREE.Mesh;
  /** Materials that fade and glow for the Phantom Dash dissolve. */
  materials: THREE.MeshStandardMaterial[];
}

const PALETTE = {
  skin: COLORS.skin, // zinc-200, stylized
  suit: 0x27272a, // zinc-800 bodysuit
  boots: 0x18181b, // zinc-900
  tunic: 0x312e81, // indigo-900
  trim: COLORS.indigoLight, // indigo-400
  hair: 0x101014,
  blade: 0xd4d4d8,
  grip: 0x18181b,
};

export function buildFigure(): Figure {
  const materials: THREE.MeshStandardMaterial[] = [];
  const mat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
    materials.push(m);
    return m;
  };
  const skin = mat(PALETTE.skin, { roughness: 0.55 });
  const suit = mat(PALETTE.suit, { roughness: 0.8 });
  const boots = mat(PALETTE.boots, { roughness: 0.7 });
  const tunic = mat(PALETTE.tunic, { roughness: 0.75, side: THREE.DoubleSide });
  const trim = mat(PALETTE.trim, { metalness: 0.4, roughness: 0.35 });
  const hair = mat(PALETTE.hair, { roughness: 0.45, metalness: 0.1 });

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
  const part = (bone: BoneId, geo: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1]) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(...pos);
    mesh.scale.set(...scale);
    mesh.castShadow = true;
    bones[bone].add(mesh);
    return mesh;
  };
  const capsule = (r: number, length: number) => new THREE.CapsuleGeometry(r, length, 6, 12);

  // Torso: narrow waist, wider hips and chest.
  part('hips', capsule(0.12, 0.08), suit, [0, 0.0, 0], [1.4, 1, 0.9]);
  part('spine', capsule(0.1, 0.1), suit, [0, 0.08, 0], [1.15, 1, 0.85]);
  part('chest', capsule(0.12, 0.12), suit, [0, 0.1, 0], [1.3, 1, 0.85]);
  // Tunic: a short flared skirt from the waist to mid thigh, a sash, and a vest over the chest.
  part('hips', new THREE.CylinderGeometry(0.17, 0.25, 0.34, 20, 1, true), tunic, [0, -0.1, 0], [1, 1, 0.82]);
  part('hips', new THREE.CylinderGeometry(0.172, 0.172, 0.045, 20), trim, [0, 0.07, 0], [1, 1, 0.82]);
  part('chest', capsule(0.128, 0.1), tunic, [0, 0.09, 0], [1.32, 1, 0.9]);

  // Head and hair.
  part('neck', new THREE.CylinderGeometry(0.04, 0.045, 0.12, 10), skin, [0, 0.04, 0]);
  part('head', new THREE.SphereGeometry(0.105, 20, 14), skin, [0, 0.11, 0], [0.92, 1.08, 1]);
  // Hair cap: the top of a sphere, tilted back so it covers the crown and back, not the face.
  const cap = part('head', new THREE.SphereGeometry(0.115, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, [0, 0.12, 0.012], [0.95, 1.08, 1.04]);
  cap.rotation.x = 0.55;
  part('head', new THREE.TorusGeometry(0.025, 0.012, 8, 16), trim, [0, 0.17, 0.095]); // hair tie at the ponytail socket

  // Arms.
  for (const side of ['L', 'R'] as const) {
    part(`upperArm${side}`, capsule(0.042, 0.2), suit, [0, -0.135, 0]);
    part(`forearm${side}`, capsule(0.036, 0.18), skin, [0, -0.12, 0]);
    part(`hand${side}`, new THREE.BoxGeometry(0.055, 0.085, 0.035), skin, [0, -0.045, 0]);
    part(`shoulder${side}`, new THREE.SphereGeometry(0.055, 12, 8), suit, [side === 'L' ? -0.1 : 0.1, 0, 0]);
    // Legs.
    part(`thigh${side}`, capsule(0.065, 0.28), suit, [0, -0.2, 0]);
    part(`shin${side}`, capsule(0.05, 0.3), boots, [0, -0.2, 0]);
    part(`foot${side}`, new THREE.BoxGeometry(0.08, 0.06, 0.2), boots, [0, -0.04, -0.05]);
  }

  // Katana in the right hand. The blade points along the hand's -Z (see clips.ts).
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
  swordPart(new THREE.BoxGeometry(0.035, 0.035, 0.24), mat(PALETTE.grip, { roughness: 0.9 }), 0.02);
  swordPart(new THREE.BoxGeometry(0.1, 0.02, 0.02), mat(COLORS.indigoLight, { metalness: 0.6, roughness: 0.3 }), -0.11);
  // Brushed rather than mirror steel: a mirror-flat face can catch the key light head-on
  // and blow out into a bloom halo that reads like an effect.
  const blade = swordPart(new THREE.BoxGeometry(0.022, 0.05, 0.95), mat(PALETTE.blade, { metalness: 0.6, roughness: 0.45 }), -0.11 - 0.475);

  return { root, bones, blade, materials };
}
