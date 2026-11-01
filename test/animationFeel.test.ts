import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTACKS, attackDuration, AttackId } from '../src/combat/moves';
import { CLIPS, LOCOMOTION, LOCOMOTION_CLIPS, locomotionWeights, type ClipDef } from '../src/character/clips';
import { GRIP_RADIUS, KNUCKLES } from '../src/character/bodyFit';
import { ANKLE, armIK, jointFrames, legIK } from '../src/character/fk';
import { BONE_IDS } from '../src/character/rig';
import { vec2 } from '../src/core/math';
import { DEFAULT_TUNING as T, PlayerStateId } from '../src/player/contracts';
import { HeadlessSandbox } from '../src/sandbox/HeadlessSandbox';

/*
 * The animations have life in them: feet that stay planted while she walks (no gliding,
 * charging a spin included), attacks that never freeze mid-move, and swings where the body
 * leads and the arm follows.
 */

const FPS = 240;

/**
 * Average speed the supporting foot slides along the floor while it's down (m/s), with
 * her moving at `speed` along (dx, dy) (her right, her forward). Also how much of the
 * cycle some foot is down.
 */
function footSlip(clip: ClipDef, dx: number, dy: number, speed: number): { slip: number; grounded: number } {
  let slip = 0;
  let down = 0;
  const n = Math.round(clip.duration * FPS);
  for (let i = 0; i < n; i++) {
    const t = clip.duration * (i / n);
    const [a, b] = [jointFrames(clip.sample(t)), jointFrames(clip.sample(t + 1 / FPS))];
    const foot = a.footL.p[1] < a.footR.p[1] ? 'footL' : 'footR';
    if (a[foot].p[1] > ANKLE + 0.001) continue; // in the air
    down++;
    // Relative to her the planted foot moves back at her speed; in the world it's still.
    const vx = (b[foot].p[0] - a[foot].p[0]) * FPS + dx * speed;
    const vz = (b[foot].p[2] - a[foot].p[2]) * FPS - dy * speed;
    slip += Math.hypot(vx, vz);
  }
  return { slip: slip / Math.max(1, down), grounded: down / n };
}

test('leg IK puts the ankle where it was asked', () => {
  for (const to of [[0, -0.8, 0], [0.1, -0.75, -0.25], [-0.15, -0.7, 0.3], [0.2, -0.6, 0.1]] as const) {
    const ik = legIK(to);
    const f = jointFrames({ bones: { thighR: ik.thigh, shinR: ik.shin, footR: ik.foot } });
    const got = f.footR.p.map((v, k) => v - f.thighR.p[k]);
    assert.ok(Math.hypot(got[0] - to[0], got[1] - to[1], got[2] - to[2]) < 1e-6, `${to} -> ${got.map((v) => v.toFixed(3))}`);
  }
});

test('charging a spin on the move takes small steps: the planted foot never slides', () => {
  const C = LOCOMOTION_CLIPS;
  for (const [clip, dx, dy] of [[C.chargeF, 0, 1], [C.chargeB, 0, -1], [C.chargeL, -1, 0], [C.chargeR, 1, 0]] as const) {
    const { slip, grounded } = footSlip(clip, dx, dy, T.chargeMoveSpeed);
    assert.ok(slip < 0.05, `${clip.name}: foot slides at ${slip.toFixed(2)} m/s (gliding was ${T.chargeMoveSpeed})`);
    assert.ok(grounded > 0.95, `${clip.name}: a foot is always down, it's a walk`);
  }
  // Charging in place: both feet flat on the floor.
  const f = jointFrames(C.charge.sample(0));
  for (const foot of ['footL', 'footR'] as const) assert.ok(Math.abs(f[foot].p[1] - ANKLE) < 1e-3, `${foot} on the floor`);
});

test('blocking on the move takes small steps too: the planted foot never slides', () => {
  const C = LOCOMOTION_CLIPS;
  for (const [clip, dx, dy] of [[C.guardF, 0, 1], [C.guardB, 0, -1], [C.guardL, -1, 0], [C.guardR, 1, 0]] as const) {
    const { slip, grounded } = footSlip(clip, dx, dy, T.guardMoveSpeed);
    assert.ok(slip < 0.05, `${clip.name}: foot slides at ${slip.toFixed(2)} m/s`);
    assert.ok(grounded > 0.95, `${clip.name}: a foot is always down`);
  }
  // The guard itself doesn't move while she steps: hands stay on the grip, braced.
  const [still, step] = [jointFrames(C.guard.sample(0)), jointFrames(C.guardF.sample(0.2))];
  assert.ok(Math.hypot(...step.handL.p.map((v, k) => v - step.handR.p[k])) < 0.15, 'both hands on the grip');
  assert.ok(Math.abs(step.handR.p[1] - still.handR.p[1]) < 0.05, 'the guard stays up');
});

