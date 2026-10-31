import { EventBus } from '../core/EventBus';
import type { Vec2 } from '../core/math';
import type { CombatSink, HitResult, IncomingHit } from '../player/contracts';
import type { Enemy } from './Enemy';
import { shapeHitsCircle } from './hitShapes';
import type { AttackDef, AttackId, HitShape } from './moves';

/** The player as the combat module sees her. Game code adapts motor + controller to this. */
export interface CombatPlayer {
  readonly position: Readonly<Vec2>;
  readonly facing: Readonly<Vec2>;
  /** True while a graze would count as a perfect dodge (PlayerController.inPerfectDodgeWindow). */
  readonly inPerfectDodgeWindow: boolean;
  receiveHit(hit: IncomingHit): HitResult;
}

export interface CombatTuning {
  /** Her hurtbox radius. Matches the capsule. */
  playerRadius: number;
  /** Extra hurtbox radius during the perfect dodge window, so near misses count. */
  grazeMargin: number;
  /** Poise damage a perfect block deals to the attacker. */
  perfectBlockPoise: number;
}

export const DEFAULT_COMBAT: CombatTuning = {
  playerRadius: 0.35,
  grazeMargin: 0.75,
  perfectBlockPoise: 30,
};

export interface CombatEvents extends Record<string, unknown> {
  /** Her sword connected. `broke`: this hit filled the poise meter. */
  enemyHit: { enemy: Enemy; attack: AttackId; damage: number; broke: boolean };
  /** An enemy hitbox overlapped her. `result` is what PlayerController made of it. */
  playerHit: { enemy: Enemy; attack: string; result: HitResult };
  /** Posture broken, by her hits or by a perfect block. */
  enemyStaggered: { enemy: Enemy; cause: 'hits' | 'perfectBlock' };
}

/** A live hit area, for the debug view. */
export interface ActiveHitArea {
  owner: 'player' | 'enemy';
  label: string;
  shape: HitShape;
  origin: Readonly<Vec2>;
  facing: Readonly<Vec2>;
}

/**
 * Hitbox overlap on the ground plane. Implements CombatSink, so AttackState opens and
 * closes her hitbox; enemies open theirs with Enemy.startSwing().
 *
 * One hit per target per swing. Runs once per sim frame, after enemies update
 * (docs/ARCHITECTURE.md §2). Pure TypeScript: the same code runs in the headless tests.
 */
export class CombatWorld implements CombatSink {
  readonly events = new EventBus<CombatEvents>();
  readonly tuning: CombatTuning;

  private playerSwing: { def: AttackDef; hit: Set<Enemy> } | null = null;
  /** Last enemy swing id that already reached her, per enemy. */
  private readonly enemySwingDone = new Map<Enemy, number>();

  constructor(
    private readonly player: CombatPlayer,
    private readonly enemies: () => Iterable<Enemy>,
    tuning: Partial<CombatTuning> = {},
  ) {
    this.tuning = { ...DEFAULT_COMBAT, ...tuning };
  }

  /** The attack whose hitbox is live, if any (debug overlay). */
  get activePlayerAttack(): AttackId | null {
    return this.playerSwing?.def.id ?? null;
  }

  setHitboxActive(attack: AttackDef, active: boolean): void {
    if (active) this.playerSwing = { def: attack, hit: new Set() };
    else if (this.playerSwing?.def === attack) this.playerSwing = null;
  }

  /** Her hurtbox radius right now: inflated only while a graze would be a perfect dodge. */
  get playerHurtRadius(): number {
    const t = this.tuning;
    return t.playerRadius + (this.player.inPerfectDodgeWindow ? t.grazeMargin : 0);
  }

  update(): void {
    this.playerAttacks();
    this.enemyAttacks();
  }

  activeHitAreas(): ActiveHitArea[] {
    const areas: ActiveHitArea[] = [];
    if (this.playerSwing) {
      const { def } = this.playerSwing;
      areas.push({ owner: 'player', label: def.id, shape: def.hit, origin: this.player.position, facing: this.player.facing });
    }
    for (const e of this.enemies()) {
      if (e.alive && e.swing) {
        areas.push({ owner: 'enemy', label: e.swing.def.id, shape: e.swing.def.hit, origin: e.position, facing: e.facing });
      }
    }
    return areas;
  }

  private playerAttacks(): void {
    const swing = this.playerSwing;
    if (!swing) return;
    const { position, facing } = this.player;
    for (const e of this.enemies()) {
      if (!e.alive || swing.hit.has(e)) continue;
      if (!shapeHitsCircle(swing.def.hit, position, facing, e.position, e.radius)) continue;
      swing.hit.add(e);
      const broke = e.takeHit(swing.def.damage, swing.def.poiseDamage);
      this.events.emit('enemyHit', { enemy: e, attack: swing.def.id, damage: swing.def.damage, broke });
      if (broke) this.events.emit('enemyStaggered', { enemy: e, cause: 'hits' });
    }
  }

  private enemyAttacks(): void {
    for (const e of this.enemies()) {
      const swing = e.swing;
      if (!e.alive || !swing || this.enemySwingDone.get(e) === swing.id) continue;
      if (!shapeHitsCircle(swing.def.hit, e.position, e.facing, this.player.position, this.playerHurtRadius)) continue;

      // Counts even if she evades it: one swing gets one chance at her.
      this.enemySwingDone.set(e, swing.id);
      const result = this.player.receiveHit({
        damage: swing.def.damage,
        sourcePosition: { ...e.position },
        attacker: e,
        unblockable: swing.def.unblockable,
      });

      let broke = false;
      if (result === 'perfectBlock') broke = e.parry(this.tuning.perfectBlockPoise);
      else if (result === 'blocked') e.recoil();
      this.events.emit('playerHit', { enemy: e, attack: swing.def.id, result });
      if (broke) this.events.emit('enemyStaggered', { enemy: e, cause: 'perfectBlock' });
    }
  }
}
