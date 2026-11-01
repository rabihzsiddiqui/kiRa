import { EventBus } from '../core/EventBus';
import { dot, length, normalize, sub, type Vec2 } from '../core/math';
import type { CameraBasis } from '../combat/direction';
import { Action } from '../input/actions';
import type { InputBuffer } from '../input/InputBuffer';
import type { TargetingQuery } from '../player/contracts';

export interface Targetable {
  readonly position: Readonly<Vec2>;
  readonly alive: boolean;
}

/**
 * Lock-on changes, for presentation (the lock-on sound). `lost`: the target died or got
 * out of range while the button was still held; `button`: she let go (or toggled off).
 */
export interface TargetingEvents extends Record<string, unknown> {
  targetLocked: { target: Targetable };
  targetReleased: { target: Targetable; reason: 'button' | 'lost' };
}

export interface TargetingConfig {
  mode: 'hold' | 'toggle';
  acquireRange: number;
  breakRange: number; // larger than acquire, so the lock doesn't flicker at the edge
  maxAngleDeg: number; // only consider enemies roughly in front of the camera
}

export const DEFAULT_TARGETING: TargetingConfig = {
  mode: 'hold',
  acquireRange: 12,
  breakRange: 16,
  maxAngleDeg: 75,
};

/**
 * Z-targeting. Decides whether we're locked and on what.
 * The player FSM and the camera both read it; neither one owns it.
 */
export class TargetingSystem implements TargetingQuery {
  private target: Targetable | null = null;
  readonly cfg: TargetingConfig;
  readonly events = new EventBus<TargetingEvents>();

  constructor(
    private readonly input: InputBuffer,
    private readonly player: { readonly position: Readonly<Vec2> },
    private readonly camera: () => CameraBasis,
    private readonly candidates: () => Iterable<Targetable>,
    cfg: Partial<TargetingConfig> = {},
  ) {
    this.cfg = { ...DEFAULT_TARGETING, ...cfg };
  }

  get isLocked(): boolean {
    return this.target !== null;
  }

  get current(): Targetable | null {
    return this.target;
  }

  /** True when the button is held but nothing is in range (camera recenters behind her). */
  get wantsRecenter(): boolean {
    return this.input.isHeld(Action.Target) && !this.target;
  }

  update(): void {
    const before = this.target;
    let lost = false;
    if (this.target && (!this.target.alive || this.distanceTo(this.target) > this.cfg.breakRange)) {
      this.target = null;
      lost = true;
    }

    const press = this.input.peek(Action.Target);
    if (press) this.input.consume(press);

    if (this.cfg.mode === 'hold') {
      if (!this.input.isHeld(Action.Target)) this.target = null;
      else if (!this.target) this.target = this.pick();
    } else if (press) {
      this.target = this.target ? null : this.pick();
    }

    if (this.target === before) return;
    if (before) this.events.emit('targetReleased', { target: before, reason: lost ? 'lost' : 'button' });
    if (this.target) this.events.emit('targetLocked', { target: this.target });
  }

  directionToTarget(): Vec2 | null {
    return this.target ? normalize(sub(this.target.position, this.player.position)) : null;
  }

  distanceToTarget(): number {
    return this.target ? this.distanceTo(this.target) : Infinity;
  }

  private distanceTo(t: Targetable): number {
    return length(sub(t.position, this.player.position));
  }

  /** Closest enemy, weighted toward whatever the camera is looking at. */
  private pick(): Targetable | null {
    const camFwd = this.camera().forward;
    const minDot = Math.cos((this.cfg.maxAngleDeg * Math.PI) / 180);
    let best: Targetable | null = null;
    let bestScore = Infinity;

    for (const c of this.candidates()) {
      if (!c.alive) continue;
      const offset = sub(c.position, this.player.position);
      const dist = length(offset);
      if (dist > this.cfg.acquireRange) continue;
      const facingDot = dot(normalize(offset), camFwd);
      if (dist > 1.5 && facingDot < minDot) continue; // very close enemies always count
      const score = dist / this.cfg.acquireRange + (1 - facingDot) * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }
}