test('blocking asks for the guard stepping blend, in the direction she is moving', () => {
  const sb = new HeadlessSandbox();
  sb.run(5, { block: true });
  assert.equal(sb.player.state, PlayerStateId.Guard);
  assert.equal(sb.anim.clip, LOCOMOTION);
  assert.equal(sb.anim.params.get('locomotion'), 4);
  sb.run(5, { block: true, stick: vec2(1, 0) });
  assert.ok((sb.anim.params.get('strafeX') ?? 0) > 0.5 || (sb.anim.params.get('strafeY') ?? 0) > 0.5, 'stepping the way she moves');
});

test('strafing: planted feet stay put forward and back; sideways they slide far less than a glide', () => {
  const C = LOCOMOTION_CLIPS;
  for (const [clip, dx, dy] of [[C.strafeF, 0, 1], [C.strafeB, 0, -1]] as const) {
    const { slip } = footSlip(clip, dx, dy, T.strafeSpeed);
    assert.ok(slip < 0.1, `${clip.name}: foot slides at ${slip.toFixed(2)} m/s`);
  }
  // 4 m/s sideways is faster than any natural side step: the steps are capped.
  for (const [clip, dx] of [[C.strafeL, -1], [C.strafeR, 1]] as const) {
    const { slip } = footSlip(clip, dx, 0, T.strafeSpeed);
    assert.ok(slip < T.strafeSpeed * 0.4, `${clip.name}: foot slides at ${slip.toFixed(2)} m/s`);
  }
});

test('side steps never cross or knock: the feet stay apart', () => {
  const C = LOCOMOTION_CLIPS;
  for (const clip of [C.strafeL, C.strafeR, C.chargeL, C.chargeR]) {
    let closest = Infinity;
    for (let i = 0; i < 120; i++) {
      const f = jointFrames(clip.sample((clip.duration * i) / 120));
      closest = Math.min(closest, f.footR.p[0] - f.footL.p[0], f.shinR.p[0] - f.shinL.p[0]);
    }
    assert.ok(closest > 0.12, `${clip.name}: feet or knees ${closest.toFixed(2)} m apart at their closest`);
  }
});

test('charging asks for the stepping blend, in the direction she is moving', () => {
  const sb = new HeadlessSandbox();
  sb.run(30, { attack: true }); // slash, then holding: charging
  assert.equal(sb.player.state, PlayerStateId.SpinCharge);
  sb.run(10, { attack: true, stick: vec2(0, 1) });
  assert.equal(sb.anim.clip, LOCOMOTION);
  assert.equal(sb.anim.params.get('locomotion'), 3);
  assert.ok((sb.anim.params.get('strafeY') ?? 0) > 0.9, 'stepping forward');
});

/** Biggest joint change (degrees) between two poses. */
function change(clip: ClipDef, t0: number, t1: number): number {
  const [a, b] = [clip.sample(t0), clip.sample(t1)];
  let most = Math.abs((a.hipsY ?? 0) - (b.hipsY ?? 0)) * 1000; // 1 mm counts like a degree
  for (const id of BONE_IDS) {
    const [x, y] = [a.bones[id] ?? [0, 0, 0], b.bones[id] ?? [0, 0, 0]];
    for (let k = 0; k < 3; k++) most = Math.max(most, Math.abs(x[k] - y[k]));
  }
  return most;
}

test('no attack freezes: something is always moving from start to finish', () => {
  for (const def of Object.values(ATTACKS)) {
    const clip = CLIPS.get(def.anim)!;
    const end = attackDuration(def);
    let still = 0;
    let longest = 0;
    for (let t = 0; t < end; t += 1 / 60) {
      still = change(clip, t, Math.min(end, t + 1 / 60)) < 0.05 ? still + 1 / 60 : 0;
      longest = Math.max(longest, still);
    }
    assert.ok(longest < 0.05, `${def.id} holds still for ${longest.toFixed(2)} s`);
  }
});

test('swings whip: the body turns first, the sword arm follows', () => {
  for (const id of [AttackId.Horizontal, AttackId.ReverseHorizontal, AttackId.Vertical]) {
    const def = ATTACKS[id];
    const clip = CLIPS.get(def.anim)!;
    /** When a bone moves fastest in the swing, and how much it moves in all. */
    const motion = (bone: 'chest' | 'shoulderR' | 'upperArmR') => {
      let [best, at, total] = [0, 0, 0];
      for (let t = 0; t < def.startup + def.active; t += 1 / FPS) {
        const [a, b] = [clip.sample(t).bones[bone] ?? [0, 0, 0], clip.sample(t + 1 / FPS).bones[bone] ?? [0, 0, 0]];
        const v = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        total += v;
        if (v > best) [best, at] = [v, t];
      }
      return { at, total };
    };
    // The arm swings at whichever joint does the work (the shoulder for flat cuts).
    const arm = [motion('shoulderR'), motion('upperArmR')].sort((x, y) => y.total - x.total)[0];
    const chest = motion('chest');
    assert.ok(chest.at < arm.at, `${id}: chest peaks at ${chest.at.toFixed(3)}, the arm at ${arm.at.toFixed(3)}`);
  }
});

