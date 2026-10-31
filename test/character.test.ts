import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTACKS, attackDuration, EVADES, EvadeId } from '../src/combat/moves';
import { lowestPoint } from '../src/character/fk';
import { CLIPS, LOCOMOTION, locomotionWeights } from '../src/character/clips';
import { len, Ponytail, type HeadFrame } from '../src/character/Ponytail';
import { BONE_IDS } from '../src/character/rig';
import type { Vec3 } from '../src/physics/space';

const STATES = resolve(dirname(fileURLToPath(import.meta.url)), '../src/player/states');

// ------------------------------------------------------------------ clips

test('every clip name the player states ask for has a clip', () => {
  const names = new Set<string>([...Object.values(ATTACKS).map((a) => a.anim), ...Object.values(EVADES).map((e) => e.anim)]);
  // Literal clip names in the states: animator.play('x'), the flip table, the clash poses.
  const clipLike = /'((?:atk|evade|pd|pb|guard|spin)_[a-z_]+|locomotion|fall|hurt)'/g;
  for (const file of readdirSync(STATES)) {
    for (const m of readFileSync(join(STATES, file), 'utf8').matchAll(clipLike)) names.add(m[1]);
  }
  assert.ok(names.size >= 24, `found ${names.size} clip names`); // 8 attacks, 4 evades, 4 flips, 2 clashes, 6 others
  const missing = [...names].filter((n) => n !== LOCOMOTION && !CLIPS.has(n));
  assert.deepEqual(missing, [], 'clips missing from src/character/clips.ts');
});

test('attack and evade clips last exactly as long as the moves', () => {
  for (const a of Object.values(ATTACKS)) assert.equal(CLIPS.get(a.anim)?.duration, attackDuration(a), a.id);
  for (const e of Object.values(EVADES)) assert.equal(CLIPS.get(e.anim)?.duration, e.duration, e.id);
});

test('clips only use rig bones and finite angles', () => {
  const bones = new Set<string>(BONE_IDS);
  for (const clip of CLIPS.values()) {
    for (let i = 0; i <= 10; i++) {
      const pose = clip.sample((clip.duration * i) / 10);
      for (const [bone, e] of Object.entries(pose.bones)) {
        assert.ok(bones.has(bone), `${clip.name}: unknown bone ${bone}`);
        assert.ok(e.every(Number.isFinite), `${clip.name}: ${bone} is not finite`);
      }
    }
  }
});

test('flips end where they started, so blending out never snaps', () => {
  for (const name of ['evade_roll', 'evade_backflip', 'pd_aerial_cartwheel', 'pd_corkscrew_left', 'pd_corkscrew_right', 'pd_backflip_twist']) {
    const clip = CLIPS.get(name)!;
    const hips = clip.sample(clip.duration).bones.hips ?? [0, 0, 0];
    for (const a of hips) assert.ok(Math.abs(((a % 360) + 360) % 360) < 1e-6 || Math.abs((((a % 360) + 360) % 360) - 360) < 1e-6, `${name} ends at ${hips}`);
  }
});

test('locomotion blend weights sum to 1 and follow the params', () => {
  const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);
  const idle = locomotionWeights({ locomotion: 0, speed: 0, strafeX: 0, strafeY: 0 });
  assert.equal(idle.weights.idle, 1);
  const run = locomotionWeights({ locomotion: 1, speed: 6, strafeX: 0, strafeY: 0 });
  assert.equal(run.weights.run, 1);
  const half = locomotionWeights({ locomotion: 1, speed: 3, strafeX: 0, strafeY: 0 });
  assert.ok(Math.abs(half.weights.run - 0.5) < 1e-9 && half.runRate === 0.5);
  const diag = locomotionWeights({ locomotion: 2, speed: 0, strafeX: 0.6, strafeY: -0.6 });
  assert.ok(diag.weights.strafeR > 0 && diag.weights.strafeB > 0 && diag.weights.strafeL === 0);
  for (const w of [idle, run, half, diag]) assert.ok(Math.abs(sum(w.weights) - 1) < 1e-9);
});

// --------------------------------------------------------------- ponytail

