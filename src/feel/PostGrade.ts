import type { FxCue, FxSink } from './CombatFeel';

/** Screen and audio grade for one frame. The renderer and audio just apply these. */
export interface GradeParams {
  /** 1 = normal color, 0 = grey. */
  saturation: number;
  /** 0..1 mix toward a cool indigo. */
  tint: number;
  /** 0..1 strength of the chromatic aberration pulse. */
  aberration: number;
  /** 0..1 strength of the radial blur pulse. */
  radialBlur: number;
  /** Low-pass cutoff on world sound (enemies, ambience). Her own sounds bypass it. */
  lowpassHz: number;
}

export interface GradeTuning {
  /** Saturation at the deepest point of the perfect dodge slow-mo. */
  dodgeSaturation: number;
  dodgeTint: number;
  /** World scale that counts as "fully slowed" (the perfect dodge request). */
  slowestWorld: number;
  /** Below this world scale it is a hit stop (a freeze), not slow-mo: the grade holds. */
  hitStopBelow: number;
  /** Fastest the grade may change, per second. Smooths the counter's partial release. */
  maxRate: number;
  pulseTime: number;
  lowpassMin: number;
  lowpassMax: number;
}

export const DEFAULT_GRADE: GradeTuning = {
  dodgeSaturation: 0.3,
  dodgeTint: 0.35,
  slowestWorld: 0.15,
  hitStopBelow: 0.1,
  maxRate: 8,
  pulseTime: 0.15,
  lowpassMin: 650,
  lowpassMax: 20000,
};

const NEUTRAL: GradeParams = { saturation: 1, tint: 0, aberration: 0, radialBlur: 0, lowpassHz: 20000 };

/**
 * Director for the perfect dodge look. Cues say WHEN (perfectDodge on, slowmo.end off);
 * the world clock says HOW MUCH, so the grade eases out exactly as the slow-mo does,
 * including when a counter releases it early. Engine-free, so it is tested headless.
 */
export class PostGrade implements FxSink {
  readonly tuning: GradeTuning;
  private dodge = false;
  private k = 0; // 0 neutral .. 1 full perfect dodge grade
  private pulseLeft = 0;
  private pulseStrength = 0;

  constructor(
    tuning: Partial<GradeTuning> = {},
    private readonly reducedMotion = false,
  ) {
    this.tuning = { ...DEFAULT_GRADE, ...tuning };
  }

  cue(name: FxCue): void {
    switch (name) {
      case 'perfectDodge':
        this.dodge = true;
        this.pulse(1);
        break;
      case 'counter.phantomDash':
        this.pulse(0.7);
        break;
      case 'counter.overpower':
        this.pulse(0.4);
        break;
      case 'slowmo.end':
        this.dodge = false;
        break;
      default:
        break;
    }
  }

  /** Real dt; worldScale from TimeController. */
  update(realDt: number, worldScale: number): GradeParams {
    const t = this.tuning;
    this.pulseLeft = Math.max(0, this.pulseLeft - realDt);

    if (worldScale >= t.hitStopBelow || !this.dodge) {
      const target = this.dodge ? clamp01((1 - worldScale) / (1 - t.slowestWorld)) : 0;
      const step = t.maxRate * realDt;
      this.k += Math.max(-step, Math.min(step, target - this.k));
    }

    const k = this.k;
    const p = this.reducedMotion ? 0 : this.pulseStrength * smooth(this.pulseLeft / t.pulseTime);
    if (k === 0 && p === 0) return { ...NEUTRAL, lowpassHz: t.lowpassMax };
    return {
      saturation: 1 - (1 - t.dodgeSaturation) * k,
      tint: t.dodgeTint * k,
      aberration: p,
      radialBlur: p,
      lowpassHz: t.lowpassMax * (t.lowpassMin / t.lowpassMax) ** k,
    };
  }

  private pulse(strength: number): void {
    this.pulseLeft = this.tuning.pulseTime;
    this.pulseStrength = strength;
  }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
