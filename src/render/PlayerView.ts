import * as THREE from 'three';
import { FaceState, type Expression, type FaceInput } from '../character/face';
import { HEAD_LOOK, HeadLook, type Gaze } from '../character/headLook';
import { COLORS } from './palette';
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
  private readonly look = new HeadLook();
  private readonly mood = new FaceState();
  /** Where her eyes point at what she's looking at (-1..1, her right / up), or null. */
  private eyeAim: { x: number; y: number } | null = null;
  /** The animator's neck and head this frame, and what lookAt() last left them at. */
  private readonly lookBase = { neck: new THREE.Quaternion(), head: new THREE.Quaternion() };
  private readonly lookOut = { neck: new THREE.Quaternion(), head: new THREE.Quaternion() };
  private readonly tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), q: new THREE.Quaternion(), p: new THREE.Quaternion() };

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

  /**
   * Turns her head toward `point` (world space, e.g. the target's head), on top of the
   * animated pose; see character/headLook.ts for when and how far. `allowed` false (a spin,
   * a roll) or no point fades it out. Call after sync(), every frame. `dt` on her clock.
   */
  lookAt(dt: number, point: THREE.Vector3 | null, allowed: boolean): void {
    const { neck, head, chest } = this.figure.bones;
    // The mixer doesn't pose the bones on every display frame. If they still hold what this
    // left last time, put the animation's pose back before turning them again.
    for (const name of ['neck', 'head'] as const) {
      const bone = this.figure.bones[name];
      if (bone.quaternion.equals(this.lookOut[name])) bone.quaternion.copy(this.lookBase[name]);
      this.lookBase[name].copy(bone.quaternion);
    }
    neck.updateMatrixWorld(true);

    const { a: eye, b: dir } = this.tmp;
    head.getWorldPosition(eye);
    eye.y += 0.06;
    const target = point ? gazeOf(dir.subVectors(point, eye).normalize()) : null;
    const gaze = this.look.update(dt, { target, chest: gazeOf(forwardOf(chest, dir)), head: gazeOf(forwardOf(head, dir)), allowed });
    if (gaze) {
      const want = dirOf(gaze, new THREE.Vector3());
      // The neck takes its share of the turn, the head the rest: reads as a head turning on
      // a neck, not a head swiveling on a post.
      this.turnToward(neck, want, HEAD_LOOK.neckShare);
      this.turnToward(head, want, 1);
    }
    this.lookOut.neck.copy(neck.quaternion);
    this.lookOut.head.copy(head.quaternion);

    // The eyes do the rest: what's left between where her head points and the target.
    this.eyeAim = null;
    if (point && this.look.weight > 0) {
      const local = head.worldToLocal(point.clone()).sub(head.worldToLocal(eye.clone()));
      const ahead = Math.max(1e-3, -local.z);
      const k = this.look.weight;
      this.eyeAim = {
        x: k * THREE.MathUtils.clamp(Math.atan2(local.x, ahead) / THREE.MathUtils.degToRad(30), -1, 1),
        y: k * THREE.MathUtils.clamp(Math.atan2(local.y, ahead) / THREE.MathUtils.degToRad(25), -1, 1),
      };
    }
  }

  /** Her expression this frame (character/face.ts): call every frame, after lookAt(). `dt` on her clock. */
  face(dt: number, input: FaceInput): void {
    this.showFace(this.mood.update(dt, input));
  }

  /** Paints an expression as is (the gallery uses it to show each one). */
  showFace(e: Expression): void {
    const aim = this.eyeAim;
    this.figure.face?.set(e, aim ? aim.x : e.gazeX, aim ? aim.y : e.gazeY);
  }

  /** Rotates `bone` so its forward moves `share` of the way to `want` (world), without rolling it. */
  private turnToward(bone: THREE.Bone, want: THREE.Vector3, share: number): void {
    const { b: fwd, q: delta, p: parent } = this.tmp;
    forwardOf(bone, fwd);
    delta.setFromUnitVectors(fwd, want);
    if (share < 1) delta.slerp(new THREE.Quaternion(), 1 - share);
    // world' = delta * world, so local' = parent⁻¹ * delta * parent * local.
    bone.parent!.getWorldQuaternion(parent);
    bone.quaternion.premultiply(parent).premultiply(delta).premultiply(parent.invert());
    bone.updateMatrixWorld(true);
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

/** Where a bone faces in the world: its -Z (the rig faces -Z at rest). */
function forwardOf(bone: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  return bone.getWorldDirection(out).negate();
}

/** World direction as yaw (about up) and pitch (up from level), degrees. */
function gazeOf(d: THREE.Vector3): Gaze {
  return { yaw: THREE.MathUtils.radToDeg(Math.atan2(d.x, d.z)), pitch: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1))) };
}

function dirOf(g: Gaze, out: THREE.Vector3): THREE.Vector3 {
  const [y, p] = [THREE.MathUtils.degToRad(g.yaw), THREE.MathUtils.degToRad(g.pitch)];
  return out.set(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p));
}
