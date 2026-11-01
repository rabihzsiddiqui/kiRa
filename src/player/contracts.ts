import type { EventBus } from '../core/EventBus';
import type { Vec2 } from '../core/math';
import type { CameraBasis } from '../combat/direction';
import type { AttackDef, AttackId, EvadeId } from '../combat/moves';
import type { InputBuffer } from '../input/InputBuffer';
import type { State } from '../fsm/StateMachine';

/**
 * Everything the player FSM touches goes through these interfaces.
 * Swap the implementations (Three.js + Rapier, Unity, a headless test fake)
 * and the gameplay code does not change.
 */

/** Physics module: kinematic capsule. Owns position, gravity, collision, slopes. */
export interface CharacterMotor {
  readonly position: Readonly<Vec2>;
  readonly facing: Readonly<Vec2>; // unit, planar
  readonly grounded: boolean;
  /** Desired planar velocity for this frame. The motor resolves collisions. */
  setPlanarVelocity(v: Vec2): void;
  /** Rotate toward `dir`, limited to `turnRate` rad/s. Use Infinity to snap. */
  turnToward(dir: Vec2, turnRate: number, dt: number): void;
  /** Vertical launch for hops, flips and the jump attack. */
  launch(upSpeed: number): void;
}

/** Targeting module: decides IF we are locked and ON WHAT. The FSM only asks. */
export interface TargetingQuery {
  readonly isLocked: boolean;
  /**
   * Target button on with nothing to lock (Zelda's Z with no enemy): she keeps her
   * facing and strafes, the camera sits behind her. Never true while isLocked.
   */
  readonly isViewLocked: boolean;
  /** Something targetable is within range, wherever the camera points (locked or not). */
  readonly targetNearby: boolean;
  /** Unit planar direction from the player to the target, or null if none. */
  directionToTarget(): Vec2 | null;
  distanceToTarget(): number;
}

/** Animation module. States request clips; blending and root motion live elsewhere. */
export interface Animator {
  play(clip: string, blendTime?: number): void;
  setFloat(param: string, value: number): void;
}

/** Combat module: owns hitbox overlap tests, hit stop, damage application. */
export interface CombatSink {
  setHitboxActive(attack: AttackDef, active: boolean): void;
}

export interface PlayerEvents extends Record<string, unknown> {
  stateChanged: { from: PlayerStateId | null; to: PlayerStateId };
  attackStarted: { attack: AttackId; combo: number };
  evadeStarted: { evade: EvadeId; dir: Vec2 };
  spinChargeReady: Record<string, never>;
  guardImpact: { from: Vec2 };
  hurt: { damage: number; from: Vec2 };
  /** Feel module: slow-mo, afterimages, camera. Combat module: nothing (she wasn't hit). */
  perfectDodge: { from: Vec2; evade: EvadeId; dir: Vec2 };
  /** Combat module: stagger + poise damage on the attacker. Feel module: clash VFX, hit stop. */
  perfectBlock: { from: Vec2; chain: number };
}

export interface PlayerTuning {
  runSpeed: number;
  strafeSpeed: number;
  guardMoveSpeed: number;
  chargeMoveSpeed: number;
  turnRate: number; // rad/s, free movement
  lockTurnRate: number; // rad/s, snapping to face the target
  dirDeadzone: number;
  untargetedFrame: 'character' | 'camera';
  maxCombo: number;
  chargeDelay: number; // hold Attack this long (with no move pending) to start charging
  spinChargeTime: number; // charge needed for release to fire a spin
  guardArcDeg: number; // total frontal arc that blocks
  guardRecoilTime: number;
  guardPushback: number;
  hitStunTime: number;
  hitKnockback: number;

  // ---- Stellar Blade layer
  /** A hit landing within this long after an evade starts is a perfect dodge. */
  perfectDodgeWindow: number;
  /** A frontal hit landing within this long after Block was pressed is a perfect block. */
  perfectBlockWindow: number;
  /** Re-pressing Block faster than this voids the perfect window (anti-mash). 0 disables. */
  perfectBlockSpamLockout: number;
  perfectDodgeDuration: number; // player-time length of the acrobatic flip
  perfectBlockDuration: number; // player-time length of the clash pose
}

export const DEFAULT_TUNING: PlayerTuning = {
  runSpeed: 6,
  strafeSpeed: 4,
  guardMoveSpeed: 1.5,
  chargeMoveSpeed: 1.2,
  turnRate: 14,
  lockTurnRate: 20,
  dirDeadzone: 0.3,
  untargetedFrame: 'character',
  maxCombo: 4,
  chargeDelay: 0.35,
  spinChargeTime: 0.8,
  guardArcDeg: 120,
  guardRecoilTime: 0.25,
  guardPushback: 3,
  hitStunTime: 0.4,
  hitKnockback: 4,
  perfectDodgeWindow: 0.15,
  perfectBlockWindow: 0.12,
  perfectBlockSpamLockout: 0.35,
  perfectDodgeDuration: 0.55,
  perfectBlockDuration: 0.45,
};

export interface PlayerContext {
  input: InputBuffer;
  motor: CharacterMotor;
  targeting: TargetingQuery;
  /** Getter so the camera can update its basis every frame without the FSM caring. */
  readonly camera: CameraBasis;
  animator: Animator;
  combat: CombatSink;
  events: EventBus<PlayerEvents>;
  tuning: PlayerTuning;
}

export enum PlayerStateId {
  Grounded = 'Grounded', // substates by blend: Idle / Run / Strafe
  Airborne = 'Airborne',
  Evade = 'Evade', // Roll / SideHopLeft / SideHopRight / Backflip
  Attack = 'Attack', // Horizontal / ReverseHorizontal / Vertical / Thrust / Spin / JumpAttack
  SpinCharge = 'SpinCharge',
  Guard = 'Guard',
  GuardRecoil = 'GuardRecoil',
  HitStun = 'HitStun',
  PerfectDodge = 'PerfectDodge', // acrobatic flip + slow-mo, opens PhantomDash counter
  PerfectBlock = 'PerfectBlock', // clash + stagger, opens Overpower counter
}

export interface Defense {
  invulnerable: boolean;
  guarding: boolean;
  /** Set during the perfect window of an evade; carries what the flip should continue. */
  perfectDodge?: { evade: EvadeId; dir: Vec2 };
  /** Set while a frontal block would count as perfect. */
  perfectBlock?: boolean;
}

/** Player states can report their defensive status so hit resolution stays in one place. */
export interface PlayerState extends State<PlayerStateId, PlayerContext> {
  defense?(ctx: PlayerContext): Defense;
}

export interface IncomingHit {
  damage: number;
  /** Attacker's planar position (used for frontal block check and knockback). */
  sourcePosition: Vec2;
  /** Live reference to the attacker, so perfect counters can chase a moving enemy. */
  attacker?: { readonly position: Readonly<Vec2> };
  unblockable?: boolean;
}

export type HitResult = 'evaded' | 'blocked' | 'hit' | 'perfectDodge' | 'perfectBlock';
