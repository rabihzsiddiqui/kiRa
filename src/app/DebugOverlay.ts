import { length } from '../core/math';
import { PlayerStateId } from '../player/contracts';
import type { EvadeState } from '../player/states/EvadeState';
import type { Devices } from './input/Devices';
import type { PadLabels } from './input/padLayout';
import type { Game } from './Game';

/** Debug switches the HUD shows. main.ts owns them; the HUD only reads. */
export interface DebugFlags {
  hitAreas: boolean;
  slowmo: boolean;
  infinitePerfect: boolean;
}

interface ToggleKeys {
  hitAreas: string;
  slowmo: string;
  infinitePerfect: string;
}

const KEYBOARD_TOGGLES: ToggleKeys = { hitAreas: 'v', slowmo: 'n', infinitePerfect: 'i' };
const padToggles = (l: PadLabels): ToggleKeys => ({
  hitAreas: 'd-pad down',
  slowmo: l.leftClick,
  infinitePerfect: l.rightClick,
});

// Phones only get the gameplay buttons and a few pills; the deeper switches are keyboard only.
const TOUCH_TOGGLES: ToggleKeys = { hitAreas: 'keys only', slowmo: 'keys only', infinitePerfect: 'keys only' };

const TOUCH_CONTROLS: ReadonlyArray<[string, string]> = [
  ['move', 'left thumb'],
  ['look', 'drag on the right'],
  ['attack', 'atk'],
  ['evade', 'roll'],
  ['block', 'block, hold'],
  ['target', 'lock, tap'],
  ['jump atk', 'jump (roll, while locked on)'],
  ['roll atk', 'atk during a roll'],
  ['dummy ai', 'ai pill'],
  ['pause sim', 'pause pill'],
  ['options', 'options pill'],
  ['hud', 'hud pill'],
];

const KEYBOARD_CONTROLS: ReadonlyArray<[string, string]> = [
  ['move', 'wasd'],
  ['look', 'mouse'],
  ['attack', 'j'],
  ['evade', 'space'],
  ['block', 'k'],
  ['target', 'shift, right mouse'],
  ['jump atk', 'evade while locked on'],
  ['roll atk', 'j during a roll'],
  ['dummy ai', 'h on / off'],
  ['strings', '1 to 4, 0 cycles'],
  ['pause sim', 'p'],
  ['options', 'o or esc'],
  ['mute', 'm'],
  ['hud', 'tab'],
];

/** Controls list for the active pad, in its own button names. */
const padControls = (l: PadLabels): ReadonlyArray<[string, string]> => [
  ['move', 'left stick'],
  ['look', 'right stick'],
  ['attack', l.attack],
  ['evade', l.evade],
  ['block', l.block],
  ['target', l.target],
  ['jump atk', 'evade while locked on'],
  ['roll atk', 'attack during a roll'],
  ['dummy ai', 'd-pad up'],
  ['strings', 'd-pad left / right'],
  ['options', 'start (pauses)'],
  ['mute', 'm'],
  ['hud', 'back'],
];

/** Buffered presses shown at once. The buffer rarely holds more than two. */
const BUFFER_SLOTS = 4;

interface BarRow {
  row: HTMLElement;
  label: HTMLElement;
  fill: HTMLElement;
  value: HTMLElement;
}

/**
 * Debug HUD, two panels. Left: live state (FSM, move phase, input buffer, perfect
 * windows, clocks, debug switches). Right: recent transitions, combat, cues, controls.
 * Read only: it looks at the game, never changes it. Plain DOM with textContent, so
 * there is nothing to escape and no framework.
 */
export class DebugOverlay {
  private readonly live: HTMLElement;
  private readonly log: HTMLElement;
  private readonly rows = new Map<string, HTMLElement>();
  private readonly world: BarRow;
  private readonly playerClock: BarRow;
  private readonly buffer: BarRow[] = [];
  private readonly bufferEmpty: HTMLElement;
  private readonly dodge: BarRow;
  private readonly block: BarRow;
  private readonly toggles = new Map<keyof DebugFlags, { key: HTMLElement; state: HTMLElement }>();
  private readonly transitions: HTMLElement;
  private readonly combat: HTMLElement;
  private readonly cues: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly controls: HTMLElement;
  private controlsFor = '';

