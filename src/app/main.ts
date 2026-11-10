import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CameraRig } from '../camera/CameraRig';
import type { CameraBasis } from '../combat/direction';
import { SoundFx } from '../audio/SoundFx';
import { PostGrade } from '../feel/PostGrade';
import { RapierCameraProbe } from '../physics/RapierCameraProbe';
import { planarFrom3, planarTo3 } from '../physics/space';
import { lookAllowed } from '../character/headLook';
import { PlayerStateId } from '../player/contracts';
import { AttackId } from '../combat/moves';
import { ArenaView } from '../render/ArenaView';
import { BladeCharge } from '../render/BladeCharge';
import { spinWaveTrails, SwordTrail } from '../render/SwordTrail';
import { trailEmitting } from '../feel/swingTrail';
import { CameraView } from '../render/CameraView';
import { DUMMY_HEAD_AT, DummyView } from '../render/DummyView';
import { HitboxDebugView } from '../render/HitboxDebugView';
import { PlayerView } from '../render/PlayerView';
import { PostFx } from '../render/PostFx';
import { setFaceLight } from '../render/FaceView';
import { ThreeFx } from '../render/ThreeFx';
import { ARENA } from './arena';
import { CounterGlyph } from './CounterGlyph';
import { DebugOverlay } from './DebugOverlay';
import { Hud } from './Hud';
import { OptionsMenu } from './OptionsMenu';
import { initialStage, STAGE_STORAGE_KEY, type StageId } from './stages';
import type { DeviceKind } from './input/Devices';
import { Game, SIM_DT } from './Game';
import { Devices } from './input/Devices';
import { PadRumble } from './input/PadRumble';

