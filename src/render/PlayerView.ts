import * as THREE from 'three';
import { Ponytail, type HeadFrame, type Sphere } from '../character/Ponytail';
import { PONYTAIL_SOCKET } from '../character/rig';
import { COLORS } from './ArenaView';
import { buildFigure, type Figure } from './CharacterFigure';
import { KEEP_COLOR_LAYER } from './PostFx';
import type { ThreeAnimator } from './ThreeAnimator';

const HAIR_COLOR = 0x101014;

/**
 * Her body: the rigged placeholder figure (animated by ThreeAnimator), the katana on
 * the right-hand bone, and the ponytail. `root` follows her feet; `hair` lives in world
 * space (it trails behind her), so add both to the scene.
 */
export class PlayerView {
  readonly root = new THREE.Group();
  /** Her posed figure. Afterimages snapshot this. */
  readonly body: THREE.Group;
  /** World-space ponytail. */
  readonly hair = new THREE.Group();
  /** World position of the blade tip, for contact flashes. Updated in sync(). */
  readonly bladeTip = new THREE.Vector3();

  private readonly figure: Figure;
  private readonly ponytail = new Ponytail();
  private readonly hairSegments: THREE.Mesh[] = [];
  private readonly hairJoints: THREE.Mesh[] = [];
  private readonly dissolveMats: THREE.MeshStandardMaterial[];

  constructor(animator: ThreeAnimator) {
    this.figure = buildFigure();
    this.body = this.figure.root;
    this.root.add(this.body);
    animator.bind(this.body);

    const hairMat = new THREE.MeshStandardMaterial({ color: HAIR_COLOR, roughness: 0.45, metalness: 0.1 });
    const n = this.ponytail.cfg.segments;
    const segGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0); // base at the origin, along +Y
    const jointGeo = new THREE.SphereGeometry(1, 8, 6);
    for (let i = 0; i < n; i++) {
      const r = this.hairRadius(i);
      const seg = new THREE.Mesh(segGeo, hairMat);
      seg.scale.set(r, 1, r);
      const joint = new THREE.Mesh(jointGeo, hairMat);
      joint.scale.setScalar(r);
      for (const m of [seg, joint]) m.castShadow = true;
      this.hairSegments.push(seg);
      this.hairJoints.push(joint);
      this.hair.add(seg, joint);
    }

    for (const g of [this.root, this.hair]) g.traverse((o) => o.layers.enable(KEEP_COLOR_LAYER)); // she keeps her color
    this.dissolveMats = [...this.figure.materials, hairMat];
    for (const m of this.dissolveMats) m.userData.base = { emissive: m.emissive.getHex(), intensity: m.emissiveIntensity };
  }

  /** `yaw` from yawFromFacing(); position is her feet. Bones are posed by the animator. */
  sync(x: number, y: number, z: number, yaw: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.root.updateMatrixWorld(true);
    const blade = this.figure.blade;
    blade.localToWorld(this.bladeTip.set(0, 0, -(blade.geometry as THREE.BoxGeometry).parameters.depth / 2));
  }

  /** Step the ponytail. `dt` is PLAYER-scaled, so her hair slows with her. Call after sync(). */
  updateHair(dt: number): void {
    const { bones } = this.figure;
    const head = bones.head;
    const q = head.getWorldQuaternion(new THREE.Quaternion());
    const frame: HeadFrame = {
      right: vec(new THREE.Vector3(1, 0, 0).applyQuaternion(q)),
      up: vec(new THREE.Vector3(0, 1, 0).applyQuaternion(q)),
      back: vec(new THREE.Vector3(0, 0, 1).applyQuaternion(q)),
    };
    const socket = vec(head.localToWorld(new THREE.Vector3(...PONYTAIL_SOCKET)));
    const colliders: Sphere[] = [
      { center: vec(head.localToWorld(new THREE.Vector3(0, 0.11, 0))), radius: 0.115 },
      { center: vec(bones.neck.localToWorld(new THREE.Vector3(0, 0.04, 0))), radius: 0.06 },
      { center: vec(bones.chest.localToWorld(new THREE.Vector3(0, 0.12, 0.05))), radius: 0.15 },
    ];
    this.ponytail.update(dt, socket, frame, colliders);

    const p = this.ponytail.points;
    const up = new THREE.Vector3(0, 1, 0);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 0; i < this.hairSegments.length; i++) {
      a.set(p[i].x, p[i].y, p[i].z);
      b.set(p[i + 1].x, p[i + 1].y, p[i + 1].z);
      const seg = this.hairSegments[i];
      const d = b.clone().sub(a);
      seg.position.copy(a);
      seg.quaternion.setFromUnitVectors(up, d.clone().normalize());
      seg.scale.y = d.length();
      this.hairJoints[i].position.copy(b);
    }
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

  /** Thick at the tie, thin at the tip. */
  private hairRadius(i: number): number {
    return 0.034 - (0.022 * i) / Math.max(1, this.ponytail.cfg.segments - 1);
  }
}

const vec = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });
