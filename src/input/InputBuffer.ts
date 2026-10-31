import { Action, ALL_ACTIONS, type RawInputSample } from './actions';
import { length, TAU, vec2, wrapAngle, type Vec2 } from '../core/math';

/**
 * A button press waiting to be used by gameplay.
 * The stick is snapshotted at press time, so "Left + Attack" still reads as Left
 * even if the stick has moved by the time the attack actually fires.
 */
export interface BufferedPress {
  readonly id: number;
  readonly action: Action;
  readonly time: number;
  readonly stick: Readonly<Vec2>;
  consumed: boolean;
}

export interface InputBufferConfig {
  /** How long a press stays usable. Lets a press during recovery fire on the first legal frame. */
  bufferWindow: number;
  /** Stick magnitude below which the 360 gesture trail resets. */
  gestureDeadzone: number;
  /** Total stick sweep needed for a spin gesture. A bit under a full turn feels fair. */
  spinMinSweep: number;
  /** The sweep must happen within this much time. */
  spinMaxDuration: number;
  /** After a sweep completes, Attack has this long to claim it. */
  spinGestureLifetime: number;
}

export const DEFAULT_INPUT_BUFFER_CONFIG: InputBufferConfig = {
  bufferWindow: 0.2, // 12 frames at 60 fps
  gestureDeadzone: 0.6,
  spinMinSweep: TAU * 0.85, // ~306 degrees
  spinMaxDuration: 0.5,
  spinGestureLifetime: 0.3,
};

interface StickSample {
  time: number;
  angle: number;
}

/**
 * Records presses, holds, and stick gestures. It never decides what a press MEANS;
 * that is the IntentResolver's job, which keeps this class reusable for menus,
 * other characters, or replays.
 */
export class InputBuffer {
  readonly cfg: InputBufferConfig;

  private presses: BufferedPress[] = [];
  private prevButtons = new Map<Action, boolean>();
  private holdStart = new Map<Action, number>();
  private lastPressAt = new Map<Action, number>();
  private prevPressAt = new Map<Action, number>();
  private stickTrail: StickSample[] = [];
  private spinGestureAt = -Infinity;
  private spinGestureClockwise = false;
  private nextId = 1;
  private _now = 0;
  private _stick: Vec2 = vec2();

  constructor(cfg: Partial<InputBufferConfig> = {}) {
    this.cfg = { ...DEFAULT_INPUT_BUFFER_CONFIG, ...cfg };
  }

  get now(): number {
    return this._now;
  }

  /** Current raw stick (screen space). */
  get stick(): Readonly<Vec2> {
    return this._stick;
  }

  /** Call once per frame, before any gameplay system reads input. */
  update(sample: RawInputSample): void {
    this._now = sample.time;
    this._stick = { ...sample.stick };

    for (const action of ALL_ACTIONS) {
      const down = sample.buttons[action] ?? false;
      const wasDown = this.prevButtons.get(action) ?? false;

      if (down && !wasDown) {
        this.presses.push({
          id: this.nextId++,
          action,
          time: sample.time,
          stick: { ...sample.stick },
          consumed: false,
        });
        this.holdStart.set(action, sample.time);
        const last = this.lastPressAt.get(action);
        if (last !== undefined) this.prevPressAt.set(action, last);
        this.lastPressAt.set(action, sample.time);
      } else if (!down && wasDown) {
        this.holdStart.delete(action);
      }
      this.prevButtons.set(action, down);
    }

    this.trackStickGesture(sample);
    this.prune();
  }

  // ---------------------------------------------------------------- presses

  /** Oldest unconsumed press of `action` that is still inside the buffer window. */
  peek(action: Action, window = this.cfg.bufferWindow): BufferedPress | undefined {
    for (const p of this.presses) {
      if (p.action === action && !p.consumed && this._now - p.time <= window) return p;
    }
    return undefined;
  }

  /** Presses still waiting to be used, oldest first. Read only; for the debug HUD. */
  get pending(): readonly BufferedPress[] {
    return this.presses.filter((p) => !p.consumed && this._now - p.time <= this.cfg.bufferWindow);
  }

  consume(...presses: BufferedPress[]): void {
    for (const p of presses) p.consumed = true;
  }

  /** Drops buffered presses (all, or one action). Used on hit stun so stale mashing doesn't fire. */
  flush(action?: Action): void {
    for (const p of this.presses) if (!action || p.action === action) p.consumed = true;
  }

  // ------------------------------------------------------------------ holds

  isHeld(action: Action): boolean {
    return this.holdStart.has(action);
  }

  /** Seconds the button has been held, or 0 if it is up. */
  heldFor(action: Action): number {
    const t = this.holdStart.get(action);
    return t === undefined ? 0 : this._now - t;
  }

  /**
   * Seconds between the latest press of `action` and the one before it.
   * Used to stop block-spamming from farming the perfect block window.
   */
  pressGap(action: Action): number {
    const last = this.lastPressAt.get(action);
    const prev = this.prevPressAt.get(action);
    return last === undefined || prev === undefined ? Infinity : last - prev;
  }

  // --------------------------------------------------------- 360 stick spin

  hasSpinGesture(): boolean {
    return this._now - this.spinGestureAt <= this.cfg.spinGestureLifetime;
  }

  /**
   * Which way the last completed 360 went, as seen on the stick (screen space, y up).
   * Clockwise there is clockwise seen from above her, so the spin can turn the same way.
   */
  get spinGestureDirection(): 'clockwise' | 'counterclockwise' {
    return this.spinGestureClockwise ? 'clockwise' : 'counterclockwise';
  }

  consumeSpinGesture(): void {
    this.spinGestureAt = -Infinity;
  }

  private trackStickGesture(sample: RawInputSample): void {
    const trail = this.stickTrail;

    // Dropping through the center breaks the circle. This filters out stick flicks.
    if (length(sample.stick) < this.cfg.gestureDeadzone) {
      trail.length = 0;
      return;
    }

    trail.push({ time: sample.time, angle: Math.atan2(sample.stick.y, sample.stick.x) });
    while (trail.length && sample.time - trail[0].time > this.cfg.spinMaxDuration) trail.shift();

    // Net signed sweep. Wiggling back and forth cancels out; only a real circle adds up.
    let sweep = 0;
    for (let i = 1; i < trail.length; i++) sweep += wrapAngle(trail[i].angle - trail[i - 1].angle);

    if (Math.abs(sweep) >= this.cfg.spinMinSweep) {
      this.spinGestureAt = sample.time;
      this.spinGestureClockwise = sweep < 0; // atan2 angles grow counterclockwise
      trail.length = 0;
    }
  }

  private prune(): void {
    this.presses = this.presses.filter((p) => !p.consumed && this._now - p.time <= this.cfg.bufferWindow);
  }
}
