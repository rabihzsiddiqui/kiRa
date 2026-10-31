import * as THREE from 'three';
import type { AttackId } from '../combat/moves';
import { trailStyle, type TrailStyle } from '../feel/swingTrail';
import type { SwordLayout } from './BladeCharge';

/** What the trail needs each frame. Read from the player, never written back. */
export interface SwordTrailInput {
  /** The swing in progress, or null. */
  attack: AttackId | null;
  /** True while the blade is live (see trailEmitting). */
  emitting: boolean;
}

const MAX_POINTS = 160;
/** Extra points between two frames' blade positions, so fast swings curve instead of zigzag. */
const SUBDIVIDE = 4;

interface TrailPoint {
  base: THREE.Vector3;
  tip: THREE.Vector3;
  age: number;
  life: number;
  /** Which swing laid this point: the ribbon never joins two swings. */
  swing: number;
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
 * moving bands and glints; counters cyan. Pure presentation, tagged noGhost.
 */
export class SwordTrail {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

  private readonly points: TrailPoint[] = [];
  /** The last frame's blade, for the curve to the next one: [base, tip] for 2 frames. */
  private readonly history: Array<{ base: THREE.Vector3; tip: THREE.Vector3 }> = [];
  private readonly positions = new Float32Array(MAX_POINTS * 2 * 3);
  private readonly params = new Float32Array(MAX_POINTS * 2 * 4); // age 0..1, across 0..1, shimmer, intensity
  private readonly colors = new Float32Array(MAX_POINTS * 2 * 6); // core rgb, edge rgb
  private swing = 0;
  private lastAttack: AttackId | null = null;
  private wasEmitting = false;
  private time = 0;
  private readonly v = { hilt: new THREE.Vector3(), tip: new THREE.Vector3(), c: new THREE.Color() };

  constructor(private readonly sword: SwordLayout) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aParams', new THREE.BufferAttribute(this.params, 4).setUsage(THREE.DynamicDrawUsage));
    const colors = new THREE.InterleavedBuffer(this.colors, 6).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aCore', new THREE.InterleavedBufferAttribute(colors, 3, 0));
    g.setAttribute('aEdge', new THREE.InterleavedBufferAttribute(colors, 3, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array((MAX_POINTS - 1) * 6), 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
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

    const emitting = input.emitting && input.attack !== null;
    if (emitting && (!this.wasEmitting || input.attack !== this.lastAttack)) {
      this.swing++; // a new swing: start a separate ribbon
      this.history.length = 0;
    }
    if (emitting) this.sample(trailStyle(input.attack!));
    this.wasEmitting = emitting;
    this.lastAttack = input.attack;

    this.rebuild();
  }

  /** Adds this frame's blade, with curved in-between points from the last frame's. */
  private sample(style: TrailStyle): void {
    const { group, hiltZ, tipZ } = this.sword;
    const { hilt, tip } = this.v;
    group.localToWorld(hilt.set(0, 0, hiltZ));
    group.localToWorld(tip.set(0, 0, tipZ));
    // A bad frame (non-finite pose) must never reach the GPU: it would draw as NaN.
    if (![hilt.x, hilt.y, hilt.z, tip.x, tip.y, tip.z].every(Number.isFinite)) return;
    const blade = tip.clone().sub(hilt);
    const now = { base: hilt.clone().addScaledVector(blade, style.base), tip: tip.clone().addScaledVector(blade, style.reach) };

    const h = this.history;
    if (h.length >= 1) {
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
    this.points.push({ base, tip, age: 0, life: style.life, swing: this.swing, style });
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
    for (const name of ['position', 'aParams'] as const) (g.attributes[name] as THREE.BufferAttribute).needsUpdate = true;
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
  varying vec4 vParams;
  varying vec3 vCore;
  varying vec3 vEdge;
  void main() {
    vParams = aParams;
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
