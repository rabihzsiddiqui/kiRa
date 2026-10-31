import type { Animator } from '../player/contracts';

export interface ClipLogEntry {
  clip: string;
  blend: number;
}

/**
 * Animator for the browser build. There are no real clips yet, so it logs what the
 * FSM asks for and keeps the current clip and its age. PlayerView reads those to
 * fake a pose on the placeholder capsule. Swap in an AnimationMixer here later;
 * the states won't notice.
 */
export class ThreeAnimator implements Animator {
  clip = 'none';
  /** Player-time seconds since the current clip started. */
  clipTime = 0;
  readonly params = new Map<string, number>();
  readonly history: ClipLogEntry[] = [];

  constructor(private readonly log = false) {}

  play(clip: string, blendTime = 0): void {
    this.clip = clip;
    this.clipTime = 0;
    this.history.unshift({ clip, blend: blendTime });
    if (this.history.length > 8) this.history.pop();
    if (this.log) console.debug(`[anim] ${clip} (blend ${blendTime.toFixed(2)})`);
  }

  setFloat(param: string, value: number): void {
    this.params.set(param, value);
  }

  getFloat(param: string): number {
    return this.params.get(param) ?? 0;
  }

  /** Advance with the PLAYER-scaled dt, so her animation slows with her. */
  tick(dt: number): void {
    this.clipTime += dt;
  }
}
