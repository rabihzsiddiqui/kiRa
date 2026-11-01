import { add, length, rightOf, scale, sub, vec2, type Vec2 } from '../core/math';
import type { CameraBasis } from '../combat/direction';
import type { FxCue, FxSink } from '../feel/CombatFeel';
import type { TargetingQuery } from '../player/contracts';
import { planarTo3, yawFromFacing, type Vec3 } from '../physics/space';
import { Pulse, smoothstep, Spring } from './damp';

/** TargetingSystem satisfies this. The rig only reads it. View lock: swing behind her. */
export type CameraTargeting = TargetingQuery;

/** What the camera follows. Interpolated per render frame by the caller. */
export interface CameraSubject {
  position: Readonly<Vec2>;
  /** Height of her feet. */
  height: number;
  facing: Readonly<Vec2>;
}

/**
 * Spring-arm collision. Cast a sphere from `from` to `to` (3D world space) and return
 * how much of the path is free, 0..1. Return 1 when nothing is in the way.
 */
export interface CameraCollider {
  cast(from: Readonly<Vec3>, to: Readonly<Vec3>, radius: number): number;
}

/** Engine-free camera output. The render layer copies it onto a real camera. */
export interface CameraPose {
  position: Vec3;
  lookAt: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Dutch roll around the view axis, radians. Positive tilts the horizon clockwise. */
  roll: number;
}

export interface LookInput {
  /** Radians. Positive turns right. */
  yaw: number;
  /** Radians. Positive looks down. */
  pitch: number;
}

export interface CameraRigConfig {
  fov: number;
  // ---- free orbit
  distance: number;
  /** Focus point height above her feet: just over the shoulders. */
  shoulderHeight: number;
  defaultPitch: number;
  minPitch: number;
  maxPitch: number;
  followTime: number;
  /** Slower vertically, so hops and flips don't bounce the whole frame. */
  followTimeVertical: number;
  distanceTime: number;
  recenterTime: number;
  // ---- lock-on (docs/ARCHITECTURE.md §7)
  lockChestHeight: number;
  /** Focus sits this far along the player-to-target line. */
  lockFocusBias: number;
  lockBaseDistance: number;
  lockDistancePerMeter: number;
  lockMinDistance: number;
  lockMaxDistance: number;
  /** Yaw swung left of the target line, so she sits on the left third. */
  lockYawOffset: number;
  /** Focus shifted to her right, same reason. */
  lockShoulderOffset: number;
  lockPitch: number;
  lockYawTime: number;
  lockPitchTime: number;
  /** Real seconds to blend into lock framing, and back out to orbit. */
  lockInTime: number;
  lockOutTime: number;
  // ---- spring arm
  collisionRadius: number;
  /** After a wall stops blocking, the arm grows back over this long. Pulling in is instant. */
  armReturnTime: number;
  /** Skip shake and dutch roll (prefers-reduced-motion). */
  reducedMotion: boolean;
}

export const DEFAULT_CAMERA_RIG: CameraRigConfig = {
  fov: 60,
  distance: 5.5,
  shoulderHeight: 1.45,
  defaultPitch: 0.32,
  minPitch: -0.35,
  maxPitch: 1.2,
  followTime: 0.08,
  followTimeVertical: 0.2,
  distanceTime: 0.25,
  recenterTime: 0.12,
  lockChestHeight: 1.3,
  lockFocusBias: 0.35,
  lockBaseDistance: 4,
  lockDistancePerMeter: 0.5,
  lockMinDistance: 4,
  lockMaxDistance: 12,
  lockYawOffset: 0.3,
  lockShoulderOffset: 0.8,
  lockPitch: 0.3,
  lockYawTime: 0.15,
  lockPitchTime: 0.25,
  lockInTime: 0.2,
  lockOutTime: 0.3,
  collisionRadius: 0.25,
  armReturnTime: 0.3,
  reducedMotion: false,
};

/** Event reactions. Small on purpose; Phase 5 tunes them alongside the VFX. */
const FX = {
  dodgeFov: 8, // degrees, punch out
  dodgeRoll: 0.05, // radians, slight dutch
  dodgeHold: 0.55, // matches the perfect dodge slow-mo hold
  dodgeRelease: 0.35,
  blockShake: 0.06, // meters
  blockShakeTime: 0.15,
  blockPush: 0.05, // 5% push in
  counterDolly: 0.12, // 12% toward the action
} as const;

