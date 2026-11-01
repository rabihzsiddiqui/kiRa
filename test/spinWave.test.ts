import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AttackId, ATTACKS } from '../src/combat/moves';
import { spinWave, trailStyle } from '../src/feel/swingTrail';
import { SwordTrail, waveSource } from '../src/render/SwordTrail';

/*
 * The spin's wave is drawn as its own thing: energy in the charge's colors, not a copy of
 * the gold blade trail. And it's a clean circle: however far the blade turns in a frame,
 * the band steps round her at the reach line instead of cutting corners, and a whole
 * turn fits without the start being dropped.
 */

test('the wave looks like energy, not like the blade trail', () => {
  const wave = spinWave(AttackId.Spin)!;
  const blade = trailStyle(AttackId.Spin);
  assert.notEqual(wave.style.core, blade.core);
  assert.notEqual(wave.style.edge, blade.edge);
  assert.equal(wave.style.edge, 0x22d3ee, 'cyan, like the blade charge');

  const group = new THREE.Group();
  const sword = { group, hiltZ: -0.11, tipZ: -1.06 };
  const energy = new SwordTrail(sword, waveSource(sword, () => new THREE.Vector3()));
  const steel = new SwordTrail(sword);
  assert.notEqual(energy.mesh.material.fragmentShader, steel.mesh.material.fragmentShader);
});

test('a fast spin draws a smooth, whole circle at the edge of the reach', () => {
  const group = new THREE.Group();
  const sword = { group, hiltZ: -0.11, tipZ: -1.06 };
  const trail = new SwordTrail(sword, waveSource(sword, () => new THREE.Vector3()));
  const radius = ATTACKS[AttackId.Spin].hit.range;

  // 30 degrees a frame (faster than the real spin), for a little over one turn.
  const FRAMES = 14;
  for (let f = 0; f < FRAMES; f++) {
    group.rotation.y = -(f * Math.PI) / 6;
    group.position.y = 1.2;
    group.updateMatrixWorld(true);
    trail.update(1 / 60, { attack: AttackId.Spin, emitting: true });
  }

  const pos = trail.mesh.geometry.getAttribute('position');
  const n = trail.mesh.geometry.drawRange.count / 6 + 1;
  assert.ok(n > 100, `${n} points`);
  let turned = 0;
  let prev = NaN;
  for (let i = 0; i < n; i++) {
    const [x, z] = [pos.getX(i * 2 + 1), pos.getZ(i * 2 + 1)];
    assert.ok(Math.abs(Math.hypot(x, z) - radius) < 1e-4, `point ${i} on the reach line`);
    const a = Math.atan2(z, x);
    if (i > 0) {
      const step = Math.abs(Math.atan2(Math.sin(a - prev), Math.cos(a - prev)));
      assert.ok(step < 0.04, `step ${i} is ${step.toFixed(3)} rad`);
      turned += step;
    }
    prev = a;
  }
  assert.ok(turned > Math.PI * 2, `the whole turn is drawn (${turned.toFixed(2)} rad)`);
});
