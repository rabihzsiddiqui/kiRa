import { AttackId } from '../combat/moves';
import type { FxCue, FxCueData, FxSink } from '../feel/CombatFeel';

type Bus = 'player' | 'world';

/** Recorded sounds in public/sfx, with the level each plays at. */
const SAMPLES = {
  slash1: { file: 'TP_Sword_Slash1.wav', level: 0.8 },
  slash2: { file: 'TP_Sword_Slash2.wav', level: 0.8 },
  jumpAttack: { file: 'TP_Sword_JumpAttack.wav', level: 0.6 },
  lockOn: { file: 'TP_ZTarget_On.wav', level: 1 },
  lockOff: { file: 'TP_ZTarget_Off.wav', level: 1 },
  viewOn: { file: 'TP_ViewLock_On.wav', level: 0.6 },
  viewOff: { file: 'TP_ViewLock_Off.wav', level: 0.6 },
} as const;
type Sample = keyof typeof SAMPLES;

/** The roll reuses the slash: this much of its level, this many seconds after the roll starts. */
const ROLL = { level: 0.45, delay: 0.05 };

/**
 * Sound, mostly procedural: hits, blocks and counters are built from oscillators and
 * filtered noise. Swings and the lock-on and view-lock sounds are short recordings in
 * public/sfx, fetched once the audio context starts. Two buses:
 *   player  her sounds, always clear
 *   world   enemies and ambience, through a low-pass that PostGrade sweeps in slow-mo
 *
 * Browsers only allow audio after a user gesture, so the context starts on the first
 * key press or click. Cues before that are skipped.
 */
export class SoundFx implements FxSink {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, AudioNode>;
  private lowpass!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private samples = new Map<Sample, AudioBuffer>();
  /** Plain swings alternate between the two slash recordings. */
  private nextSlash: 'slash1' | 'slash2' = 'slash1';
  private muted = false;

  constructor() {
    const unlock = () => {
      this.start();
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.02);
  }

