import { dot, normalize, sub } from '../core/math';
import { StateMachine } from '../fsm/StateMachine';
import {
  PlayerStateId,
  type Defense,
  type HitResult,
  type IncomingHit,
  type PlayerContext,
  type PlayerState,
} from './contracts';
import { AttackState } from './states/AttackState';
import { EvadeState } from './states/EvadeState';
import { GuardRecoilState, GuardState, HitStunState, SpinChargeState } from './states/DefenseStates';
import { AirborneState, GroundedState } from './states/GroundedState';
import {
  PerfectBlockState,
  PerfectDodgeState,
  type PerfectBlockParams,
  type PerfectDodgeParams,
} from './states/PerfectStates';

/**
 * Owns the player FSM and is the single entry point for incoming damage.
 * It does not read devices, move the camera or run physics; it only turns
 * buffered intent into motor/animator/combat requests.
 */
export class PlayerController {
  readonly fsm: StateMachine<PlayerStateId, PlayerContext, PlayerState>;
  private readonly perfectBlock = new PerfectBlockState();

  constructor(readonly ctx: PlayerContext) {
    this.fsm = new StateMachine<PlayerStateId, PlayerContext, PlayerState>(ctx)
      .add(new GroundedState())
      .add(new AirborneState())
      .add(new AttackState())
      .add(new EvadeState())
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