  constructor(
    parent: HTMLElement,
    private readonly game: Game,
    private readonly devices: Devices,
    private readonly flags: () => DebugFlags,
  ) {
    // ---- left: live state
    this.live = el('aside', 'hud');
    this.live.append(heading('kiRa', 'debug'));

    const stats = el('dl', 'hud-stats');
    for (const key of ['state', 'in state', 'move', 'clip', 'hitbox', 'target', 'motor', 'dummy', 'ai', 'device']) {
      const value = el('dd', 'hud-value');
      stats.append(text('dt', 'hud-key', key), value);
      this.rows.set(key, value);
    }
    this.live.append(stats);

    this.live.append(section('input buffer'));
    for (let i = 0; i < BUFFER_SLOTS; i++) {
      const b = barRow('', 'hud-bar-fill-live');
      b.row.hidden = true;
      this.buffer.push(b);
      this.live.append(b.row);
    }
    this.bufferEmpty = text('p', 'hud-empty', 'nothing waiting');
    this.live.append(this.bufferEmpty);

    this.live.append(section('perfect windows'));
    this.dodge = barRow('dodge', 'hud-bar-fill-live hud-bar-fill-cyan');
    this.block = barRow('block', 'hud-bar-fill-live hud-bar-fill-cyan');
    this.live.append(this.dodge.row, this.block.row);

    this.live.append(section('clocks'));
    this.world = barRow('world');
    this.playerClock = barRow('player', 'hud-bar-fill-cyan');
    this.live.append(this.world.row, this.playerClock.row);

    this.live.append(section('toggles'));
    const toggles = el('dl', 'hud-toggles');
    const names: Array<[keyof DebugFlags, string]> = [
      ['hitAreas', 'hit areas'],
      ['slowmo', 'slow-mo'],
      ['infinitePerfect', 'infinite perfect'],
    ];
    for (const [flag, name] of names) {
      const key = el('span', 'hud-toggle-key');
      const state = el('span', 'hud-toggle-state');
      const dd = el('dd', 'hud-toggle');
      dd.append(key, state);
      toggles.append(text('dt', 'hud-key', name), dd);
      this.toggles.set(flag, { key, state });
    }
    this.live.append(toggles);

    // ---- right: logs and controls
    this.log = el('aside', 'hud hud-log');

    this.log.append(section('transitions'));
    this.transitions = el('ol', 'hud-list');
    this.log.append(this.transitions);

    this.log.append(section('combat'));
    this.combat = el('ol', 'hud-list');
    this.log.append(this.combat);

    this.log.append(section('fx cues'));
    this.cues = el('ol', 'hud-list');
    this.log.append(this.cues);

    this.log.append(section('controls'));
    this.controls = el('dl', 'hud-stats hud-controls');
    this.log.append(this.controls);
    // The first section of a panel sits flush with the top padding.
    this.log.firstElementChild?.classList.add('hud-section-first');

    this.hint = text('p', 'hud-hint', 'click the arena to capture the mouse');
    parent.append(this.live, this.log, this.hint);
  }

  toggle(): void {
    const hide = !this.live.hidden;
    this.live.hidden = hide;
    this.log.hidden = hide;
  }

  update(fps: number): void {
    const onPad = this.devices.active === 'gamepad';
    // The mouse hint only matters on keyboard and mouse.
    this.hint.hidden = this.devices.active !== 'keyboard' || this.devices.keyboard.pointerLocked;
    if (this.live.hidden) return;
    this.renderControls();
    const g = this.game;
    const m = g.motor;

    this.set('state', g.player.state);
    this.set('in state', `${g.player.fsm.timeInState.toFixed(2)} s`);
    this.set('move', moveText(g));
    this.set('clip', g.animator.clip);
    this.set('hitbox', g.combat.activePlayerAttack ?? (g.player.inPerfectDodgeWindow ? 'off, graze on' : 'off'));
    this.set('target', g.targeting.isLocked ? `dummy, ${g.targeting.distanceToTarget().toFixed(1)} m` : 'none');
    this.set(
      'motor',
      // The skin gap leaves height at about -0.001 on the floor; don't print "-0.00".
      `${m.grounded ? 'ground' : 'air'}, ${length(m.planarVelocity).toFixed(1)} m/s, ${Math.max(0, m.height).toFixed(2)} m`,
    );
    const d = g.dummy;
    this.set('dummy', `${d.status}, poise ${Math.floor(d.poise.value)}/${d.poise.cfg.max}`);
    this.set('ai', aiText(g));
    const pad = this.devices.gamepad;
    const device = onPad
      ? `${pad.family === 'generic' ? 'gamepad' : pad.family}`
      : this.devices.active === 'touch'
        ? 'touch'
        : `keyboard${this.devices.keyboard.pointerLocked ? ', mouse captured' : ''}${pad.name ? ', pad idle' : ''}`;
    this.set('device', `${device}, ${fps.toFixed(0)} fps`);

    this.renderBuffer();
    this.renderWindows();

    setBar(this.world, g.time.worldScale, g.time.worldScale.toFixed(2));
    setBar(this.playerClock, g.time.playerScale, g.time.playerScale.toFixed(2));

    const flags = this.flags();
    for (const [flag, { state }] of this.toggles) {
      const on = flags[flag];
      setText(state, on ? 'on' : 'off');
      state.classList.toggle('hud-toggle-on', on);
    }

    replaceItems(
      this.transitions,
      g.transitions.slice(0, 4).map((t) => `f${t.frame}  ${t.from ?? 'start'} → ${t.to}`),
    );
    replaceItems(
      this.combat,
      g.combatLog.slice(0, 4).map((c) => `${c.text}  ${(g.realTime - c.at).toFixed(1)} s`),
    );
    replaceItems(
      this.cues,
      g.fx.recent.slice(0, 3).map((c) => `${c.cue}  ${(g.realTime - c.at).toFixed(1)} s`),
    );
  }

