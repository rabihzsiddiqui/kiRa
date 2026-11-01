import * as THREE from 'three';
import type { ArenaLayout } from '../../app/arena';
import { planarTo3 } from '../../physics/space';
import { COLORS } from '../palette';
import { disposeTree } from './dispose';
import type { BuiltStage, StageOptions } from './Stage';

/** The original sandbox look: dark zinc floor, indigo grid, plain walls and pillars. */
export function buildVoidStage(layout: ArenaLayout, _opts: StageOptions): BuiltStage {
  const root = new THREE.Group();
  root.name = 'stage:void';
  const half = layout.half;

  root.add(new THREE.HemisphereLight(0x8b93ff, 0x09090b, 0.9));
  const key = new THREE.DirectionalLight(0xf4f4ff, 2.2);
  key.position.set(6, 14, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const s = key.shadow.camera;
  s.left = -half;
  s.right = half;
  s.top = half;
  s.bottom = -half;
  s.near = 1;
  s.far = 40;
  key.shadow.bias = -0.0005;
  root.add(key);
  // Cool rim from behind the spawn, so silhouettes read against the dark floor.
  const rim = new THREE.DirectionalLight(COLORS.cyan, 0.6);
  rim.position.set(-8, 6, -12);
  root.add(rim);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2, half * 2),
    new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.95, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  const grid = new THREE.GridHelper(half * 2, half * 2, COLORS.gridCenter, COLORS.grid);
  grid.position.y = 0.002; // just above the floor, avoids z-fighting
  const gridMat = grid.material as THREE.Material;
  gridMat.transparent = true;
  gridMat.opacity = 0.35;
  root.add(grid);

  const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.8 });
  for (const w of layout.walls) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.half.x * 2, w.height, w.half.y * 2), wallMat);
    const c = planarTo3(w.center, w.height / 2);
    mesh.position.set(c.x, c.y, c.z);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = 'wall';
    root.add(mesh);
  }

  const pillarMat = new THREE.MeshStandardMaterial({ color: COLORS.pillar, roughness: 0.7 });
  for (const p of layout.pillars) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(p.radius, p.radius, p.height, 24), pillarMat);
    const c = planarTo3(p.center, p.height / 2);
    mesh.position.set(c.x, c.y, c.z);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = 'pillar';
    root.add(mesh);
  }

  return {
    root,
    background: new THREE.Color(COLORS.background),
    fog: new THREE.Fog(COLORS.background, 14, 42),
    exposure: 1,
    bloom: { strength: 0.55, threshold: 0.88 },
    // Unlit eyes glow against a dark scene; dim them to sit with the rest of her.
    faceLight: 0.5,
    envScene: null,
    envIntensity: 1,
    update: () => {},
    dispose: () => disposeTree(root),
  };
}
