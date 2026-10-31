import type { Vec3 } from '../physics/space';

/*
 * Ponytail: a verlet chain hanging from a socket on the head (docs/ARCHITECTURE.md §8).
 * Engine-free: points in, points out. The render layer draws a tube along them.
 *
 * Runs on the PLAYER clock in fixed 120 Hz substeps, so her hair slows with her in slow-mo.
 */

export interface Sphere {
  center: Vec3;
  radius: number;
}

/** Head orientation, for the rest shape. Unit vectors in world space. */
export interface HeadFrame {
  right: Vec3;
  up: Vec3;
  back: Vec3;
}

export interface PonytailConfig {
  segments: number;
  segmentLength: number;
  /** Fraction of velocity kept per substep. */
  damping: number;
  gravity: number;
  iterations: number;
  substep: number;
  /** Max bend between one segment and the next, degrees. */
  coneDeg: number;
  /** 0..1 pull toward the rest shape per iteration. Weak, so it still swings. */
  restPull: number;
  /** Rest direction of the hair in head space (right, up, back). */
  restDir: Vec3;
  /** Root may move this far per substep; beyond that the whole chain is carried along. */
  maxRootStep: number;
}

export const DEFAULT_PONYTAIL: PonytailConfig = {
  segments: 7,
  segmentLength: 0.065,
  damping: 0.985,
  gravity: 9.8,
  iterations: 4,
  substep: 1 / 120,
  coneDeg: 35,
  restPull: 0.04,
  restDir: { x: 0, y: -0.75, z: 0.66 }, // down and back
  maxRootStep: 0.08,
};

export class Ponytail {
  readonly cfg: PonytailConfig;
  /** points[0] is the socket. points.length = segments + 1. */
  readonly points: Vec3[];
  private readonly prev: Vec3[];
  private acc = 0;
  private started = false;

  constructor(cfg: Partial<PonytailConfig> = {}) {
    this.cfg = { ...DEFAULT_PONYTAIL, ...cfg };
    const n = this.cfg.segments + 1;
    this.points = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
    this.prev = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
  }

  /** Lay the chain out in its rest shape at `socket`, at rest. */
  reset(socket: Vec3, head: HeadFrame): void {
    const dir = toWorld(norm(this.cfg.restDir), head);
    for (let i = 0; i < this.points.length; i++) {
      const p = add(socket, scale(dir, i * this.cfg.segmentLength));
      this.points[i] = p;
      this.prev[i] = { ...p };
    }
    this.started = true;
  }

  /**
   * Advance by `dt` (player-scaled seconds). Steps in fixed substeps; leftover time
   * carries over to the next call.
   */
  update(dt: number, socket: Vec3, head: HeadFrame, colliders: readonly Sphere[] = []): void {
    if (!this.started) this.reset(socket, head);
    this.acc = Math.min(this.acc + Math.max(0, dt), this.cfg.substep * 8); // never spiral
    while (this.acc >= this.cfg.substep) {
      this.acc -= this.cfg.substep;
      this.step(socket, head, colliders);
    }
  }

  private step(socket: Vec3, head: HeadFrame, colliders: readonly Sphere[]): void {
    const { points: x, prev, cfg } = this;
    const dt = cfg.substep;

    // 1. Root: follow the socket, but never jump more than maxRootStep. Anything beyond
    //    carries the whole chain (Phantom Dash moves 9 m fast; the hair must not whip).
    const move = sub(socket, x[0]);
    const dist = len(move);
    if (dist > cfg.maxRootStep) {
      const carry = scale(move, 1 - cfg.maxRootStep / dist);
      for (let i = 0; i < x.length; i++) {
        x[i] = add(x[i], carry);
        prev[i] = add(prev[i], carry);
      }
    }
    x[0] = { ...socket };
    prev[0] = { ...socket };

    // 2. Verlet integrate: keep momentum (damped), add gravity.
    for (let i = 1; i < x.length; i++) {
      const v = scale(sub(x[i], prev[i]), cfg.damping);
      prev[i] = x[i];
      x[i] = add(add(x[i], v), { x: 0, y: -cfg.gravity * dt * dt, z: 0 });
    }

    // 3. Constraints. Follow-the-leader keeps every segment exactly its length.
    const rest = toWorld(norm(cfg.restDir), head);
    const cosCone = Math.cos((cfg.coneDeg * Math.PI) / 180);
    for (let it = 0; it < cfg.iterations; it++) {
      let parentDir = rest;
      for (let i = 1; i < x.length; i++) {
        let d = norm(sub(x[i], x[i - 1]), parentDir);
        d = coneLimit(d, parentDir, cosCone);
        d = norm(add(scale(d, 1 - cfg.restPull), scale(rest, cfg.restPull)), d);
        let p = add(x[i - 1], scale(d, cfg.segmentLength));
        for (const s of colliders) p = pushOut(p, s);
        // Re-length after the push so a collision can never stretch the chain.
        d = norm(sub(p, x[i - 1]), d);
        x[i] = add(x[i - 1], scale(d, cfg.segmentLength));
        parentDir = d;
      }
    }
  }
}

// --------------------------------------------------------------- vector math

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);

/** Unit vector, or `fallback` when `a` is (nearly) zero. */
function norm(a: Vec3, fallback: Vec3 = { x: 0, y: -1, z: 0 }): Vec3 {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : fallback;
}

function toWorld(local: Vec3, h: HeadFrame): Vec3 {
  return add(add(scale(h.right, local.x), scale(h.up, local.y)), scale(h.back, local.z));
}

/** Rotate unit `d` toward unit `axis` until the angle between them is within the cone. */
function coneLimit(d: Vec3, axis: Vec3, cosCone: number): Vec3 {
  const c = dot(d, axis);
  if (c >= cosCone) return d;
  // Component of d perpendicular to the axis, rebuilt at exactly the cone angle.
  const perp = norm(sub(d, scale(axis, c)), { x: axis.y, y: -axis.x, z: 0 });
  const sinCone = Math.sqrt(1 - cosCone * cosCone);
  return add(scale(axis, cosCone), scale(perp, sinCone));
}

function pushOut(p: Vec3, s: Sphere): Vec3 {
  const d = sub(p, s.center);
  const l = len(d);
  if (l >= s.radius) return p;
  return add(s.center, scale(norm(d, { x: 0, y: 0, z: 1 }), s.radius));
}
