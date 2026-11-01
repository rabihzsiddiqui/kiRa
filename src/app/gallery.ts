import * as THREE from 'three';
import { CLIPS, LOCOMOTION } from '../character/clips';
import { ATTACKS, type AttackDef } from '../combat/moves';
import { COLORS } from '../render/ArenaView';
import { PlayerView } from '../render/PlayerView';
import { SwordTrail, waveSource } from '../render/SwordTrail';
import { ThreeAnimator } from '../render/ThreeAnimator';

/*
 * Dev tool: every clip on its own figure, in a grid. /gallery.html in `npm run dev`.
 *   ?at=0.4   freeze every clip at 40% of its length (good for checking poses and trails)
 *   ?only=atk only clips whose name contains "atk"
 *   ?zoom=3   move the camera in (close-ups of the model)
 *   ?yaw=180  turn every figure, in degrees (180 = her back to the camera)
 *   ?y=1.6    height the camera looks at (1.6 = her face)
 *   ?body=classic  the original shape-built body instead of the skinned base mesh
 * Not part of the production build (Vite builds index.html only).
 */

const params = new URLSearchParams(location.search);
const at = params.has('at') ? Number(params.get('at')) : null;
const only = params.get('only');
const zoom = Math.max(0.2, Number(params.get('zoom') ?? 1));
const body = params.get('body') === 'classic' ? 'classic' : 'mesh';

interface Entry {
  name: string;
  animator: ThreeAnimator;
  view: PlayerView;
  duration: number;
  label: HTMLElement;
  /** Locomotion entries set params instead of playing a one-shot. */
  loco?: Record<string, number>;
  /** Attack clips draw their sword trail during the live part of the swing. */
  attack?: AttackDef;
  trail: SwordTrail;
  /** The spin's circle of energy (only spins draw one). */
  wave: SwordTrail;
}

/** Trail input for an attack clip `age` seconds in. */
const trailAt = (e: Entry, age: number) => {
  const a = e.attack;
  return { attack: a?.id ?? null, emitting: !!a && age >= a.startup && age <= a.startup + a.active };
};

const LOCO_VARIANTS: Array<[string, Record<string, number>]> = [
  ['loco idle', { locomotion: 0 }],
  ['loco run', { locomotion: 1, speed: 6 }],
  ['loco strafe f', { locomotion: 2, strafeY: 1 }],
  ['loco strafe b', { locomotion: 2, strafeY: -1 }],
  ['loco strafe l', { locomotion: 2, strafeX: -1 }],
  ['loco strafe r', { locomotion: 2, strafeX: 1 }],
];

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.background);
scene.add(new THREE.HemisphereLight(0x8b93ff, 0x09090b, 1.1));
const key = new THREE.DirectionalLight(0xf4f4ff, 2.4);
key.position.set(4, 8, 9); // from the camera side
scene.add(key);
const rim = new THREE.DirectionalLight(COLORS.cyan, 0.8);
rim.position.set(-6, 4, -8);
scene.add(rim);

const names = [...LOCO_VARIANTS.map(([n]) => n), ...CLIPS.keys()].filter((n) => !only || n.includes(only));
const COLS = Math.min(6, names.length);
const SPACING = 2.2;
const YAW = params.has('yaw') ? Math.PI + (Number(params.get('yaw')) * Math.PI) / 180 : Math.PI - 0.6;
const entries: Entry[] = names.map((name, i) => {
  const animator = new ThreeAnimator();
  const view = new PlayerView(animator, body);
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const x = (col - (COLS - 1) / 2) * SPACING;
  const z = -row * SPACING * 1.4;
  // Facing the camera (+Z), turned three quarters so slashes and flips read.
  view.sync(x, 0, z, YAW);
  scene.add(view.root);

  const label = document.createElement('div');
  label.className = 'hud-label';
  label.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;white-space:nowrap';
  label.textContent = name;
  document.body.append(label);

  const loco = LOCO_VARIANTS.find(([n]) => n === name)?.[1];
  if (loco) {
    for (const [k, v] of Object.entries(loco)) animator.setFloat(k, v);
    animator.play(LOCOMOTION);
  } else {
    animator.play(name);
  }
  const duration = loco ? 1 : CLIPS.get(name)!.duration;
  const attack = Object.values(ATTACKS).find((a) => a.anim === name);
  const trail = new SwordTrail(view.sword);
  const wave = new SwordTrail(view.sword, waveSource(view.sword, () => view.root.position));
  scene.add(trail.mesh, wave.mesh);
  const entry: Entry = { name, animator, view, duration, label, loco, attack, trail, wave };
  if (at !== null) {
    // Step up to the frozen moment so the trail behind the blade is there too.
    const step = 1 / 60;
    for (let t = 0; t < duration * at; t += step) {
      animator.tick(Math.min(step, duration * at - t));
      view.sync(x, 0, z, YAW);
      trail.update(step, trailAt(entry, t));
      wave.update(step, trailAt(entry, t));
    }
  }
  return entry;
});

const rows = Math.ceil(names.length / COLS);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
const depth = (rows - 1) * SPACING * 1.4;
const look = new THREE.Vector3(0, params.has('y') ? Number(params.get('y')) : zoom > 1.5 ? 1.05 : 0.8, -depth / 2);
const from = new THREE.Vector3(0, 2.2 + depth * 0.35, 4.2 + Math.max(COLS * 0.9, depth * 0.6));
camera.position.copy(look).add(from.sub(look).divideScalar(zoom));
camera.lookAt(look);

const resize = () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
};
window.addEventListener('resize', resize);
resize();

let last = performance.now();
const ages = new Map<Entry, number>();
const frame = (now: number) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  for (const e of entries) {
    if (at === null) {
      // One-shots replay with a short pause so each one reads from the start.
      const age = (ages.get(e) ?? 0) + dt;
      if (!e.loco && age > e.duration + 0.4) {
        e.animator.play(e.name);
        ages.set(e, 0);
      } else ages.set(e, age);
      e.animator.tick(dt);
    }
    e.view.sync(e.view.root.position.x, 0, e.view.root.position.z, YAW);
    if (at === null) {
      e.trail.update(dt, trailAt(e, ages.get(e) ?? 0));
      e.wave.update(dt, trailAt(e, ages.get(e) ?? 0));
    }
    const p = e.view.root.position.clone().setY(-0.15).project(camera);
    e.label.style.transform = `translate(${((p.x + 1) / 2) * window.innerWidth - 30}px, ${((1 - p.y) / 2) * window.innerHeight}px)`;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
