import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { ATTACKS, AttackId } from '../combat/moves';
import type { FxCue, FxCueData, FxSink } from '../feel/CombatFeel';
import { planarTo3 } from '../physics/space';
import { COLORS } from './palette';
import type { PlayerView } from './PlayerView';
import { KEEP_COLOR_LAYER } from './PostFx';

/*
 * Phase 5 spectacle. Gameplay already fires the cues and drives the slow-mo; this file
 * only draws. Two clocks:
 *   world time  sparks, shockwaves, decals (they hang in the air during slow-mo)
 *   real time   flashes, afterimages, slash arcs and lines (they stay crisp)
 */

const INDIGO = new THREE.Color(COLORS.indigo);
const CYAN = new THREE.Color(COLORS.cyan);
const SPARK_HOT = new THREE.Color(1, 0.97, 0.9);
const SPARK_ORANGE = new THREE.Color(1, 0.62, 0.25);
const CHEST = 1.2;

interface Transient {
  /** Return false when finished; it is then disposed. */
  update(realDt: number, worldDt: number): boolean;
  dispose(): void;
}

export class ThreeFx implements FxSink {
  private readonly root = new THREE.Group();
  private readonly sparks: Sparks;
  private readonly glowTex = glowTexture();
  private readonly crackTex = crackTexture();
  private transients: Transient[] = [];
  private scheduled: Array<{ at: number; run: () => void }> = [];
  private time = 0;

