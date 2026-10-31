import * as THREE from 'three';
import type { EnemyStatus } from '../combat/Enemy';
import type { Vec2 } from '../core/math';
import type { DummyPhase } from '../enemies/TrainingDummyAI';
import { planarTo3, yawFromFacing } from '../physics/space';
import { COLORS } from './ArenaView';

/** Decorative loops (bob, pulse, spin) stay still when the OS asks for less motion. */
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface DummyState {
  facing: Readonly<Vec2>;
  status: EnemyStatus;
  /** Real seconds since her sword last connected. */
  sinceHit: number;
  locked: boolean;
  /** AI phase and 0..1 progress through it. Drives the arm. */
  phase: DummyPhase;
  progress: number;
  /** World seconds since the last telegraph event (glint). */
  sinceTelegraph: number;
  /** An unblockable step is winding up or live: red glow. */
  glow: boolean;
  /** Poise meter, 0..1. */
  poise: number;
  /** Real seconds since a perfect block landed on it (the poise bar flashes). */
  sinceParry: number;
  /** Posture broken by an Overpower: it goes down hard. */
  knockdown: boolean;
}

/** How far it rocks back per reaction, radians. */
const LEAN: Record<EnemyStatus, number> = { ready: 0, recoil: 0.08, parried: 0.18, staggered: 0.35 };
const KNOCKDOWN_LEAN = 1.15;
const BAR_WIDTH = 0.9;
const FLASH_TIME = 0.12;
const GLINT_TIME = 0.35; // world seconds
const RED = 0xef4444; // red-500, same meaning as enemy hit areas in the debug view
const WIND_BACK = -0.9; // arm yaw, radians. Positive swings the right-hand tip forward.
const FOLLOW_THROUGH = 1.1;

const ease = (k: number) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 3;

/**
 * Training dummy: post, body, cross arm, head. Sways on the WORLD clock, so slow-mo
 * is visible on it. A cyan marker floats above it while it is the locked target.
 * Reacts to combat: flashes when hit, rocks back on recoil, parry and stagger.
 */
export class DummyView {
  readonly root = new THREE.Group();
  private readonly swayer = new THREE.Group();
  private readonly marker = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly diamond: THREE.Mesh;
  private readonly diamondY: number;
  private readonly straw: THREE.MeshStandardMaterial;
  private readonly armPivot = new THREE.Group();
  private readonly glint: THREE.Sprite;
  private readonly barTrack: THREE.Sprite;
  private readonly barFill: THREE.Sprite;
  private lean = 0;

