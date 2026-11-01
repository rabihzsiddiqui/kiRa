import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fitArmor } from '../character/armorFit';
import { fitHair } from '../character/hairFit';
import { shellColumns, type Shell } from '../character/shell';
import { fitBody, restJoints } from '../character/bodyFit';
import { BONE_IDS, type BoneId } from '../character/rig';

/*
 * Her body as skinned meshes: "Female_2500_ Base Mesh" by EbiosDesigner, CC-BY-4.0
 * (https://sketchfab.com/3d-models/female-2500--base-mesh-f59219d3c8a34c6380120ec280338c5b),
 * rigged to our bones in code by src/character/bodyFit.ts. Armor (src/character/armorFit.ts)
 * and hair (src/character/hairFit.ts) are shells measured off it. All share one skeleton.
 *
 * The meshes exist from the start (bound to the figure's bones, empty geometry) so the
 * rest of the game can treat the figure as built. The fitted geometry drops in when the
 * file has loaded. No DOM (headless tests): it never loads.
 */

const MODEL_PATH = 'models/base_body.glb';

interface BodyAsset {
  body: THREE.BufferGeometry;
  plates: THREE.BufferGeometry;
  straps: THREE.BufferGeometry;
  hair: THREE.BufferGeometry;
}

/** Fitted once per page, shared by every figure. */
let asset: Promise<BodyAsset> | null = null;

function loadAsset(): Promise<BodyAsset> {
  asset ??= new GLTFLoader().loadAsync(new URL(MODEL_PATH, document.baseURI).href).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    let found: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (!found && o instanceof THREE.Mesh) found = o;
    });
    if (!found) throw new Error(`${MODEL_PATH} has no mesh`);
    const mesh: THREE.Mesh = found;
    const source = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const { index, attributes } = source;
    if (!index || !attributes.normal) throw new Error(`${MODEL_PATH} needs indices and normals`);
    const fit = fitBody(attributes.position.array, attributes.normal.array, index.array, { keepHead: true });

    const body = new THREE.BufferGeometry();
    body.setAttribute('position', new THREE.BufferAttribute(fit.positions, 3));
    body.setAttribute('normal', new THREE.BufferAttribute(fit.normals, 3));
    body.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(fit.skinIndex, 4));
    body.setAttribute('skinWeight', new THREE.BufferAttribute(fit.skinWeight, 4));
    body.setAttribute('aArm', new THREE.BufferAttribute(fit.armParam, 1)); // for the outfit (BodyOutfit.ts)
    body.setIndex(new THREE.BufferAttribute(fit.indices, 1));
    const armor = fitArmor(fit);
    return {
      body,
      plates: shellsGeometry(armor.plates.map((p) => p.shell)),
      straps: shellsGeometry(armor.straps.map((p) => p.shell)),
      hair: shellGeometry(fitHair(fit, restJoints().head[1])),
    };
  });
  return asset;
}

/**
 * A shell (see character/shell.ts) as geometry: the outer surface, the inner one, and
 * walls along its open edges, each on their own vertices so edges read crisp. Groups:
 * 0 = main material, 1 = trim. Faces are turned to face out whichever way the grid runs.
 */
function shellGeometry(s: Shell): THREE.BufferGeometry {
  const { cols, rows } = s;
  const H = rows + 1;
  const C = shellColumns(s);
  const pos: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  const col = (i: number) => (s.wrap ? i % C : i);
  const add = (i: number, j: number, offset: Float32Array) => {
    const k = col(i) * H + j;
    pos.push(s.base[k * 3] + s.dir[k * 3] * offset[k], s.base[k * 3 + 1] + s.dir[k * 3 + 1] * offset[k], s.base[k * 3 + 2] + s.dir[k * 3 + 2] * offset[k]);
    for (let c = 0; c < 4; c++) {
      skinIndex.push(s.skinIndex[k * 4 + c]);
      skinWeight.push(s.skinWeight[k * 4 + c]);
    }
    return pos.length / 3 - 1;
  };
  const outer: number[] = [];
  const inner: number[] = [];
  for (let i = 0; i < C; i++) for (let j = 0; j < H; j++) outer.push(add(i, j, s.outer));
  for (let i = 0; i < C; i++) for (let j = 0; j < H; j++) inner.push(add(i, j, s.inner));
  const o = (i: number, j: number) => outer[col(i) * H + j];
  const n = (i: number, j: number) => inner[col(i) * H + j];
  const v = (a: number) => new THREE.Vector3(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]);

  // Which winding faces out: test a cell in the middle against its outward direction.
  const [mi, mj] = [Math.floor(cols / 2), Math.floor(rows / 2)];
  const mk = col(mi) * H + mj;
  const normal = v(o(mi, mj + 1)).sub(v(o(mi, mj))).cross(v(o(mi + 1, mj)).sub(v(o(mi, mj))));
  const flip = normal.dot(new THREE.Vector3(s.dir[mk * 3], s.dir[mk * 3 + 1], s.dir[mk * 3 + 2])) < 0;
  const quad = (list: number[], a: number, b: number, c: number, d: number, out: boolean) => {
    // a-b along a row, a-c along a column; d opposite a.
    if (out !== flip) list.push(a, c, b, b, c, d);
    else list.push(a, b, c, b, d, c);
  };

  const groups: number[][] = [[], []];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      quad(groups[s.cellGroup[i * rows + j]], o(i, j), o(i + 1, j), o(i, j + 1), o(i + 1, j + 1), true);
      quad(groups[0], n(i, j), n(i + 1, j), n(i, j + 1), n(i + 1, j + 1), false);
    }
  }

  // Walls along the open edges, facing away from the shell's middle.
  const edges: Array<[number, number, number, number]> = [];
  for (let i = 0; i < cols; i++) {
    if (!s.pole) edges.push([i, 0, i + 1, 0]);
    edges.push([i, rows, i + 1, rows]);
  }
  if (!s.wrap) {
    for (let j = 0; j < rows; j++) edges.push([0, j, 0, j + 1], [cols, j, cols, j + 1]);
  }
  const middle = v(o(mi, mj));
  for (const [i0, j0, i1, j1] of edges) {
    const [a, b] = [add(i0, j0, s.outer), add(i1, j1, s.outer)];
    const [c, d] = [add(i0, j0, s.inner), add(i1, j1, s.inner)];
    const face = v(b).sub(v(a)).cross(v(c).sub(v(a)));
    const away = v(a).sub(middle);
    if (face.dot(away) >= 0) groups[s.wallGroup].push(a, b, c, b, d, c);
    else groups[s.wallGroup].push(a, c, b, b, c, d);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  g.setIndex([...groups[0], ...groups[1]]);
  g.addGroup(0, groups[0].length, 0);
  g.addGroup(groups[0].length, groups[1].length, 1);
  g.computeVertexNormals();
  return g;
}

