import * as THREE from 'three';
import type { AttackId } from '../combat/moves';
import { spinWave, trailStyle, wavePoints, type SpinWave, type TrailStyle } from '../feel/swingTrail';
import type { SwordLayout } from './BladeCharge';

/** What the trail needs each frame. Read from the player, never written back. */
export interface SwordTrailInput {
  /** The swing in progress, or null. */
  attack: AttackId | null;
  /** True while the blade is live (see trailEmitting). */
  emitting: boolean;
}

/** Enough for the spin's wave: a full 3 m circle at fine angle steps, plus the fading tail. */
const MAX_POINTS = 320;

/** A trail's two edges at one moment. */
export interface TrailEdges {
  base: THREE.Vector3;
  tip: THREE.Vector3;
}

/**
 * What a trail follows: its style for a given attack (null = none), and its two edges this
 * frame (false = skip the frame). The default follows the blade, hilt side to tip.
 */
export interface TrailSource {
  style(attack: AttackId): TrailStyle | null;
  edges(style: TrailStyle, base: THREE.Vector3, tip: THREE.Vector3): boolean;
  /** Extra points between two frames' samples, so fast swings curve instead of zigzag. */
  subdivide: number;
  /** How it's shaded: a blade trail, or a band of energy (the spin's wave). */
  look: 'blade' | 'energy';
  /**
   * Optional: lays the in-between points from the last frame's edges to this frame's
   * itself, instead of the default curve fit.
   */
  between?(from: TrailEdges, to: TrailEdges, push: (base: THREE.Vector3, tip: THREE.Vector3) => void): void;
}

/** The blade, from `base` along it to `reach` past the tip (see TrailStyle). */
export function bladeSource(sword: SwordLayout): TrailSource {
  const hilt = new THREE.Vector3();
  return {
    style: trailStyle,
    subdivide: 4,
    look: 'blade',
    edges: (style, base, tip) => {
      sword.group.localToWorld(hilt.set(0, 0, sword.hiltZ));
      sword.group.localToWorld(tip.set(0, 0, sword.tipZ));
      const blade = tip.clone().sub(hilt);
      base.copy(hilt).addScaledVector(blade, style.base);
      tip.addScaledVector(blade, style.reach);
      return true;
    },
  };
}

/** Angle step (radians) between the wave's in-between points: small enough to look round. */
const WAVE_STEP = 0.035;

/**
 * The spin's wave (see spinWave in feel/swingTrail.ts): a band out at the edge of the
 * spin's hit range, pointing where the blade points, so it sweeps a circle round her.
 * `center` is her position (feet), world space.
 *
 * Between frames it steps around her by angle at a fixed radius, so the band is a true
 * arc however far the blade turned that frame (a curve fit through 3 m wide steps cuts
 * corners and looks choppy).
 */
export function waveSource(sword: SwordLayout, center: () => THREE.Vector3): TrailSource {
  const tipWorld = new THREE.Vector3();
  let wave: SpinWave | null = null;
  return {
    style: (attack) => {
      wave = spinWave(attack);
      return wave?.style ?? null;
    },
    subdivide: 1,
    look: 'energy',
    between: (from, to, push) => {
      const c = center();
      const angle = (v: THREE.Vector3) => Math.atan2(v.z - c.z, v.x - c.x);
      const a0 = angle(from.tip);
      // Shortest way round: a blade never turns half a circle in one frame.
      const turn = Math.atan2(Math.sin(angle(to.tip) - a0), Math.cos(angle(to.tip) - a0));
      const steps = Math.ceil(Math.abs(turn) / WAVE_STEP);
      const at = (e: TrailEdges, u: number, a: number, which: 'base' | 'tip') => {
        const r0 = Math.hypot(from[which].x - c.x, from[which].z - c.z);
        const r1 = Math.hypot(e[which].x - c.x, e[which].z - c.z);
        const r = r0 + (r1 - r0) * u;
        const y = from[which].y + (e[which].y - from[which].y) * u;
        return new THREE.Vector3(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r);
      };
      for (let k = 1; k < steps; k++) {
        const u = k / steps;
        const a = a0 + turn * u;
        push(at(to, u, a, 'base'), at(to, u, a, 'tip'));
      }
    },
    edges: (_style, base, tip) => {
      if (!wave) return false;
      sword.group.localToWorld(tipWorld.set(0, 0, sword.tipZ));
      const p = wavePoints(center(), tipWorld, wave);
      if (!p) return false;
      base.set(p.inner.x, p.inner.y, p.inner.z);
      tip.set(p.outer.x, p.outer.y, p.outer.z);
      return true;
    },
  };
}