/**
 * Third-person camera rig: free orbit, Z-target framing, spring-arm collision and
 * event reactions. Plain math, no engine: it outputs a CameraPose and keeps `basis`
 * up to date for the player FSM.
 *
 * Runs on REAL time, so it stays fluid while the world crawls in slow-mo.
 */
export class CameraRig implements FxSink {
  readonly cfg: CameraRigConfig;
  /** Mutated in place: the player context holds this same object. */
  readonly basis: CameraBasis;

  /** 0 looks down planar +Y. Positive turns left (counterclockwise from above). */
  readonly yaw = new Spring(0);
  readonly pitch: Spring;
  /** 0 = free orbit, 1 = full lock framing. Eased, so breaking lock never snaps. */
  lockBlend = 0;

  private readonly focus = { x: new Spring(), y: new Spring(), h: new Spring() };
  private readonly distance: Spring;
  /** Share of the wanted arm length that collision allows, 0..1. 1 = nothing in the way. */
  private readonly armFree = new Spring(1);
  private readonly fovKick = new Pulse();
  private readonly rollKick = new Pulse();
  private readonly push = new Pulse();
  private readonly shake = new Pulse();
  private lastTarget: Vec2 | null = null;
  private time = 0;
  private started = false;

  constructor(
    private readonly targeting: CameraTargeting,
    private readonly collider: CameraCollider | null,
    cfg: Partial<CameraRigConfig> = {},
    basis: CameraBasis = { forward: vec2(0, 1), right: vec2(1, 0) },
  ) {
    this.cfg = { ...DEFAULT_CAMERA_RIG, ...cfg };
    this.basis = basis;
    this.pitch = new Spring(this.cfg.defaultPitch);
    this.distance = new Spring(this.cfg.distance);
    this.writeBasis();
  }

  // ------------------------------------------------------------- event hooks