  /** Each waiting press as a bar of how much buffer window it has left. */
  private renderBuffer(): void {
    const { input } = this.game;
    const window = input.cfg.bufferWindow;
    const pending = input.pending;
    this.buffer.forEach((b, i) => {
      const p = pending[i];
      b.row.hidden = !p;
      if (!p) return;
      const age = input.now - p.time;
      setText(b.label, p.action);
      setBar(b, 1 - age / window, `${age.toFixed(2)}`);
    });
    this.bufferEmpty.hidden = pending.length > 0;
  }

  /** Time left in each perfect window, in seconds on the clock that window runs on. */
  private renderWindows(): void {
    const { tuning } = this.game.player.ctx;
    const w = this.game.player.perfectWindows();
    const left = (frac: number, window: number) =>
      frac <= 0 ? 'shut' : Number.isFinite(window) ? (frac * window).toFixed(2) : 'inf';
    setBar(this.dodge, w.dodge, left(w.dodge, tuning.perfectDodgeWindow));
    setBar(this.block, w.block, w.blockLockedOut ? 'mash' : left(w.block, tuning.perfectBlockWindow));
    this.block.row.classList.toggle('hud-bar-row-warn', w.blockLockedOut);
  }

  /** Rebuilt only when the active device (or pad family) changes. */
  private renderControls(): void {
    const kind = this.devices.active;
    const key = kind === 'gamepad' ? `pad:${this.devices.gamepad.family}` : kind;
    if (key === this.controlsFor) return;
    this.controlsFor = key;
    const labels = this.devices.gamepad.labels;
    const rows = kind === 'gamepad' ? padControls(labels) : kind === 'touch' ? TOUCH_CONTROLS : KEYBOARD_CONTROLS;
    this.controls.replaceChildren(...rows.flatMap(([k, v]) => [text('dt', 'hud-key', k), text('dd', 'hud-value', v)]));
    const keys = kind === 'gamepad' ? padToggles(labels) : kind === 'touch' ? TOUCH_TOGGLES : KEYBOARD_TOGGLES;
    for (const [flag, t] of this.toggles) setText(t.key, keys[flag]);
  }

  private set(key: string, value: string): void {
    const node = this.rows.get(key);
    if (node) setText(node, value);
  }
}

/** The move in progress: attack with its phase and combo step, or the evade and its clock. */
function moveText(g: Game): string {
  const a = g.player.attack;
  if (a) return `${a.attack}, ${a.phase}${a.combo > 0 ? `, combo ${a.combo + 1}` : ''}`;
  if (g.player.state === PlayerStateId.Evade) {
    const e = g.player.fsm.current as EvadeState;
    return `${e.evade.replaceAll('_', ' ')}, ${e.elapsed.toFixed(2)} s`;
  }
  return 'none';
}

function aiText(g: Game): string {
  const ai = g.dummyAI;
  if (!ai.enabled) return 'off';
  const pick = ai.selection === 'cycle' ? 'cycle' : (ai.strings[ai.selection]?.id ?? '?');
  const s = ai.string;
  if (!s || ai.phase === 'idle') return `${pick}, idle`;
  const steps = s.steps.length > 1 ? ` ${ai.stepIndex + 1}/${s.steps.length}` : '';
  return `${s.id}${steps}, ${ai.phase}`;
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function text(tag: string, className: string, value: string): HTMLElement {
  const node = el(tag, className);
  node.textContent = value;
  return node;
}

function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

/** Title with the square accent mark that every heading uses. */
function heading(title: string, label: string): HTMLElement {
  const h = el('header', 'hud-header');
  const t = text('h1', 'hud-title', title);
  t.append(el('span', 'mark'));
  h.append(t, text('span', 'hud-label', label));
  return h;
}

function section(title: string): HTMLElement {
  const h = text('h2', 'hud-section', title);
  h.append(el('span', 'mark'));
  return h;
}

function barRow(label: string, fillClass = ''): BarRow {
  const row = el('div', 'hud-bar-row');
  const track = el('div', 'hud-bar');
  const fill = el('div', `hud-bar-fill ${fillClass}`.trim());
  track.append(fill);
  const name = text('span', 'hud-key', label);
  const value = el('span', 'hud-bar-value');
  row.append(name, track, value);
  return { row, label: name, fill, value };
}

function setBar(bar: BarRow, frac: number, value: string): void {
  bar.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
  setText(bar.value, value);
}

function replaceItems(list: HTMLElement, items: string[]): void {
  const joined = items.join('\n');
  if (list.dataset.items === joined) return;
  list.dataset.items = joined;
  list.replaceChildren(...items.map((s) => text('li', 'hud-item', s)));
}
