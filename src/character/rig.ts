/**
 * Placeholder character rig as plain data: bone hierarchy and proportions (meters).
 * The render layer builds three.js bones from this, and clips.ts animates these bones.
 *
 * Bone names follow Mixamo's, so a real rigged model (glTF from Mixamo or similar) can
 * replace the placeholder without renaming tracks.
 *
 * Local space matches the rest of the game: facing -Z, +X is her right, +Y up.
 * At rest every bone has zero rotation: standing straight, arms hanging down.
 */

export type BoneId =
  | 'hips' | 'spine' | 'chest' | 'neck' | 'head'
  | 'shoulderL' | 'upperArmL' | 'forearmL' | 'handL'
  | 'shoulderR' | 'upperArmR' | 'forearmR' | 'handR'
  | 'thighL' | 'shinL' | 'footL'
  | 'thighR' | 'shinR' | 'footR';

export interface BoneDef {
  id: BoneId;
  name: string; // Mixamo name
  parent: BoneId | null;
  /** Joint position relative to the parent joint. */
  offset: [number, number, number];
}

/**
 * Heroic proportions (think action-game leads): about 7.5 heads tall, long legs (hips at
 * 55% of her height), narrow shoulders, a slender neck. Hips height = thigh joint drop +
 * thigh + shin + ankle to sole.
 */
export const HIPS_HEIGHT = 0.04 + 0.44 + 0.43 + 0.07;

export const BONES: readonly BoneDef[] = [
  { id: 'hips', name: 'mixamorigHips', parent: null, offset: [0, HIPS_HEIGHT, 0] },
  { id: 'spine', name: 'mixamorigSpine', parent: 'hips', offset: [0, 0.1, 0] },
  { id: 'chest', name: 'mixamorigSpine2', parent: 'spine', offset: [0, 0.18, 0] },
  { id: 'neck', name: 'mixamorigNeck', parent: 'chest', offset: [0, 0.19, 0] },
  { id: 'head', name: 'mixamorigHead', parent: 'neck', offset: [0, 0.08, 0] },

  { id: 'shoulderL', name: 'mixamorigLeftShoulder', parent: 'chest', offset: [-0.055, 0.145, 0] },
  { id: 'upperArmL', name: 'mixamorigLeftArm', parent: 'shoulderL', offset: [-0.11, 0, 0] },
  { id: 'forearmL', name: 'mixamorigLeftForeArm', parent: 'upperArmL', offset: [0, -0.27, 0] },
  { id: 'handL', name: 'mixamorigLeftHand', parent: 'forearmL', offset: [0, -0.235, 0] },

  { id: 'shoulderR', name: 'mixamorigRightShoulder', parent: 'chest', offset: [0.055, 0.145, 0] },
  { id: 'upperArmR', name: 'mixamorigRightArm', parent: 'shoulderR', offset: [0.11, 0, 0] },
  { id: 'forearmR', name: 'mixamorigRightForeArm', parent: 'upperArmR', offset: [0, -0.27, 0] },
  { id: 'handR', name: 'mixamorigRightHand', parent: 'forearmR', offset: [0, -0.235, 0] },

  { id: 'thighL', name: 'mixamorigLeftUpLeg', parent: 'hips', offset: [-0.09, -0.04, 0] },
  { id: 'shinL', name: 'mixamorigLeftLeg', parent: 'thighL', offset: [0, -0.44, 0] },
  { id: 'footL', name: 'mixamorigLeftFoot', parent: 'shinL', offset: [0, -0.43, 0] },

  { id: 'thighR', name: 'mixamorigRightUpLeg', parent: 'hips', offset: [0.09, -0.04, 0] },
  { id: 'shinR', name: 'mixamorigRightLeg', parent: 'thighR', offset: [0, -0.44, 0] },
  { id: 'footR', name: 'mixamorigRightFoot', parent: 'shinR', offset: [0, -0.43, 0] },
];

export const BONE_IDS: readonly BoneId[] = BONES.map((b) => b.id);