  /** World bus cutoff. Called every frame with PostGrade's value. */
  setWorldLowpass(hz: number): void {
    if (this.ctx) this.lowpass.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.03);
  }

  cue(name: FxCue, data: FxCueData): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'perfectDodge':
        this.reverseWhoosh(t);
        this.heartbeat(t + 0.18, 0.9);
        this.heartbeat(t + 0.45, 0.55);
        break;
      case 'perfectBlock': {
        const chain = data.chain ?? 0;
        this.clang(t, 2 ** ((2 * chain) / 12)); // each chained block a whole step higher
        this.boom(t, 110, 38, 0.4, 0.8);
        break;
      }
      case 'counter.phantomDash':
        this.noise1('bandpass', 2400, 500, 1.2, 0.28, 'player', 0.35, t, 0.02);
        break;
      case 'counter.overpower':
        this.noise1('bandpass', 700, 300, 1, 0.25, 'player', 0.25, t, 0.05);
        break;
      case 'hit':
        this.hit(t, data);
        break;
      case 'guard.impact':
        this.partials(t, 420, [1, 2.6], 0.25, 0.18, 'player');
        this.noise1('highpass', 2500, 2500, 0.7, 0.05, 'player', 0.15, t, 0.001);
        break;
      case 'player.hurt':
        this.tone('sine', 170, 80, 0.14, 'player', 0.5, t);
        this.noise1('lowpass', 900, 300, 0.7, 0.12, 'player', 0.25, t, 0.002);
        break;
      case 'spinCharge.ready':
        this.partials(t, 1320, [1, 1.5], 0.45, 0.08, 'player');
        break;
      case 'slowmo.end':
        break;
    }
  }

  /** Her swing (attackStarted). The jump attack has its own; the rest alternate. */
  swing(attack: AttackId): void {
    if (attack === AttackId.JumpAttack) {
      this.sample('jumpAttack');
      return;
    }
    // A little pitch drift so a long combo doesn't sound like a loop.
    this.slash(0.97 + Math.random() * 0.06);
  }

  /**
   * Her roll (evadeStarted): the swing whoosh, quieter and a touch lower, so it reads as
   * her body moving rather than the blade. Lands just after the roll starts.
   */
  roll(): void {
    this.slash(0.93 + Math.random() * 0.03, ROLL.level, ROLL.delay);
  }

  /** One of the two slash recordings, alternating. */
  private slash(rate: number, level = 1, delay = 0): void {
    this.sample(this.nextSlash, rate, level, delay);
    this.nextSlash = this.nextSlash === 'slash1' ? 'slash2' : 'slash1';
  }

  /** Z-target lock on. */
  lockOn(): void {
    this.sample('lockOn');
  }

  /** Lock released. A touch lower when the target was lost rather than let go. */
  lockOff(lost: boolean): void {
    this.sample('lockOff', lost ? 0.9 : 1);
  }

  /** Target held with nothing in range: the camera snaps behind her. */
  viewLock(on: boolean): void {
    this.sample(on ? 'viewOn' : 'viewOff');
  }

  /** Enemy telegraph: a bright ting for a glint, a low swell for an unblockable. */
  telegraph(unblockable: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (unblockable) {
      this.tone('sawtooth', 110, 98, 0.6, 'world', 0.12, t, 0.25);
      this.tone('sawtooth', 220, 196, 0.6, 'world', 0.06, t, 0.25);
    } else {
      this.partials(t, 2600, [1, 1.5], 0.28, 0.06, 'world');
    }
  }

  // ------------------------------------------------------------- sounds

  private hit(t: number, data: FxCueData): void {
    switch (data.attack) {
      case AttackId.PhantomDash:
        // Iaido beat: the slash lines appear on contact, the cut lands 0.15 s later.
        this.noise1('highpass', 3000, 2000, 0.8, 0.14, 'player', 0.4, t + 0.15, 0.002);
        this.tone('sine', 3400, 2500, 0.35, 'player', 0.12, t + 0.15);
        this.boom(t + 0.15, 90, 40, 0.3, 0.45);
        break;
      case AttackId.Overpower:
        this.boom(t, 85, 28, 0.55, 1);
        this.noise1('lowpass', 400, 120, 0.7, 0.4, 'player', 0.5, t, 0.005);
        break;
      default:
        this.noise1('bandpass', 1900, 1400, 1.4, 0.05, 'player', 0.3, t, 0.001);
        this.tone('triangle', 900, 520, 0.07, 'player', 0.12, t);
        if (data.broke) this.boom(t, 120, 50, 0.3, 0.5);
        break;
    }
  }

  private reverseWhoosh(t: number): void {
    // Swells up and cuts off: a whoosh played backwards.
    const { src, out } = this.noiseSource('bandpass', 400, 1.2);
    const f = (out as BiquadFilterNode).frequency;
    f.setValueAtTime(400, t);
    f.exponentialRampToValueAtTime(3200, t + 0.35);
    const g = this.gain(0, 'player');
    out.connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.34);
    g.gain.linearRampToValueAtTime(0, t + 0.37);
    src.start(t);
    src.stop(t + 0.4);
  }

  private heartbeat(t: number, level: number): void {
    this.tone('sine', 75, 42, 0.2, 'player', 0.9 * level, t, 0.005);
  }

  private clang(t: number, pitch: number): void {
    this.partials(t, 640 * pitch, [1, 2.76, 5.4, 8.93], 0.9, 0.22, 'player');
    this.noise1('highpass', 4000, 4000, 0.7, 0.04, 'player', 0.25, t, 0.001);
  }

  private boom(t: number, from: number, to: number, dur: number, level: number): void {
    this.tone('sine', from, to, dur, 'player', level, t, 0.004);
  }

  /** Inharmonic partials with decays shortening up the series: bells, metal. */
  private partials(t: number, base: number, ratios: number[], decay: number, level: number, bus: Bus): void {
    ratios.forEach((r, i) => this.tone('sine', base * r, base * r, decay / (1 + i * 0.6), bus, level / (1 + i), t, 0.002));
  }

  // ----------------------------------------------------------- building blocks

  /**
   * Plays a recording on her bus, `level` times its usual level, `delay` seconds from now.
   * Skipped if it hasn't finished loading.
   */
  private sample(name: Sample, rate = 1, level = 1, delay = 0): void {
    const buffer = this.samples.get(name);
    if (!this.ctx || !buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(this.gain(SAMPLES[name].level * level, 'player'));
    src.start(this.ctx.currentTime + delay);
  }

  private loadSamples(ctx: AudioContext): void {
    for (const [name, { file }] of Object.entries(SAMPLES) as Array<[Sample, (typeof SAMPLES)[Sample]]>) {
      fetch(`sfx/${file}`)
        .then((r) => r.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => this.samples.set(name, buffer))
        .catch(() => console.warn(`sound: couldn't load ${file}`));
    }
  }

  private tone(type: OscillatorType, from: number, to: number, dur: number, bus: Bus, level: number, t: number, attack = 0.005): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    const g = this.gain(0, bus);
    envelope(g.gain, t, attack, dur, level);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise1(type: BiquadFilterType, from: number, to: number, q: number, dur: number, bus: Bus, level: number, t: number, attack: number): void {
    const { src, out } = this.noiseSource(type, from, q);
    const f = (out as BiquadFilterNode).frequency;
    f.setValueAtTime(from, t);
    if (to !== from) f.exponentialRampToValueAtTime(to, t + dur);
    const g = this.gain(0, bus);
    envelope(g.gain, t, attack, dur, level);
    out.connect(g);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private noiseSource(type: BiquadFilterType, freq: number, q: number): { src: AudioBufferSourceNode; out: AudioNode } {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    src.connect(filter);
    return { src, out: filter };
  }

  private gain(value: number, bus: Bus): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = value;
    g.connect(this.buses[bus]);
    return g;
  }

  private start(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(limiter);

    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 20000;
    this.lowpass.connect(this.master);
    this.buses = { player: this.master, world: this.lowpass };

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.loadSamples(ctx);
  }
}

/** Fast attack, exponential decay. */
function envelope(p: AudioParam, t: number, attack: number, dur: number, level: number): void {
  p.setValueAtTime(0.0001, t);
  p.exponentialRampToValueAtTime(Math.max(0.0002, level), t + attack);
  p.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01));
}
