import * as THREE from 'three';
import type { EnemyStatus } from '../combat/Enemy';
import type { Vec2 } from '../core/math';
import type { DummyPhase } from '../enemies/TrainingDummyAI';
import { planarTo3, yawFromFacing } from '../physics/space';
import { COLORS } from './palette';
import { burlapTexture, canvasTexture, woodTexture } from './stages/textures';

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

/** Where her eyes go on the dummy, as a fraction of its height: the middle of its sack head. */
export const DUMMY_HEAD_AT = 0.92;

/**
 * Training dummy, built like a scarecrow: a wooden post on crossed planks, a stuffed burlap
 * body tied with rope, a crossbar for arms with straw poking out of the sleeves, a sack head
 * with a stitched face, and a straw hat. Sways on the WORLD clock, so slow-mo is visible on
 * it. A cyan marker floats above it while it is the locked target. Reacts to combat:
 * flashes when hit, rocks back on recoil, parry and stagger. The crossbar is its weapon.
 */
export class DummyView {
  readonly root = new THREE.Group();
  private readonly swayer = new THREE.Group();
  private readonly marker = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly diamond: THREE.Mesh;
  private readonly diamondY: number;
  /** Materials that light up on a hit (white) or for an unblockable (red). */
  private readonly flashing: THREE.MeshStandardMaterial[];
  private readonly armPivot = new THREE.Group();
  private readonly glint: THREE.Sprite;
  private readonly barTrack: THREE.Sprite;
  private readonly barFill: THREE.Sprite;
  private lean = 0;

  constructor(position: Readonly<Vec2>, radius: number, height: number) {
    const p = planarTo3(position);
    this.root.position.set(p.x, p.y, p.z);
    this.root.add(this.swayer);

    const std = (color: number, map: THREE.Texture | null, roughness = 0.95) =>
      new THREE.MeshStandardMaterial({ color, map, roughness, emissive: 0xffffff, emissiveIntensity: 0 });
    const woodTex = woodTexture();
    const wood = std(woodTex ? 0x9a6b42 : 0x7a5232, woodTex, 0.9);
    const burlapTex = burlapTexture();
    const burlap = std(burlapTex ? 0xc9a676 : 0xb08d5e, burlapTex);
    const faceTex = sackFaceTexture();
    const headMat = std(faceTex ? 0xd2b083 : 0xb08d5e, faceTex);
    const straw = std(0xdcbc68, null, 1);
    const rope = new THREE.MeshStandardMaterial({ color: 0x8f7650, roughness: 1 });
    const band = new THREE.MeshStandardMaterial({ color: 0x3f3a9e, roughness: 0.9 });
    this.flashing = [wood, burlap, headMat, straw];

    const s = height / 1.8; // proportions below are for a 1.8 m dummy
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Crossed planks on the ground hold the post. They stay put while the rest sways.
    for (const yaw of [0.4, 0.4 + Math.PI / 2]) {
      add(this.root, new THREE.BoxGeometry(0.95 * s, 0.07, 0.14), wood, 0, 0.035, 0).rotation.y = yaw;
    }
    add(this.root, new THREE.CylinderGeometry(0.11 * s, 0.13 * s, 0.12, 10), wood, 0, 0.1, 0);

    add(this.swayer, new THREE.CylinderGeometry(0.055 * s, 0.07 * s, height * 0.9, 10), wood, 0, height * 0.45, 0);

    // Stuffed sack body: a lumpy lathe, narrow where it is tied at the bottom and the neck.
    const body = new THREE.LatheGeometry(
      [[0.001, 0.78], [0.12, 0.78], [0.21, 0.83], [0.29, 0.93], [0.33, 1.05], [0.33, 1.18], [0.3, 1.3], [0.23, 1.39], [0.12, 1.45], [0.07, 1.47]].map(
        ([r, y]) => new THREE.Vector2(r * s, y * s),
      ),
      24,
    );
    const bp = body.getAttribute('position');
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i);
      const z = bp.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + 0.045 * Math.sin(3 * a + bp.getY(i) * 7) + 0.025 * Math.sin(5 * a - bp.getY(i) * 11);
      bp.setX(i, x * k);
      bp.setZ(i, z * k);
    }
    body.computeVertexNormals();
    add(this.swayer, body, burlap);
    for (const [y, r] of [[0.84, 0.215], [1.44, 0.125]] as const) {
      const tie = new THREE.TorusGeometry(r * s, 0.018, 6, 24);
      tie.rotateX(Math.PI / 2);
      add(this.swayer, tie, rope, 0, y * s, 0);
    }
    // Straw poking out under the body and round the neck.
    this.swayer.add(strawTuft(straw, 16, 0.17 * s, 0.2, -1, 0.8 * s));
    this.swayer.add(strawTuft(straw, 12, 0.09 * s, 0.14, 1, 1.44 * s));

    // Arms: one crossbar through the shoulders, burlap sleeves, straw hands.
    this.armPivot.position.y = height * 0.74;
    const bar = new THREE.CylinderGeometry(0.032, 0.032, 1.42, 8);
    bar.rotateZ(Math.PI / 2);
    add(this.armPivot, bar, wood);
    for (const side of [-1, 1]) {
      const sleeve = new THREE.CylinderGeometry(0.08, 0.06, 0.34, 10);
      sleeve.rotateZ(Math.PI / 2);
      add(this.armPivot, sleeve, burlap, side * 0.36, 0, 0);
      const cuff = new THREE.TorusGeometry(0.062, 0.014, 6, 16);
      cuff.rotateY(Math.PI / 2);
      add(this.armPivot, cuff, rope, side * 0.52, 0, 0);
      const hand = strawTuft(straw, 10, 0.04, 0.14, 1, 0);
      hand.rotation.z = -side * Math.PI / 2; // tufts point out along the bar
      hand.position.x = side * 0.53;
      this.armPivot.add(hand);
    }

    // Sack head with a stitched face, tied off at the neck, under a straw hat.
    const headY = height * DUMMY_HEAD_AT;
    const head = add(this.swayer, new THREE.SphereGeometry(0.2 * s, 24, 16), headMat, 0, headY, 0);
    head.scale.set(1, 1.08, 0.95);
    const hat = new THREE.Group();
    hat.position.set(0, headY + 0.16 * s, 0);
    hat.rotation.set(-0.08, 0, 0.13);
    add(hat, new THREE.CylinderGeometry(0.36 * s, 0.37 * s, 0.025, 28), straw);
    add(hat, new THREE.CylinderGeometry(0.14 * s, 0.17 * s, 0.17 * s, 20), straw, 0, 0.085 * s, 0);
    add(hat, new THREE.CylinderGeometry(0.172 * s, 0.174 * s, 0.04 * s, 20), band, 0, 0.03 * s, 0);
    this.swayer.add(hat, this.armPivot);

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
    this.glint.position.x = 0.7;
    this.glint.visible = false;
    this.armPivot.add(this.glint);

    // Poise bar above the head. Sprites always face the camera; both are anchored so
    // their left edges line up.
    const barY = height + 0.42; // clear of the hat
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
    this.diamondY = height + 0.72;
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
    let hex = 0xffffff;
    let intensity = 0;
    if (s.sinceHit < FLASH_TIME) {
      intensity = 0.6 * (1 - s.sinceHit / FLASH_TIME);
    } else if (s.glow) {
      hex = RED;
      intensity = reducedMotion ? 0.6 : 0.5 + 0.2 * Math.sin(worldTime * 18);
    }
    for (const m of this.flashing) {
      m.emissive.setHex(hex);
      m.emissiveIntensity = intensity;
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

/**
 * A ring of thin straw cones, splayed out from a point. `dir` 1 points them up, -1 down.
 * Built at the origin, then lifted to `y`.
 */
function strawTuft(mat: THREE.Material, count: number, radius: number, length: number, dir: 1 | -1, y: number): THREE.Group {
  const g = new THREE.Group();
  g.position.y = y;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (i % 3) * 0.3;
    const len = length * (0.7 + ((i * 37) % 10) / 22);
    const cone = new THREE.ConeGeometry(0.014, len, 4);
    if (dir < 0) cone.rotateX(Math.PI); // tip down
    cone.translate(0, (dir * len) / 2, 0); // base at the origin, tip out
    const mesh = new THREE.Mesh(cone, mat);
    mesh.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    // Splay outward from the middle.
    mesh.rotation.set(Math.sin(a) * 0.5 * dir, 0, -Math.cos(a) * 0.5 * dir);
    mesh.castShadow = true;
    g.add(mesh);
  }
  return g;
}

