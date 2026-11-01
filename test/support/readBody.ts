import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Positions, normals and indices straight out of the .glb (one mesh, as Sketchfab exports it). */
export function readBody(): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  const buf = readFileSync(join(ROOT, 'public/models/base_body.glb'));
  assert.equal(buf.toString('ascii', 0, 4), 'glTF');
  const jsonLength = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength)) as {
    meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; indices: number }> }>;
    accessors: Array<{ bufferView: number; byteOffset?: number; count: number; componentType: number }>;
    bufferViews: Array<{ byteOffset?: number }>;
    nodes: Array<{ matrix?: number[] }>;
  };
  const bin = 20 + jsonLength + 8;
  const bytes = (index: number, size: number) => {
    const a = gltf.accessors[index];
    const start = bin + (gltf.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
    const view = buf.subarray(start, start + a.count * size);
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  };
  const prim = gltf.meshes[0].primitives[0];
  const idx = gltf.accessors[prim.indices];
  const indices = idx.componentType === 5125 ? new Uint32Array(bytes(prim.indices, 4)) : Uint32Array.from(new Uint16Array(bytes(prim.indices, 2)));
  return {
    positions: new Float32Array(bytes(prim.attributes.POSITION, 12)),
    normals: new Float32Array(bytes(prim.attributes.NORMAL, 12)),
    indices,
  };
}
