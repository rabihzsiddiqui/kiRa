import * as THREE from 'three';
import { CLIPS, LOCOMOTION, LOCOMOTION_CLIPS, locomotionWeights, type ClipDef, type LocoKey } from '../character/clips';
import { BONES, HIPS_HEIGHT } from '../character/rig';
import type { Animator } from '../player/contracts';

export interface ClipLogEntry {
  clip: string;
  blend: number;
}

const DEG = Math.PI / 180;
/**
 * Time constant (seconds) the clips inside the locomotion blend ease toward their weights
 * with. Snapping made starting, stopping and turning the stick pop from pose to pose.
 */
const LOCO_EASE = 0.08;
const HIPS = BONES[0];

/**
 * Animator on three.js's AnimationMixer. Clips come from src/character/clips.ts, sampled
 * into keyframe tracks. One-shots crossfade over the blend time the state asks for;
 * 'locomotion' is a blend of idle, run and four strafe clips driven by setFloat params.
 *
 * It ticks on the PLAYER clock (Game.step), so animation slows with her in slow-mo.
 * Call bind() with the figure once it exists; until then it only records requests.
 *
 * Deferred mode (the game): tick() only advances logic, and render(alpha) moves the
 * mixer to the same in-between moment the renderer draws her position at. Without it,
 * a display frame that lands on 0 sim steps freezes her pose and the next one jumps
 * two, which reads as a stutter while running even though her position is smooth.
 */
export class ThreeAnimator implements Animator {
  clip = 'none';
  /** Player-time seconds since the current clip started. */
  clipTime = 0;
  readonly params = new Map<string, number>();
  readonly history: ClipLogEntry[] = [];

  private mixer: THREE.AnimationMixer | null = null;
  /** Two actions per clip, so a clip can crossfade into itself (thrust, thrust). */
  private readonly oneShots = new Map<string, [THREE.AnimationAction, THREE.AnimationAction]>();
  private loco: Record<LocoKey, THREE.AnimationAction> | null = null;
  private current: THREE.AnimationAction | null = null;
  private locoWeight = 1;
  private locoTarget = 1;
  private locoFade = 0;
  /** The blend inside the locomotion group, easing toward locomotionWeights(). */
  private locoMix: Record<LocoKey, number> | null = null;
  /** Player-clock time at the last two ticks, and where the mixer has been drawn up to. */
  private simPrev = 0;
  private simTime = 0;
  private drawn = 0;
  private readonly log: boolean;
  private readonly deferred: boolean;

  constructor(opts: { log?: boolean; deferred?: boolean } = {}) {
    this.log = opts.log ?? false;
    this.deferred = opts.deferred ?? false;
  }