/** Remembered between visits: the controls card and the debug panels. */
const CONTROLS_STORAGE_KEY = 'kira.hud.controls';
const DEBUG_STORAGE_KEY = 'kira.hud.debug';

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

  const arena = new ArenaView(canvas, ARENA, reducedMotion);
  const stageLook = arena.setStage(initialStage(location.search, readStored(STAGE_STORAGE_KEY)));
  // Phones: render at most 1.5x density. Fill rate is the bottleneck there, and the
  // post-processing stack runs at full resolution.
  if (devices.touch) arena.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  // ?body=classic: the original shape-built body, for comparing with the skinned base mesh.
  const body = new URLSearchParams(location.search).get('body') === 'classic' ? 'classic' : 'mesh';
  const playerView = new PlayerView(game.animator, body);
  const dummyView = new DummyView(ARENA.dummy.position, ARENA.dummy.radius, ARENA.dummy.height);
  /** Where she looks on the dummy: the middle of its sack head. */
  const DUMMY_HEAD = ARENA.dummy.height * DUMMY_HEAD_AT;
  const lookPoint = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  const hitboxes = new HitboxDebugView();
  hitboxes.visible = false; // V shows hit areas and hurtboxes
  arena.scene.add(playerView.root, dummyView.root, hitboxes.root);

  // Presentation. Each one is an FxSink fed by CombatFeel's cues; none of them touch gameplay.
  const grade = new PostGrade({}, reducedMotion);
  const fx = new ThreeFx(arena.scene, cameraView.camera, playerView, reducedMotion);
  const sound = new SoundFx();
  for (const sink of [grade, fx, sound, new PadRumble(devices)]) game.addFxSink(sink);
  game.events.on('attackStarted', ({ attack }) => sound.swing(attack));
  game.dummyAI.events.on('telegraph', ({ step }) => sound.telegraph(!!step.attack.unblockable));
  game.targeting.events.on('targetLocked', () => sound.lockOn());
  game.targeting.events.on('targetReleased', ({ reason }) => sound.lockOff(reason === 'lost'));
  game.targeting.events.on('viewLocked', () => sound.viewLock(true));
  game.targeting.events.on('viewReleased', () => sound.viewLock(false));
  const bladeCharge = new BladeCharge(playerView.sword, reducedMotion);
  const swordTrail = new SwordTrail(playerView.sword);
  // The spin's circle of energy, out at the edge of its reach, swept round with the blade.
  const spinWave = spinWaveTrails(playerView.sword, () => playerView.root.position);
  arena.scene.add(swordTrail.mesh, ...spinWave.map((t) => t.mesh));
  const post = new PostFx(arena.renderer, arena.scene, cameraView.camera, reducedMotion);
  post.setBloom(stageLook.bloom);
  const glyph = new CounterGlyph(document.body, game, devices);
  const chest = new THREE.Vector3();
  const focus = new THREE.Vector2(0.5, 0.5);

  const overlay = new DebugOverlay(document.body, game, devices, () => ({
    hitAreas: hitboxes.visible,
    slowmo: game.feel.slowmo,
    infinitePerfect: game.player.infinitePerfectWindows,
  }));
  // Off unless asked for: the panels are for tuning, not playing.
  overlay.visible = readStored(DEBUG_STORAGE_KEY) === 'on';
  const setDebug = (on: boolean) => {
    overlay.visible = on;
    writeStored(DEBUG_STORAGE_KEY, on ? 'on' : 'off');
  };
  // The controls card starts open, except on phones where it would sit under the left thumb.
  const storedControls = readStored(CONTROLS_STORAGE_KEY);
  const hud = new Hud(
    document.body,
    game,
    devices,
    () => ({
      paused,
      muted: sound.isMuted,
      slowmo: game.feel.slowmo,
      infinitePerfect: game.player.infinitePerfectWindows,
      hitAreas: hitboxes.visible,
    }),
    storedControls === null ? !devices.touch : storedControls === 'on',
  );
  const setControls = (on: boolean) => {
    hud.controlsShown = on;
    writeStored(CONTROLS_STORAGE_KEY, on ? 'on' : 'off');
  };
  if (devices.touch) devices.touch.setLockQuery(() => game.targeting.isLocked || game.targeting.isViewLocked);
  if (import.meta.env.DEV) {
    window.__kira = game;
    window.__kiraFx = fx;
  }

  // Options: the sim pauses while it is open. Picking a stage applies it behind the panel.
  const menu = new OptionsMenu(document.body, arena.current ?? 'grounds', [
    { label: 'controls', blurb: 'the button list, bottom left.', get: () => hud.controlsShown, set: setControls },
    { label: 'debug panels', blurb: 'fsm, buffer, windows, clocks. for tuning.', get: () => overlay.visible, set: setDebug },
  ]);
  menu.onStage = (id: StageId) => {
    post.setBloom(arena.setStage(id).bloom);
    writeStored(STAGE_STORAGE_KEY, id);
  };
  // Keys and taps made while it is open never reach her.
  menu.onToggle = () => devices.release();
  const menuHint = (kind: DeviceKind) =>
    kind === 'gamepad'
      ? 'paused while open. d-pad to pick, start to close.'
      : kind === 'touch'
        ? 'paused while open. tap a stage, then close.'
        : 'paused while open. arrows to pick, o or esc to close.';

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
    if (menu.open) {
      if (menu.key(e)) e.preventDefault(); // also stops a focused button clicking itself
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyO' || e.code === 'Escape') menu.show(menuHint('keyboard'));
    if (e.code === 'KeyH') debug.toggleAI();
    // 1-4 pick one string to repeat, 0 cycles through all of them.
    const digit = /^Digit([0-4])$/.exec(e.code);
    if (digit) game.dummyAI.select(digit[1] === '0' ? 'cycle' : Number(digit[1]) - 1);
    if (e.code === 'KeyV') debug.toggleHitAreas();
    if (e.code === 'KeyP') debug.togglePause();
    if (e.code === 'KeyN') debug.toggleSlowmo();
    if (e.code === 'KeyI') debug.toggleInfinitePerfect();
    if (e.code === 'KeyM') sound.toggleMute();
    if (e.code === 'KeyC') setControls(!hud.controlsShown);
    if (e.code === 'Tab') {
      e.preventDefault();
      setDebug(!overlay.visible);
    }
  });
  devices.gamepad.onMenu = (m) => {
    if (m === 'menu') menu.toggle(menuHint('gamepad'));
    else if (menu.open) menu.pad(m);
  };
  devices.gamepad.onDebug = (d) => {
    if (menu.open) return; // the d-pad is driving the menu
    if (d === 'ai') debug.toggleAI();
    else if (d === 'prevString') debug.stepString(-1);
    else if (d === 'nextString') debug.stepString(1);
    else if (d === 'hitAreas') debug.toggleHitAreas();
    else if (d === 'slowmo') debug.toggleSlowmo();
    else if (d === 'infinitePerfect') debug.toggleInfinitePerfect();
    else if (d === 'overlay') setDebug(!overlay.visible);
  };
  if (devices.touch) {
    devices.touch.onDebug = (d) => {
      if (d === 'debug') setDebug(!overlay.visible);
      else if (d === 'ai') {
        debug.toggleAI();
        toast(game.dummyAI.enabled ? 'dummy ai on' : 'dummy ai off');
      } else if (d === 'pause') debug.togglePause();
      else if (d === 'options') menu.toggle(menuHint('touch'));
      else if (d === 'fullscreen') toggleFullscreen();
    };
  }
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
  /** Real seconds the stage has been animating (wind, clouds), stopped while paused. */
  let stageTime = 0;

  const frame = (now: number) => {
    const realDt = Math.min((now - last) / 1000, MAX_FRAME_TIME);
    last = now;

    // Fixed 60 Hz sim. Each step is one frame of ARCHITECTURE.md §2.
    const frozen = paused || menu.open;
    accumulator = frozen ? 0 : accumulator + realDt;
    let steps = 0;
    while (accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
      game.step();
      accumulator -= SIM_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;

    // Render between the last two sim states, so motion is smooth at any refresh rate.
    const alpha = accumulator / SIM_DT;
    const pose = game.interpolated(alpha);
    game.animator.render(alpha); // her pose at the same in-between moment as her position
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
    // Facing from the interpolated yaw (inverse of yawFromFacing), so recentering is smooth too.
    const facing = { x: -Math.sin(pose.yaw), y: Math.cos(pose.yaw) };
    const subject = { position: planarFrom3(pose.pos), height: pose.pos.y, facing };
    cameraView.apply(rig.update(realDt, devices.look(realDt), subject)); // camera on real time

    // Paused: effects freeze too (a true freeze frame), the camera still orbits.
    const fxDt = frozen ? 0 : realDt;
    stageTime += fxDt;
    arena.update(stageTime);
    // Her eyes on the target (or what she'd target), at its head. On her clock.
    const look = game.targeting.lookTarget;
    const at = look && planarTo3(look.position, look === game.dummy ? DUMMY_HEAD : 1.5);
    const p = game.player;
    playerView.lookAt(fxDt * game.time.playerScale, at ? lookPoint.set(at.x, at.y, at.z) : null, lookAllowed(p.state, p.attack?.attack ?? null, p.evade));
    // Her eyes are unlit paint: light them like her skin, from the way her face points.
    setFaceLight(arena.faceLight(playerView.faceDirection(faceNormal)));
    // Her face: a little angry near an enemy and locked on, a frown when she swings.
    playerView.face(fxDt * game.time.playerScale, {
      alert: game.targeting.targetNearby && !game.targeting.isLocked,
      locked: game.targeting.isLocked,
      attacking: p.state === PlayerStateId.Attack,
      hurt: p.state === PlayerStateId.HitStun,
    });
    const swing = game.player.attack?.attack;
    bladeCharge.update(fxDt, {
      charge: game.player.spinCharge,
      spinning: swing === AttackId.Spin || swing === AttackId.SpinClockwise,
    });
    // On her clock, so trails linger with her in slow-mo.
    const trailInput = { attack: swing ?? null, emitting: trailEmitting(game.player.attack) };
    swordTrail.update(fxDt * game.time.playerScale, trailInput);
    for (const t of spinWave) t.update(fxDt * game.time.playerScale, trailInput);
    fx.update(fxDt, worldDt);
    // The vignette closes in for a view lock too, as Zelda's bars do with no enemy around.
    const g = grade.update(fxDt, game.time.worldScale, game.targeting.isLocked || game.targeting.isViewLocked);
    sound.setWorldLowpass(g.lowpassHz);
    chest.set(pose.pos.x, pose.pos.y + 1.2, pose.pos.z);
    const ndc = chest.clone().project(cameraView.camera);
    focus.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
    post.render(g, focus, fxDt);
    glyph.update(cameraView.camera, chest);

    if (realDt > 0) fps += (1 / realDt - fps) * 0.05;
    overlay.update(fps);
    hud.update(overlay.visible);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** localStorage can throw (private browsing, storage off). The choice just isn't kept then. */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // not saved, still applied
  }
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => toast('full screen is not available here'));
}

/** Production builds work offline once loaded (see public/sw.js). Dev builds skip it. */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => console.warn('service worker not registered', err));
  });
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

registerServiceWorker();
boot().catch((err: unknown) => {
  console.error(err);
  const box = document.createElement('pre');
  box.className = 'boot-error';
  box.textContent = `the sandbox failed to start.\n\n${err instanceof Error ? err.message : String(err)}`;
  document.body.append(box);
});
