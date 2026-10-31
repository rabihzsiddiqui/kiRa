import RAPIER from '@dimforge/rapier3d-compat';
import { EventBus } from '../core/EventBus';
import { TimeController } from '../core/TimeController';
import { wrapAngle } from '../core/math';
import { CombatWorld } from '../combat/CombatWorld';
import type { CameraBasis } from '../combat/direction';
import { Enemy } from '../combat/Enemy';
import { DUMMY_STRINGS } from '../enemies/strings';
import { TrainingDummyAI } from '../enemies/TrainingDummyAI';
import { CombatFeel, type FxSink } from '../feel/CombatFeel';
import { InputBuffer } from '../input/InputBuffer';
import {
  DEFAULT_TUNING,
  type PlayerContext,
  type PlayerEvents,
  type PlayerStateId,
} from '../player/contracts';
import { PlayerController } from '../player/PlayerController';
import { RapierMotor } from '../physics/RapierMotor';
import { planarTo3, yawFromFacing, type Vec3 } from '../physics/space';
import { ThreeAnimator } from '../render/ThreeAnimator';
import { TargetingSystem } from '../targeting/TargetingSystem';
import { ARENA, buildArenaPhysics } from './arena';
import { LogFxSink } from './DebugSinks';
import type { Devices } from './input/Devices';

/** Fixed simulation step. State logic assumes this; render interpolates between steps. */
export const SIM_DT = 1 / 60;


export interface CombatLogEntry {
  at: number; // real time
  text: string;
}

interface Snapshot {
  pos: Vec3;
  yaw: number;
}

export interface Transition {
  frame: number;
  from: PlayerStateId | null;
  to: PlayerStateId;
}

/**
 * The browser sandbox's simulation: the HeadlessSandbox loop with real adapters
 * (Rapier motor, device input, a three.js-facing animator). No rendering in here,
 * so step() reads top to bottom as the frame order in docs/ARCHITECTURE.md §2.
 */
export class Game {
  frame = 0;
  realTime = 0;
  /** Seconds on the world clock. Slows down in slow-mo; the dummy sways on it. */
  worldTime = 0;

  readonly world: RAPIER.World;
  /** Level geometry (floor, walls, pillars). The camera's spring arm collides with these. */
  readonly levelColliders: RAPIER.Collider[];
  readonly input = new InputBuffer();
  readonly time = new TimeController();
  readonly events = new EventBus<PlayerEvents>();
  readonly animator = new ThreeAnimator(true);
  readonly combat: CombatWorld;
  readonly fx = new LogFxSink(() => this.realTime);
  readonly motor: RapierMotor;
  readonly targeting: TargetingSystem;
  readonly player: PlayerController;
  readonly feel: CombatFeel;
  readonly dummy: Enemy;
  readonly dummyAI: TrainingDummyAI;
  readonly enemies: Enemy[];

  readonly transitions: Transition[] = [];
  readonly combatLog: CombatLogEntry[] = [];
  /** Real time the dummy last took a hit, for the hit flash. */
  dummyHitAt = -Infinity;
  /** World time of the dummy's last telegraph, for the glint. */
  dummyTelegraphAt = -Infinity;
  /** Real time a perfect block last landed on the dummy (poise bar flash). */
  dummyParryAt = -Infinity;
  /** The attack that last broke the dummy's posture (Overpower = knockdown). */
  dummyBrokenBy: string | null = null;

  /** Presentation listeners for CombatFeel cues: the debug log, the camera, later VFX and audio. */
  private readonly fxSinks: FxSink[] = [this.fx];
  private prev: Snapshot;
  private curr: Snapshot;