  // Afterimage emitter (perfect dodge)
  private ghostLeft = 0;
  private ghostTimer = 0;
  // Phantom Dash dissolve + streak
  private dash: { t: number; length: number; streak: Streak } | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly player: PlayerView,
    private readonly reducedMotion: boolean,
  ) {
    scene.add(this.root);
    this.sparks = new Sparks(600, this.glowTex);
    if (reducedMotion) this.sparks.speedScale = 0.6;
    this.root.add(this.sparks.points);
  }

  cue(name: FxCue, data: FxCueData): void {
    switch (name) {
      case 'perfectDodge':
        this.ghostLeft = 0.4;
        this.ghostTimer = 0;
        break;
      case 'perfectBlock':
        this.perfectBlock(data);
        break;
      case 'counter.phantomDash':
        this.phantomDash();
        break;
      case 'counter.overpower':
        break; // the impact is on 'hit', when it lands
      case 'guard.impact':
        this.guardImpact(data);
        break;
      case 'spinCharge.ready':
        this.ring(this.herFeet(), 0.2, 1.4, 0.35, CYAN, 0.7, 'real');
        break;
      case 'hit':
        this.hit(data);
        break;
      case 'player.hurt':
      case 'slowmo.end':
        break;
    }
  }

  update(realDt: number, worldDt: number): void {
    this.time += realDt;
    const due = this.scheduled.filter((s) => s.at <= this.time);
    if (due.length) {
      this.scheduled = this.scheduled.filter((s) => s.at > this.time);
      for (const s of due) s.run();
    }

    if (this.ghostLeft > 0) {
      this.ghostLeft -= realDt;
      this.ghostTimer -= realDt;
      if (this.ghostTimer <= 0) {
        // About 6 copies over the 0.4 s; half as many when the OS asks for less motion.
        this.ghostTimer = this.reducedMotion ? 0.13 : 0.065;
        this.transients.push(new Afterimage(this.root, this.player.body));
      }
    }

    if (this.dash) {
      const d = this.dash;
      d.t += realDt;
      const k = d.t / d.length;
      // Fade out fast, stay mostly gone through the dash, come back at the end.
      const dissolve = k < 0.15 ? k / 0.15 : k < 0.75 ? 1 : Math.max(0, 1 - (k - 0.75) / 0.25);
      this.player.setDissolve(dissolve);
      d.streak.extendTo(this.herChest(), this.camera.position);
      if (k >= 1) {
        this.player.setDissolve(0);
        d.streak.release();
        this.dash = null;
      }
    }

    this.sparks.update(worldDt);
    this.transients = this.transients.filter((t) => {
      const alive = t.update(realDt, worldDt);
      if (!alive) t.dispose();
      return alive;
    });
  }

  // --------------------------------------------------------------- effects

  private perfectBlock(data: FxCueData): void {
    const her = this.herChest();
    const from = data.at ? planarTo3(data.at, CHEST) : null;
    const toward = from ? new THREE.Vector3(from.x, from.y, from.z).sub(her).setY(0).normalize() : new THREE.Vector3(0, 0, -1);
    const contact = her.clone().addScaledVector(toward, 0.7);
    const chain = data.chain ?? 0;

    this.flash(contact, 1.8, 0.035); // 1 to 2 frames of white at the blade contact point
    this.sparks.emit(contact, 110 + chain * 25, {
      speed: [3, 9],
      up: 2.5,
      life: [0.3, 0.7],
      hot: SPARK_HOT,
      cool: SPARK_ORANGE,
      dir: toward.clone().negate().add(new THREE.Vector3(0, 0.4, 0)).normalize(),
      spread: 1.1,
      size: 1,
    });
    this.ring(this.herFeet(), 0.3, 3.2, 0.4, SPARK_ORANGE, 0.8, 'world');
  }

  private guardImpact(data: FxCueData): void {
    const her = this.herChest();
    const from = data.at ? planarTo3(data.at, CHEST) : null;
    const toward = from ? new THREE.Vector3(from.x, from.y, from.z).sub(her).setY(0).normalize() : new THREE.Vector3(0, 0, -1);
    const contact = her.clone().addScaledVector(toward, 0.6);
    this.sparks.emit(contact, 24, { speed: [1.5, 4], up: 1.5, life: [0.15, 0.35], hot: SPARK_HOT, cool: SPARK_ORANGE, size: 0.7 });
  }

  private phantomDash(): void {
    const def = ATTACKS[AttackId.PhantomDash];
    const length = def.startup + def.active + 0.1;
    this.dash?.streak.release();
    const streak = new Streak(this.herChest());
    this.root.add(streak.mesh);
    this.transients.push(streak);
    this.dash = { t: 0, length, streak };
    // Aurora slash arc when the blade comes around (startup end).
    this.after(def.startup, () => this.auroraArc());
  }

  private hit(data: FxCueData): void {
    if (!data.at) return;
    const her = this.herChest();
    const target = planarTo3(data.at, CHEST - 0.1);
    const at = new THREE.Vector3(target.x, target.y, target.z);
    // Contact on the near side of the target, not its center.
    const near = at.clone().add(her.clone().sub(at).setY(0).normalize().multiplyScalar(0.35));

    switch (data.attack) {
      case AttackId.PhantomDash:
        // Iaido: the cut lines appear on contact. (The sound lands 0.15 s later.)
        this.slashLines(at);
        this.flash(near, 1.2, 0.05);
        this.sparks.emit(near, 40, { speed: [2, 6], up: 1, life: [0.2, 0.5], hot: SPARK_HOT, cool: CYAN, size: 0.8 });
        break;
      case AttackId.Overpower:
        this.crack(new THREE.Vector3(at.x, 0, at.z));
        this.ring(new THREE.Vector3(at.x, 0, at.z), 0.3, 2.6, 0.45, new THREE.Color(0xa1a1aa), 0.6, 'world');
        this.sparks.emit(near, 50, { speed: [2, 7], up: 3, life: [0.3, 0.8], hot: SPARK_HOT, cool: SPARK_ORANGE, size: 0.9 });
        this.flash(near, 1.3, 0.05);
        break;
      default:
        // Ordinary hits stay small, so the counters stand apart.
        this.flash(near, 0.45, 0.03);
        this.sparks.emit(near, 14, { speed: [1.5, 3.5], up: 1, life: [0.1, 0.25], hot: SPARK_HOT, cool: SPARK_HOT, size: 0.5 });
        if (data.broke) this.ring(new THREE.Vector3(at.x, 0, at.z), 0.3, 1.8, 0.35, SPARK_HOT, 0.5, 'world');
        break;
    }
  }

  // ------------------------------------------------------------ primitives

  private flash(at: THREE.Vector3, size: number, life: number): void {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
    );
    sprite.position.copy(at);
    sprite.scale.setScalar(size);
    sprite.renderOrder = 30;
    this.root.add(sprite);
    let t = 0;
    this.transients.push({
      update: (dt) => {
        t += dt;
        (sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - t / life) * 2;
        return t < life;
      },
      dispose: () => {
        this.root.remove(sprite);
        sprite.material.dispose();
      },
    });
  }

  private ring(
    at: THREE.Vector3,
    from: number,
    to: number,
    life: number,
    color: THREE.Color,
    opacity: number,
    clock: 'world' | 'real',
  ): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(RING_GEOMETRY, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(at.x, 0.04, at.z);
    this.root.add(mesh);
    let t = 0;
    this.transients.push({
      update: (realDt, worldDt) => {
        t += clock === 'world' ? worldDt : realDt;
        const k = Math.min(1, t / life);
        const ease = 1 - (1 - k) ** 3;
        mesh.scale.setScalar(from + (to - from) * ease);
        mat.opacity = opacity * (1 - k);
        return k < 1;
      },
      dispose: () => {
        this.root.remove(mesh);
        mat.dispose();
      },
    });
  }

  private auroraArc(): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: { progress: { value: 0 }, opacity: { value: 1 }, colorA: { value: INDIGO }, colorB: { value: CYAN } },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float progress;
        uniform float opacity;
        uniform vec3 colorA;
        uniform vec3 colorB;
        varying vec3 vPos;
        void main() {
          // 0 at her right, 1 at her left (forward is -Z).
          float t = atan(-vPos.z, vPos.x) / 3.14159265;
          if (t > progress) discard;
          float r = length(vPos.xz);
          float band = smoothstep(0.7, 2.1, r) * (1.0 - smoothstep(2.15, 2.4, r));
          float head = smoothstep(progress - 0.5, progress, t); // brightest at the leading edge
          vec3 c = mix(colorA, colorB, t);
          float a = band * (0.35 + 0.65 * head) * opacity;
          gl_FragColor = vec4(c * a * 2.2, a);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(ARC_GEOMETRY, mat);
    const feet = this.herFeet();
    mesh.position.set(feet.x, 1.0, feet.z);
    mesh.rotation.y = this.player.root.rotation.y;
    this.root.add(mesh);
    let t = 0;
    this.transients.push({
      update: (dt) => {
        t += dt;
        mat.uniforms.progress.value = Math.min(1, t / 0.1);
        mat.uniforms.opacity.value = t < 0.12 ? 1 : Math.max(0, 1 - (t - 0.12) / 0.3);
        return t < 0.42;
      },
      dispose: () => {
        this.root.remove(mesh);
        mat.dispose();
      },
    });
  }

  private slashLines(at: THREE.Vector3): void {
    const group = new THREE.Group();
    group.position.copy(at);
    group.quaternion.copy(this.camera.quaternion); // lines sit in the screen plane
    const mat = new THREE.MeshBasicMaterial({ color: 0xe0f7ff, transparent: true, depthTest: false, toneMapped: false });
    const angles = [0.35, -0.5, 1.2];
    const lines = angles.map((a, i) => {
      const line = new THREE.Mesh(LINE_GEOMETRY, mat);
      line.rotation.z = a;
      line.position.set((i - 1) * 0.12, (i - 1) * 0.15, 0);
      line.renderOrder = 31;
      group.add(line);
      return line;
    });
    this.root.add(group);
    let t = 0;
    this.transients.push({
      update: (dt) => {
        t += dt;
        lines.forEach((l, i) => l.scale.set(Math.min(1, Math.max(0, (t - i * 0.02) / 0.05)) * 2.6, 1, 1));
        mat.opacity = t < 0.25 ? 1 : Math.max(0, 1 - (t - 0.25) / 0.3);
        return t < 0.55;
      },
      dispose: () => {
        this.root.remove(group);
        mat.dispose();
      },
    });
  }

  private crack(at: THREE.Vector3): void {
    const mat = new THREE.MeshBasicMaterial({
      map: this.crackTex,
      color: 0xc7d2fe, // indigo-200: pale cracks read on the dark floor
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(DECAL_GEOMETRY, mat);
    mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    mesh.position.set(at.x, 0.015, at.z);
    this.root.add(mesh);
    let t = 0;
    this.transients.push({
      update: (_r, worldDt) => {
        t += worldDt;
        mat.opacity = t < 1.4 ? 0.85 : Math.max(0, 0.85 * (1 - (t - 1.4) / 1));
        return t < 2.4;
      },
      dispose: () => {
        this.root.remove(mesh);
        mat.dispose();
      },
    });
  }

  // --------------------------------------------------------------- helpers

  private after(seconds: number, run: () => void): void {
    this.scheduled.push({ at: this.time + seconds, run });
  }

  private herFeet(): THREE.Vector3 {
    return this.player.root.position.clone();
  }

  private herChest(): THREE.Vector3 {
    return this.player.root.position.clone().setY(this.player.root.position.y + CHEST);
  }
}

const RING_GEOMETRY = new THREE.RingGeometry(0.9, 1, 64);

const ARC_GEOMETRY = new THREE.RingGeometry(0.6, 2.4, 48, 1, 0, Math.PI).rotateX(-Math.PI / 2);
const LINE_GEOMETRY = new THREE.BoxGeometry(1, 0.025, 0.025);
const DECAL_GEOMETRY = new THREE.PlaneGeometry(2.8, 2.8);

// ------------------------------------------------------------------ sparks

interface EmitOptions {
  speed: [number, number];
  up: number;
  life: [number, number];
  hot: THREE.Color;
  cool: THREE.Color;
  /** Main direction; omit for an even burst. */
  dir?: THREE.Vector3;
  /** 0 = tight cone, 1+ = wide. */
  spread?: number;
  size: number;
}

/** CPU particle pool in one Points object. Additive, so a dead particle is just black. */
class Sparks {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly hot: Float32Array;
  private readonly cool: Float32Array;
  private next = 0;

  constructor(
    private readonly cap: number,
    texture: THREE.Texture,
  ) {
    this.pos = new Float32Array(cap * 3).fill(-1000);
    this.col = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap).fill(1);
    this.hot = new Float32Array(cap * 3);
    this.cool = new Float32Array(cap * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size: 0.09,
        map: texture,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
  }

  /** Scales burst speed (lower under prefers-reduced-motion). */
  speedScale = 1;

  emit(origin: THREE.Vector3, count: number, o: EmitOptions): void {
    const v = new THREE.Vector3();
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.cap;
      v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      if (o.dir) v.multiplyScalar(o.spread ?? 1).add(o.dir).normalize();
      const speed = (o.speed[0] + Math.random() * (o.speed[1] - o.speed[0])) * o.size * this.speedScale;
      this.vel[i * 3] = v.x * speed;
      this.vel[i * 3 + 1] = v.y * speed + o.up * Math.random();
      this.vel[i * 3 + 2] = v.z * speed;
      this.pos.set([origin.x, origin.y, origin.z], i * 3);
      this.maxLife[i] = this.life[i] = o.life[0] + Math.random() * (o.life[1] - o.life[0]);
      this.hot.set([o.hot.r, o.hot.g, o.hot.b], i * 3);
      this.cool.set([o.cool.r, o.cool.g, o.cool.b], i * 3);
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const drag = Math.exp(-2.5 * dt);
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]); // 1 fresh, 0 dead
      const j = i * 3;
      this.vel[j] *= drag;
      this.vel[j + 1] = this.vel[j + 1] * drag - 12 * dt;
      this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] = Math.max(0.02, this.pos[j + 1] + this.vel[j + 1] * dt);
      this.pos[j + 2] += this.vel[j + 2] * dt;
      // White hot at birth, cooling to the second color, fading to black (invisible).
      for (let c = 0; c < 3; c++) this.col[j + c] = (this.cool[j + c] + (this.hot[j + c] - this.cool[j + c]) * k) * k * 2;
      if (this.life[i] <= 0) this.pos[j + 1] = -1000;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// ------------------------------------------------------------ afterimages