  cue(name: FxCue): void {
    const reduced = this.cfg.reducedMotion;
    switch (name) {
      case 'perfectDodge':
        this.fovKick.fire(FX.dodgeFov, 0.06, FX.dodgeHold, FX.dodgeRelease);
        if (!reduced) this.rollKick.fire(FX.dodgeRoll, 0.08, FX.dodgeHold, FX.dodgeRelease);
        break;
      case 'perfectBlock':
        if (!reduced) this.shake.fire(FX.blockShake, 0, 0.02, FX.blockShakeTime);
        this.push.fire(FX.blockPush, 0.05, 0.15, 0.3);
        break;
      case 'counter.phantomDash':
      case 'counter.overpower':
        // The counter releases the slow-mo, so the dodge punch eases out with it.
        this.fovKick.letGo();
        this.rollKick.letGo();
        this.push.fire(FX.counterDolly, 0.06, 0.15, 0.35);
        break;
      case 'slowmo.end':
        this.fovKick.letGo();
        this.rollKick.letGo();
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ update

  update(realDt: number, look: LookInput, subject: CameraSubject): CameraPose {
    const { cfg } = this;
    const dt = Math.max(0, realDt);
    this.time += dt;
    for (const p of [this.fovKick, this.rollKick, this.push, this.shake]) p.update(dt);

    // ---- lock state
    const dir = this.targeting.isLocked ? this.targeting.directionToTarget() : null;
    if (dir) this.lastTarget = add(subject.position, scale(dir, this.targeting.distanceToTarget()));
    const locked = dir !== null;
    const blendTime = locked ? cfg.lockInTime : cfg.lockOutTime;
    this.lockBlend = Math.max(0, Math.min(1, this.lockBlend + (locked ? dt : -dt) / blendTime));
    const w = smoothstep(this.lockBlend);

    // ---- yaw and pitch
    if (dir) {
      this.yaw.toAngle(yawFromFacing(dir) + cfg.lockYawOffset, cfg.lockYawTime, dt);
      this.pitch.to(cfg.lockPitch, cfg.lockPitchTime, dt);
    } else if (this.targeting.isViewLocked) {
      this.yaw.toAngle(yawFromFacing(subject.facing), cfg.recenterTime, dt);
      this.pitch.to(cfg.defaultPitch, cfg.recenterTime * 2, dt);
    } else {
      // Free look. Clear spring velocity so a finished swing doesn't keep drifting.
      this.yaw.snap(this.yaw.value - look.yaw);
      this.pitch.snap(this.pitch.value + look.pitch);
    }
    this.pitch.snap(Math.max(cfg.minPitch, Math.min(cfg.maxPitch, this.pitch.value)));
    this.writeBasis();

    // ---- focus and distance goals: blend free orbit with lock framing
    let goal: Vec2 = subject.position;
    let goalH = subject.height + cfg.shoulderHeight;
    let goalDist = cfg.distance;
    if (w > 0 && this.lastTarget) {
      const toTarget = sub(this.lastTarget, subject.position);
      const sep = length(toTarget);
      const side = sep > 1e-3 ? rightOf(scale(toTarget, 1 / sep)) : vec2();
      const lockFocus = add(lerp2(subject.position, this.lastTarget, cfg.lockFocusBias), scale(side, cfg.lockShoulderOffset));
      const lockDist = Math.max(
        cfg.lockMinDistance,
        Math.min(cfg.lockMaxDistance, cfg.lockBaseDistance + sep * cfg.lockDistancePerMeter),
      );
      goal = lerp2(goal, lockFocus, w);
      goalH += (subject.height + cfg.lockChestHeight - goalH) * w;
      goalDist += (lockDist - goalDist) * w;
    }
    if (!locked && this.lockBlend === 0) this.lastTarget = null;

    if (!this.started) {
      this.focus.x.snap(goal.x);
      this.focus.y.snap(goal.y);
      this.focus.h.snap(goalH);
      this.distance.snap(goalDist);
      this.started = true;
    } else {
      this.focus.x.to(goal.x, cfg.followTime, dt);
      this.focus.y.to(goal.y, cfg.followTime, dt);
      this.focus.h.to(goalH, cfg.followTimeVertical, dt);
      this.distance.to(goalDist, cfg.distanceTime, dt);
    }

    // ---- spring arm
    const focus3 = planarTo3(vec2(this.focus.x.value, this.focus.y.value), this.focus.h.value);
    const back = this.armDirection();
    const wanted = this.distance.value * (1 - this.push.value);
    const desired = offset(focus3, back, wanted);
    const free = this.collider ? Math.max(0, Math.min(1, this.collider.cast(focus3, desired, cfg.collisionRadius))) : 1;
    // Pull in instantly so it never clips; ease back out so it doesn't pop. Only the
    // collision share is eased: with nothing in the way the arm is exactly `wanted`,
    // which is already smooth. (Easing the length itself too makes two springs fight.)
    if (free <= this.armFree.value) this.armFree.snap(free);
    else this.armFree.to(free, cfg.armReturnTime, dt);
    if (this.armFree.value > free) this.armFree.snap(free);
    const arm = wanted * this.armFree.value;

    // ---- pose
    const jitter = this.shakeOffset();
    const position = offset(focus3, back, arm);
    return {
      position: { x: position.x + jitter.x, y: position.y + jitter.y, z: position.z + jitter.z },
      lookAt: { x: focus3.x + jitter.x, y: focus3.y + jitter.y, z: focus3.z + jitter.z },
      fov: cfg.fov + this.fovKick.value,
      roll: this.rollKick.value,
    };
  }

  /** Unit vector from the focus back to the camera, 3D world space. */
  private armDirection(): Vec3 {
    const yaw = this.yaw.value;
    const pitch = this.pitch.value;
    const cp = Math.cos(pitch);
    // The camera looks along planar (-sin yaw, cos yaw), tilted down by pitch. Sit opposite.
    const lookPlanar = vec2(-Math.sin(yaw), Math.cos(yaw));
    const backPlanar = planarTo3(scale(lookPlanar, -cp));
    return { x: backPlanar.x, y: Math.sin(pitch), z: backPlanar.z };
  }

  private shakeOffset(): Vec3 {
    const a = this.shake.value;
    if (a === 0) return { x: 0, y: 0, z: 0 };
    // Deterministic high-frequency wobble, so tests and replays see the same frames.
    const t = this.time;
    return { x: Math.sin(t * 61) * a, y: Math.sin(t * 73 + 1.3) * a * 0.6, z: Math.sin(t * 47 + 2.1) * a * 0.4 };
  }

  private writeBasis(): void {
    const s = Math.sin(this.yaw.value);
    const c = Math.cos(this.yaw.value);
    this.basis.forward.x = -s;
    this.basis.forward.y = c;
    this.basis.right.x = c;
    this.basis.right.y = s;
  }
}

const lerp2 = (a: Readonly<Vec2>, b: Readonly<Vec2>, k: number): Vec2 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

const offset = (p: Vec3, dir: Vec3, d: number): Vec3 => ({ x: p.x + dir.x * d, y: p.y + dir.y * d, z: p.z + dir.z * d });
