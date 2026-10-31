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
  /**
   * Fraction of each point's velocity RELATIVE TO THE TIE kept per substep. Damps the
   * swing and wobble without making the hair lag behind when she simply moves.
   */
  damping: number;
  gravity: number;
  iterations: number;
  substep: number;
  /** Max bend between one segment and the next, degrees. A braid is fairly stiff. */
  coneDeg: number;
  /** How far the first segment may swing from restDir at the tie, degrees. Wide: it hangs. */
  rootConeDeg: number;
  /** 0..1 pull toward the rest shape per iteration. 0 = gravity alone shapes it. */
  restPull: number;
  /** Direction the hair leaves the tie, in head space (right, up, back). Only limits the first segment. */
  restDir: Vec3;
  /** Root may move this far per substep; beyond that the whole chain is carried along. */
  maxRootStep: number;
  /**
   * Air drag, per second, on each point's speed through the world. Calms the chain's
   * response to every footfall and lets the hair trail back when she runs.
   */
  airDrag: number;
}

/**
 * A heavy braid from a high tie: it hangs straight down under gravity and drapes over the
 * back of her head (the head collider does that), swings when she moves, and settles
 * quickly instead of wobbling.
 */
export const DEFAULT_PONYTAIL: PonytailConfig = {
  segments: 9,
  segmentLength: 0.058,
  damping: 0.965,
  gravity: 9.8,
  iterations: 4,
  substep: 1 / 120,
  coneDeg: 28,
  rootConeDeg: 75,
  restPull: 0,
  restDir: { x: 0, y: -0.6, z: 0.8 }, // leaves the tie down and back
  maxRootStep: 0.08,
  airDrag: 1.2,
};

export class Ponytail {
  readonly cfg: PonytailConfig;
  /** points[0] is the socket. points.length = segments + 1. */
  readonly points: Vec3[];
  private readonly prev: Vec3[];
  private acc = 0;
  private started = false;
  /** Where the socket was at the end of the last update, so substeps can follow its path. */
  private lastSocket: Vec3 = { x: 0, y: 0, z: 0 };

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
    this.lastSocket = { ...socket };
  }

  /**
   * Advance by `dt` (player-scaled seconds). Steps in fixed substeps; leftover time
   * carries over to the next call.
   */
  update(dt: number, socket: Vec3, head: HeadFrame, colliders: readonly Sphere[] = []): void {
    if (!this.started) this.reset(socket, head);
    const step = this.cfg.substep;
    const span = Math.max(0, dt);
    const acc0 = this.acc;
    this.acc = Math.min(this.acc + span, step * 8); // never spiral
    // Each substep sees the socket where it was at that moment in the frame, not where it
    // ends up. Otherwise the root jumps on the first substep and sits still for the rest,
    // and its speed flickers with however many substeps the frame happened to need.
    let j = 0;
    while (this.acc >= step) {
      this.acc -= step;
      j++;
      const f = span > 0 ? Math.min(1, (j * step - acc0) / span) : 1;
      const at = {
        x: this.lastSocket.x + (socket.x - this.lastSocket.x) * f,
        y: this.lastSocket.y + (socket.y - this.lastSocket.y) * f,
        z: this.lastSocket.z + (socket.z - this.lastSocket.z) * f,
      };
      this.step(at, head, colliders);
    }
    this.lastSocket = { ...socket };
  }

  /**
   * Points to draw this frame. The chain steps at 120 Hz but frames come at any rate, so
   * drawing the raw points makes the hair hop by a different amount each frame (it reads
   * as fidgeting). This blends between the last two substeps by the leftover time, then
   * pins the root to where the socket is right now, easing that correction down the chain.
   */
  renderPoints(socket: Vec3, out: Vec3[] = this.points.map(() => ({ x: 0, y: 0, z: 0 }))): Vec3[] {
    const k = this.acc / this.cfg.substep;
    const n = this.points.length;
    for (let i = 0; i < n; i++) {
      const a = this.prev[i];
      const b = this.points[i];
      const o = out[i];
      o.x = a.x + (b.x - a.x) * k;
      o.y = a.y + (b.y - a.y) * k;
      o.z = a.z + (b.z - a.z) * k;
    }
    const dx = socket.x - out[0].x;
    const dy = socket.y - out[0].y;
    const dz = socket.z - out[0].z;
    for (let i = 0; i < n; i++) {
      const w = 1 - i / (n - 1);
      out[i].x += dx * w;
      out[i].y += dy * w;
      out[i].z += dz * w;
    }
    return out;
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
    const tieV = sub(socket, x[0]); // how far the tie moved this substep
    x[0] = { ...socket };
    prev[0] = { ...socket };

    // 2. Verlet integrate. Swinging relative to the tie is damped hard (a heavy braid
    //    settles, it doesn't wobble); air drag is light, so running only trails it back.
    const drag = Math.max(0, 1 - cfg.airDrag * dt);
    for (let i = 1; i < x.length; i++) {
      const raw = sub(x[i], prev[i]);
      const v = scale(add(tieV, scale(sub(raw, tieV), cfg.damping)), drag);
      prev[i] = x[i];
      x[i] = add(add(x[i], v), { x: 0, y: -cfg.gravity * dt * dt, z: 0 });
    }

    // 3. Constraints. Follow-the-leader keeps every segment exactly its length.
    const before = x.map((p) => ({ ...p }));
    const rest = toWorld(norm(cfg.restDir), head);
    const cosCone = Math.cos((cfg.coneDeg * Math.PI) / 180);
    const cosRoot = Math.cos((cfg.rootConeDeg * Math.PI) / 180);
    for (let it = 0; it < cfg.iterations; it++) {
      let parentDir = rest;
      for (let i = 1; i < x.length; i++) {
        let d = norm(sub(x[i], x[i - 1]), parentDir);
        d = coneLimit(d, parentDir, i === 1 ? cosRoot : cosCone);
        if (cfg.restPull > 0) d = norm(add(scale(d, 1 - cfg.restPull), scale(rest, cfg.restPull)), d);
        let p = add(x[i - 1], scale(d, cfg.segmentLength));
        for (const s of colliders) p = pushOut(p, s);
        // Re-length after the push so a collision can never stretch the chain.
        d = norm(sub(p, x[i - 1]), d);
        x[i] = add(x[i - 1], scale(d, cfg.segmentLength));
        parentDir = d;
      }
    }

    // 4. Follow-the-leader on its own pumps energy into the end of the chain (the tip
    //    whips instead of settling). Dynamic FTL (Mueller et al. 2012): each point gives
    //    back most of the correction its child just received, as velocity.
    for (let i = 1; i < x.length - 1; i++) {
      const childFix = sub(x[i + 1], before[i + 1]);
      prev[i] = add(prev[i], scale(childFix, FTL_DAMPING));
    }
  }
}

/** Share of the child's correction fed back as velocity (the paper suggests about 0.9). */
const FTL_DAMPING = 0.9;

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
