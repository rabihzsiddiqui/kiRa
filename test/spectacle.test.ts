import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AttackId } from '../src/combat/moves';
import { PostGrade, type GradeParams } from '../src/feel/PostGrade';
import { HeadlessSandbox } from '../src/sandbox/HeadlessSandbox';

/** Feeds each new sandbox cue to the grade, steps, and records the grade per frame. */
function graded(sb: HeadlessSandbox, grade = new PostGrade()) {
  let seen = 0;
  const frames: GradeParams[] = [];
  const step = (f: Parameters<HeadlessSandbox['step']>[0] = {}) => {
    sb.step(f);
    for (; seen < sb.cues.length; seen++) grade.cue(sb.cues[seen]);
    frames.push(grade.update(sb.realDt, sb.time.worldScale));
  };
  return { grade, frames, step };
}

// ------------------------------------------------------------ hit landing

test('her hits freeze the frame briefly; counters and posture breaks hold longer', () => {
  const sb = new HeadlessSandbox();
  sb.addEnemy(0, 1.8);
  sb.step({ attack: true });
  let frozen = 0;
  for (let i = 0; i < 30; i++) {
    sb.step();
    if (sb.time.worldScale < 0.1) frozen++;
  }
  assert.ok(sb.cues.includes('hit'), 'hit cue for the presentation layer');
  assert.ok(frozen >= 1 && frozen <= 3, `light hit stop: ${frozen} frames`);

  const big = new HeadlessSandbox();
  const e = big.addEnemy(3, 3);
  big.step({ evade: true });
  big.hitFrom(e); // perfect dodge
  big.step({ attack: true });
  let counterFrozen = 0;
  for (let i = 0; i < 60; i++) {
    big.step();
    if (big.time.worldScale < 0.1) counterFrozen++;
  }
  assert.deepEqual(big.attacks, [AttackId.PhantomDash]);
  assert.ok(counterFrozen > frozen + 2, `counter hit stop is longer (${counterFrozen} frames)`);
});

// ------------------------------------------------------------ the grade

test('perfect dodge greys the world out and muffles it, then eases back with the slow-mo', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 3);
  const g = graded(sb);
  g.step({ evade: true });
  sb.hitFrom(e);
  for (let i = 0; i < 20; i++) g.step();
  const deep = g.frames.at(-1)!;
  assert.ok(Math.abs(deep.saturation - 0.3) < 0.02, `desaturated to ${deep.saturation.toFixed(2)}`);
  assert.ok(deep.tint > 0.3, 'cool tint');
  assert.ok(deep.lowpassHz < 800, `world muffled (${deep.lowpassHz.toFixed(0)} Hz)`);
  assert.ok(g.frames.slice(0, 6).some((f) => f.aberration > 0.5), 'aberration pulse at the start');
  assert.equal(deep.aberration, 0, 'pulse is short (0.15 s)');

  for (let i = 0; i < 90; i++) g.step();
  assert.deepEqual(g.frames.at(-1), { saturation: 1, tint: 0, aberration: 0, radialBlur: 0, lowpassHz: 20000, vignette: 0 });
});

test('counter: the grade eases out with the released slow-mo, no jumps, hit stop holds it', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(3, 3);
  const g = graded(sb);
  g.step({ evade: true });
  sb.hitFrom(e);
  for (let i = 0; i < 10; i++) g.step();
  g.step({ attack: true }); // phantom dash, lands on the attacker
  for (let i = 0; i < 90; i++) g.step();
  assert.ok(sb.cues.includes('hit'), 'the counter connected');

  const after = g.frames.slice(11).map((f) => f.saturation);
  for (let i = 1; i < after.length; i++) {
    assert.ok(after[i] >= after[i - 1] - 1e-9, `frame ${i}: saturation went back down (hit stop must hold it)`);
    assert.ok(after[i] - after[i - 1] < 0.15, `frame ${i}: jumped by ${(after[i] - after[i - 1]).toFixed(3)}`);
  }
  assert.equal(after.at(-1), 1);
});

test('perfect block slow-mo does not grade the screen (that look is only for perfect dodge)', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 2.5);
  const g = graded(sb);
  g.step({ block: true });
  assert.equal(sb.hitFrom(e), 'perfectBlock');
  for (let i = 0; i < 20; i++) g.step({ block: true });
  assert.ok(g.frames.every((f) => f.saturation === 1 && f.lowpassHz === 20000));
});

test('reduced motion: no aberration or radial blur, the grade still happens', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 3);
  const g = graded(sb, new PostGrade({}, true));
  g.step({ evade: true });
  sb.hitFrom(e);
  for (let i = 0; i < 20; i++) g.step();
  assert.ok(g.frames.every((f) => f.aberration === 0 && f.radialBlur === 0));
  assert.ok(g.frames.at(-1)!.saturation < 0.4);
});

test('lock-on vignette closes in while targeting and opens back up after', () => {
  const grade = new PostGrade();
  const dt = 1 / 60;
  let v = 0;
  for (let i = 0; i < 6; i++) v = grade.update(dt, 1, true).vignette;
  assert.ok(v > 0 && v < 1, `easing in (${v.toFixed(2)})`);
  for (let i = 0; i < 30; i++) v = grade.update(dt, 1, true).vignette;
  assert.equal(v, 1, 'fully in while locked');
  for (let i = 0; i < 10; i++) v = grade.update(dt, 1, false).vignette;
  assert.ok(v > 0 && v < 1, `easing out, no snap (${v.toFixed(2)})`);
  for (let i = 0; i < 40; i++) v = grade.update(dt, 1, false).vignette;
  assert.equal(v, 0);
});

test('the vignette does not disturb the perfect dodge grade', () => {
  const a = new PostGrade();
  const b = new PostGrade();
  a.cue('perfectDodge');
  b.cue('perfectDodge');
  for (let i = 0; i < 10; i++) {
    const x = a.update(1 / 60, 0.3, true);
    const y = b.update(1 / 60, 0.3, false);
    assert.equal(x.saturation, y.saturation);
    assert.equal(x.tint, y.tint);
  }
});
