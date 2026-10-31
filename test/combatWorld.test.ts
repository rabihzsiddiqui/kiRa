import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vec2, type Vec2 } from '../src/core/math';
import { Enemy, type EnemyAttackDef } from '../src/combat/Enemy';
import { distanceToShape, shapeHitsCircle, shapeOutline } from '../src/combat/hitShapes';
import { ATTACKS, AttackId, type HitShape } from '../src/combat/moves';
import { PlayerStateId } from '../src/player/contracts';
import { HeadlessSandbox } from '../src/sandbox/HeadlessSandbox';

const UP = vec2(0, 1);
const SLASH: EnemyAttackDef = { id: 'test_slash', damage: 1, hit: { kind: 'arc', range: 2, arcDeg: 120 } };
const PLAYER_R = 0.35;
const GRAZE = 0.75;

// ------------------------------------------------------------------ shapes

test('arc: covers its angle and range, grazes count by hurtbox radius', () => {
  const arc: HitShape = { kind: 'arc', range: 2, arcDeg: 90 };
  const at = (x: number, y: number, r = 0) => shapeHitsCircle(arc, vec2(), UP, vec2(x, y), r);
  assert.ok(at(0, 1.9), 'straight ahead, in range');
  assert.ok(!at(0, 2.1), 'just out of range');
  assert.ok(at(0, 2.3, 0.35), 'out of range, but the hurtbox reaches in');
  assert.ok(at(1.3, 1.3), '45 degrees, on the edge of a 90 degree arc');
  assert.ok(!at(1.5, 0.5), 'outside the angle');
  assert.ok(!at(0, -1), 'behind');
  assert.ok(at(0, -0.2, 0.35), 'hurtbox overlapping the attacker counts');
});

test('360 arc hits all around; line is a thin box ahead', () => {
  const spin: HitShape = { kind: 'arc', range: 2.4, arcDeg: 360 };
  assert.ok(shapeHitsCircle(spin, vec2(), UP, vec2(0, -2), 0));
  const thrust: HitShape = { kind: 'line', range: 2.6, width: 0.4 };
  const at = (x: number, y: number, r = 0) => shapeHitsCircle(thrust, vec2(), UP, vec2(x, y), r);
  assert.ok(at(0, 2.5));
  assert.ok(!at(0, 2.7));
  assert.ok(!at(0.5, 1.5), 'beside the blade');
  assert.ok(at(0.5, 1.5, 0.35), 'hurtbox reaches the blade');
  assert.ok(!at(0, -0.5), 'not behind');
});

test('debug outline matches the hit data for every attack', () => {
  const tol = 0.05; // polygon chords sit about 1 cm inside the true arc
  for (const def of Object.values(ATTACKS)) {
    const poly = shapeOutline(def.hit);
    for (let x = -3; x <= 3; x += 0.1) {
      for (let y = -3; y <= 3; y += 0.1) {
        const p = vec2(x, y);
        const d = distanceToShape(def.hit, p);
        const inPoly = pointInPolygon(poly, p);
        if (d > tol) assert.ok(!inPoly, `${def.id}: (${x.toFixed(1)}, ${y.toFixed(1)}) drawn but not hittable`);
        if (d === 0 && distanceToPolygon(poly, p) > tol) {
          assert.ok(inPoly, `${def.id}: (${x.toFixed(1)}, ${y.toFixed(1)}) hittable but not drawn`);
        }
      }
    }
  }
});

// ------------------------------------------------------- her attacks on enemies

test('her slash hits an enemy in front once per swing, not one behind', () => {
  const sb = new HeadlessSandbox();
  const front = sb.addEnemy(0, 1.8);
  const behind = sb.addEnemy(0, -1.8);
  sb.step({ attack: true });
  sb.run(40);
  const hits = sb.combatLog.filter((e) => e.type === 'enemyHit');
  assert.equal(hits.length, 1, 'active for 6 frames, but one hit');
  assert.equal(front.damageTaken, ATTACKS[AttackId.Horizontal].damage);
  assert.equal(front.poise.value, ATTACKS[AttackId.Horizontal].poiseDamage);
  assert.equal(behind.damageTaken, 0);
});

test('each swing of a combo is a new chance to hit', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 2.5);
  sb.step({ attack: true });
  sb.run(9);
  sb.step({ attack: true });
  sb.run(9);
  sb.step({ attack: true });
  sb.run(30);
  assert.deepEqual(sb.attacks, [AttackId.Horizontal, AttackId.ReverseHorizontal, AttackId.Horizontal]);
  assert.equal(sb.combatLog.filter((x) => x.type === 'enemyHit').length, 3);
  assert.equal(e.poise.value, 30);
});

// ------------------------------------------------------- enemy attacks on her

test('enemy swing in range hits her once, even though it stays live for several frames', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 1.5);
  sb.swingFrom(e, SLASH, 6);
  sb.run(10);
  const hits = sb.combatLog.filter((x) => x.type === 'playerHit');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].type === 'playerHit' && hits[0].result, 'hit');
  assert.equal(sb.player.state, PlayerStateId.HitStun);
});

