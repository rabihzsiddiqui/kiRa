import * as THREE from 'three';
import { COLORS } from './ArenaView';

/** What the blade needs to know each frame. Read from the player, never written back. */
export interface BladeChargeInput {
  /** Spin charge progress 0..1, or null when not charging. */
  charge: number | null;
  /** A spin attack is in progress: a full charge stays lit through it. */
  spinning: boolean;
}

/** The sword as built by CharacterFigure: hilt end and tip along the sword group's -Z. */
export interface SwordLayout {
  group: THREE.Group;
  /** Sword-space z of the blade's hilt end and tip. */
  hiltZ: number;
  tipZ: number;
}

const MOTES = 32;
const CYAN = new THREE.Color(COLORS.cyan);
const WHITE = new THREE.Color(1, 1, 1);

/**
 * Spin charge on the blade. As the charge builds, a sparkle travels from the hilt to the
 * tip, leaving a faint trail and a few drifting motes, and the blade trembles more and
 * more. When the sparkle reaches the tip the whole blade lights up with energy (bright
 * enough to bloom, plus a small light on her) and stays lit through the spin.
 *
 * Pure presentation: it reads the charge progress, it never changes gameplay. Everything
 * hangs off the sword and is tagged noGhost, so perfect dodge afterimages skip it.
 */
export class BladeCharge {
  private readonly root = new THREE.Group();
  private readonly trail: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly energyMesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly sparkle: THREE.Sprite;
  private readonly motes: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly moteVel = new Float32Array(MOTES * 3);
  private readonly moteLife = new Float32Array(MOTES);
  private readonly light = new THREE.PointLight(COLORS.cyan, 0, 2.5, 2);
  private readonly length: number;

  private energy = 0;
  private flare = 0;
  private wasFull = false;
  private emitTimer = 0;
  private nextMote = 0;
  private t = 0;

  constructor(
    private readonly sword: SwordLayout,
    private readonly reducedMotion: boolean,
  ) {
    const { group, hiltZ, tipZ } = sword;
    this.length = hiltZ - tipZ;
    this.root.userData.noGhost = true;
    group.add(this.root);

    // Both glows are built with their origin at the hilt end, so scale.z fills toward the tip.
    const along = (w: number, h: number) => new THREE.BoxGeometry(w, h, this.length).translate(0, 0, -this.length / 2);
    const additive = () =>
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.trail = new THREE.Mesh(along(0.03, 0.062), additive());
    this.energyMesh = new THREE.Mesh(along(0.05, 0.09), additive());
    for (const m of [this.trail, this.energyMesh]) {
      m.position.z = hiltZ;
      m.renderOrder = 10;
      this.root.add(m);
    }

    this.sparkle = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: starTexture(), color: WHITE, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    this.sparkle.renderOrder = 11;
    this.root.add(this.sparkle);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    this.motes = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.025, map: dotTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    this.motes.frustumCulled = false;
    this.root.add(this.motes);

    this.light.position.z = (hiltZ + tipZ) / 2;
    this.root.add(this.light);
  }