  /** Call after RAPIER.init(). `camera` is read live every step. */
  constructor(
    private readonly devices: Devices,
    camera: CameraBasis,
  ) {
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    // Only static colliders and kinematic bodies so far, so the world clock does not
    // matter to Rapier yet. Once dynamic bodies exist, step them on worldScale.
    this.world.timestep = SIM_DT;
    this.levelColliders = buildArenaPhysics(this.world, ARENA);
    this.motor = new RapierMotor(this.world, ARENA.playerSpawn);
    this.world.step(); // build the broad phase so her first query finds the floor

    this.dummy = new Enemy('dummy', ARENA.dummy.position, { radius: ARENA.dummy.radius });
    this.dummy.faceToward(ARENA.playerSpawn);
    this.enemies = [this.dummy];
    this.targeting = new TargetingSystem(this.input, this.motor, () => camera, () => this.enemies);

    // The combat module sees her through getters, so it always reads live state.
    const motor = this.motor;
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
    this.combat.events.on('enemyHit', ({ enemy, attack, broke }) => {
      if (enemy === this.dummy) this.dummyHitAt = this.realTime;
      if (enemy === this.dummy && broke) this.dummyBrokenBy = attack;
      this.log(`${attack} hit ${enemy.name}${broke ? ', posture broken' : ''}`);
    });
    this.combat.events.on('playerHit', ({ enemy, attack, result }) => {
      if (enemy === this.dummy && result === 'perfectBlock') this.dummyParryAt = this.realTime;
      this.log(`${enemy.name} ${attack}: ${result}`);
    });
    this.combat.events.on('enemyStaggered', ({ enemy, cause }) => {
      if (enemy === this.dummy && cause === 'perfectBlock') this.dummyBrokenBy = 'perfectBlock';
      this.log(`${enemy.name} staggered (${cause})`);
    });

    this.dummyAI = new TrainingDummyAI(this.dummy, () => this.motor.position, DUMMY_STRINGS);
    this.dummyAI.events.on('telegraph', ({ step }) => {
      this.dummyTelegraphAt = this.worldTime;
      const string = this.dummyAI.string;
      if (string && step === string.steps[0]) this.log(`dummy: ${string.label}`);
    });
    this.dummyAI.events.on('stringEnd', ({ reason }) => {
      if (reason !== 'done') this.log(`dummy string ended (${reason})`);
    });

    const ctx: PlayerContext = {
      input: this.input,
      motor: this.motor,
      targeting: this.targeting,
      camera,
      animator: this.animator,
      combat: this.combat,
      events: this.events,
      tuning: { ...DEFAULT_TUNING },
    };

    this.events.on('stateChanged', ({ from, to }) => {
      this.transitions.unshift({ frame: this.frame, from, to });
      if (this.transitions.length > 8) this.transitions.pop();
    });

    this.feel = new CombatFeel(this.events, this.time, {
      cue: (name, data) => {
        for (const sink of this.fxSinks) sink.cue(name, data);
      },
    });
    this.feel.attachCombat(this.combat.events);
    this.player = new PlayerController(ctx);

    this.curr = this.snapshot();
    this.prev = this.curr;
  }

  addFxSink(sink: FxSink): void {
    this.fxSinks.push(sink);
  }

  /** True while an unblockable step is winding up or live (red glow). */
  get dummyGlow(): boolean {
    const ai = this.dummyAI;
    return !!ai.step?.attack.unblockable && (ai.phase === 'windup' || ai.phase === 'active');
  }

  /** 0..1 through the AI's current phase, for the dummy's arm. */
  get dummyPhaseProgress(): number {
    const { step, phase, t } = this.dummyAI;
    if (!step || phase === 'idle') return 0;
    const len = phase === 'windup' ? step.windup : phase === 'active' ? step.active : step.recovery;
    return len > 0 ? Math.min(1, t / len) : 1;
  }

  /** One fixed step. Order matters; see docs/ARCHITECTURE.md §2. */
  step(): void {
    this.frame++;
    this.realTime += SIM_DT;
    this.prev = this.curr;

    this.time.update(SIM_DT);
    this.input.update(this.devices.poll(this.realTime)); // real time, never scaled
    this.targeting.update();

    const playerDt = SIM_DT * this.time.playerScale;
    this.player.update(playerDt);
    this.animator.tick(playerDt);
    this.motor.step(playerDt);
    this.world.step();

    // Enemies run on the world clock: bodies first, then the AI that drives them.
    const worldDt = SIM_DT * this.time.worldScale;
    this.worldTime += worldDt;
    for (const e of this.enemies) e.update(worldDt);
    this.dummyAI.update(worldDt);

    this.combat.update(); // overlap tests, both directions
    this.feel.update();
    this.curr = this.snapshot();
  }

  private log(text: string): void {
    this.combatLog.unshift({ at: this.realTime, text });
    if (this.combatLog.length > 6) this.combatLog.pop();
  }

  /** Her pose between the last two steps. `alpha` = leftover accumulator / SIM_DT. */
  interpolated(alpha: number): Snapshot {
    const a = this.prev;
    const b = this.curr;
    const lerp = (x: number, y: number) => x + (y - x) * alpha;
    return {
      pos: { x: lerp(a.pos.x, b.pos.x), y: lerp(a.pos.y, b.pos.y), z: lerp(a.pos.z, b.pos.z) },
      yaw: a.yaw + wrapAngle(b.yaw - a.yaw) * alpha,
    };
  }

  private snapshot(): Snapshot {
    const m = this.motor;
    return { pos: planarTo3(m.position, m.height), yaw: yawFromFacing(m.facing) };
  }
}
