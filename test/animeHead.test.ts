import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { HEAD_CHIN, HEAD_CROWN, placeAnimeHead } from '../src/render/AnimeHead';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'public/models/anime_head.glb');

/** Just the vertex positions and UVs out of the .glb: enough to check the placement. */
function readHead(): { geometry: THREE.BufferGeometry; uv: Float32Array } {
  const buf = readFileSync(FILE);
  assert.equal(buf.toString('ascii', 0, 4), 'glTF');
  const jsonLength = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength)) as {
    meshes: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
    accessors: Array<{ bufferView: number; byteOffset?: number; count: number; type: string }>;
    bufferViews: Array<{ byteOffset?: number }>;
  };
  const bin = 20 + jsonLength + 8;
  const read = (index: number, size: number) => {
    const a = gltf.accessors[index];
    const start = bin + (gltf.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
    const bytes = buf.subarray(start, start + a.count * size * 4);
    return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  };
  assert.equal(gltf.meshes.length, 1, 'one mesh');
  const attributes = gltf.meshes[0].primitives[0].attributes;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(read(attributes.POSITION, 3), 3));
  return { geometry, uv: read(attributes.TEXCOORD_0, 2) };
}

test('the anime head sits low on the head bone, anime-sized, facing forward', () => {
  const { geometry, uv } = readHead();
  placeAnimeHead(geometry);
  const box = geometry.boundingBox!;
  assert.ok(Math.abs(box.max.y - HEAD_CROWN) < 0.002, `crown at ${box.max.y.toFixed(3)}`);
  assert.ok(box.max.y - box.min.y < 0.32, 'head and a short neck stump, nothing more');
  assert.ok(Math.abs(box.max.x + box.min.x) < 0.002, 'centered left to right');
  assert.ok(box.max.x > 0.09 && box.max.x < 0.12, `anime-sized: wider than a realistic head (${box.max.x.toFixed(3)})`);

  // Her eyes (the iris island of the texture) look down -Z, the way she faces.
  const pos = geometry.attributes.position;
  let eyeZ = 0;
  let eyes = 0;
  for (let i = 0; i < pos.count; i++) {
    const [u, v] = [uv[2 * i], uv[2 * i + 1]];
    if (u > 0.03 && u < 0.27 && v > 0.55 && v < 0.81) {
      eyeZ += pos.getZ(i);
      eyes++;
    }
  }
  assert.ok(eyes > 0, 'found the eyes');
  assert.ok(eyeZ / eyes < -0.05, 'eyes at the front');
  assert.ok(box.min.z < -0.09 && box.max.z > 0.08, 'face in front of the neck, skull behind it');
  assert.ok(HEAD_CROWN - HEAD_CHIN > 0.25, 'a big anime head, not a realistic one');
  assert.ok(Math.abs(HEAD_CHIN) < 0.04, 'chin near the head bone, so the neck stays short');
});
