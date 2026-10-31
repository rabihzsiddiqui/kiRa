import * as THREE from 'three';
import type { ActiveHitArea } from '../combat/CombatWorld';
import { shapeOutline } from '../combat/hitShapes';
import type { HitShape } from '../combat/moves';
import type { Vec2 } from '../core/math';
import { planarTo3, yawFromFacing } from '../physics/space';
import { COLORS } from './ArenaView';

export interface HurtboxView {
  position: Readonly<Vec2>;
  radius: number;
  kind: 'player' | 'graze' | 'enemy';
}

const RED = 0xef4444; // red-500: enemy threat, same meaning as the Phase 4 unblockable glow
const RED_LIGHT = 0xf87171; // red-400
const LIFT = 0.03; // above the floor grid

interface AreaSlot {
  group: THREE.Group;
  fill: THREE.Mesh;
  edge: THREE.LineLoop;
}

/**
 * Debug view of combat: live hit areas and hurtboxes, drawn flat on the floor.
 * Every outline comes from shapeOutline(), the same data the overlap test uses
 * (test/combatWorld.test.ts checks the two agree).
 */
export class HitboxDebugView {
  readonly root = new THREE.Group();
  private readonly fills = new Map<HitShape, THREE.BufferGeometry>();
  private readonly edges = new Map<HitShape, THREE.BufferGeometry>();
  private readonly rings = new Map<number, THREE.BufferGeometry>();
  private readonly areaSlots: AreaSlot[] = [];
  private readonly ringSlots: THREE.Mesh[] = [];

  private readonly mat = {
    playerFill: fillMaterial(COLORS.indigo),
    playerEdge: new THREE.LineBasicMaterial({ color: COLORS.indigoLight }),
    enemyFill: fillMaterial(RED),
    enemyEdge: new THREE.LineBasicMaterial({ color: RED_LIGHT }),
    player: ringMaterial(COLORS.skin, 0.5),
    graze: ringMaterial(COLORS.cyan, 0.8),
    enemy: ringMaterial(RED_LIGHT, 0.5),
  };

  get visible(): boolean {
    return this.root.visible;
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  sync(areas: readonly ActiveHitArea[], hurtboxes: readonly HurtboxView[]): void {
    if (!this.root.visible) return;

    areas.forEach((a, i) => {
      const slot = this.areaSlot(i);
      slot.group.visible = true;
      slot.fill.geometry = this.fillGeometry(a.shape);
      slot.edge.geometry = this.edgeGeometry(a.shape);
      const enemy = a.owner === 'enemy';
      slot.fill.material = enemy ? this.mat.enemyFill : this.mat.playerFill;
      slot.edge.material = enemy ? this.mat.enemyEdge : this.mat.playerEdge;
      const p = planarTo3(a.origin, LIFT);
      slot.group.position.set(p.x, p.y, p.z);
      slot.group.rotation.y = yawFromFacing(a.facing);
    });
    for (let i = areas.length; i < this.areaSlots.length; i++) this.areaSlots[i].group.visible = false;

    hurtboxes.forEach((h, i) => {
      const ring = this.ringSlot(i);
      ring.visible = true;
      ring.geometry = this.ringGeometry(h.radius);
      ring.material = this.mat[h.kind];
      const p = planarTo3(h.position, LIFT * 2);
      ring.position.set(p.x, p.y, p.z);
    });
    for (let i = hurtboxes.length; i < this.ringSlots.length; i++) this.ringSlots[i].visible = false;
  }

  private areaSlot(i: number): AreaSlot {
    let slot = this.areaSlots[i];
    if (!slot) {
      const group = new THREE.Group();
      const fill = new THREE.Mesh();
      const edge = new THREE.LineLoop();
      fill.renderOrder = 10;
      edge.renderOrder = 11;
      group.add(fill, edge);
      this.root.add(group);
      slot = { group, fill, edge };
      this.areaSlots.push(slot);
    }
    return slot;
  }

  private ringSlot(i: number): THREE.Mesh {
    let ring = this.ringSlots[i];
    if (!ring) {
      ring = new THREE.Mesh();
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 12;
      this.root.add(ring);
      this.ringSlots.push(ring);
    }
    return ring;
  }

  /**
   * Outline is in the attacker's local space: x = right, y = forward. Forward is -Z
   * (src/physics/space.ts), so local (x, y) becomes (x, 0, -y) and yaw does the rest.
   */
  private fillGeometry(shape: HitShape): THREE.BufferGeometry {
    let g = this.fills.get(shape);
    if (!g) {
      const pts = shapeOutline(shape).map((p) => new THREE.Vector2(p.x, p.y));
      g = new THREE.ShapeGeometry(new THREE.Shape(pts));
      g.rotateX(-Math.PI / 2); // XY plane onto the floor: (x, y, 0) -> (x, 0, -y)
      this.fills.set(shape, g);
    }
    return g;
  }

  private edgeGeometry(shape: HitShape): THREE.BufferGeometry {
    let g = this.edges.get(shape);
    if (!g) {
      g = new THREE.BufferGeometry().setFromPoints(shapeOutline(shape).map((p) => new THREE.Vector3(p.x, 0, -p.y)));
      this.edges.set(shape, g);
    }
    return g;
  }

  private ringGeometry(radius: number): THREE.BufferGeometry {
    const key = Math.round(radius * 100);
    let g = this.rings.get(key);
    if (!g) {
      g = new THREE.RingGeometry(Math.max(0, radius - 0.025), radius, 48);
      this.rings.set(key, g);
    }
    return g;
  }
}

function fillMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function ringMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
}
