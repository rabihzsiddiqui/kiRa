import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AttackId } from '../src/combat/moves';
import { TRAIL_STYLES, trailEmitting, trailStyle } from '../src/feel/swingTrail';
import { HeadlessSandbox } from '../src/sandbox/HeadlessSandbox';
import { AttackPhase } from '../src/player/states/AttackState';

const STANDARD = [AttackId.Horizontal, AttackId.ReverseHorizontal, AttackId.Vertical, AttackId.VerticalLeft, AttackId.Thrust, AttackId.ThrustLeft];

test('every attack has a trail style', () => {
  for (const id of Object.values(AttackId)) assert.ok(trailStyle(id), id);
});

test('basic swings share the standard trail; specials and counters look different', () => {
  for (const id of STANDARD) assert.equal(trailStyle(id).tier, 'standard', id);
  const standard = TRAIL_STYLES.standard;
  for (const id of Object.values(AttackId).filter((a) => !STANDARD.includes(a))) {
    const s = trailStyle(id);
    assert.notEqual(s.tier, 'standard', `${id} should stand out`);
    assert.notEqual(s.core, standard.core, `${id}: its own color`);
    assert.notEqual(s.edge, standard.edge, `${id}: its own color`);
    assert.ok(s.life > standard.life && s.reach > standard.reach && s.shimmer > 0, `${id}: bigger and longer, with shimmer`);
  }
  assert.equal(trailStyle(AttackId.FinisherCleave).tier, 'special');
  assert.equal(trailStyle(AttackId.FinisherSpin).tier, 'special');
  // The spin attack's blade trail is the same gold but faint: its wave is the show.
  for (const id of [AttackId.Spin, AttackId.SpinClockwise]) {
    const s = trailStyle(id);
    assert.equal(s.tier, 'spin');
    assert.equal(s.edge, TRAIL_STYLES.special.edge);
    assert.ok(s.intensity < TRAIL_STYLES.special.intensity * 0.4, 'much fainter than a special');
  }
  assert.equal(trailStyle(AttackId.PhantomDash).tier, 'counter');
  assert.notEqual(TRAIL_STYLES.special.edge, TRAIL_STYLES.counter.edge);
});

test('the trail draws only while the blade is live in a real swing', () => {
  const sb = new HeadlessSandbox();
  sb.step({ attack: true });
  const seen: boolean[] = [];
  for (let i = 0; i < 40; i++) {
    const a = sb.player.attack;
    seen.push(trailEmitting(a));
    if (a) assert.equal(trailEmitting(a), a.phase === AttackPhase.Active);
    sb.step();
  }
  const first = seen.indexOf(true);
  assert.ok(first > 0, 'not during the wind-up');
  assert.ok(seen.lastIndexOf(true) < seen.length - 1, 'stops before the swing ends');
  assert.equal(trailEmitting(null), false, 'nothing when not attacking');
});