test('arm IK puts the wrist where it was asked, elbow bending forward', () => {
  for (const to of [[0, -0.4, -0.2], [0.2, -0.2, -0.3], [-0.1, 0, -0.4]] as const) {
    const ik = armIK(to);
    assert.ok(ik.forearm[0] >= 0, 'elbows bend forward');
    const f = jointFrames({ bones: { upperArmL: ik.upperArm, forearmL: ik.forearm } });
    // The shoulder bone has no turn here, so its frame is the body's.
    const got = f.handL.p.map((v, k) => v - f.upperArmL.p[k]);
    assert.ok(Math.hypot(got[0] - to[0], got[1] - to[1], got[2] - to[2]) < 1e-6, `${to} -> ${got.map((v) => v.toFixed(3))}`);
  }
});

/** Distance between her feet (m), and whether both are flat on the floor. */
function stance(clip: ClipDef): { apart: number; planted: boolean } {
  const f = jointFrames(clip.sample(0.3));
  const apart = Math.hypot(f.footR.p[0] - f.footL.p[0], f.footR.p[2] - f.footL.p[2]);
  return { apart, planted: [f.footL.p[1], f.footR.p[1]].every((y) => Math.abs(y - ANKLE) < 1e-3) };
}

test('locked on she stands in a wide, planted fighting stance; near an enemy, a slightly wider idle', () => {
  const C = LOCOMOTION_CLIPS;
  const [idle, alert, fight] = [stance(C.idle), stance(C.alert), stance(C.stance)];
  assert.ok(alert.apart > idle.apart + 0.05, `alert ${alert.apart.toFixed(2)} m vs idle ${idle.apart.toFixed(2)}`);
  assert.ok(fight.apart > alert.apart + 0.1, `fighting stance ${fight.apart.toFixed(2)} m`);
  assert.ok(alert.planted && fight.planted, 'feet flat on the floor');
});

test('near an enemy her idle turns alert; locked on and standing, the fighting stance', () => {
  const near = new HeadlessSandbox();
  near.addEnemy(1, 5);
  near.run(3);
  assert.equal(near.anim.params.get('alert'), 1);
  assert.equal(locomotionWeights({ locomotion: 0, speed: 0, strafeX: 0, strafeY: 0, alert: 1 }).weights.alert, 1);
  near.run(3, { target: true });
  assert.equal(near.anim.params.get('locomotion'), 2);
  assert.equal(locomotionWeights({ locomotion: 2, speed: 0, strafeX: 0, strafeY: 0 }).weights.stance, 1);
  const alone = new HeadlessSandbox();
  alone.run(3);
  assert.equal(alone.anim.params.get('alert'), 0);
});

test('the parry is the block pushed out: same planted feet, both hands on the grip, arms further forward', () => {
  const guard = jointFrames(CLIPS.get('guard_raise')!.sample(1));
  for (const name of ['pb_clash_a', 'pb_clash_b']) {
    const clip = CLIPS.get(name)!;
    const push = jointFrames(clip.sample(0.1));
    for (const foot of ['footL', 'footR'] as const) {
      assert.ok(Math.hypot(push[foot].p[0] - guard[foot].p[0], push[foot].p[2] - guard[foot].p[2]) < 0.01, `${name}: ${foot} stays put`);
    }
    // Driven out from her chest (forward, or out to the side for the second one).
    const reach = (f: typeof guard) => Math.hypot(f.handR.p[0] - f.chest.p[0], f.handR.p[2] - f.chest.p[2]);
    assert.ok(reach(push) > reach(guard) + 0.08, `${name}: hands pushed out (${reach(guard).toFixed(2)} -> ${reach(push).toFixed(2)} m)`);
    assert.ok(Math.hypot(...push.handL.p.map((v, k) => v - push.handR.p[k])) < 0.15, `${name}: left hand on the grip`);
    const settled = jointFrames(clip.sample(clip.duration));
    assert.ok(Math.abs(settled.handR.p[2] - guard.handR.p[2]) < 1e-6, `${name}: back into the guard`);
  }
});

