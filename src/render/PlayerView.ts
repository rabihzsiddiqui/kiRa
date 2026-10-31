import * as THREE from 'three';
import { Ponytail, type HeadFrame, type Sphere } from '../character/Ponytail';
import { PONYTAIL_SOCKET } from '../character/rig';
import { COLORS } from './ArenaView';
import { buildFigure, type Figure } from './CharacterFigure';
import { KEEP_COLOR_LAYER } from './PostFx';
import type { ThreeAnimator } from './ThreeAnimator';

const HAIR_COLOR = 0x101014;

/** Braid lobes along the ponytail: one every ~2 cm, overlapping like a three-strand braid. */
const LOBES = 24;
const LOBE_TILT = 0.55; // radians each lobe leans off the strand, alternating sides

/**
 * Her body: the rigged placeholder figure (animated by ThreeAnimator), the katana on
 * the right-hand bone, and the ponytail. `root` follows her feet; `hair` lives in world
 * space (it trails behind her), so add both to the scene.
 *
 * The ponytail is drawn as a braid: overlapping lobes that lean left and right in turn
 * along a smooth curve through the simulated chain, ending in a tie and a small tuft.
 */
export class PlayerView {
  readonly root = new THREE.Group();
  /** Her posed figure. Afterimages snapshot this. */
  readonly body: THREE.Group;
  /** World-space ponytail. */
  readonly hair = new THREE.Group();
  /** World position of the blade tip, for contact flashes. Updated in sync(). */
  readonly bladeTip = new THREE.Vector3();
  /** The katana: group, and where the blade starts and ends along it. */
  readonly sword: Figure['sword'];

  private readonly figure: Figure;
  private readonly ponytail = new Ponytail();
  private readonly braid: THREE.InstancedMesh;
  private readonly tie: THREE.Mesh;
  private readonly tuft: THREE.Mesh;
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly drawn: Array<{ x: number; y: number; z: number }>;
  private readonly dissolveMats: THREE.MeshStandardMaterial[];
  private readonly scratch = {
    q: new THREE.Quaternion(),
    v: new THREE.Vector3(),
    p: new THREE.Vector3(),
    t: new THREE.Vector3(),
    side: new THREE.Vector3(),
    x: new THREE.Vector3(),
    y: new THREE.Vector3(),
    z: new THREE.Vector3(),
    right: new THREE.Vector3(),
    m: new THREE.Matrix4(),
    basis: new THREE.Matrix4(),
    scale: new THREE.Vector3(),
    socket: { x: 0, y: 0, z: 0 },
    frame: { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, back: { x: 0, y: 0, z: 1 } } as HeadFrame,
    colliders: [
      { center: { x: 0, y: 0, z: 0 }, radius: 0.115 },
      { center: { x: 0, y: 0, z: 0 }, radius: 0.06 },
      { center: { x: 0, y: 0, z: 0 }, radius: 0.15 },
    ] as Sphere[],
  };

