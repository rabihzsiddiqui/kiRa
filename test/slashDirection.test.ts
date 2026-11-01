import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ATTACKS, attackDuration, AttackId } from '../src/combat/moves';
import { PlayerView } from '../src/render/PlayerView';
import { ThreeAnimator } from '../src/render/ThreeAnimator';

/**
 * What the player sees: Right + Attack must sweep the blade toward her right, Left toward
 * her left. Builds the real placeholder body and reads the blade tip in world space.
 * She faces planar +Y (three.js -Z), so her right is +X.
 */
function bladeTipX(attack: AttackId, at: 'start' | 'end'): number {
  const animator = new ThreeAnimator();
  const view = new PlayerView(animator);
  animator.play(ATTACKS[attack].anim);
  animator.tick(at === 'start' ? 0 : attackDuration(ATTACKS[attack]) * 0.6);
  view.sync(0, 0, 0, 0);
  view.root.updateMatrixWorld(true);

  // Tip = the far end of the blade along the sword's axis.
  const { group, tipZ } = view.sword;
  return group.localToWorld(new THREE.Vector3(0, 0, tipZ)).x;
}

test('reverse horizontal (right + attack) sweeps the blade from her left to her right', () => {
  assert.ok(bladeTipX(AttackId.ReverseHorizontal, 'start') < -0.3);
  assert.ok(bladeTipX(AttackId.ReverseHorizontal, 'end') > 0.3);
});

test('horizontal (left + attack) sweeps the blade from her right to her left', () => {
  assert.ok(bladeTipX(AttackId.Horizontal, 'start') > 0.3);
  assert.ok(bladeTipX(AttackId.Horizontal, 'end') < -0.3);
});

test('every slash ends on the side its data says, so combos flow from the right place', () => {
  // Thrusts end near the middle, so only the cutting swings are checked against the blade.
  const slashes = [
    AttackId.Horizontal,
    AttackId.ReverseHorizontal,
    AttackId.Vertical,
    AttackId.VerticalLeft,
    AttackId.FinisherRising,
  ];
  for (const id of slashes) {
    const x = bladeTipX(id, 'end');
    const side = x < 0 ? 'left' : 'right';
    assert.equal(side, ATTACKS[id].endSide, `${id} ends with the tip at x = ${x.toFixed(2)}`);
    assert.ok(Math.abs(x) > 0.3, `${id} ends clearly to one side`);
  }
});

test('diagonals: / starts high on her right, \\ starts high on her left', () => {
  assert.ok(bladeTipX(AttackId.Vertical, 'end') < -0.3, '/ finishes low left');
  assert.ok(bladeTipX(AttackId.VerticalLeft, 'start') < 0, '\\ is wound up over the left shoulder');
  assert.ok(bladeTipX(AttackId.VerticalLeft, 'end') > 0.3, '\\ finishes low right');
});
