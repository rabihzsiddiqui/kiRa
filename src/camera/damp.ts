import { wrapAngle } from '../core/math';

/**
 * Critically damped spring toward a moving goal: no ringing, no jitter, and it
 * stays smooth when the goal jumps. `time` is roughly how long it takes to get there.
 * (The Game Programming Gems 4 approximation, the same one Unity's SmoothDamp uses.)
 */
export class Spring {
  velocity = 0;

  constructor(public value = 0) {}

  to(goal: number, time: number, dt: number): number {
    if (dt <= 0) return this.value;
    const omega = 2 / Math.max(time, 1e-4);
    const x = omega * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = this.value - goal;
    const temp = (this.velocity + omega * change) * dt;
    this.velocity = (this.velocity - omega * temp) * decay;
    // No overshoot clamp (Unity has one): with a moving goal it fires as the spring catches
    // up and zeroes the velocity, which shows as a one-frame hitch. Critically damped
    // means it won't ring anyway.
    this.value = goal + (change + temp) * decay;
    return this.value;
  }

  /** Same, but takes the short way around the circle. */
  toAngle(goal: number, time: number, dt: number): number {
    return this.to(this.value + wrapAngle(goal - this.value), time, dt);
  }

  snap(value: number): void {
    this.value = value;
    this.velocity = 0;
  }
}

/**
 * A one-shot camera effect: ramps in, holds, then eases out.
 * Used for FOV punches, dutch roll, push-ins and shake strength.
 */
export class Pulse {
  private amount = 0;
  private t = Infinity;
  private attack = 0;
  private hold = 0;
  private release = 1;

  fire(amount: number, attack: number, hold: number, release: number): void {
    this.amount = amount;
    this.t = 0;
    this.attack = attack;
    this.hold = hold;
    this.release = Math.max(release, 1e-4);
  }

  /** Skip the rest of the hold and start easing out now. */
  letGo(): void {
    if (this.t < this.attack + this.hold) this.hold = Math.max(0, this.t - this.attack);
  }

  update(dt: number): void {
    this.t += dt;
  }

  get value(): number {
    const { t, attack, hold, release, amount } = this;
    if (t < attack) return amount * smoothstep(t / attack);
    if (t <= attack + hold) return amount;
    const k = 1 - (t - attack - hold) / release;
    return k > 0 ? amount * smoothstep(k) : 0;
  }
}

export const smoothstep = (k: number): number => {
  const x = Math.max(0, Math.min(1, k));
  return x * x * (3 - 2 * x);
};