/**
 * Burlap with a stitched face: X eyes and a crooked smile in dark thread. Laid out for a
 * sphere's UVs, where u = 0.75 faces -Z (the way the dummy looks).
 */
function sackFaceTexture(): THREE.Texture | null {
  const weave = burlapTexture();
  const src = weave?.image as HTMLCanvasElement | undefined;
  return canvasTexture(512, (g, size) => {
    const w = size;
    const h = size / 2;
    g.canvas.height = h;
    if (src) for (let x = 0; x < w; x += src.width) for (let y = 0; y < h; y += src.height) g.drawImage(src, x, y);
    else {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
    }
    weave?.dispose();
    const cx = 0.75 * w;
    g.strokeStyle = '#2a1d12';
    g.lineCap = 'round';
    g.lineWidth = 7;
    // X stitched eyes.
    for (const side of [-1, 1]) {
      const ex = cx + side * 0.05 * w;
      const ey = 0.42 * h;
      const r = 0.022 * w;
      g.beginPath();
      g.moveTo(ex - r, ey - r);
      g.lineTo(ex + r, ey + r);
      g.moveTo(ex + r, ey - r);
      g.lineTo(ex - r, ey + r);
      g.stroke();
    }
    // A crooked smile with cross stitches.
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx - 0.06 * w, 0.6 * h);
    g.quadraticCurveTo(cx, 0.68 * h, cx + 0.065 * w, 0.58 * h);
    g.stroke();
    g.lineWidth = 3.5;
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6;
      const x = cx - 0.06 * w + t * 0.125 * w;
      const y = 0.6 * h + Math.sin(t * Math.PI) * 0.06 * h - t * 0.02 * h;
      g.beginPath();
      g.moveTo(x - 3, y - 9);
      g.lineTo(x + 3, y + 9);
      g.stroke();
    }
  });
}
