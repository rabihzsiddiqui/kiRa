import { length, normalize, sub, vec2, type Vec2 } from '../core/math';
import type { HitShape } from './moves';

/** One enemy swing. Phase 4 builds strings (telegraph, wind-up, follow-ups) out of these. */
export interface EnemyAttackDef {
  id: string;
  damage: number;
  hit: HitShape;
  unblockable?: boolean;
}

export interface PoiseConfig {
  /** Poise damage needed to break posture. */
  max: number;
  /** Seconds without taking poise damage before the meter starts draining. */
  regenDelay: number;
  /** Meter drained per second after the delay. */
  regenRate: number;
}

export interface EnemyConfig {
  radius: number;
  poise: PoiseConfig;
  /** Weapon bounced off a normal block. */
  recoilTime: number;
  /** Weapon thrown back by a perfect block. */
  parryTime: number;
  /** Posture broken (poise full). Wide open. */
  staggerTime: number;
}

export const DEFAULT_ENEMY: EnemyConfig = {
  radius: 0.35,
  poise: { max: 100, regenDelay: 2, regenRate: 25 },
  // Both short: a string's next hit must still land inside her PerfectBlock state
  // (src/enemies/strings.ts, combo3), or perfect blocks could not chain.
  recoilTime: 0.15,
  parryTime: 0.15,
  staggerTime: 1.2,
};

/**
 * Posture meter. Hits and perfect blocks fill it; full breaks posture (stagger) and
 * resets it. It drains back down if the pressure stops.
 */
export class Poise {
  value = 0;
  private sinceHit = Infinity;

  constructor(readonly cfg: PoiseConfig) {}

  /** Returns true if this broke posture. */
  add(amount: number): boolean {
    if (amount <= 0) return false;
    this.sinceHit = 0;
    this.value += amount;
    if (this.value < this.cfg.max) return false;
    this.value = 0;
    return true;
  }

  update(dt: number): void {
    this.sinceHit += dt;
    if (this.sinceHit >= this.cfg.regenDelay) this.value = Math.max(0, this.value - this.cfg.regenRate * dt);
  }
}

/**
 * ready     can act
 * recoil    weapon bounced off her guard (short)
 * parried   weapon thrown back by a perfect block (short, string AI decides if it continues)
 * staggered posture broken (long, wide open)
 */
export type EnemyStatus = 'ready' | 'recoil' | 'parried' | 'staggered';

export interface EnemySwing {
  readonly id: number;
  readonly def: EnemyAttackDef;
  /** World-time seconds the hitbox stays live. */
  remaining: number;
}

/**
 * Combat-side enemy: a body with a hurtbox, a facing, poise and a live swing.
 * No AI here. Phase 4's dummy drives startSwing(); CombatWorld does the overlap tests.
 * Runs on the WORLD clock. Structurally a Targetable (position, alive), so it can be locked on to.
 */
export class Enemy {
  readonly cfg: EnemyConfig;
  readonly poise: Poise;
  position: Vec2;
  facing: Vec2 = vec2(0, -1);
  alive = true;
  status: EnemyStatus = 'ready';
  /** Seconds left in the current status (0 when ready). */
  statusTime = 0;
  swing: EnemySwing | null = null;
  damageTaken = 0;
  private nextSwingId = 1;

  constructor(
    readonly name: string,
    position: Vec2,
    cfg: Partial<EnemyConfig> = {},
  ) {
    this.cfg = { ...DEFAULT_ENEMY, ...cfg };
    this.poise = new Poise(this.cfg.poise);
    this.position = { ...position };
  }

  get radius(): number {
    return this.cfg.radius;
  }

  faceToward(p: Readonly<Vec2>): void {
    const d = sub(p, this.position);
    if (length(d) > 1e-6) this.facing = normalize(d);
  }

  /** Opens a hitbox for `activeTime` world seconds. Refused unless ready. */
  startSwing(def: EnemyAttackDef, activeTime: number): boolean {
    if (this.status !== 'ready') return false;
    this.swing = { id: this.nextSwingId++, def, remaining: activeTime };
    return true;
  }

  cancelSwing(): void {
    this.swing = null;
  }

  /** Her sword connected. Returns true if it broke posture. */
  takeHit(damage: number, poiseDamage: number): boolean {
    this.damageTaken += damage;
    const broke = this.poise.add(poiseDamage);
    if (broke) this.setStatus('staggered', this.cfg.staggerTime);
    return broke;
  }

  /** Normal block: the weapon bounces off. */
  recoil(): void {
    if (this.status !== 'staggered') this.setStatus('recoil', this.cfg.recoilTime);
  }

  /** Perfect block: weapon thrown back plus poise damage. Returns true if posture broke. */
  parry(poiseDamage: number): boolean {
    if (this.poise.add(poiseDamage)) {
      this.setStatus('staggered', this.cfg.staggerTime);
      return true;
    }
    if (this.status !== 'staggered') this.setStatus('parried', this.cfg.parryTime);
    return false;
  }

  /** WORLD-scaled dt. */
  update(dt: number): void {
    this.poise.update(dt);
    if (this.swing) {
      this.swing.remaining -= dt;
      if (this.swing.remaining <= 0) this.swing = null;
    }
    if (this.status !== 'ready') {
      this.statusTime -= dt;
      if (this.statusTime <= 0) {
        this.status = 'ready';
        this.statusTime = 0;
      }
    }
  }

  private setStatus(status: EnemyStatus, time: number): void {
    this.status = status;
    this.statusTime = time;
    this.swing = null; // any reaction interrupts the swing in progress
  }
}
