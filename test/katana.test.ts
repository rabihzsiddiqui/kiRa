import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BLADE_LENGTH, buildKatana, HILT_Z } from '../src/render/Katana';

const plain = new THREE.MeshBasicMaterial();
const { blade } = buildKatana({ steel: plain, hamon: plain, spine: plain, gold: plain, iron: plain, grip: plain });
const pos = blade.geometry.getAttribute('position');
const normal = blade.geometry.getAttribute('normal');

/** Blade width (edge to spine) and thickness at the station nearest z. */
function across(target: number): { width: number; thick: number; low: number; high: number } {
  let z = Infinity;
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - target) < Math.abs(z - target)) z = pos.getZ(i);
  let [low, high, thick] = [Infinity, -Infinity, 0];
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getZ(i) - z) > 1e-6) continue;
    low = Math.min(low, pos.getY(i));
    high = Math.max(high, pos.getY(i));
    thick = Math.max(thick, Math.abs(pos.getX(i)) * 2);
  }
  return { width: high - low, thick, low, high };
}

test('the blade faces outward: the flats look sideways, away from the middle', () => {
  let out = 0;
  let total = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (Math.abs(x) < 0.0015) continue;
    total++;
    if (Math.sign(normal.getX(i)) === Math.sign(x)) out++;
  }
  assert.ok(out / total > 0.95, `${out} of ${total} side normals face out`);
});

test('the blade comes to a sharp point on the sword axis, and the edge is on the -Y side', () => {
  const tipZ = HILT_Z - BLADE_LENGTH;
  let tip = new THREE.Vector3(0, 0, Infinity);
  for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < tip.z) tip = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  assert.ok(Math.abs(tip.z - tipZ) < 1e-6, 'reaches the tip');
  assert.ok(Math.abs(tip.y) < 0.002 && Math.abs(tip.x) < 1e-6, `the point sits on the axis (${tip.y.toFixed(4)})`);

  const base = across(HILT_Z - 0.05);
  const middle = across(HILT_Z - BLADE_LENGTH / 2);
  const nearTip = across(tipZ + 0.01);
  assert.ok(base.width > 0.03 && middle.width < base.width, 'tapers from a full width');
  assert.ok(nearTip.width < base.width * 0.6, `narrows into the point (${nearTip.width.toFixed(4)})`);
  assert.ok(base.thick < 0.01 && base.thick > 0.005, 'thin, like a blade');
  // Curved: the middle bows toward the edge, off the line from hilt to tip.
  assert.ok((middle.low + middle.high) / 2 < (base.low + base.high) / 2 - 0.005, 'a gentle curve');
});