test('cuts from her right across to her left are two-handed; the backhands coming back are not', () => {
  /** Left wrist to the grip just below the right hand (m), at time t. */
  const gap = (anim: string, t: number) => {
    const f = jointFrames(CLIPS.get(anim)!.sample(t));
    const r = f.handR.r;
    const grip = [0, 1, 2].map((k) => f.handR.p[k] + r[k * 3 + 2] * 0.09);
    return Math.hypot(...grip.map((v, k) => v - f.handL.p[k]));
  };
  for (const id of [AttackId.Horizontal, AttackId.Vertical]) {
    const d = ATTACKS[id];
    // Wind-up, the cut and the follow-through: both hands on the sword.
    for (let t = 0; t <= d.startup + d.active + d.recovery * 0.35; t += 1 / 60) {
      assert.ok(gap(d.anim, t) < 0.04, `${id}: left hand ${gap(d.anim, t).toFixed(3)} m off the grip at ${t.toFixed(2)} s`);
    }
    assert.ok(gap(d.anim, attackDuration(d)) > 0.2, `${id}: lets go as she settles back to ready`);
  }
  for (const id of [AttackId.ReverseHorizontal, AttackId.VerticalLeft]) {
    const d = ATTACKS[id];
    assert.ok(gap(d.anim, d.startup + d.active) > 0.2, `${id}: a one-handed backhand`);
  }
});

test('flat cuts are driven from the ground: feet planted, hips turning, weight moving, heel pivoting', () => {
  for (const [id, turn, pivot] of [[AttackId.Horizontal, 1, 'footR'], [AttackId.ReverseHorizontal, -1, 'footL']] as const) {
    const d = ATTACKS[id];
    const clip = CLIPS.get(d.anim)!;
    const start = jointFrames(clip.sample(0));
    const hit = d.startup + d.active;
    let moved = 0;
    for (let t = 0; t <= hit + d.recovery * 0.4; t += 1 / 60) {
      const f = jointFrames(clip.sample(t));
      for (const foot of ['footL', 'footR'] as const) moved = Math.max(moved, Math.hypot(f[foot].p[0] - start[foot].p[0], f[foot].p[2] - start[foot].p[2]));
    }
    assert.ok(moved < 0.01, `${id}: feet stay planted (moved ${(moved * 100).toFixed(1)} cm)`);
    const yaw = (t: number) => clip.sample(t).bones.hips?.[1] ?? 0;
    assert.ok(turn * (yaw(hit) - yaw(0)) > 40, `${id}: hips unwind through the cut (${yaw(0).toFixed(0)} -> ${yaw(hit).toFixed(0)})`);
    const hipsZ = (t: number) => clip.sample(t).hipsZ ?? 0;
    assert.ok(Math.abs(hipsZ(hit) - hipsZ(0)) > 0.04, `${id}: weight moves between the feet`);
    // The pivot foot's heel up: its toe lower than its heel compared with standing flat.
    const heelUp = (t: number) => (clip.sample(t).bones[pivot]?.[0] ?? 0) - (clip.sample(0).bones[pivot]?.[0] ?? 0);
    assert.ok(heelUp(hit) > 10, `${id}: ${pivot} heel comes up as she pivots`);
  }
});

test('the left fist closes on the handle itself, below the right hand, not past it', () => {
  const holds: Array<[string, number[]]> = [
    ['guard_raise', [1]],
    ['pb_clash_a', [0.1]],
    ['pb_clash_b', [0.1]],
    ['atk_horizontal', [0, 0.12, 0.15, 0.2]],
    ['atk_vertical', [0, 0.15, 0.22]],
  ];
  const at = (f: ReturnType<typeof jointFrames>, hand: 'handL' | 'handR', local: number[]) =>
    [0, 1, 2].map((k) => f[hand].p[k] + f[hand].r[k * 3] * local[0] + f[hand].r[k * 3 + 1] * local[1] + f[hand].r[k * 3 + 2] * local[2]);
  for (const [name, times] of holds) {
    for (const t of times) {
      const f = jointFrames(CLIPS.get(name)!.sample(t));
      // The sword's axis: through the right fist, along the right hand's Z. Fists curl mirror-wise.
      const origin = at(f, 'handR', [-GRIP_RADIUS, -KNUCKLES, 0]);
      const axis = [2, 5, 8].map((i) => f.handR.r[i]);
      const fist = at(f, 'handL', [GRIP_RADIUS, -KNUCKLES, 0]);
      const rel = fist.map((v, k) => v - origin[k]);
      const along = rel[0] * axis[0] + rel[1] * axis[1] + rel[2] * axis[2];
      const off = Math.hypot(...rel.map((v, k) => v - along * axis[k]));
      assert.ok(off < 0.01, `${name} at ${t}: left fist ${(off * 100).toFixed(1)} cm off the handle`);
      assert.ok(along > 0.06 && along < 0.16, `${name} at ${t}: ${(along * 100).toFixed(1)} cm down the handle`);
    }
  }
});