  bind(root: THREE.Object3D): void {
    const mixer = new THREE.AnimationMixer(root);
    this.mixer = mixer;

    this.loco = Object.fromEntries(
      (Object.keys(LOCOMOTION_CLIPS) as LocoKey[]).map((k) => {
        const action = mixer.clipAction(buildClip(LOCOMOTION_CLIPS[k]));
        action.play();
        action.setEffectiveWeight(0);
        return [k, action];
      }),
    ) as Record<LocoKey, THREE.AnimationAction>;

    for (const def of CLIPS.values()) {
      const clip = buildClip(def);
      const pair = [mixer.clipAction(clip), mixer.clipAction(clip.clone())] as [THREE.AnimationAction, THREE.AnimationAction];
      for (const a of pair) {
        a.setLoop(def.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        a.clampWhenFinished = true;
      }
      this.oneShots.set(def.name, pair);
    }

    if (this.clip !== 'none') this.start(this.clip, 0);
  }

  play(clip: string, blendTime = 0): void {
    this.clip = clip;
    this.clipTime = 0;
    this.history.unshift({ clip, blend: blendTime });
    if (this.history.length > 8) this.history.pop();
    if (this.log) console.debug(`[anim] ${clip} (blend ${blendTime.toFixed(2)})`);
    if (this.mixer) this.start(clip, blendTime);
  }

  setFloat(param: string, value: number): void {
    this.params.set(param, value);
  }

  getFloat(param: string): number {
    return this.params.get(param) ?? 0;
  }

  /** Advance with the PLAYER-scaled dt. */
  tick(dt: number): void {
    this.clipTime += dt;
    this.simPrev = this.simTime;
    this.simTime += dt;
    if (!this.mixer || !this.loco) return;

    // Locomotion group fades as a whole; inside it, the params pick the mix.
    if (this.locoWeight !== this.locoTarget) {
      const step = this.locoFade > 0 ? dt / this.locoFade : 1;
      this.locoWeight += Math.sign(this.locoTarget - this.locoWeight) * Math.min(step, Math.abs(this.locoTarget - this.locoWeight));
    }
    const { weights, runRate } = locomotionWeights({
      locomotion: this.getFloat('locomotion'),
      speed: this.getFloat('speed'),
      strafeX: this.getFloat('strafeX'),
      strafeY: this.getFloat('strafeY'),
      alert: this.getFloat('alert'),
    });
    // While the group is faded out there's nothing to ease from: take the new mix as is.
    const k = !this.locoMix || this.locoWeight === 0 ? 1 : 1 - Math.exp(-dt / LOCO_EASE);
    const mix = (this.locoMix ??= { ...weights });
    for (const key of Object.keys(this.loco) as LocoKey[]) {
      mix[key] += (weights[key] - mix[key]) * k;
      this.loco[key].setEffectiveWeight(this.locoWeight * mix[key]);
    }
    this.loco.run.setEffectiveTimeScale(runRate);

    if (!this.deferred) {
      this.mixer.update(dt);
      this.drawn = this.simTime;
    }
  }

  /**
   * Deferred mode: pose the figure `alpha` of the way between the last two ticks
   * (alpha = leftover accumulator / sim step, the same value position interpolation uses).
   */
  render(alpha: number): void {
    if (!this.mixer || !this.deferred) return;
    const target = this.simPrev + (this.simTime - this.simPrev) * Math.max(0, Math.min(1, alpha));
    if (target > this.drawn) {
      this.mixer.update(target - this.drawn);
      this.drawn = target;
    }
  }

  private start(clip: string, blend: number): void {
    const fade = Math.max(0, blend);
    if (clip === LOCOMOTION) {
      this.fadeOutCurrent(fade);
      this.setLoco(1, fade);
      return;
    }
    const pair = this.oneShots.get(clip);
    if (!pair) {
      console.warn(`[anim] no clip named "${clip}"`); // the coverage test should catch this first
      return;
    }
    const next = this.current === pair[0] ? pair[1] : pair[0];
    next.reset();
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    if (fade > 0) next.fadeIn(fade);
    this.fadeOutCurrent(fade);
    next.play();
    this.current = next;
    this.setLoco(0, fade);
  }

  private fadeOutCurrent(fade: number): void {
    if (!this.current) return;
    if (fade > 0) this.current.fadeOut(fade);
    else this.current.stop();
    this.current = null;
  }

  private setLoco(target: number, fade: number): void {
    this.locoTarget = target;
    this.locoFade = fade;
    if (fade === 0) this.locoWeight = target;
  }
}

/** Samples a ClipDef into a three.js clip: a quaternion track per bone, plus hips height. */
export function buildClip(def: ClipDef, fps = 60): THREE.AnimationClip {
  const n = Math.max(2, Math.ceil(def.duration * fps) + 1);
  const times = new Float32Array(n);
  const rot = new Map(BONES.map((b) => [b.id, new Float32Array(n * 4)]));
  const hipsPos = new Float32Array(n * 3);
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const q = new THREE.Quaternion();

  for (let i = 0; i < n; i++) {
    const t = (def.duration * i) / (n - 1);
    times[i] = t;
    const pose = def.sample(t);
    for (const b of BONES) {
      const e = pose.bones[b.id] ?? [0, 0, 0];
      q.setFromEuler(euler.set(e[0] * DEG, e[1] * DEG, e[2] * DEG, 'YXZ'));
      q.toArray(rot.get(b.id)!, i * 4);
    }
    hipsPos.set([HIPS.offset[0], HIPS_HEIGHT + (pose.hipsY ?? 0), HIPS.offset[2] - (pose.hipsZ ?? 0)], i * 3); // forward is -Z
  }

  const tracks: THREE.KeyframeTrack[] = BONES.map((b) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, rot.get(b.id)!));
  tracks.push(new THREE.VectorKeyframeTrack(`${HIPS.name}.position`, times, hipsPos));
  return new THREE.AnimationClip(def.name, def.duration, tracks);
}
