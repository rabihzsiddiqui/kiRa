import type { EventBus } from '../core/EventBus';
import type { TimeController, TimeRequest } from '../core/TimeController';
import type { Vec2 } from '../core/math';
import type { CombatEvents } from '../combat/CombatWorld';
import { AttackId } from '../combat/moves';
import type { PlayerEvents } from '../player/contracts';

/**
 * "Game feel" director. Listens to gameplay events and turns them into time
 * effects (slow-mo, hit stop) and named presentation cues. It never changes
 * gameplay state, so all the spectacle can be tuned or disabled safely.
 *
 * The renderer/audio/camera implement FxSink. See docs/HANDOFF.md for what
 * each cue should look and sound like.
 */
export type FxCue =
  | 'perfectDodge'
  | 'perfectBlock'
  | 'counter.phantomDash'
  | 'counter.overpower'
  | 'spinCharge.ready'
  | 'guard.impact'
  | 'player.hurt'
  /** Her sword connected. `attack` says which, so counters can look nothing like normal hits. */
  | 'hit'
  | 'slowmo.end';

export interface FxCueData {
  at?: Vec2;
  dir?: Vec2;
  chain?: number;
  attack?: AttackId;
  /** This hit broke the target's posture. */
  broke?: boolean;
}

export interface FxSink {
  cue(name: FxCue, data: FxCueData): void;
}

export interface FeelTuning {
  perfectDodgeSlowmo: TimeRequest;
  perfectBlockHitStop: number;
  perfectBlockSlowmo: TimeRequest;
  /** Applied when a counter starts: world stays slow, she snaps to full speed. */
  counterRelease: TimeRequest;
  guardHitStop: number;
  hurtHitStop: number;
  /** Her ordinary hits: a tiny freeze so contact reads. */
  hitStop: number;
  /** Phantom Dash and Overpower landing: the iaido beat. */
  counterHitStop: number;
  /** Any hit that breaks posture. */
  breakHitStop: number;
}

export const DEFAULT_FEEL: FeelTuning = {
  perfectDodgeSlowmo: { world: 0.15, player: 0.55, hold: 0.55, easeOut: 0.35 },
  perfectBlockHitStop: 0.07,
  perfectBlockSlowmo: { world: 0.35, player: 0.8, hold: 0.2, easeOut: 0.2 },
  counterRelease: { world: 0.3, player: 1, hold: 0.12, easeOut: 0.25 },
  guardHitStop: 0.04,
  hurtHitStop: 0.06,
  hitStop: 0.035,
  counterHitStop: 0.09,
  breakHitStop: 0.12,
};

const isCounter = (a: AttackId) => a === AttackId.PhantomDash || a === AttackId.Overpower;

export class CombatFeel {
  private unsubs: Array<() => void> = [];
  private wasSlow = false;

  constructor(
    events: EventBus<PlayerEvents>,
    private readonly time: TimeController,
    private readonly fx: FxSink,
    private readonly tuning: FeelTuning = DEFAULT_FEEL,
  ) {
    this.unsubs.push(
      events.on('perfectDodge', ({ from, dir }) => {
        this.time.request(this.tuning.perfectDodgeSlowmo);
        this.fx.cue('perfectDodge', { at: from, dir });
      }),
      events.on('perfectBlock', ({ from, chain }) => {
        this.time.hitStop(this.tuning.perfectBlockHitStop);
        this.time.request(this.tuning.perfectBlockSlowmo);
        this.fx.cue('perfectBlock', { at: from, chain });
      }),
      events.on('attackStarted', ({ attack }) => {
        if (attack === AttackId.PhantomDash || attack === AttackId.Overpower) {
          this.time.clear();
          this.time.request(this.tuning.counterRelease);
          this.fx.cue(attack === AttackId.PhantomDash ? 'counter.phantomDash' : 'counter.overpower', {});
        }
      }),
      events.on('guardImpact', ({ from }) => {
        this.time.hitStop(this.tuning.guardHitStop);
        this.fx.cue('guard.impact', { at: from });
      }),
      events.on('spinChargeReady', () => this.fx.cue('spinCharge.ready', {})),
      events.on('hurt', ({ from }) => {
        this.time.hitStop(this.tuning.hurtHitStop);
        this.fx.cue('player.hurt', { at: from });
      }),
    );
  }

  /** Her hits come from the combat module, not the player FSM, so they arrive on their own bus. */
  attachCombat(combat: EventBus<CombatEvents>): void {
    this.unsubs.push(
      combat.on('enemyHit', ({ enemy, attack, broke }) => {
        const t = this.tuning;
        this.time.hitStop(broke ? t.breakHitStop : isCounter(attack) ? t.counterHitStop : t.hitStop);
        this.fx.cue('hit', { at: { ...enemy.position }, attack, broke });
      }),
    );
  }

  /** Call after TimeController.update so post-processing can fade out with the slow-mo. */
  update(): void {
    const slow = this.time.worldScale < 0.99;
    if (this.wasSlow && !slow) this.fx.cue('slowmo.end', {});
    this.wasSlow = slow;
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
}
