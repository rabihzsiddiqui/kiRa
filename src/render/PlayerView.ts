import * as THREE from 'three';
import { ATTACKS, attackDuration, EVADES } from '../combat/moves';
import { COLORS } from './ArenaView';
import { KEEP_COLOR_LAYER } from './PostFx';
import type { ThreeAnimator } from './ThreeAnimator';

const RADIUS = 0.35;
const HALF_HEIGHT = 0.5;
const CENTER = HALF_HEIGHT + RADIUS; // pivot for flips and rolls

/** Clip lengths come from the move data, so the fake poses line up with the real timings. */
const CLIP_LENGTH = new Map<string, number>([
  ...Object.values(ATTACKS).map((d) => [d.anim, attackDuration(d)] as const),
  ...Object.values(EVADES).map((d) => [d.anim, d.duration] as const),
]);

interface Pose {
  pitch: number; // body, around her local X (forward roll is negative)
  roll: number; // body, around her local Z
  twist: number; // body, around Y
  swordYaw: number; // sword pivot, around Y (positive swings toward her left)
  swordPitch: number; // sword pivot, around X (positive points the blade up)
}

const REST: Pose = { pitch: 0, roll: 0, twist: 0, swordYaw: -0.6, swordPitch: -0.9 };

const ease = (k: number) => 1 - (1 - k) ** 3;
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));

/**
 * Placeholder body: capsule, a nose to show facing, and a box katana in the right hand.
 * The pose is faked from the animator's clip name and age until real animations exist.
 */
export class PlayerView {
  readonly root = new THREE.Group();
  /** Her posed body (capsule, visor, sword). Afterimages snapshot this. */
  readonly body = new THREE.Group();
  private readonly swordPivot = new THREE.Group();
  /** Phantom Dash dissolve: these fade and glow cyan together. */
  private readonly dissolveMats: THREE.MeshStandardMaterial[] = [];
  /** Real world position of the blade tip, for contact flashes. Updated in sync(). */
  readonly bladeTip = new THREE.Vector3();
  private readonly blade: THREE.Mesh;

  constructor(private readonly animator: ThreeAnimator) {
    this.body.position.y = CENTER;
    this.root.add(this.body);

    const skin = new THREE.MeshStandardMaterial({ color: COLORS.skin, roughness: 0.55 });
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(RADIUS, HALF_HEIGHT * 2, 8, 16), skin);
    capsule.castShadow = true;
    this.body.add(capsule);

    // Visor on the front of the head. Local -Z is her forward (see src/physics/space.ts).
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.08, 0.12),
      new THREE.MeshStandardMaterial({ color: COLORS.indigo, emissive: COLORS.indigo, emissiveIntensity: 0.8 }),
    );
    visor.position.set(0, 0.52, -0.3);
    this.body.add(visor);

    // Right hand. Facing -Z, her right is +X.
    this.swordPivot.position.set(RADIUS + 0.08, 0.05, -0.1);
    this.body.add(this.swordPivot);

    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 }),
    );
    handle.position.z = -0.06;
    const guard = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.02, 0.02),
      new THREE.MeshStandardMaterial({ color: COLORS.indigoLight, metalness: 0.6, roughness: 0.3 }),
    );
    guard.position.z = -0.19;
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.06, 0.95),
      new THREE.MeshStandardMaterial({ color: 0xd4d4d8, metalness: 0.9, roughness: 0.2 }),
    );
    blade.position.z = -0.19 - 0.475;
    for (const m of [handle, guard, blade]) {
      m.castShadow = true;
      this.swordPivot.add(m);
    }
    this.blade = blade;

    this.root.traverse((o) => {
      o.layers.enable(KEEP_COLOR_LAYER); // she keeps her color while the world greys out
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) this.dissolveMats.push(o.material);
    });
    for (const m of this.dissolveMats) m.userData.base = { emissive: m.emissive.getHex(), intensity: m.emissiveIntensity };
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

  /** `yaw` from yawFromFacing(); position is her feet. */
  sync(x: number, y: number, z: number, yaw: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;

    const p = this.pose();
    this.body.rotation.set(p.pitch, p.twist, p.roll, 'YXZ');
    this.swordPivot.rotation.set(p.swordPitch, p.swordYaw, 0, 'YXZ');
    this.root.updateMatrixWorld(true);
    this.blade.localToWorld(this.bladeTip.set(0, 0, -0.475));
  }

  private pose(): Pose {
    const { clip, clipTime } = this.animator;
    const len = CLIP_LENGTH.get(clip) ?? 0.5;
    const k = clamp01(clipTime / len);

    // Swings play over the first ~45% of the clip (startup + active), then hold.
    const swing = ease(clamp01(clipTime / (len * 0.45)));
    const blend = (a: number, b: number) => a + (b - a) * swing;

    switch (clip) {
      case 'atk_horizontal':
        return { ...REST, swordPitch: -0.1, swordYaw: blend(-1.6, 1.4) };
      case 'atk_reverse_horizontal':
        return { ...REST, swordPitch: -0.1, swordYaw: blend(1.4, -1.6) };
      case 'atk_vertical':
      case 'atk_jump':
      case 'atk_overpower':
        return { ...REST, swordYaw: 0.3, swordPitch: 1.4 - 2.6 * swing, pitch: -0.25 * swing };
      case 'atk_thrust':
        return { ...REST, swordYaw: 0.25, swordPitch: 0, pitch: -0.2 * swing };
      case 'atk_spin':
        return { ...REST, swordPitch: -0.1, swordYaw: 1.4, twist: ease(k) * Math.PI * 2 };
      case 'atk_phantom_dash':
        return { ...REST, swordPitch: -0.1, swordYaw: blend(-1.8, 1.6), pitch: -0.35 };
      case 'evade_roll':
        return { ...REST, pitch: -ease(k) * Math.PI * 2 };
      case 'evade_backflip':
        return { ...REST, pitch: ease(k) * Math.PI * 2 };
      case 'evade_hop_left':
        return { ...REST, roll: 0.35 * Math.sin(k * Math.PI) };
      case 'evade_hop_right':
        return { ...REST, roll: -0.35 * Math.sin(k * Math.PI) };
      case 'pd_aerial_cartwheel':
        return { ...REST, roll: ease(clamp01(clipTime / 0.45)) * Math.PI * 2 };
      case 'pd_corkscrew_left':
      case 'pd_corkscrew_right':
      case 'pd_backflip_twist':
        return { ...REST, pitch: ease(clamp01(clipTime / 0.45)) * Math.PI * 2, twist: ease(clamp01(clipTime / 0.45)) * Math.PI };
      case 'guard_raise':
      case 'guard_impact':
      case 'pb_clash_a':
      case 'pb_clash_b':
        return { ...REST, swordYaw: 1.35, swordPitch: 0.25 };
      case 'spin_charge':
        return { ...REST, swordYaw: -2.2, swordPitch: -0.2, twist: 0.5 };
      case 'hurt':
        return { ...REST, pitch: 0.3 * Math.sin(k * Math.PI) };
      case 'locomotion': {
        const a = this.animator;
        if (a.getFloat('locomotion') === 2) {
          // Strafing: lean into the move, body stays square to the target.
          return { ...REST, pitch: -0.12 * a.getFloat('strafeY'), roll: -0.12 * a.getFloat('strafeX') };
        }
        return { ...REST, pitch: -0.03 * a.getFloat('speed') };
      }
      default:
        return REST;
    }
  }
}
