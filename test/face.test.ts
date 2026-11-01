import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitBody, restJoints } from '../src/character/bodyFit';
import { FACE_MOOD, FaceState, type Expression, type FaceInput } from '../src/character/face';
import { FACE, fitFace } from '../src/character/faceFit';
import { BONE_IDS } from '../src/character/rig';
import { readBody } from './support/readBody';

/*
 * Her face: neutral most of the time, a little angry near an enemy and locked on, a frown
 * when she attacks, eyes shut when hurt; blinks now and then. And the eyes sit on her face.
 */

const CALM: FaceInput = { alert: false, locked: false, attacking: false, hurt: false };

function live(face: FaceState, seconds: number, input: FaceInput): Expression[] {
  const out: Expression[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) out.push(face.update(1 / 60, input));
  return out;
}
const last = (xs: Expression[]) => xs[xs.length - 1];

test('neutral by default', () => {
  const e = last(live(new FaceState(), 1, CALM));
  assert.ok(e.angry < 0.01 && e.frown < 0.01 && e.pain < 0.01);
});

test('near an enemy the brows go a little angry; locked on, a bit more; attacking, a frown', () => {
  const near = last(live(new FaceState(), 0.5, { ...CALM, alert: true }));
  assert.ok(Math.abs(near.angry - FACE_MOOD.alert) < 0.02 && near.frown < 0.01, `alert: ${near.angry.toFixed(2)}`);
  const locked = last(live(new FaceState(), 0.5, { ...CALM, locked: true }));
  assert.ok(locked.angry > near.angry, 'locked on reads angrier than just near');
  const swing = last(live(new FaceState(), 0.3, { ...CALM, locked: true, attacking: true }));
  assert.ok(swing.frown > 0.95 && swing.angry > 0.8, 'frowning mid-swing');
});

test('moods come on fast and ease off slowly', () => {
  const face = new FaceState();
  const on = live(face, 0.1, { ...CALM, attacking: true });
  assert.ok(last(on).frown > 0.7, `on within 0.1 s (${last(on).frown.toFixed(2)})`);
  live(face, 0.3, { ...CALM, attacking: true });
  const off = live(face, 0.1, CALM);
  assert.ok(last(off).frown > 0.5, `still easing off after 0.1 s (${last(off).frown.toFixed(2)})`);
  assert.ok(last(live(face, 2, CALM)).frown < 0.01, 'and gone after a while');
});

test('she blinks every few seconds, quickly, and not while her eyes are squeezed shut', () => {
  const frames = live(new FaceState(), 12, CALM);
  let blinks = 0;
  let closed = 0;
  let longest = 0;
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].blink > 0.95 && frames[i - 1].blink <= 0.95) blinks++;
    closed = frames[i].blink > 0.5 ? closed + 1 : 0;
    longest = Math.max(longest, closed);
  }
  assert.ok(blinks >= 2 && blinks <= 8, `${blinks} blinks in 12 s`);
  assert.ok(longest / 60 < 0.15, 'a blink is quick');
  const hurt = live(new FaceState(), 8, { ...CALM, hurt: true }).slice(30);
  assert.ok(hurt.every((e) => e.pain > 0.9 && e.blink === 0), 'eyes shut tight, no blinking');
});

test('the eye patch sits on the front of her face, on the head bone, covering both eyes and brows', () => {
  const raw = readBody();
  const body = fitBody(raw.positions, raw.normals, raw.indices, { keepHead: true });
  const f = fitFace(body, restJoints().head[1]);
  const head = BONE_IDS.indexOf('head');
  const n = f.positions.length / 3;
  for (let k = 0; k < n; k++) {
    assert.equal(f.skinIndex[k * 4], head);
    assert.equal(f.skinWeight[k * 4], 1);
    const z = f.positions[k * 3 + 2];
    assert.ok(z < -0.03 && z > -0.13, `vertex ${k} on the face (z ${z.toFixed(3)})`);
    assert.ok(f.normals[k * 3 + 2] < 0, 'faces out of her face');
  }
  const xs = Array.from({ length: n }, (_, k) => f.face[k * 2]);
  const ys = Array.from({ length: n }, (_, k) => f.face[k * 2 + 1]);
  assert.ok(Math.min(...xs) < -(FACE.eyeX + FACE.eyeHalf) && Math.max(...xs) > FACE.eyeX + FACE.eyeHalf, 'both eyes across');
  assert.ok(Math.max(...ys) > 0.04 && Math.min(...ys) < -0.015, 'from below the eyes to above the brows');
});
