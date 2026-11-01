import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AttackId, ATTACKS } from '../src/combat/moves';
import { spinWave, trailStyle, waveWall, wavePoints } from '../src/feel/swingTrail';
import { spinWaveTrails, SwordTrail, waveSource } from '../src/render/SwordTrail';

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

test('the wave has real thickness: an upright band crosses the flat one along its hot line', () => {
  const wave = spinWave(AttackId.Spin)!;
  assert.ok(wave.thickness >= 0.3, `${wave.thickness} m tall`);
  const center = { x: 0, y: 0, z: 0 };
  const tip = { x: 1, y: 1.3, z: 1 };
  const band = wavePoints(center, tip, wave)!;
  const wall = waveWall(center, tip, wave)!;
  const r = (q: { x: number; z: number }) => Math.hypot(q.x, q.z);
  const hot = r(band.inner) + (r(band.outer) - r(band.inner)) * wave.rim;
  assert.ok(Math.abs(r(wall.low) - hot) < 1e-9 && Math.abs(r(wall.high) - hot) < 1e-9, 'on the hot line');
  assert.ok(Math.abs(wall.high.y - wall.low.y - wave.thickness) < 1e-9);
  assert.ok(Math.abs((wall.high.y + wall.low.y) / 2 - tip.y) < 1e-9, 'centered on the blade height');

  // Both parts draw during a spin, with the hot line where each expects it.
  const group = new THREE.Group();
  const sword = { group, hiltZ: -0.11, tipZ: -1.06 };
  const parts = spinWaveTrails(sword, () => new THREE.Vector3());
  for (let f = 0; f < 4; f++) {
    group.rotation.y = -(f * Math.PI) / 6;
    group.position.y = 1.2;
    group.updateMatrixWorld(true);
    for (const p of parts) p.update(1 / 60, { attack: AttackId.Spin, emitting: true });
  }
  for (const p of parts) assert.ok(p.mesh.visible && p.mesh.geometry.drawRange.count > 0);
  const [flat, upright] = parts.map((p) => p.mesh.geometry.getAttribute('position'));
  assert.ok(Math.abs(flat.getY(0) - flat.getY(1)) < 1e-6, 'the band lies flat');
  assert.ok(Math.abs(upright.getY(1) - upright.getY(0) - wave.thickness) < 1e-6, 'the wall stands up');
  assert.deepEqual(
    parts.map((p) => p.mesh.material.uniforms.uRim.value),
    [wave.rim, 0.5],
  );
});
