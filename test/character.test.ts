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

test('the roll is a dive: crouch, push off, hand to the floor, and only then the tuck', () => {
  const roll = CLIPS.get(EVADES[EvadeId.Roll].anim)!;
  const at = (t: number) => {
    const pose = roll.sample(t);
    return { pose, f: jointFrames(pose), turn: -(pose.bones.hips?.[0] ?? 0) };
  };
  const start = at(0);
  const load = at(0.07);
  const push = at(0.1);
  const hand = at(0.15);
  const tuck = at(0.25);
  assert.ok(load.f.hips.p[1] < start.f.hips.p[1] - 0.12 && load.turn < 10, 'drops into a crouch before tipping over');
  assert.ok(push.f.hips.p[1] > load.f.hips.p[1] + 0.04, 'pushes off out of the crouch');
  assert.ok(hand.turn > 60 && hand.turn < 100, `tipped forward onto the hand (${hand.turn.toFixed(0)} deg)`);
  assert.ok(hand.f.handL.p[1] < 0.2 && hand.f.handL.p[2] < hand.f.hips.p[2], 'the free hand is down on the floor ahead of her');
  assert.ok((hand.pose.bones.shinL?.[0] ?? 0) > -60, 'legs still long behind her in the dive, not balled up');
  assert.ok((tuck.pose.bones.shinL?.[0] ?? 0) < -120, 'tucked once she is over');
});