// The skinning chunks do nothing on plain meshes and pose the skinned body.
const GHOST_VERTEX = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    #include <skinbase_vertex>
    #include <beginnormal_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
    vNormal = normalize(normalMatrix * objectNormal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

const GHOST_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // Additive with alpha 1: what you see is color * brightness * opacity, applied once.
    float fresnel = pow(1.0 - abs(dot(vNormal, vView)), 2.0);
    gl_FragColor = vec4(color * (0.35 + 2.2 * fresnel) * opacity, 1.0);
  }`;

/** A frozen cyan fresnel copy of her current pose, fading out over 0.4 s (real time). */
class Afterimage implements Transient {
  private readonly ghost: THREE.Object3D;
  private readonly mat: THREE.ShaderMaterial;
  private t = 0;

  constructor(
    private readonly parent: THREE.Object3D,
    source: THREE.Object3D,
  ) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: CYAN.clone() }, opacity: { value: 0.9 } },
      vertexShader: GHOST_VERTEX,
      fragmentShader: GHOST_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    // Shares geometry, copies the pose. The skeleton-aware clone rebinds the skinned body
    // to the copied bones, so the ghost keeps this pose instead of following hers.
    this.ghost = cloneSkinned(source);
    // Effects riding on her (the blade charge) are not part of her silhouette.
    const skip: THREE.Object3D[] = [];
    this.ghost.traverse((o) => {
      if (o.userData.noGhost) skip.push(o);
    });
    for (const o of skip) o.removeFromParent();
    this.ghost.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.material = this.mat;
        o.castShadow = false;
      }
      o.layers.enable(KEEP_COLOR_LAYER);
    });
    this.ghost.matrixAutoUpdate = false;
    this.ghost.matrix.copy(source.matrixWorld);
    parent.add(this.ghost);
  }

  update(realDt: number): boolean {
    this.t += realDt;
    this.mat.uniforms.opacity.value = 0.9 * Math.max(0, 1 - this.t / 0.4);
    return this.t < 0.4;
  }

  dispose(): void {
    this.parent.remove(this.ghost);
    this.mat.dispose();
  }
}

// ----------------------------------------------------------------- streak

/**
 * Phantom Dash trail: a camera-facing ribbon from where the dash started to where she is,
 * indigo at the tail to cyan at her. Fades once the dash ends.
 */
class Streak implements Transient {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly positions = new Float32Array(12);
  private released = false;
  private fade = 0;

  constructor(private readonly start: THREE.Vector3) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), 2));
    g.setIndex([0, 2, 1, 2, 3, 1]);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { colorA: { value: INDIGO }, colorB: { value: CYAN }, opacity: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 colorA;
        uniform vec3 colorB;
        uniform float opacity;
        varying vec2 vUv;
        void main() {
          float edge = smoothstep(0.0, 0.5, vUv.y) * smoothstep(1.0, 0.5, vUv.y);
          float a = vUv.x * vUv.x * edge * opacity;
          gl_FragColor = vec4(mix(colorA, colorB, vUv.x) * a * 2.0, a);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.extendTo(start, start.clone().add(new THREE.Vector3(0, 0, 1)));
  }

  /** Stretch the ribbon to `end`, turned to face the camera around the dash line. */
  extendTo(end: THREE.Vector3, eye: THREE.Vector3): void {
    const along = end.clone().sub(this.start);
    const toEye = eye.clone().sub(end);
    const side = new THREE.Vector3().crossVectors(along, toEye);
    if (side.lengthSq() < 1e-6) side.set(0, 1, 0);
    side.normalize().multiplyScalar(0.45);
    const corners = [
      this.start.clone().sub(side),
      this.start.clone().add(side),
      end.clone().sub(side),
      end.clone().add(side),
    ];
    corners.forEach((c, i) => this.positions.set([c.x, c.y, c.z], i * 3));
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  release(): void {
    this.released = true;
  }

  update(realDt: number): boolean {
    if (!this.released) return true;
    this.fade += realDt;
    this.mat.uniforms.opacity.value = Math.max(0, 1 - this.fade / 0.4);
    return this.fade < 0.4;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------- textures

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Procedural ground crack: jagged lines from the center with a few branches. */
function crackTexture(): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineCap = 'round';

  const branch = (x: number, y: number, angle: number, length: number, width: number) => {
    let px = x;
    let py = y;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(px, py);
    const steps = 6;
    for (let s = 0; s < steps; s++) {
      angle += (rand() - 0.5) * 0.9;
      px += Math.cos(angle) * (length / steps);
      py += Math.sin(angle) * (length / steps);
      g.lineTo(px, py);
      if (width > 1.5 && rand() < 0.3) {
        g.stroke();
        branch(px, py, angle + (rand() < 0.5 ? 0.8 : -0.8), length * 0.4, width * 0.5);
        g.lineWidth = width;
        g.beginPath();
        g.moveTo(px, py);
      }
    }
    g.stroke();
  };
  for (let i = 0; i < 8; i++) branch(size / 2, size / 2, (i / 8) * Math.PI * 2 + rand() * 0.5, 70 + rand() * 50, 4);
  return new THREE.CanvasTexture(c);
}