interface TrailPoint {
  base: THREE.Vector3;
  tip: THREE.Vector3;
  age: number;
  life: number;
  /** Which swing laid this point: the ribbon never joins two swings. */
  swing: number;
  /** Meters along the ribbon's tip edge from where this swing started (energy flows along it). */
  along: number;
  style: TrailStyle;
}

/**
 * Sword swing trail: a ribbon swept by the blade while a swing is live, fading with age
 * and toward the hilt. Lives in world space, so it stays where the blade passed. Each
 * frame's blade position is joined to the last with a smooth curve (Catmull-Rom), so a
 * swing that crosses a lot of space in one frame still draws an arc.
 *
 * Its look comes from the attack's TrailStyle (src/feel/swingTrail.ts): standard swings
 * are a thin, quick indigo arc; enders, spins and the jump attack a wider gold arc with
 * moving bands and glints; counters cyan. A source with the energy look (the spin's wave)
 * uses ENERGY_FRAG instead. Pure presentation, tagged noGhost.
 */
export class SwordTrail {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

  private readonly points: TrailPoint[] = [];
  /** The last frame's blade, for the curve to the next one: [base, tip] for 2 frames. */
  private readonly history: Array<{ base: THREE.Vector3; tip: THREE.Vector3 }> = [];
  private readonly positions = new Float32Array(MAX_POINTS * 2 * 3);
  private readonly params = new Float32Array(MAX_POINTS * 2 * 4); // age 0..1, across 0..1, shimmer, intensity
  private readonly colors = new Float32Array(MAX_POINTS * 2 * 6); // core rgb, edge rgb
  private readonly along = new Float32Array(MAX_POINTS * 2);
  private swing = 0;
  private lastAttack: AttackId | null = null;
  private wasEmitting = false;
  private time = 0;
  private readonly v = { base: new THREE.Vector3(), tip: new THREE.Vector3(), c: new THREE.Color() };
  private readonly source: TrailSource;

