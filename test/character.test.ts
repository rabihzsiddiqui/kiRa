import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTACKS, attackDuration, EVADES, EvadeId } from '../src/combat/moves';
import { jointFrames, lowestPoint } from '../src/character/fk';
import { CLIPS, LOCOMOTION, locomotionWeights } from '../src/character/clips';
import { BONE_IDS } from '../src/character/rig';

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

// ------------------------------------------------------------------- roll

const roll = CLIPS.get(EVADES[EvadeId.Roll].anim)!;
/** The dive: from the push off until her back takes the floor, she's in the air. */
const DIVE = [0.17, 0.23];

test('the roll stays on the floor: never sinks in, only leaves it for the dive', () => {
  for (let i = 0; i <= 140; i++) {
    const t = (roll.duration * i) / 140;
    const low = lowestPoint(roll.sample(t));
    const airborne = t >= DIVE[0] && t <= DIVE[1];
    assert.ok(low > 0.01, `t ${t.toFixed(3)}: sinks into the floor (${low.toFixed(3)} m)`);
    assert.ok(low < (airborne ? 0.2 : 0.08), `t ${t.toFixed(3)}: floating ${low.toFixed(3)} m`);
  }
  // It turns about the middle of the tucked body, so the hips swing around that point.
  const shift = Math.max(...Array.from({ length: 31 }, (_, i) => Math.abs(roll.sample((roll.duration * i) / 30).hipsZ ?? 0)));
  assert.ok(shift > 0.2, `hips move around the tuck's center (${shift.toFixed(2)} m)`);
});

test('the roll is smooth: no hip snaps, and the spin speeds up and slows down without jerks', () => {
  const dt = 1 / 240;
  const hips: number[] = [];
  const turn: number[] = [];
  for (let t = 0; t <= roll.duration + 1e-9; t += dt) {
    const pose = roll.sample(t);
    hips.push(jointFrames(pose).hips.p[1]);
    turn.push(-(pose.bones.hips?.[0] ?? 0));
  }
  const second = (xs: number[], i: number) => (xs[i + 1] - 2 * xs[i] + xs[i - 1]) / (dt * dt);
  let hipAcc = 0;
  let spinAcc = 0;
  for (let i = 1; i < hips.length - 1; i++) {
    hipAcc = Math.max(hipAcc, Math.abs(second(hips, i)));
    spinAcc = Math.max(spinAcc, Math.abs(second(turn, i)));
  }
  // Before smoothing, contact changes snapped the hips at over 5000 m/s^2.
  assert.ok(hipAcc < 600, `hip height changes smoothly (peak ${hipAcc.toFixed(0)} m/s^2)`);
  // Before, the spin stopped dead at the end (over 100000 deg/s^2).
  assert.ok(spinAcc < 20000, `spin changes speed smoothly (peak ${spinAcc.toFixed(0)} deg/s^2)`);
  const end = turn.findIndex((a) => a >= 360);
  assert.ok(end > 0 && turn[end] - turn[end - 1] < 0.1, 'the spin eases out to a stop as her feet come under her');
});

test('the roll is a dive: crouch, push off, hand to the floor, and only then the tuck', () => {
  const at = (t: number) => {
    const pose = roll.sample(t);
    return { pose, f: jointFrames(pose), turn: -(pose.bones.hips?.[0] ?? 0) };
  };
  const start = at(0);
  const load = at(0.1);
  const push = at(0.15);
  const hand = at(0.2);
  const tuck = at(0.33);
  assert.ok(load.f.hips.p[1] < start.f.hips.p[1] - 0.12 && load.turn < 10, 'drops into a crouch before tipping over');
  assert.ok(push.f.hips.p[1] > load.f.hips.p[1] + 0.04, 'pushes off out of the crouch');
  assert.ok(hand.turn > 60 && hand.turn < 100, `tipped forward onto the hand (${hand.turn.toFixed(0)} deg)`);
  assert.ok(hand.f.handL.p[1] < 0.25 && hand.f.handL.p[2] < hand.f.hips.p[2], 'the free hand is down by the floor ahead of her');
  assert.ok((hand.pose.bones.shinL?.[0] ?? 0) > -60, 'legs still long behind her in the dive, not balled up');
  assert.ok((tuck.pose.bones.shinL?.[0] ?? 0) < -120, 'tucked once she is over');
});
