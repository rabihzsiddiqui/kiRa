import { EventBus } from '../core/EventBus';
import { TimeController } from '../core/TimeController';
import { vec2, type Vec2 } from '../core/math';
import type { CameraBasis } from '../combat/direction';
import { CombatWorld, type CombatEvents } from '../combat/CombatWorld';
import { Enemy, type EnemyAttackDef } from '../combat/Enemy';
import type { AttackDef, AttackId } from '../combat/moves';
import { DUMMY_STRINGS, type AttackString } from '../enemies/strings';
import { TrainingDummyAI, type DummyAIConfig } from '../enemies/TrainingDummyAI';
import { CombatFeel, type FxCue } from '../feel/CombatFeel';
import { Action } from '../input/actions';
import { InputBuffer } from '../input/InputBuffer';
import {
  DEFAULT_TUNING,
  type HitResult,
  type PlayerContext,
  type PlayerEvents,
  type PlayerTuning,
} from '../player/contracts';
import { PlayerController } from '../player/PlayerController';
import { SimpleMotor } from '../physics/SimpleMotor';
import { TargetingSystem } from '../targeting/TargetingSystem';

export interface FrameInput {
  stick?: Vec2;
  attack?: boolean;
  evade?: boolean;
  block?: boolean;
  target?: boolean;
}

/**
 * The combat test sandbox with no renderer. Shows the intended frame order:
 *
 *   time.update(realDt)
 *   input.update(realTime)                 <- real time, never scaled
 *   targeting.update()
 *   player.update(realDt * playerScale)
 *   motor.step(realDt * playerScale)
 *   enemies.update(realDt * worldScale)
 *   combat.update()                        <- overlap tests, both directions
 *   feel.update(); camera; ponytail; render
 *
 * The browser build swaps the fakes for Three.js adapters and keeps this loop.
 */
export class HeadlessSandbox {
  readonly realDt = 1 / 60;
  frame = 0;
  realTime = 0;

  readonly input = new InputBuffer();
  readonly motor = new SimpleMotor();
  readonly time = new TimeController();
  readonly events = new EventBus<PlayerEvents>();
  readonly camera: CameraBasis = { forward: vec2(0, 1), right: vec2(1, 0) };
  readonly enemies: Enemy[] = [];
  readonly targeting: TargetingSystem;
  readonly player: PlayerController;
  readonly feel: CombatFeel;
  readonly combat: CombatWorld;
  readonly ais: TrainingDummyAI[] = [];

  /** Human-readable log, e.g. "f12 Grounded -> Attack". */
  readonly trace: string[] = [];
  readonly attacks: AttackId[] = [];
  readonly cues: FxCue[] = [];
  readonly hitboxLog: Array<{ frame: number; attack: AttackId; active: boolean }> = [];
  /** Everything CombatWorld reported, in order. */
  readonly combatLog: Array<{ frame: number } & (
    | ({ type: 'enemyHit' } & CombatEvents['enemyHit'])
    | ({ type: 'playerHit' } & CombatEvents['playerHit'])
    | ({ type: 'enemyStaggered' } & CombatEvents['enemyStaggered'])
  )> = [];

  constructor(tuning: Partial<PlayerTuning> = {}) {
    this.targeting = new TargetingSystem(this.input, this.motor, () => this.camera, () => this.enemies);
    const motor = this.motor;
    // Getters, not copies: the combat module reads her live position and state.
    const player = () => this.player;
    this.combat = new CombatWorld(
      {
        get position() { return motor.position; },
        get facing() { return motor.facing; },
        get inPerfectDodgeWindow() { return player().inPerfectDodgeWindow; },
        receiveHit: (hit) => player().receiveHit(hit),
      },
      () => this.enemies,
    );
    this.combat.events.on('enemyHit', (e) => this.combatLog.push({ frame: this.frame, type: 'enemyHit', ...e }));
    this.combat.events.on('playerHit', (e) => this.combatLog.push({ frame: this.frame, type: 'playerHit', ...e }));
    this.combat.events.on('enemyStaggered', (e) => this.combatLog.push({ frame: this.frame, type: 'enemyStaggered', ...e }));

    const ctx: PlayerContext = {
      input: this.input,
      motor: this.motor,
      targeting: this.targeting,
      camera: this.camera,
      animator: { play: () => {}, setFloat: () => {} },
      combat: {
        setHitboxActive: (def: AttackDef, active: boolean) => {
          this.hitboxLog.push({ frame: this.frame, attack: def.id, active });
          this.combat.setHitboxActive(def, active);
        },
      },
      events: this.events,
      tuning: { ...DEFAULT_TUNING, ...tuning },
    };

    this.events.on('stateChanged', ({ from, to }) => this.trace.push(`f${this.frame} ${from} -> ${to}`));
    this.events.on('attackStarted', ({ attack }) => this.attacks.push(attack));

    this.feel = new CombatFeel(this.events, this.time, { cue: (name) => this.cues.push(name) });
    this.feel.attachCombat(this.combat.events);
    this.player = new PlayerController(ctx);
  }

  addEnemy(x: number, y: number): Enemy {
    const e = new Enemy(`enemy${this.enemies.length + 1}`, vec2(x, y));
    e.faceToward(this.motor.position);
    this.enemies.push(e);
    return e;
  }

  /** Gives an enemy the training dummy AI. It starts its first string on the next step. */
  addDummyAI(
    enemy: Enemy,
    strings: readonly AttackString[] = DUMMY_STRINGS,
    cfg: Partial<DummyAIConfig> = {},
  ): TrainingDummyAI {
    const ai = new TrainingDummyAI(enemy, () => this.motor.position, strings, cfg);
    this.ais.push(ai);
    return ai;
  }

  /** The enemy turns to her and opens a hitbox for `activeFrames` (world time). Goes through CombatWorld. */
  swingFrom(enemy: Enemy, def: EnemyAttackDef, activeFrames = 6): boolean {
    enemy.faceToward(this.motor.position);
    return enemy.startSwing(def, activeFrames * this.realDt);
  }

  step(f: FrameInput = {}): void {
    this.frame++;
    this.realTime = this.frame * this.realDt;
    this.time.update(this.realDt);

    this.input.update({
      time: this.realTime,
      stick: f.stick ?? vec2(),
      buttons: {
        [Action.Attack]: !!f.attack,
        [Action.Evade]: !!f.evade,
        [Action.Block]: !!f.block,
        [Action.Target]: !!f.target,
      },
    });
    this.targeting.update();

    const playerDt = this.realDt * this.time.playerScale;
    this.player.update(playerDt);
    this.motor.step(playerDt);

    const worldDt = this.realDt * this.time.worldScale;
    for (const e of this.enemies) e.update(worldDt);
    for (const ai of this.ais) ai.update(worldDt);
    this.combat.update();

    this.feel.update();
  }

  run(frames: number, f: FrameInput = {}): void {
    for (let i = 0; i < frames; i++) this.step(f);
  }

  /** Forces an enemy hit on her this frame, skipping the overlap test. For FSM-only tests. */
  hitFrom(enemy: { position: Vec2 }, opts: { damage?: number; unblockable?: boolean } = {}): HitResult {
    return this.player.receiveHit({
      damage: opts.damage ?? 1,
      sourcePosition: { ...enemy.position },
      attacker: enemy,
      unblockable: opts.unblockable,
    });
  }
}
