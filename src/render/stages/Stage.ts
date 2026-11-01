import type * as THREE from 'three';
import type { ArenaLayout } from '../../app/arena';

/**
 * One look for the arena: meshes, lights, sky and the few renderer settings that go with
 * them. ArenaView adds `root` to the scene and applies the rest; switching stages disposes
 * the old one. Every stage draws the same ArenaLayout, so meshes line up with the colliders.
 */
export interface BuiltStage {
  /** Meshes and lights. */
  root: THREE.Group;
  /** Flat background color, or null when the stage draws its own sky. */
  background: THREE.Color | null;
  fog: THREE.Fog;
  exposure: number;
  /** Bloom tuned per stage: a sunlit floor is brighter than anything in the void. */
  bloom: { strength: number; threshold: number };
  /** Sky only, for image based lighting. ArenaView turns it into scene.environment. */
  envScene: THREE.Scene | null;
  envIntensity: number;
  /** Average brightness (luma) of that sky, for lighting her unlit eyes (faceLight.ts). */
  envLuma: number;
  /** Wind and clouds, on real seconds. */
  update(time: number): void;
  dispose(): void;
}

export interface StageOptions {
  reducedMotion: boolean;
}

export type StageBuilder = (layout: ArenaLayout, opts: StageOptions) => BuiltStage;