  constructor(sword: SwordLayout, source?: TrailSource) {
    this.source = source ?? bladeSource(sword);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aParams', new THREE.BufferAttribute(this.params, 4).setUsage(THREE.DynamicDrawUsage));
    const colors = new THREE.InterleavedBuffer(this.colors, 6).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aCore', new THREE.InterleavedBufferAttribute(colors, 3, 0));
    g.setAttribute('aEdge', new THREE.InterleavedBufferAttribute(colors, 3, 3));
    g.setAttribute('aAlong', new THREE.BufferAttribute(this.along, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array((MAX_POINTS - 1) * 6), 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: this.source.look === 'energy' ? ENERGY_FRAG : FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false; // world-space points, far from the mesh origin
    this.mesh.renderOrder = 2;
    this.mesh.userData.noGhost = true;
  }

  /**
   * Call once per render frame, after the figure is posed and synced. `dt` is the player
   * clock (trails linger in slow-mo along with her).
   */
  update(dt: number, input: SwordTrailInput): void {
    // Wraps so the shimmer's sin() inputs stay small and precise in long sessions.
    this.time = (this.time + dt) % 1000;
    for (const p of this.points) p.age += dt;
    while (this.points.length && this.points[0].age >= this.points[0].life) this.points.shift();

    const style = input.emitting && input.attack !== null ? this.source.style(input.attack) : null;
    const emitting = style !== null;
    if (emitting && (!this.wasEmitting || input.attack !== this.lastAttack)) {
      this.swing++; // a new swing: start a separate ribbon
      this.history.length = 0;
    }
    if (style) this.sample(style);
    this.wasEmitting = emitting;
    this.lastAttack = input.attack;

    this.rebuild();
  }

  /** Adds this frame's edges, with curved in-between points from the last frame's. */
  private sample(style: TrailStyle): void {
    const { base, tip } = this.v;
    if (!this.source.edges(style, base, tip)) return;
    // A bad frame (non-finite pose) must never reach the GPU: it would draw as NaN.
    if (![base.x, base.y, base.z, tip.x, tip.y, tip.z].every(Number.isFinite)) return;
    const now = { base: base.clone(), tip: tip.clone() };
    const SUBDIVIDE = this.source.subdivide;

    const h = this.history;
    if (h.length >= 1 && this.source.between) {
      this.source.between(h[h.length - 1], now, (b, t) => this.push(b, t, style));
    } else if (h.length >= 1) {
      // Curve through the previous two frames into this one.
      const p0 = h.length >= 2 ? h[h.length - 2] : h[h.length - 1];
      const p1 = h[h.length - 1];
      for (let k = 1; k < SUBDIVIDE; k++) {
        const u = k / SUBDIVIDE;
        this.push(catmull(p0.base, p1.base, now.base, now.base, u), catmull(p0.tip, p1.tip, now.tip, now.tip, u), style);
      }
    }
    this.push(now.base, now.tip, style);
    h.push(now);
    if (h.length > 2) h.shift();
  }

  private push(base: THREE.Vector3, tip: THREE.Vector3, style: TrailStyle): void {
    if (this.points.length >= MAX_POINTS) this.points.shift();
    const last = this.points[this.points.length - 1];
    const along = last && last.swing === this.swing ? last.along + last.tip.distanceTo(tip) : 0;
    this.points.push({ base, tip, age: 0, life: style.life, swing: this.swing, style, along });
  }

  private rebuild(): void {
    const g = this.mesh.geometry;
    const n = this.points.length;
    const c = this.v.c;
    for (let i = 0; i < n; i++) {
      const p = this.points[i];
      const age = Math.min(1, p.age / p.life);
      this.positions.set([p.base.x, p.base.y, p.base.z, p.tip.x, p.tip.y, p.tip.z], i * 6);
      this.params.set([age, 0, p.style.shimmer, p.style.intensity, age, 1, p.style.shimmer, p.style.intensity], i * 8);
      this.along[i * 2] = this.along[i * 2 + 1] = p.along;
      for (let side = 0; side < 2; side++) {
        const o = (i * 2 + side) * 6;
        c.setHex(p.style.core, THREE.SRGBColorSpace);
        this.colors.set([c.r, c.g, c.b], o);
        c.setHex(p.style.edge, THREE.SRGBColorSpace);
        this.colors.set([c.r, c.g, c.b], o + 3);
      }
    }
    // Quads between neighbors laid by the same swing.
    const index = g.index!.array as Uint16Array;
    let k = 0;
    for (let i = 0; i + 1 < n; i++) {
      if (this.points[i].swing !== this.points[i + 1].swing) continue;
      const a = i * 2;
      index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], k);
      k += 6;
    }
    g.setDrawRange(0, k);
    g.index!.needsUpdate = true;
    for (const name of ['position', 'aParams', 'aAlong'] as const) (g.attributes[name] as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aCore as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
    this.mesh.material.uniforms.uTime.value = this.time;
    this.mesh.visible = k > 0;
  }
}

function catmull(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, u: number): THREE.Vector3 {
  // Uniform Catmull-Rom between p1 and p2.
  const u2 = u * u;
  const u3 = u2 * u;
  return new THREE.Vector3()
    .addScaledVector(p0, (-u3 + 2 * u2 - u) / 2)
    .addScaledVector(p1, (3 * u3 - 5 * u2 + 2) / 2)
    .addScaledVector(p2, (-3 * u3 + 4 * u2 + u) / 2)
    .addScaledVector(p3, (u3 - u2) / 2);
}

const VERT = /* glsl */ `
  attribute vec4 aParams;
  attribute vec3 aCore;
  attribute vec3 aEdge;
  attribute float aAlong;
  varying vec4 vParams;
  varying vec3 vCore;
  varying vec3 vEdge;
  varying float vAlong;
  void main() {
    vParams = aParams;
    vAlong = aAlong;
    vCore = aCore;
    vEdge = aEdge;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform float uTime;
  varying vec4 vParams;
  varying vec3 vCore;
  varying vec3 vEdge;
  void main() {
    // Interpolated varyings can land a hair outside 0..1, and pow() of a negative number
    // is NaN on some GPUs. One NaN pixel in the half-float buffer gets smeared by bloom
    // into black blocks or a black frame, so clamp everything that feeds pow().
    float age = clamp(vParams.x, 0.0, 1.0);
    float across = clamp(vParams.y, 0.0, 1.0); // 0 at the base, 1 at the tip
    float shimmer = clamp(vParams.z, 0.0, 1.0);
    float intensity = max(vParams.w, 0.0);
    float fade = pow(1.0 - age, 1.6);
    // Thin toward the base, a bright leading band near the tip.
    float body = smoothstep(0.0, 0.55, across);
    float edgeBand = smoothstep(0.7, 1.0, across);
    vec3 color = mix(vEdge, vCore, edgeBand * (1.0 - age * 0.7));
    float alpha = fade * body * (0.45 + 0.55 * edgeBand);
    // Specials: bands that run back along the trail, and glints near the tip.
    float bands = 0.65 + 0.35 * sin(age * 28.0 - uTime * 18.0 + across * 5.0);
    float spark = clamp(sin(age * 61.0 + uTime * 7.0) * sin(across * 23.0 - uTime * 11.0), 0.0, 1.0);
    float glint = pow(spark, 8.0) * edgeBand;
    alpha *= mix(1.0, bands, shimmer);
    color += shimmer * glint * 1.5 * vCore;
    // Additive: keep it finite and non-negative whatever happens above.
    gl_FragColor = vec4(clamp(color * intensity, 0.0, 8.0), clamp(alpha, 0.0, 1.0));
  }
`;

/**
 * The spin's wave: a band of energy, not a blade trail. Across the band (0 inner, 1 outer)
 * there's a soft glow that fades out on both sides and a hot rim near the outer edge (the
 * edge of the hit range). Noise flows along the ring (vAlong, meters) and churns over
 * time, with thin bright filaments in it. The newest part flares white; as it ages it
 * breaks up into the noise and burns out, rather than fading evenly like steel's trail.
 */
const ENERGY_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec4 vParams;
  varying vec3 vCore;
  varying vec3 vEdge;
  varying float vAlong;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    return 0.55 * noise(p) + 0.3 * noise(p * 2.1 + 3.1) + 0.15 * noise(p * 4.3 + 7.7);
  }

  void main() {
    // Clamped for the same reason as the blade trail: no NaN may reach the bloom.
    float age = clamp(vParams.x, 0.0, 1.0);
    float across = clamp(vParams.y, 0.0, 1.0);
    float intensity = max(vParams.w, 0.0);
    // vAlong only grows within a swing; wrap it so sin() in hash() stays precise.
    float along = mod(vAlong, 64.0);

    float flow = fbm(vec2(along * 1.2 - uTime * 3.0, across * 2.0 + uTime * 1.4));
    // Streaks: stretched along the ring, fine across it, so they read as energy running round.
    float wisp = fbm(vec2(along * 0.9 + uTime * 4.0, across * 10.0 - uTime * 1.5));
    float filament = pow(clamp(1.0 - abs(wisp - 0.5) * 5.0, 0.0, 1.0), 2.0);

    // The rim wavers with the flow; the glow fades out toward both sides of the band.
    float rimAt = 0.8 + (flow - 0.5) * 0.1;
    float rim = exp(-pow((across - rimAt) / 0.07, 2.0));
    float glow = smoothstep(0.0, 0.6, across) * (1.0 - smoothstep(0.86, 1.0, across));

    // Newest energy flares; older energy breaks up and burns out.
    float head = exp(-age * 20.0);
    float burn = smoothstep(age - 0.25, age + 0.05, flow);
    float fade = pow(1.0 - age, 1.2);

    float alpha = (glow * (0.18 + 0.4 * flow) + rim * (0.55 + 0.45 * flow) + filament * glow * 0.6) * burn * fade;
    alpha += head * (glow * 0.25 + rim * 0.5);
    vec3 color = mix(vEdge, vCore, clamp(rim * 0.7 + filament * 0.5 + head * 0.6, 0.0, 1.0));
    gl_FragColor = vec4(clamp(color * intensity, 0.0, 8.0), clamp(alpha, 0.0, 1.0));
  }
`;
