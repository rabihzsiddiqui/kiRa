import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CameraRig } from '../camera/CameraRig';
import type { CameraBasis } from '../combat/direction';
import { SoundFx } from '../audio/SoundFx';
import { PostGrade } from '../feel/PostGrade';
import { RapierCameraProbe } from '../physics/RapierCameraProbe';
import { planarFrom3 } from '../physics/space';
import { ArenaView } from '../render/ArenaView';
import { CameraView } from '../render/CameraView';
import { DummyView } from '../render/DummyView';
import { HitboxDebugView } from '../render/HitboxDebugView';
import { PlayerView } from '../render/PlayerView';
import { PostFx } from '../render/PostFx';
import { ThreeFx } from '../render/ThreeFx';
import { ARENA } from './arena';
import { CounterGlyph } from './CounterGlyph';
import { DebugOverlay } from './DebugOverlay';
import { Game, SIM_DT } from './Game';
import { Devices } from './input/Devices';
import { PadRumble } from './input/PadRumble';

/** A long hitch (tab switch, breakpoint) is clamped so the sim doesn't fast-forward. */
const MAX_FRAME_TIME = 0.25;
/** If a frame needs more steps than this, drop the backlog instead of spiraling. */
const MAX_STEPS_PER_FRAME = 8;

async function boot(): Promise<void> {
  await RAPIER.init();

  const canvas = document.getElementById('view');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing <canvas id="view">');

  const devices = new Devices(canvas);
  // One basis object, shared: the rig writes it, the player FSM and targeting read it.
  const basis: CameraBasis = { forward: { x: 0, y: 1 }, right: { x: 1, y: 0 } };
  const game = new Game(devices, basis);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rig = new CameraRig(game.targeting, new RapierCameraProbe(game.world, game.levelColliders), { reducedMotion }, basis);
  game.addFxSink(rig);
  const cameraView = new CameraView(window.innerWidth / window.innerHeight, rig.cfg.fov);

  const arena = new ArenaView(canvas, ARENA);
  const playerView = new PlayerView(game.animator);
  const dummyView = new DummyView(ARENA.dummy.position, ARENA.dummy.radius, ARENA.dummy.height);
  const hitboxes = new HitboxDebugView();
  hitboxes.visible = false; // V shows hit areas and hurtboxes
  arena.scene.add(playerView.root, playerView.hair, dummyView.root, hitboxes.root);

  // Presentation. Each one is an FxSink fed by CombatFeel's cues; none of them touch gameplay.
  const grade = new PostGrade({}, reducedMotion);
  const fx = new ThreeFx(arena.scene, cameraView.camera, playerView, reducedMotion);
  const sound = new SoundFx();
  for (const sink of [grade, fx, sound, new PadRumble(devices)]) game.addFxSink(sink);
  game.events.on('attackStarted', () => sound.swing());
  game.dummyAI.events.on('telegraph', ({ step }) => sound.telegraph(!!step.attack.unblockable));
  const post = new PostFx(arena.renderer, arena.scene, cameraView.camera, reducedMotion);
  const glyph = new CounterGlyph(document.body, game, devices);
  const chest = new THREE.Vector3();
  const focus = new THREE.Vector2(0.5, 0.5);

  const overlay = new DebugOverlay(document.body, game, devices, () => ({
    hitAreas: hitboxes.visible,
    slowmo: game.feel.slowmo,
    infinitePerfect: game.player.infinitePerfectWindows,
  }));
  if (import.meta.env.DEV) {
    window.__kira = game;
    window.__kiraFx = fx;
  }

  // Debug controls live here, not in the devices: they are not gameplay actions.
  const debug = {
    toggleAI: () => game.dummyAI.setEnabled(!game.dummyAI.enabled),
    /** Steps through: cycle, string 1, 2, 3, 4, cycle ... */
    stepString: (dir: 1 | -1) => {
      const order: Array<number | 'cycle'> = ['cycle', ...game.dummyAI.strings.map((_, i) => i)];
      const at = order.indexOf(game.dummyAI.selection);
      game.dummyAI.select(order[(at + dir + order.length) % order.length]);
      toast(`dummy: ${game.dummyAI.selection === 'cycle' ? 'all strings' : game.dummyAI.strings[game.dummyAI.selection].label}`);
    },
    toggleHitAreas: () => (hitboxes.visible = !hitboxes.visible),
    togglePause: () => (paused = !paused),
    /** Perfect dodge and block skip their slow-mo, so the effects can be judged at full speed. */
    toggleSlowmo: () => {
      game.feel.slowmo = !game.feel.slowmo;
      toast(game.feel.slowmo ? 'slow-mo on' : 'slow-mo off');
    },
    /** Every evade and guard counts as perfect. For testing the spectacle without the timing. */
    toggleInfinitePerfect: () => {
      game.player.infinitePerfectWindows = !game.player.infinitePerfectWindows;
      toast(game.player.infinitePerfectWindows ? 'every dodge and block is perfect' : 'perfect windows back to normal');
    },
  };
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyH') debug.toggleAI();
    // 1-4 pick one string to repeat, 0 cycles through all of them.
    const digit = /^Digit([0-4])$/.exec(e.code);
    if (digit) game.dummyAI.select(digit[1] === '0' ? 'cycle' : Number(digit[1]) - 1);
    if (e.code === 'KeyV') debug.toggleHitAreas();
    if (e.code === 'KeyP') debug.togglePause();
    if (e.code === 'KeyN') debug.toggleSlowmo();
    if (e.code === 'KeyI') debug.toggleInfinitePerfect();
    if (e.code === 'KeyM') sound.toggleMute();
    if (e.code === 'Tab') {
      e.preventDefault();
      overlay.toggle();
    }
  });
  devices.gamepad.onDebug = (d) => {
    if (d === 'ai') debug.toggleAI();
    else if (d === 'prevString') debug.stepString(-1);
    else if (d === 'nextString') debug.stepString(1);
    else if (d === 'hitAreas') debug.toggleHitAreas();
    else if (d === 'pause') debug.togglePause();
    else if (d === 'slowmo') debug.toggleSlowmo();
    else if (d === 'infinitePerfect') debug.toggleInfinitePerfect();
    else if (d === 'overlay') overlay.toggle();
  };
  devices.gamepad.onConnection = ({ connected, family }) =>
    toast(connected ? `controller connected${family === 'generic' ? '' : `: ${family}`}` : 'controller disconnected');

  const resize = () => {
    arena.resize(window.innerWidth, window.innerHeight);
    post.setSize(window.innerWidth, window.innerHeight);
    cameraView.setAspect(window.innerWidth / window.innerHeight);
  };
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  let accumulator = 0;
  let fps = 60;
  let lastWorldTime = 0;
  /** Debug pause: rendering and the camera keep running, the sim does not. */
  let paused = false;

  const frame = (now: number) => {
    const realDt = Math.min((now - last) / 1000, MAX_FRAME_TIME);
    last = now;

    // Fixed 60 Hz sim. Each step is one frame of ARCHITECTURE.md §2.
    accumulator = paused ? 0 : accumulator + realDt;
    let steps = 0;
    while (accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
      game.step();
      accumulator -= SIM_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;

    // Render between the last two sim states, so motion is smooth at any refresh rate.
    const pose = game.interpolated(accumulator / SIM_DT);
    playerView.sync(pose.pos.x, pose.pos.y, pose.pos.z, pose.yaw);
    const d = game.dummy;
    const worldDt = game.worldTime - lastWorldTime;
    dummyView.sync(game.worldTime, game.realTime, worldDt, {
      facing: d.facing,
      status: d.status,
      sinceHit: game.realTime - game.dummyHitAt,
      locked: game.targeting.current === d,
      phase: game.dummyAI.phase,
      progress: game.dummyPhaseProgress,
      sinceTelegraph: game.worldTime - game.dummyTelegraphAt,
      glow: game.dummyGlow,
      poise: d.poise.value / d.poise.cfg.max,
      sinceParry: game.realTime - game.dummyParryAt,
      knockdown: game.dummyBrokenBy === 'overpower',
    });
    lastWorldTime = game.worldTime;
    hitboxes.sync(game.combat.activeHitAreas(), [
      { position: game.motor.position, radius: game.combat.playerHurtRadius, kind: game.player.inPerfectDodgeWindow ? 'graze' : 'player' },
      ...game.enemies.map((e) => ({ position: e.position, radius: e.radius, kind: 'enemy' as const })),
    ]);
    const subject = { position: planarFrom3(pose.pos), height: pose.pos.y, facing: game.motor.facing };
    cameraView.apply(rig.update(realDt, devices.look(realDt), subject)); // camera on real time

    // Paused: effects freeze too (a true freeze frame), the camera still orbits.
    const fxDt = paused ? 0 : realDt;
    playerView.updateHair(fxDt * game.time.playerScale); // her hair slows with her
    fx.update(fxDt, worldDt);
    const g = grade.update(fxDt, game.time.worldScale);
    sound.setWorldLowpass(g.lowpassHz);
    chest.set(pose.pos.x, pose.pos.y + 1.2, pose.pos.z);
    const ndc = chest.clone().project(cameraView.camera);
    focus.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
    post.render(g, focus, fxDt);
    glyph.update(cameraView.camera, chest);

    if (realDt > 0) fps += (1 / realDt - fps) * 0.05;
    overlay.update(fps);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Short message at the top of the screen, gone after a moment. */
function toast(message: string): void {
  let el = document.querySelector<HTMLElement>('.toast');
  if (!el) {
    el = document.createElement('p');
    el.className = 'toast';
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('toast-visible');
  window.clearTimeout(Number(el.dataset.timer));
  el.dataset.timer = String(window.setTimeout(() => el.classList.remove('toast-visible'), 2200));
}

boot().catch((err: unknown) => {
  console.error(err);
  const box = document.createElement('pre');
  box.className = 'boot-error';
  box.textContent = `the sandbox failed to start.\n\n${err instanceof Error ? err.message : String(err)}`;
  document.body.append(box);
});
