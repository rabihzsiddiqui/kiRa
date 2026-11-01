import type * as THREE from 'three';

/** Frees the GPU side of everything under `root`: geometries, materials and their textures. */
export function disposeTree(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) m.forEach((x) => materials.add(x));
    else if (m) materials.add(m);
    const light = o as THREE.DirectionalLight;
    if (light.isDirectionalLight) light.shadow.map?.dispose();
  });
  for (const m of materials) {
    for (const value of Object.values(m)) {
      if (value && typeof value === 'object' && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose();
    }
    const uniforms = (m as THREE.ShaderMaterial).uniforms;
    if (uniforms) {
      for (const u of Object.values(uniforms)) {
        const v = u.value as THREE.Texture | null;
        if (v && typeof v === 'object' && v.isTexture) v.dispose();
      }
    }
    m.dispose();
  }
}
