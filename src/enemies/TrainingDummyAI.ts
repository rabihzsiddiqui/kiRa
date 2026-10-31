import { EventBus } from '../core/EventBus';
import { length, normalize, rotateToward, sub, type Vec2 } from '../core/math';
import type { Enemy } from '../combat/Enemy';
import type { AttackString, StringStep } from './strings';

export interface DummyAIConfig {
  /** Only starts a string when she is this close. */
  engageRange: number;
  /** Pause between strings. */
  cooldown: number;
  /** Turn rate toward her during windup, rad/s. */
  trackRate: number;
  /** Stops turning this long before the hitbox opens, so a late sidestep is fair. */
  trackLock: number;
  /** Extra pause after a posture break before it starts again. */
  afterStagger: number;
}

export const DEFAULT_DUMMY_AI: DummyAIConfig = {
  engageRange: 4.5, // she spawns 5 m out, so it waits for her to step in
  cooldown: 1.2,
  trackRate: 6,
  trackLock: 0.2,
  afterStagger: 0.6,
};

export interface DummyEvents extends Record<string, unknown> {
  /** Windup started on a telegraphed step. Presentation: glint, or red glow if unblockable. */
  telegraph: { enemy: Enemy; step: StringStep; stringId: string };
  /** Hitbox opened. */
  strike: { enemy: Enemy; step: StringStep; stringId: string };
  stringEnd: { enemy: Enemy; stringId: string; reason: 'done' | 'staggered' | 'disabled' };
}

export type DummyPhase = 'idle' | 'windup' | 'active' | 'recovery';

/**
 * Loops attack strings so the timing windows can be practiced. Runs on the WORLD clock.
 *
 * Parries and blocked hits do not end a string (so perfect blocks can chain through the
 * 3-hit combo). A posture break (stagger) does. It never touches the player: it only
 * opens hitboxes with Enemy.startSwing(), and CombatWorld does the rest.
 */
export class TrainingDummyAI {
  readonly events = new EventBus<DummyEvents>();
  readonly cfg: DummyAIConfig;

  enabled = true;
  /** Index into `strings`, or 'cycle' to run them all in order. */
  selection: number | 'cycle' = 'cycle';
  phase: DummyPhase = 'idle';
  /** Seconds into the current phase. */
  t = 0;
  stepIndex = 0;
  private current: AttackString | null = null;
  private cycleIndex = 0;
  private cooldown: number;

  constructor(
    readonly enemy: Enemy,
    private readonly target: () => Readonly<Vec2>,
    readonly strings: readonly AttackString[],
    cfg: Partial<DummyAIConfig> = {},
    /** Wait before the first string. */
    firstDelay = 0,
  ) {
    this.cfg = { ...DEFAULT_DUMMY_AI, ...cfg };
    this.cooldown = firstDelay;
  }

  get string(): AttackString | null {
    return this.current;
  }

  get step(): StringStep | null {
    return this.current?.steps[this.stepIndex] ?? null;
  }

  setEnabled(on: boolean): void {
    if (!on && this.current) this.endString('disabled', this.cfg.cooldown);
    this.enabled = on;
  }

  select(selection: number | 'cycle'): void {
    this.selection = selection;
    this.cycleIndex = 0;
  }

  /** WORLD-scaled dt. Call after Enemy.update(), before CombatWorld.update(). */
  update(dt: number): void {
    if (!this.enabled) return;
    const e = this.enemy;

    if (e.status === 'staggered') {
      if (this.current) this.endString('staggered', this.cfg.afterStagger);
      return;
    }

    if (this.phase === 'idle') {
      this.cooldown -= dt;
      if (this.cooldown > 0 || length(sub(this.target(), e.position)) > this.cfg.engageRange) return;
      this.startString();
      return;
    }

    const step = this.step;
    if (!step) return;
    this.t += dt;

    switch (this.phase) {
      case 'windup':
        if (this.t < step.windup - this.cfg.trackLock) this.track(dt);
        if (this.t < step.windup) return;
        // Weapon still thrown back from a parry: hold the strike until it recovers.
        if (!e.startSwing(step.attack, step.active)) {
          this.t = step.windup;
          return;
        }
        this.t -= step.windup;
        this.phase = 'active';
        this.events.emit('strike', { enemy: e, step, stringId: this.current!.id });
        return;
      case 'active':
        if (this.t < step.active) return;
        this.t -= step.active;
        this.phase = 'recovery';
        return;
      case 'recovery':
        if (this.t < step.recovery) return;
        this.t -= step.recovery;
        if (this.stepIndex + 1 < this.current!.steps.length) {
          this.stepIndex++;
          this.beginWindup();
        } else {
          this.endString('done', this.cfg.cooldown);
        }
        return;
    }
  }

  private startString(): void {
    const index = this.selection === 'cycle' ? this.cycleIndex++ % this.strings.length : this.selection;
    this.current = this.strings[index] ?? this.strings[0];
    this.stepIndex = 0;
    this.t = 0;
    this.enemy.faceToward(this.target());
    this.beginWindup();
  }

  private beginWindup(): void {
    this.phase = 'windup';
    const step = this.step!;
    if (step.telegraph) this.events.emit('telegraph', { enemy: this.enemy, step, stringId: this.current!.id });
  }

  private endString(reason: 'done' | 'staggered' | 'disabled', cooldown: number): void {
    const id = this.current?.id ?? '';
    this.enemy.cancelSwing();
    this.current = null;
    this.phase = 'idle';
    this.t = 0;
    this.stepIndex = 0;
    this.cooldown = cooldown;
    this.events.emit('stringEnd', { enemy: this.enemy, stringId: id, reason });
  }

  private track(dt: number): void {
    const d = sub(this.target(), this.enemy.position);
    if (length(d) < 1e-6) return;
    this.enemy.facing = rotateToward(this.enemy.facing, normalize(d), this.cfg.trackRate * dt);
  }
}