/** Several shells as one geometry (the plates; the straps). */
function shellsGeometry(shells: Shell[]): THREE.BufferGeometry {
  const parts = shells.map(shellGeometry);
  const merged = new THREE.BufferGeometry();
  const attrs = ['position', 'normal', 'skinIndex', 'skinWeight'] as const;
  for (const name of attrs) {
    const size = parts[0].getAttribute(name).itemSize;
    const all = parts.flatMap((p) => Array.from(p.getAttribute(name).array as ArrayLike<number>));
    merged.setAttribute(name, name === 'skinIndex' ? new THREE.Uint16BufferAttribute(all, size) : new THREE.Float32BufferAttribute(all, size));
  }
  // Index by group across parts, so each material is one draw.
  const byGroup: number[][] = [[], []];
  let offset = 0;
  for (const p of parts) {
    const index = p.index!.array;
    for (const grp of p.groups) for (let t = grp.start; t < grp.start + grp.count; t++) byGroup[grp.materialIndex ?? 0].push(index[t] + offset);
    offset += p.getAttribute('position').count;
  }
  merged.setIndex([...byGroup[0], ...byGroup[1]]);
  merged.addGroup(0, byGroup[0].length, 0);
  merged.addGroup(byGroup[0].length, byGroup[1].length, 1);
  return merged;
}

/** Empty, but with the attributes a skinned mesh expects (see skinnedBody). */
function emptySkinned(extra: string[] = []): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([], 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([], 4));
  for (const name of extra) g.setAttribute(name, new THREE.Float32BufferAttribute([], 1));
  return g;
}

/** Materials per piece: [main, trim] where a piece has trim. */
export interface BodyMaterials {
  body: THREE.Material;
  plates: [steel: THREE.Material, gold: THREE.Material];
  straps: [leather: THREE.Material, gold: THREE.Material];
  hair: THREE.Material;
}

/**
 * The body, its armor and its hair, skinned to `bones`, children of `root` (the figure root
 * that holds the hips). The bind pose is the rig's rest pose, so each bone's inverse is
 * just its rest joint.
 *
 * Normals on the placeholders matter: a material first compiled for a mesh without them
 * is built flat shaded, and keeps that shader after the real geometry arrives.
 */
export function skinnedBody(
  root: THREE.Object3D,
  bones: Record<BoneId, THREE.Bone>,
  materials: BodyMaterials,
): void {
  const rest = restJoints();
  const inverses = BONE_IDS.map((id) => new THREE.Matrix4().makeTranslation(-rest[id][0], -rest[id][1], -rest[id][2]));
  const skeleton = new THREE.Skeleton(
    BONE_IDS.map((id) => bones[id]),
    inverses,
  );
  const make = (geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]) => {
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.castShadow = true;
    mesh.frustumCulled = false; // its bounds move with the pose (a roll, a jump)
    root.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
    return mesh;
  };
  const body = make(emptySkinned(['aArm']), materials.body);
  const plates = make(emptySkinned(), materials.plates);
  const straps = make(emptySkinned(), materials.straps);
  const hair = make(emptySkinned(), materials.hair);

  if (typeof document === 'undefined') return;
  loadAsset().then(
    (a) => {
      body.geometry = a.body;
      plates.geometry = a.plates;
      straps.geometry = a.straps;
      hair.geometry = a.hair;
      for (const m of [materials.body, ...materials.plates, ...materials.straps, materials.hair]) m.needsUpdate = true;
    },
    (e: unknown) => console.error('base body failed to load', e),
  );
}