test('enemy swing out of range misses', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, SLASH.hit.range + PLAYER_R + 0.2);
  sb.swingFrom(e, SLASH);
  sb.run(10);
  assert.equal(sb.combatLog.length, 0);
  assert.equal(sb.player.state, PlayerStateId.Grounded);
});

test('near miss during the perfect dodge window counts as a perfect dodge', () => {
  // Outside her real hurtbox, inside the graze margin.
  const gap = SLASH.hit.range + PLAYER_R + GRAZE / 2;
  const standing = new HeadlessSandbox();
  standing.swingFrom(standing.addEnemy(gap, 0), SLASH);
  standing.run(5);
  assert.equal(standing.combatLog.length, 0, 'standing still: a clean miss');

  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(gap, 0);
  sb.step({ evade: true }); // rolls along +Y, sideways to the enemy
  sb.swingFrom(e, SLASH);
  sb.step();
  const hit = sb.combatLog.find((x) => x.type === 'playerHit');
  assert.equal(hit?.type === 'playerHit' && hit.result, 'perfectDodge');
  assert.equal(sb.player.state, PlayerStateId.PerfectDodge);
});

test('near miss after the perfect window is just a miss, never a hit', () => {
  const sb = new HeadlessSandbox();
  sb.step({ evade: true });
  sb.run(20); // ~0.35 s: past the perfect window and the i-frames, still rolling
  assert.equal(sb.player.state, PlayerStateId.Evade);
  assert.equal(sb.player.inPerfectDodgeWindow, false);

  const her = sb.motor.position;
  const e = sb.addEnemy(her.x + SLASH.hit.range + PLAYER_R + GRAZE / 2, her.y);
  sb.swingFrom(e, SLASH);
  sb.step();
  assert.equal(sb.combatLog.length, 0, 'graze margin is off outside the window');
  assert.equal(sb.player.state, PlayerStateId.Evade);
});

// ------------------------------------------------------- block reactions

test('normal block bounces the enemy weapon (recoil, swing cancelled)', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 1.5);
  sb.run(20, { block: true }); // past the perfect window
  sb.swingFrom(e, SLASH, 10);
  sb.step({ block: true });
  const hit = sb.combatLog.find((x) => x.type === 'playerHit');
  assert.equal(hit?.type === 'playerHit' && hit.result, 'blocked');
  assert.equal(e.status, 'recoil');
  assert.equal(e.swing, null);
});

test('perfect block parries and fills poise; enough of them break posture', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 1.8);
  const results: string[] = [];
  for (let i = 0; i < 4; i++) {
    sb.motor.position = vec2(0, 0); // the clash steps her in; reset between rounds
    sb.run(90); // let slow-mo and the parry wear off, block released
    sb.step({ block: true });
    assert.ok(sb.swingFrom(e, SLASH), `round ${i}: enemy ready to swing`);
    sb.step({ block: true });
    const last = sb.combatLog.filter((x) => x.type === 'playerHit').at(-1);
    results.push(last?.type === 'playerHit' ? last.result : 'none');
    if (i < 3) {
      assert.equal(e.status, 'parried');
      assert.equal(e.poise.value, 30 * (i + 1));
    }
  }
  assert.deepEqual(results, ['perfectBlock', 'perfectBlock', 'perfectBlock', 'perfectBlock']);
  assert.equal(e.status, 'staggered', '4 x 30 poise breaks a 100 meter');
  assert.ok(sb.combatLog.some((x) => x.type === 'enemyStaggered' && x.cause === 'perfectBlock'));
});

// ------------------------------------------------------------------ poise

test('poise: full meter staggers and cancels the swing; it drains when pressure stops', () => {
  const e = new Enemy('dummy', vec2());
  assert.ok(e.startSwing(SLASH, 1));
  assert.equal(e.takeHit(1, 60), false);
  assert.equal(e.takeHit(1, 60), true, 'broke at 120 / 100');
  assert.equal(e.status, 'staggered');
  assert.equal(e.swing, null, 'stagger interrupts the swing');
  assert.equal(e.startSwing(SLASH, 1), false, 'cannot swing while staggered');
  for (let i = 0; i < 80; i++) e.update(1 / 60);
  assert.equal(e.status, 'ready', 'stagger wears off on the world clock');

  e.takeHit(1, 50);
  for (let i = 0; i < 60; i++) e.update(1 / 60); // 1 s: still inside the regen delay
  assert.equal(e.poise.value, 50);
  for (let i = 0; i < 120; i++) e.update(1 / 60);
  assert.ok(e.poise.value < 50 && e.poise.value >= 0, `drained to ${e.poise.value.toFixed(1)}`);
});

// --------------------------------------------------------------- helpers

function pointInPolygon(poly: Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToPolygon(poly: Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1)));
    best = Math.min(best, Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t)));
  }
  return best;
}
