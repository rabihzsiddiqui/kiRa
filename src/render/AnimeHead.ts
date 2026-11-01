import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/*
 * Her head: "Anime head" by DaGreen, CC-BY-4.0
 * (https://sketchfab.com/3d-models/anime-head-fe08e8a406764f81863ba4bba629f608).
 * One textured mesh, no hair: that gets built on top of it.
 *
 * The file lives in public/models and loads after the figure is built. Until then the
 * head mesh has an empty geometry and draws nothing. Without a DOM (headless tests) it
 * never loads at all.
 */

/** Relative to the page, so it works at any base path (index.html and gallery.html). */
const MODEL_PATH = 'models/anime_head.glb';

/*
 * Where the model sits in head-bone space (x = her right, y = up, her face looks down -Z,
 * meters). Measured from the file: its chin is at y -1.80, its crown at 3.79, its face
 * looks down +Z and its neck stump is centered at z -0.86. Anime proportions: 0.28 m chin
 * to crown (about 6.3 heads tall, the realistic head was 0.22), sunk so the chin sits
 * just under the head joint and just above the collar, which keeps the neck short.
 */
const MODEL_CHIN = -1.8;
const MODEL_CROWN = 3.79;
const MODEL_NECK_Z = -0.86;
/** Chin and crown height above the head bone. */
export const HEAD_CHIN = -0.025;
export const HEAD_CROWN = 0.255;

/** Bakes the placement into the model's geometry (in place). */
export function placeAnimeHead(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const s = (HEAD_CROWN - HEAD_CHIN) / (MODEL_CROWN - MODEL_CHIN);
  geometry.rotateY(Math.PI); // face +Z -> -Z
  geometry.scale(s, s, s);
  geometry.translate(0, HEAD_CHIN - MODEL_CHIN * s, MODEL_NECK_Z * s); // neck stump over the neck bone
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

interface HeadAsset {
  geometry: THREE.BufferGeometry;
  map: THREE.Texture | null;
}

/** Loaded once, shared by every figure (the gallery builds many). */
let asset: Promise<HeadAsset> | null = null;

function loadAsset(): Promise<HeadAsset> {
  asset ??= new GLTFLoader().loadAsync(new URL(MODEL_PATH, document.baseURI).href).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    let found: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (!found && o instanceof THREE.Mesh) found = o;
    });
    if (!found) throw new Error(`${MODEL_PATH} has no mesh`);
    const mesh: THREE.Mesh = found;
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const map = 'map' in source && source.map instanceof THREE.Texture ? source.map : null;
    return { geometry: placeAnimeHead(geometry), map };
  });
  return asset;
}

/**
 * Fills in `mesh` (already on the head bone, with its own lit material) once the model
 * has loaded. The material stays the figure's own, so the dissolve still reaches it.
 */
export function fillAnimeHead(mesh: THREE.Mesh, material: THREE.MeshStandardMaterial): void {
  if (typeof document === 'undefined') return;
  loadAsset().then(
    ({ geometry, map }) => {
      mesh.geometry = geometry;
      material.map = map;
      material.needsUpdate = true;
    },
    (e: unknown) => console.error('anime head failed to load', e),
  );
}
