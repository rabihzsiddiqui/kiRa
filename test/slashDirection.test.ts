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

  let blade: THREE.Mesh | null = null;
  view.root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry instanceof THREE.BoxGeometry && o.geometry.parameters.depth > 0.9) blade = o;
  });
  assert.ok(blade, 'found the blade');
  // Tip = far end of the blade along its local -Z.
  const b = blade as THREE.Mesh;
  return b.localToWorld(new THREE.Vector3(0, 0, -(b.geometry as THREE.BoxGeometry).parameters.depth / 2)).x;
}

test('reverse horizontal (right + attack) sweeps the blade from her left to her right', () => {
  assert.ok(bladeTipX(AttackId.ReverseHorizontal, 'start') < -0.3);
  assert.ok(bladeTipX(AttackId.ReverseHorizontal, 'end') > 0.3);
});

test('horizontal (left + attack) sweeps the blade from her right to her left', () => {
  assert.ok(bladeTipX(AttackId.Horizontal, 'start') > 0.3);
  assert.ok(bladeTipX(AttackId.Horizontal, 'end') < -0.3);
});
