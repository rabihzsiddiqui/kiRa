import * as THREE from 'three';
import type { BuiltStage } from './Stage';

/** Eyes never go fully black, and never brighter than their painted colors. */
const MIN = 0.12;
const MAX = 1;

const luma = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * How brightly her painted eyes should show, for a face pointing along `normal` (world,
 * unit). The face shader is unlit, so this stands in for lighting: the same sum three.js
 * makes for a diffuse surface (hemisphere + ambient + direct lights by angle + the sky's
 * image based light), divided by pi. A white surface would show about that bright, so the
 * eye whites sit with her skin: lit when she faces the sun, dim in shade and in the void.
 * Point lights (the dusk braziers) are left out; they are small at her distance.
 */
export function faceLighting(stage: BuiltStage): (normal: THREE.Vector3) => number {
  const hemis: THREE.HemisphereLight[] = [];
  const ambient: THREE.AmbientLight[] = [];
  const directional: Array<{ dir: THREE.Vector3; amount: number }> = [];
  stage.root.updateMatrixWorld(true);
  stage.root.traverse((o) => {
    if ((o as THREE.HemisphereLight).isHemisphereLight) hemis.push(o as THREE.HemisphereLight);
    else if ((o as THREE.AmbientLight).isAmbientLight) ambient.push(o as THREE.AmbientLight);
    else if ((o as THREE.DirectionalLight).isDirectionalLight) {
      const l = o as THREE.DirectionalLight;
      const dir = l.getWorldPosition(new THREE.Vector3()).sub(l.target.getWorldPosition(new THREE.Vector3())).normalize();
      directional.push({ dir, amount: luma(l.color) * l.intensity });
    }
  });
  // Lights don't move within a stage, so everything but the angles is summed once.
  const flat = ambient.reduce((sum, a) => sum + luma(a.color) * a.intensity, 0) + Math.PI * stage.envLuma * stage.envIntensity;
  const hemi = hemis.map((h) => ({ sky: luma(h.color) * h.intensity, ground: luma(h.groundColor) * h.intensity }));

  return (n) => {
    let e = flat;
    const up = 0.5 * n.y + 0.5; // hemisphere lights point straight up here
    for (const h of hemi) e += h.ground + (h.sky - h.ground) * up;
    for (const d of directional) e += d.amount * Math.max(0, n.dot(d.dir));
    return Math.min(MAX, Math.max(MIN, e / Math.PI));
  };
}