  constructor(animator: ThreeAnimator) {
    this.figure = buildFigure();
    this.body = this.figure.root;
    this.sword = this.figure.sword;
    this.root.add(this.body);
    animator.bind(this.body);

    const hairMat = new THREE.MeshStandardMaterial({ color: HAIR_COLOR, roughness: 0.42, metalness: 0.12 });
    const tieMat = new THREE.MeshStandardMaterial({ color: COLORS.indigoLight, metalness: 0.4, roughness: 0.35 });
    this.braid = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), hairMat, LOBES);
    this.braid.frustumCulled = false; // instances live in world space, far from the mesh origin
    this.tie = new THREE.Mesh(new THREE.TorusGeometry(1, 0.35, 6, 14), tieMat);
    this.tuft = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 8, 1, true).translate(0, -0.5, 0), hairMat); // apex at the origin, opening along -Y
    for (const m of [this.braid, this.tie, this.tuft]) m.castShadow = true;
    this.hair.add(this.braid, this.tie, this.tuft);

    this.drawn = this.ponytail.points.map(() => ({ x: 0, y: 0, z: 0 }));
    this.curve = new THREE.CatmullRomCurve3(this.ponytail.points.map(() => new THREE.Vector3()), false, 'centripetal');

    for (const g of [this.root, this.hair]) g.traverse((o) => o.layers.enable(KEEP_COLOR_LAYER)); // she keeps her color
    this.dissolveMats = [...this.figure.materials, hairMat, tieMat];
    for (const m of this.dissolveMats) m.userData.base = { emissive: m.emissive.getHex(), intensity: m.emissiveIntensity };
  }

  /** `yaw` from yawFromFacing(); position is her feet. Bones are posed by the animator. */
  sync(x: number, y: number, z: number, yaw: number): void {
    this.figure.updateCloth();
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    this.root.updateMatrixWorld(true);
    const blade = this.figure.blade;
    blade.localToWorld(this.bladeTip.set(0, 0, -(blade.geometry as THREE.BoxGeometry).parameters.depth / 2));
  }

  /** Step the ponytail. `dt` is PLAYER-scaled, so her hair slows with her. Call after sync(). */
  updateHair(dt: number): void {
    // Runs every display frame: reuse scratch objects so it makes no garbage.
    const { bones } = this.figure;
    const head = bones.head;
    const s = this.scratch;
    head.getWorldQuaternion(s.q);
    const frame = s.frame;
    copy(frame.right, s.v.set(1, 0, 0).applyQuaternion(s.q));
    copy(frame.up, s.v.set(0, 1, 0).applyQuaternion(s.q));
    copy(frame.back, s.v.set(0, 0, 1).applyQuaternion(s.q));
    copy(s.socket, head.localToWorld(s.v.set(...PONYTAIL_SOCKET)));
    copy(s.colliders[0].center, head.localToWorld(s.v.set(0, 0.11, 0)));
    copy(s.colliders[1].center, bones.neck.localToWorld(s.v.set(0, 0.04, 0)));
    copy(s.colliders[2].center, bones.chest.localToWorld(s.v.set(0, 0.12, 0.05)));
    this.ponytail.update(dt, s.socket, frame, s.colliders);
    this.drawBraid(s.socket);
  }

  /** Lobes along a smooth curve through the chain, leaning left and right in turn. */
  private drawBraid(socket: { x: number; y: number; z: number }): void {
    const s = this.scratch;
    const pts = this.ponytail.renderPoints(socket, this.drawn);
    this.curve.points.forEach((p, i) => p.set(pts[i].x, pts[i].y, pts[i].z));
    s.right.set(s.frame.right.x, s.frame.right.y, s.frame.right.z);

    for (let i = 0; i < LOBES; i++) {
      const u = (i + 0.5) / LOBES;
      this.curve.getPoint(u, s.p);
      this.curve.getTangent(u, s.t);
      // The braid's side: her head's right, made square to the strand.
      s.side.copy(s.right).addScaledVector(s.t, -s.t.dot(s.right));
      if (s.side.lengthSq() < 1e-6) s.side.set(1, 0, 0);
      s.side.normalize();
      const lean = i % 2 === 0 ? 1 : -1;
      // Lobe long axis: along the strand, leaned to one side. Thick at the tie, thin at the end.
      s.y.copy(s.t).multiplyScalar(Math.cos(LOBE_TILT)).addScaledVector(s.side, lean * Math.sin(LOBE_TILT)).normalize();
      s.x.copy(s.side).addScaledVector(s.y, -s.y.dot(s.side)).normalize();
      s.z.crossVectors(s.x, s.y);
      const width = 0.026 - 0.012 * u;
      s.p.addScaledVector(s.side, lean * width * 0.3);
      s.basis.makeBasis(s.x, s.y, s.z);
      s.q.setFromRotationMatrix(s.basis);
      s.scale.set(width, 0.03 - 0.008 * u, width * 0.75);
      s.m.compose(s.p, s.q, s.scale);
      this.braid.setMatrixAt(i, s.m);
    }
    this.braid.instanceMatrix.needsUpdate = true;

    // A tie near the end, then a short tuft that opens out past it.
    this.curve.getPoint(0.94, s.p);
    this.curve.getTangent(0.94, s.t);
    this.tie.position.copy(s.p);
    this.tie.quaternion.setFromUnitVectors(AXIS_Z, s.t);
    this.tie.scale.setScalar(0.013);
    this.curve.getPoint(0.97, s.p);
    this.curve.getTangent(1, s.t);
    this.tuft.position.copy(s.p);
    this.tuft.quaternion.setFromUnitVectors(DOWN, s.t);
    this.tuft.scale.set(0.017, 0.06, 0.017);
  }

  /** 0 = solid, 1 = mostly gone: see-through with a cyan glow (Phantom Dash). */
  setDissolve(k: number): void {
    const on = k > 0.001;
    for (const m of this.dissolveMats) {
      const base = m.userData.base as { emissive: number; intensity: number };
      if (m.transparent !== on) {
        m.transparent = on;
        m.needsUpdate = true;
      }
      m.opacity = 1 - 0.75 * k;
      m.depthWrite = !on;
      m.emissive.setHex(on ? COLORS.cyan : base.emissive);
      m.emissiveIntensity = on ? 1.5 * k : base.intensity;
    }
  }
}

/** The tuft cone opens along -Y; a torus's axis is Z. */
const DOWN = new THREE.Vector3(0, -1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

function copy(out: { x: number; y: number; z: number }, v: THREE.Vector3): void {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
}