const HEAD: HeadFrame = { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, back: { x: 0, y: 0, z: 1 } };
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const dist = (a: Vec3, b: Vec3) => len({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

function segmentLengths(p: Ponytail): number[] {
  return p.points.slice(1).map((q, i) => dist(q, p.points[i]));
}

test('ponytail settles under gravity: hangs down and comes to rest', () => {
  const hair = new Ponytail();
  const socket = v(0, 1.7, 0.1);
  hair.reset(socket, HEAD);
  for (let i = 0; i < 60 * 4; i++) hair.update(1 / 60, socket, HEAD);
  const before = hair.points.map((p) => ({ ...p }));
  hair.update(1 / 60, socket, HEAD);
  const motion = Math.max(...hair.points.map((p, i) => dist(p, before[i])));
  assert.ok(motion < 1e-3, `still moving ${motion.toFixed(5)} m per frame`);
  const tip = hair.points.at(-1)!;
  const length = hair.cfg.segments * hair.cfg.segmentLength;
  assert.ok(tip.y < socket.y - length * 0.9, `hangs straight down (${(socket.y - tip.y).toFixed(2)} of ${length.toFixed(2)} m)`);
  assert.ok(Math.hypot(tip.x - socket.x, tip.z - socket.z) < 0.1, 'not held out at an angle');
});

test('ponytail drapes down the back of her head from a high tie', () => {
  const hair = new Ponytail();
  const head = { center: v(0, 1.62, 0), radius: 0.125 };
  const socket = v(0, 1.72, 0.08); // high on the back of the head
  hair.reset(socket, HEAD);
  for (let i = 0; i < 60 * 4; i++) hair.update(1 / 60, socket, HEAD, [head]);
  for (const p of hair.points.slice(1)) assert.ok(dist(p, head.center) >= head.radius - 0.01, 'stays outside the head');
  const tip = hair.points.at(-1)!;
  assert.ok(tip.z > head.center.z + 0.08, 'falls behind the head');
  assert.ok(tip.y < head.center.y - 0.25, 'and on down her back');
});

test('ponytail never stretches past its segment lengths, even when shaken and dashed', () => {
  const hair = new Ponytail();
  const L = hair.cfg.segmentLength;
  let socket = v(0, 1.7, 0);
  hair.reset(socket, HEAD);
  let worst = 0;
  for (let f = 0; f < 600; f++) {
    // Violent shaking, plus a 9 m Phantom Dash in 0.15 s at frame 300.
    const dash = f >= 300 && f < 309 ? 1 : 0;
    socket = v(socket.x + dash, 1.7 + Math.sin(f * 0.9) * 0.3, Math.cos(f * 1.3) * 0.3);
    hair.update(1 / 60, socket, HEAD);
    for (const l of segmentLengths(hair)) worst = Math.max(worst, l);
    for (const p of hair.points) assert.ok(Number.isFinite(p.x + p.y + p.z), `frame ${f}: not finite`);
  }
  assert.ok(worst <= L + 1e-9, `longest segment ${worst} vs ${L}`);
  const total = L * hair.cfg.segments;
  assert.ok(dist(hair.points.at(-1)!, socket) <= total + 1e-9, 'the tip stays within reach of the socket');
});

test('ponytail stays outside the head collision sphere', () => {
  const hair = new Ponytail({ restDir: v(0, -0.2, -1) }); // rest shape points INTO the head
  const head = { center: v(0, 1.6, 0), radius: 0.12 };
  const socket = v(0, 1.73, 0.04);
  hair.reset(socket, HEAD);
  for (let i = 0; i < 240; i++) hair.update(1 / 60, socket, HEAD, [head]);
  for (const p of hair.points.slice(1)) assert.ok(dist(p, head.center) >= head.radius - 0.01, 'inside the head');
});

test('ponytail runs on the clock it is given: half the dt, half the motion', () => {
  const fast = new Ponytail();
  const slow = new Ponytail();
  const tilted: HeadFrame = { right: v(1, 0, 0), up: v(0, 0, -1), back: v(0, 1, 0) }; // swings from a horizontal start
  const socket = v(0, 1.7, 0);
  fast.reset(socket, tilted);
  slow.reset(socket, tilted);
  for (let i = 0; i < 30; i++) fast.update(1 / 60, socket, HEAD);
  for (let i = 0; i < 60; i++) slow.update(1 / 120, socket, HEAD);
  const tipFast = fast.points.at(-1)!;
  const tipSlow = slow.points.at(-1)!;
  assert.ok(dist(tipFast, tipSlow) < 1e-6, 'same simulated time, same result');
});

test('the roll stays on the floor all the way round: no sinking in, no floating', () => {
  const roll = CLIPS.get(EVADES[EvadeId.Roll].anim)!;
  let maxShift = 0;
  for (let i = 0; i <= 30; i++) {
    const pose = roll.sample((roll.duration * i) / 30);
    const low = lowestPoint(pose);
    assert.ok(low > 0.02 && low < 0.06, `frame ${i}: lowest point ${low.toFixed(3)} m`);
    maxShift = Math.max(maxShift, Math.abs(pose.hipsZ ?? 0));
  }
  // It turns about the middle of the tucked body, so the hips swing around that point.
  assert.ok(maxShift > 0.2, `hips move around the tuck's center (${maxShift.toFixed(2)} m)`);
});

test('ponytail draws smoothly at uneven frame rates while she runs (no fidgeting)', () => {
  // Head running forward with a smooth step bounce; frames arrive 13 to 20 ms apart.
  const frame: HeadFrame = { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, back: { x: 0, y: 0, z: 1 } };
  const p = new Ponytail();
  let t = 0;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rel: Vec3[] = [];
  for (let f = 0; f < 600; f++) {
    const dt = 1 / 60 + (rnd() - 0.5) * 0.007;
    t += dt;
    const socket = { x: 0, y: 1.68 + 0.03 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 0.33)), z: -6 * t };
    p.update(dt, socket, frame);
    const pts = p.renderPoints(socket);
    const tip = pts[pts.length - 1];
    rel.push({ x: tip.x - socket.x, y: tip.y - socket.y, z: tip.z - socket.z });
  }
  // Frame-to-frame change in the tip's motion relative to her head, after it settles.
  let jerk = 0;
  for (let i = 302; i < rel.length; i++) {
    for (const k of ['x', 'y', 'z'] as const) jerk += Math.abs(rel[i][k] - 2 * rel[i - 1][k] + rel[i - 2][k]);
  }
  const mm = (jerk / (rel.length - 302)) * 1000;
  assert.ok(mm < 5, `tip jumpiness ${mm.toFixed(1)} mm per frame squared`);
});
