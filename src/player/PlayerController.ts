import { dot, normalize, sub } from '../core/math';
import type { AttackId } from '../combat/moves';
import { StateMachine } from '../fsm/StateMachine';
import { Action } from '../input/actions';
import {
  PlayerStateId,
  type Defense,
  type HitResult,
  type IncomingHit,
  type PlayerContext,
  type PlayerState,
} from './contracts';
import { AttackState, type AttackPhase } from './states/AttackState';
import { EvadeState } from './states/EvadeState';
import { GuardRecoilState, GuardState, HitStunState, SpinChargeState } from './states/DefenseStates';
import { AirborneState, GroundedState } from './states/GroundedState';
import {
  PerfectBlockState,
  PerfectDodgeState,
  type PerfectBlockParams,
  type PerfectDodgeParams,
} from './states/PerfectStates';

/** The sword move in progress, for the debug HUD. */
export interface AttackReadout {
  attack: AttackId;
  phase: AttackPhase;
  combo: number;
}

/** How much of each perfect window is left right now, 0..1 (0 = closed). For the debug HUD. */
export interface PerfectWindowReadout {
  dodge: number;
  block: number;
  /** Block would be in its window, but the press came too soon after the last one (anti-mash). */
  blockLockedOut: boolean;
}

/**
 * Owns the player FSM and is the single entry point for incoming damage.
 * It does not read devices, move the camera or run physics; it only turns
 * buffered intent into motor/animator/combat requests.
 */
export class PlayerController {
  readonly fsm: StateMachine<PlayerStateId, PlayerContext, PlayerState>;
  private readonly perfectBlock = new PerfectBlockState();
  private readonly attackState = new AttackState();
  private readonly evadeState = new EvadeState();
  /** The real windows, kept so the infinite-window debug switch can put them back. */
  private readonly windows: { dodge: number; block: number; lockout: number };

  constructor(readonly ctx: PlayerContext) {
    const { tuning } = ctx;
    this.windows = {
      dodge: tuning.perfectDodgeWindow,
      block: tuning.perfectBlockWindow,
      lockout: tuning.perfectBlockSpamLockout,
    };
    this.fsm = new StateMachine<PlayerStateId, PlayerContext, PlayerState>(ctx)
      .add(new GroundedState())
      .add(new AirborneState())
      .add(this.attackState)
      .add(this.evadeState)
      .add(new GuardState())
      .add(new GuardRecoilState())
      .add(new HitStunState())
      .add(new SpinChargeState())
      .add(new PerfectDodgeState())
      .add(this.perfectBlock);

    this.fsm.onTransition = (from, to) => ctx.events.emit('stateChanged', { from, to });
    this.fsm.start(PlayerStateId.Grounded);
  }

  get state(): PlayerStateId {
    return this.fsm.currentId;
  }

  /**
   * True while a hit landing now would be a perfect dodge. The combat module tests a
   * hurtbox inflated by a graze margin only then, so near misses count as perfect
   * dodges but never as hits.
   */
  get inPerfectDodgeWindow(): boolean {
    return !!this.defense().perfectDodge;
  }

  // ------------------------------------------------------------ debug readouts

  get attack(): AttackReadout | null {
    if (this.state !== PlayerStateId.Attack) return null;
    const a = this.attackState;
    return { attack: a.attack, phase: a.phase, combo: a.comboIndex };
  }

  perfectWindows(): PerfectWindowReadout {
    const { input, tuning } = this.ctx;
    const defense = this.defense();
    const left = (elapsed: number, window: number) => Math.max(0, Math.min(1, 1 - elapsed / window));

    const dodge = defense.perfectDodge ? left(this.evadeState.elapsed, tuning.perfectDodgeWindow) : 0;

    // PerfectBlock holds its window open for the next hit of a string, so it reads as full.
    const blockAge = this.state === PlayerStateId.PerfectBlock ? 0 : input.heldFor(Action.Block);
    const block = defense.perfectBlock ? left(blockAge, tuning.perfectBlockWindow) : 0;
    const blockLockedOut =
      defense.guarding &&
      !defense.perfectBlock &&
      input.isHeld(Action.Block) &&
      input.heldFor(Action.Block) <= tuning.perfectBlockWindow;

    return { dodge, block, blockLockedOut };
  }

  /**
   * Debug: every evade and every guard counts as perfect, so the spectacle can be
   * tested without nailing the timing. Turning it off restores the tuned windows.
   */
  get infinitePerfectWindows(): boolean {
    return this.ctx.tuning.perfectDodgeWindow === Infinity;
  }

  set infinitePerfectWindows(on: boolean) {
    const t = this.ctx.tuning;
    t.perfectDodgeWindow = on ? Infinity : this.windows.dodge;
    t.perfectBlockWindow = on ? Infinity : this.windows.block;
    t.perfectBlockSpamLockout = on ? 0 : this.windows.lockout;
  }

  /** Fixed-step update with PLAYER-scaled dt. Call after input + targeting, before physics. */
  update(dt: number): void {
    this.fsm.update(dt);
  }

  /**
   * Called by the combat module when an enemy hitbox overlaps her hurtbox
   * (during evades, test against a hurtbox inflated by a graze margin so
   * near misses still count as perfect dodges).
   *
   * Resolution order:
   *   perfect dodge > i-frames > (frontal) perfect block > block > hit
   */
  receiveHit(hit: IncomingHit): HitResult {
    const { motor, tuning, events } = this.ctx;
    const from = hit.attacker?.position ?? hit.sourcePosition;
    const defense = this.defense();

    // Unblockable attacks can still be perfect-dodged. That's the counterplay.
    if (defense.perfectDodge) {
      const params: PerfectDodgeParams = { from, ...defense.perfectDodge };
      this.fsm.transition(PlayerStateId.PerfectDodge, params);
      return 'perfectDodge';
    }

    if (defense.invulnerable) return 'evaded';

    if (defense.guarding && !hit.unblockable) {
      const toAttacker = normalize(sub(hit.sourcePosition, motor.position));
      const cosHalfArc = Math.cos(((tuning.guardArcDeg / 2) * Math.PI) / 180);
      if (dot(motor.facing, toAttacker) >= cosHalfArc) {
        if (defense.perfectBlock) {
          const chain = this.fsm.currentId === PlayerStateId.PerfectBlock ? this.perfectBlock.chain + 1 : 0;
          this.fsm.transition(PlayerStateId.PerfectBlock, { from, chain } satisfies PerfectBlockParams);
          return 'perfectBlock';
        }
        this.fsm.transition(PlayerStateId.GuardRecoil, { from: hit.sourcePosition });
        return 'blocked';
      }
    }

    events.emit('hurt', { damage: hit.damage, from: hit.sourcePosition });
    this.fsm.transition(PlayerStateId.HitStun, { from: hit.sourcePosition });
    return 'hit';
  }

  private defense(): Defense {
    return this.fsm.current.defense?.(this.ctx) ?? { invulnerable: false, guarding: false };
  }
}
