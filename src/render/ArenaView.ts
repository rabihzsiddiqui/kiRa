import * as THREE from 'three';
import type { ArenaLayout } from '../app/arena';
import { planarTo3 } from '../physics/space';

/** Palette for the sandbox. Dark zinc base, indigo and cyan accents. */
export const COLORS = {
  background: 0x09090b, // zinc-950
  floor: 0x18181b, // zinc-900
  grid: 0x312e81, // indigo-900
  gridCenter: 0x4f46e5, // indigo-600
  wall: 0x27272a, // zinc-800
  pillar: 0x3f3f46, // zinc-700
  indigo: 0x6366f1,
  indigoLight: 0x818cf8,
  cyan: 0x22d3ee,
  skin: 0xe4e4e7, // zinc-200
} as const;

/**
 * Renderer, scene, lights and the static arena meshes.
 * Built from the same ArenaLayout as the physics colliders.
 */
export class ArenaView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();

  constructor(canvas: HTMLCanvasElement, layout: ArenaLayout) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene.background = new THREE.Color(COLORS.background);
    this.scene.fog = new THREE.Fog(COLORS.background, 14, 42);

    this.addLights(layout.half);
    this.addFloor(layout.half);
    this.addStatic(layout);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
  }

  render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }

  private addLights(half: number): void {
    this.scene.add(new THREE.HemisphereLight(0x8b93ff, 0x09090b, 0.9));

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
    this.scene.add(key);

    // Cool rim from behind the spawn, so silhouettes read against the dark floor.
    const rim = new THREE.DirectionalLight(COLORS.cyan, 0.6);
    rim.position.set(-8, 6, -12);
    this.scene.add(rim);
  }

  private addFloor(half: number): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(half * 2, half * 2),
      new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.95, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(half * 2, half * 2, COLORS.gridCenter, COLORS.grid);
    grid.position.y = 0.002; // just above the floor, avoids z-fighting
    const mat = grid.material as THREE.Material;
    mat.transparent = true;
    mat.opacity = 0.35;
    this.scene.add(grid);
  }

  private addStatic(layout: ArenaLayout): void {
    const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.8 });
    for (const w of layout.walls) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.half.x * 2, w.height, w.half.y * 2), wallMat);
      const c = planarTo3(w.center, w.height / 2);
      mesh.position.set(c.x, c.y, c.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    const pillarMat = new THREE.MeshStandardMaterial({ color: COLORS.pillar, roughness: 0.7 });
    for (const p of layout.pillars) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(p.radius, p.radius, p.height, 24), pillarMat);
      const c = planarTo3(p.center, p.height / 2);
      mesh.position.set(c.x, c.y, c.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }
}