  /** Real dt. */
  update(dt: number, input: BladeChargeInput): void {
    this.t += dt;
    const { charge, spinning } = input;
    const charging = charge !== null;
    const full = charging && charge >= 1;

    // Energy: snaps on when the sparkle reaches the tip, holds through the spin, then fades.
    if (full && !this.wasFull) this.burst();
    this.wasFull = full;
    const lit = full || (spinning && this.energy > 0);
    this.energy = lit ? Math.min(1, this.energy + dt / 0.08) : Math.max(0, this.energy - dt / 0.3);
    this.flare = Math.max(0, this.flare - dt / 0.35);

    // The sparkle rides the charge from hilt to tip, twinkling.
    const fill = charging ? Math.min(1, charge) : 0;
    const z = this.sword.hiltZ - this.length * fill;
    const twinkle = 0.75 + 0.25 * Math.sin(this.t * 31) * Math.sin(this.t * 17);
    this.sparkle.position.set(0, 0, z);
    this.sparkle.material.opacity = charging ? (full ? 0.9 : 1) : Math.max(0, this.flare);
    this.sparkle.material.rotation = this.t * 2;
    this.sparkle.scale.setScalar((charging && !full ? 0.11 * twinkle : 0.08) + 0.3 * this.flare);

    // A faint trail behind the sparkle shows how far the charge has come.
    this.trail.scale.z = Math.max(1e-3, fill);
    this.trail.material.opacity = charging && !full ? 0.35 : 0;

    // Full energy: hot core, slow pulse. Colors above 1 so the bloom pass picks it up.
    const pulse = 0.8 + 0.2 * Math.sin(this.t * Math.PI * 2 * 3);
    const e = this.energy * pulse;
    this.energyMesh.material.color.copy(CYAN).lerp(WHITE, 0.35).multiplyScalar(1 + 1.6 * this.energy);
    this.energyMesh.material.opacity = Math.min(1, 0.85 * e + 0.6 * this.flare);
    this.light.intensity = 1.6 * e + 2 * this.flare;

    // Motes drift off the sparkle while charging, and off the whole blade once lit.
    this.emitTimer -= dt;
    if ((charging || this.energy > 0.5) && this.emitTimer <= 0) {
      this.emitTimer = this.reducedMotion ? 0.08 : 0.035;
      const at = full || !charging ? this.sword.hiltZ - Math.random() * this.length : z;
      this.emit(at, 0.25);
    }
    this.updateMotes(dt);

    // Tremble: the blade hums harder as it fills, and keeps a steady hum when charged.
    // Off when the OS asks for less motion.
    const amp = this.reducedMotion || !charging ? 0 : THREE.MathUtils.degToRad(full ? 0.6 : 0.15 + 0.75 * fill);
    this.sword.group.rotation.x = amp * Math.sin(this.t * 2 * Math.PI * 37);
    this.sword.group.rotation.y = amp * Math.sin(this.t * 2 * Math.PI * 53 + 1.3);
  }

  /** Sparkle reaches the tip: flare and a spray of motes. */
  private burst(): void {
    this.flare = 1;
    for (let i = 0; i < 12; i++) this.emit(this.sword.tipZ + Math.random() * 0.15, 0.8);
  }

  private emit(z: number, speed: number): void {
    const i = this.nextMote;
    this.nextMote = (i + 1) % MOTES;
    const pos = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(i, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.04, z);
    const a = Math.random() * Math.PI * 2;
    this.moteVel.set([Math.cos(a) * speed, Math.sin(a) * speed, (Math.random() - 0.5) * speed * 0.3], i * 3);
    this.moteLife[i] = 1;
  }

  private updateMotes(dt: number): void {
    const pos = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.motes.geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < MOTES; i++) {
      const life = Math.max(0, this.moteLife[i] - dt / 0.4);
      this.moteLife[i] = life;
      if (life > 0) {
        pos.setXYZ(i, pos.getX(i) + this.moteVel[i * 3] * dt, pos.getY(i) + this.moteVel[i * 3 + 1] * dt, pos.getZ(i) + this.moteVel[i * 3 + 2] * dt);
      }
      // Additive, so fading to black makes it vanish.
      const k = life * life;
      col.setXYZ(i, (0.6 + 0.4 * k) * k, k, k);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}

/** Four-pointed star with a soft core. */
function starTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const mid = size / 2;
  const core = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.2, 'rgba(180,240,255,0.8)');
  core.addColorStop(1, 'rgba(34,211,238,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[size, 3], [3, size]]) {
    const ray = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
    ray.addColorStop(0, 'rgba(255,255,255,0.9)');
    ray.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ray;
    g.fillRect(mid - w / 2, mid - h / 2, w, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function dotTexture(): THREE.Texture {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
