/*
 * Her expression (engine-free): what the eyes and brows are doing, from what's going on.
 * The render layer (src/render/FaceView.ts) draws it.
 *
 *   neutral    most of the time: relaxed brows, blinking now and then, eyes wandering a little
 *   alert      something targetable near: brows angle down toward the nose, a little angry
 *   locked on  the same, a little more
 *   attacking  a frown: brows down and drawn together, eyes narrowed
 *   hurt       eyes squeezed shut, brows up in the middle
 *
 * Moods come on quickly and ease off slowly, so a swing's frown lingers a moment after it.
 */

export interface FaceInput {
  /** Something targetable near, not locked on. */
  alert: boolean;
  locked: boolean;
  attacking: boolean;
  hurt: boolean;
}

/** All 0..1, except gaze (-1..1: her right, up) for the idle wander. */
export interface Expression {
  angry: number;
  frown: number;
  pain: number;
  blink: number;
  gazeX: number;
  gazeY: number;
}

export const NEUTRAL: Expression = { angry: 0, frown: 0, pain: 0, blink: 0, gazeX: 0, gazeY: 0 };

export const FACE_MOOD = {
  alert: 0.6,
  locked: 0.85,
  /** Half-lives (seconds) coming on and easing off. */
  rise: 0.05,
  fall: 0.25,
  /** Seconds between blinks, and a blink's close, hold and open. */
  blinkEvery: [2.2, 5.5] as const,
  blinkClose: 0.06,
  blinkHold: 0.03,
  blinkOpen: 0.1,
  /** Chance a blink comes as a double. */
  doubleBlink: 0.2,
};

/** Where each mood is headed for these inputs. */
export function moodFor(i: FaceInput): { angry: number; frown: number; pain: number } {
  const angry = Math.max(i.locked ? FACE_MOOD.locked : 0, i.alert ? FACE_MOOD.alert : 0, i.attacking ? FACE_MOOD.locked : 0);
  return { angry, frown: i.attacking ? 1 : 0, pain: i.hurt ? 1 : 0 };
}

export class FaceState {
  private readonly e: Expression = { ...NEUTRAL };
  private seed: number;
  private untilBlink: number;
  /** Seconds into the current blink, or -1. */
  private blinkT = -1;
  private untilGlance = 1;
  private glance = { x: 0, y: 0 };

  constructor(seed = 7) {
    this.seed = seed;
    this.untilBlink = this.between(FACE_MOOD.blinkEvery[0], FACE_MOOD.blinkEvery[1]);
  }

  update(dt: number, i: FaceInput): Expression {
    const goal = moodFor(i);
    for (const k of ['angry', 'frown', 'pain'] as const) {
      const half = goal[k] > this.e[k] ? FACE_MOOD.rise : FACE_MOOD.fall;
      this.e[k] += (goal[k] - this.e[k]) * (dt > 0 ? 1 - 2 ** (-dt / half) : 0);
    }

    // Blinks: not while her eyes are squeezed shut anyway.
    this.untilBlink -= dt;
    if (this.blinkT < 0 && this.untilBlink <= 0 && this.e.pain < 0.5) {
      this.blinkT = 0;
      this.untilBlink = this.random() < FACE_MOOD.doubleBlink ? 0.25 : this.between(FACE_MOOD.blinkEvery[0], FACE_MOOD.blinkEvery[1]);
    }
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const { blinkClose: c, blinkHold: h, blinkOpen: o } = FACE_MOOD;
      const t = this.blinkT;
      this.e.blink = t < c ? t / c : t < c + h ? 1 : Math.max(0, 1 - (t - c - h) / o);
      if (t >= c + h + o) this.blinkT = -1;
    } else {
      this.e.blink = 0;
    }

    // Idle glances: now and then the eyes settle somewhere new, quickly (a saccade).
    this.untilGlance -= dt;
    if (this.untilGlance <= 0) {
      this.untilGlance = this.between(1.2, 3.2);
      this.glance = this.random() < 0.4 ? { x: 0, y: 0 } : { x: this.between(-0.35, 0.35), y: this.between(-0.2, 0.15) };
    }
    const k = dt > 0 ? 1 - 2 ** (-dt / 0.025) : 0;
    this.e.gazeX += (this.glance.x - this.e.gazeX) * k;
    this.e.gazeY += (this.glance.y - this.e.gazeY) * k;
    return { ...this.e };
  }

  /** Small fixed generator, so she blinks the same way every run (and in tests). */
  private random(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private between(a: number, b: number): number {
    return a + (b - a) * this.random();
  }
}
