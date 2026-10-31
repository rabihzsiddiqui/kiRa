/**
 * Global time scaling for slow motion and hit stop.
 *
 * Two clocks:
 *  - worldScale: enemies, projectiles, particles, ambient animation
 *  - playerScale: the player FSM + her motor (usually less slowed, so she looks fast)
 *
 * The input buffer always runs on REAL time, so buffer and counter windows feel the
 * same to the player's thumbs no matter how slow the world is.
 *
 * Nothing in gameplay calls this directly. The CombatFeel module listens to events
 * (perfectDodge, perfectBlock, ...) and requests time effects here.
 */
export interface TimeRequest {
  world: number; // target scale, 0..1
  player: number; // target scale, 0..1
  hold: number; // real seconds at full effect
  easeOut: number; // real seconds blending back to 1
}

interface Active {
  req: TimeRequest;
  t: number;
}

export class TimeController {
  worldScale = 1;
  playerScale = 1;
  private active: Active[] = [];

  request(req: TimeRequest): void {
    this.active.push({ req, t: 0 });
    this.recompute();
  }

  /** Freeze frame on impact. Short, both clocks. */
  hitStop(duration: number): void {
    this.request({ world: 0.02, player: 0.02, hold: duration, easeOut: 0 });
  }

  clear(): void {
    this.active = [];
    this.recompute();
  }

  /** Call once per frame with the real (unscaled) delta. */
  update(realDt: number): void {
    for (const a of this.active) a.t += realDt;
    this.active = this.active.filter((a) => a.t < a.req.hold + a.req.easeOut);
    this.recompute();
  }

  private recompute(): void {
    let world = 1;
    let player = 1;
    // Overlapping effects: the strongest slowdown wins per clock.
    for (const { req, t } of this.active) {
      const k = t <= req.hold ? 1 : 1 - (t - req.hold) / Math.max(req.easeOut, 1e-6);
      world = Math.min(world, lerp(1, req.world, k));
      player = Math.min(player, lerp(1, req.player, k));
    }
    this.worldScale = world;
    this.playerScale = player;
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.max(0, Math.min(1, k));