  constructor(position: Readonly<Vec2>, radius: number, height: number) {
    const p = planarTo3(position);
    this.root.position.set(p.x, p.y, p.z);
    this.root.add(this.swayer);

    const wood = new THREE.MeshStandardMaterial({ color: 0x52525b, roughness: 0.9 }); // zinc-600
    const straw = new THREE.MeshStandardMaterial({ color: 0x71717a, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0 }); // zinc-500
    this.straw = straw;

    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, height, 10), wood);
    post.position.y = height / 2;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.9, height * 0.45, 16), straw);
    torso.position.y = height * 0.62;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.08), wood);
    this.armPivot.position.y = height * 0.74;
    this.armPivot.add(arm);
    const head = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.7, 16, 12), straw);
    head.position.y = height * 0.95;
    for (const m of [post, torso, arm, head]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    this.swayer.add(post, torso, this.armPivot, head);

    // Weapon glint on the arm's right-hand tip (facing -Z, right is +X): a four-point star
    // that blooms. Drawn over the body (no depth test) so the telegraph reads from any angle.
    this.glint = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: starTexture(),
        color: 0xffffff,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.glint.renderOrder = 20;
    this.glint.position.x = 0.68;
    this.glint.visible = false;
    this.armPivot.add(this.glint);

    // Poise bar above the head. Sprites always face the camera; both are anchored so
    // their left edges line up.
    const barY = height + 0.25;
    this.barTrack = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x27272a, depthTest: false, transparent: true, opacity: 0.85 }));
    this.barTrack.scale.set(BAR_WIDTH, 0.05, 1);
    this.barFill = new THREE.Sprite(new THREE.SpriteMaterial({ color: COLORS.indigo, depthTest: false }));
    for (const s of [this.barTrack, this.barFill]) {
      s.position.y = barY;
      s.renderOrder = 21;
      this.root.add(s);
    }
    this.barFill.renderOrder = 22;

    const cyan = new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.9 });
    this.diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), cyan);
    this.diamond.scale.y = 1.6;
    this.diamondY = height + 0.55;
    this.diamond.position.y = this.diamondY;
    this.marker.add(this.diamond);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(radius + 0.35, radius + 0.42, 48),
      new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.01;
    this.marker.add(this.ring);

    this.marker.visible = false;
    this.root.add(this.marker);
  }

  /**
   * @param worldTime seconds on the world clock (sway and reactions slow in slow-mo)
   * @param realTime  seconds on the real clock (the marker stays snappy, it is UI)
   * @param worldDt   world-clock seconds since the last render frame
   */
  sync(worldTime: number, realTime: number, worldDt: number, s: DummyState): void {
    const { locked } = s;
    this.root.rotation.y = yawFromFacing(s.facing);

    // Ease toward the reaction pose on the world clock, so it crawls in slow-mo too.
    const leanGoal = s.knockdown && s.status === 'staggered' ? KNOCKDOWN_LEAN : LEAN[s.status];
    this.lean += (leanGoal - this.lean) * (1 - Math.exp(-(s.knockdown ? 10 : 18) * worldDt));
    this.swayer.rotation.z = Math.sin(worldTime * 1.6) * 0.04;
    // Positive X tilts the top toward local +Z, away from where it faces.
    this.swayer.rotation.x = Math.sin(worldTime * 1.1 + 1) * 0.025 + this.lean;

    // Hit flash wins over the unblockable glow, so hits always read.
    if (s.sinceHit < FLASH_TIME) {
      this.straw.emissive.setHex(0xffffff);
      this.straw.emissiveIntensity = 0.6 * (1 - s.sinceHit / FLASH_TIME);
    } else if (s.glow) {
      this.straw.emissive.setHex(RED);
      this.straw.emissiveIntensity = reducedMotion ? 0.6 : 0.5 + 0.2 * Math.sin(worldTime * 18);
    } else {
      this.straw.emissiveIntensity = 0;
    }

    // Glint: a quick star pop on the weapon tip at windup start.
    const g = s.sinceTelegraph / GLINT_TIME;
    this.glint.visible = g >= 0 && g < 1;
    if (this.glint.visible) {
      const pop = Math.sin(g * Math.PI);
      this.glint.scale.setScalar(0.1 + pop * 0.75);
      (this.glint.material as THREE.SpriteMaterial).rotation = reducedMotion ? 0 : g * 1.5;
    }

    this.armPivot.rotation.y = armYaw(s.phase, s.progress);

    // Poise bar: hidden when empty, flashes white when a perfect block lands.
    const showBar = s.poise > 0.005 || s.sinceParry < 0.3;
    this.barTrack.visible = this.barFill.visible = showBar;
    if (showBar) {
      const f = Math.max(0.01, Math.min(1, s.poise));
      this.barFill.scale.set(BAR_WIDTH * f, 0.05, 1);
      this.barFill.center.set(0.5 / f, 0.5); // left edge on the track's left edge
      (this.barFill.material as THREE.SpriteMaterial).color.setHex(s.sinceParry < 0.15 ? 0xffffff : COLORS.indigo);
    }

    this.marker.visible = locked;
    if (locked && !reducedMotion) {
      this.diamond.rotation.y = realTime * 2.5;
      this.diamond.position.y = this.diamondY + Math.sin(realTime * 4) * 0.05;
      this.ring.scale.setScalar(1 + Math.sin(realTime * 5) * 0.04);
    }
  }
}

/** Wind back during windup, swing through while the hitbox is live, settle in recovery. */
function armYaw(phase: DummyPhase, k: number): number {
  switch (phase) {
    case 'windup':
      return WIND_BACK * ease(k * 1.5);
    case 'active':
      return WIND_BACK + (FOLLOW_THROUGH - WIND_BACK) * ease(k);
    case 'recovery':
      return FOLLOW_THROUGH * (1 - ease(k));
    default:
      return 0;
  }
}

/** Four-point star with a soft core, for the weapon glint. */
function starTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const mid = size / 2;
  const core = g.createRadialGradient(mid, mid, 0, mid, mid, mid * 0.45);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, size, size);
  // Two thin rays, fading toward the tips.
  for (const [w, h] of [[size, 6], [6, size]] as const) {
    const ray = w > h ? g.createLinearGradient(0, mid, size, mid) : g.createLinearGradient(mid, 0, mid, size);
    ray.addColorStop(0, 'rgba(255,255,255,0)');
    ray.addColorStop(0.5, 'rgba(255,255,255,1)');
    ray.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ray;
    g.fillRect(mid - w / 2, mid - h / 2, w, h);
  }
  return new THREE.CanvasTexture(c);
}
