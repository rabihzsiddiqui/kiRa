import * as THREE from 'three';
import { COLORS } from './ArenaView';
import { buildFigure, type BodyKind, type Figure } from './CharacterFigure';
import { KEEP_COLOR_LAYER } from './PostFx';
import type { ThreeAnimator } from './ThreeAnimator';

/**
 * Her body: the rigged figure (animated by ThreeAnimator) with the katana on the
 * right-hand bone. `body` picks the skinned base mesh or the original shape-built body. `root` follows her feet; add it to the scene.
 */
export class PlayerView {
  readonly root = new THREE.Group();
  /** Her posed figure. Afterimages snapshot this. */
  readonly body: THREE.Group;
  /** World position of the blade tip, for contact flashes. Updated in sync(). */
  readonly bladeTip = new THREE.Vector3();
  /** The katana: group, and where the blade starts and ends along it. */
  readonly sword: Figure['sword'];

  private readonly figure: Figure;
  private readonly dissolveMats: THREE.MeshStandardMaterial[];

  constructor(animator: ThreeAnimator, body: BodyKind = 'mesh') {
    this.figure = buildFigure(body);
    this.body = this.figure.root;
    this.sword = this.figure.sword;
    this.root.add(this.body);
    animator.bind(this.body);

    this.root.traverse((o) => o.layers.enable(KEEP_COLOR_LAYER)); // she keeps her color
    this.dissolveMats = this.figure.materials;
    for (const m of this.dissolveMats) m.userData.base = { emissive: m.emissive.getHex(), intensity: m.emissiveIntensity };
  }

  /** `yaw` from yawFromFacing(); position is her feet. Bones are posed by the animator. */
  sync(x: number, y: number, z: number, yaw: number): void {
    this.figure.updateCloth();
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.root.updateMatrixWorld(true);
    const { group, tipZ } = this.sword;
    group.localToWorld(this.bladeTip.set(0, 0, tipZ));
  }

  /** 0 = solid, 1 = mostly gone: see-through with a cyan glow (Phantom Dash). */
  setDissolve(k: number): void {
    const on = k > 0.001;
    for (const m of this.dissolveMats) {
      const base = m.userData.base as { emissive: number; intensity: number };
      if (m.transparent !== on) {
        m.transparent = on;
        m.needsUpdate = true;
      }
      m.opacity = 1 - 0.75 * k;
      m.depthWrite = !on;
      m.emissive.setHex(on ? COLORS.cyan : base.emissive);
      m.emissiveIntensity = on ? 1.5 * k : base.intensity;
    }
  }
}
