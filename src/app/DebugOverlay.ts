import { length } from '../core/math';
import type { Devices } from './input/Devices';
import type { PadLabels } from './input/padLayout';
import type { Game } from './Game';

const KEYBOARD_CONTROLS: ReadonlyArray<[string, string]> = [
  ['move', 'wasd'],
  ['look', 'mouse'],
  ['attack', 'j'],
  ['evade', 'space'],
  ['block', 'k'],
  ['target', 'shift, right mouse'],
  ['jump atk', 'evade while locked on'],
  ['dummy ai', 'h on / off'],
  ['strings', '1 to 4, 0 cycles'],
  ['hit areas', 'v'],
  ['pause sim', 'p'],
  ['mute', 'm'],
  ['overlay', 'tab'],
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
  ['dummy ai', 'd-pad up'],
  ['strings', 'd-pad left / right'],
  ['hit areas', 'd-pad down'],
  ['pause sim', 'start'],
  ['mute', 'm'],
  ['overlay', 'back'],
];

/**
 * Debug overlay. Read only: it looks at the game, never changes it.
 * Plain DOM with textContent, so there is nothing to escape and no framework.
 */
export class DebugOverlay {
  private readonly root: HTMLElement;
  private readonly rows = new Map<string, HTMLElement>();
  private readonly worldBar: HTMLElement;
  private readonly playerBar: HTMLElement;
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
  ) {
    this.root = el('aside', 'hud');
    this.root.append(heading('kiRa', 'sandbox'));

    const stats = el('dl', 'hud-stats');
    for (const key of ['state', 'in state', 'clip', 'hitbox', 'target', 'motor', 'dummy', 'ai', 'device']) {
      const value = el('dd', 'hud-value');
      stats.append(text('dt', 'hud-key', key), value);
      this.rows.set(key, value);
    }
    this.root.append(stats);

    this.root.append(section('clocks'));
    this.worldBar = el('div', 'hud-bar-fill');
    this.playerBar = el('div', 'hud-bar-fill hud-bar-fill-cyan');
    this.root.append(bar('world', this.worldBar), bar('player', this.playerBar));

    this.root.append(section('transitions'));
    this.transitions = el('ol', 'hud-list');
    this.root.append(this.transitions);

    this.root.append(section('combat'));
    this.combat = el('ol', 'hud-list');
    this.root.append(this.combat);

    this.root.append(section('fx cues'));
    this.cues = el('ol', 'hud-list');
    this.root.append(this.cues);

    this.root.append(section('controls'));
    this.controls = el('dl', 'hud-stats hud-controls');
    this.root.append(this.controls);

    this.hint = text('p', 'hud-hint', 'click the arena to capture the mouse');
    parent.append(this.root, this.hint);
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
  }

  update(fps: number): void {
    const onPad = this.devices.active === 'gamepad';
    // The mouse hint only matters on keyboard and mouse.
    this.hint.hidden = onPad || this.devices.keyboard.pointerLocked;
    if (this.root.hidden) return;
    this.renderControls();
    const g = this.game;
    const m = g.motor;

    this.set('state', g.player.state);
    this.set('in state', `${g.player.fsm.timeInState.toFixed(2)} s`);
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
      : `keyboard${this.devices.keyboard.pointerLocked ? ', mouse captured' : ''}${pad.name ? ', pad idle' : ''}`;
    this.set('device', `${device}, ${fps.toFixed(0)} fps`);

    setBar(this.worldBar, g.time.worldScale);
    setBar(this.playerBar, g.time.playerScale);

    replaceItems(
      this.transitions,
      g.transitions.slice(0, 5).map((t) => `f${t.frame}  ${t.from ?? 'start'} → ${t.to}`),
    );
    replaceItems(
      this.combat,
      g.combatLog.slice(0, 5).map((c) => `${c.text}  ${(g.realTime - c.at).toFixed(1)} s`),
    );
    replaceItems(
      this.cues,
      g.fx.recent.slice(0, 4).map((c) => `${c.cue}  ${(g.realTime - c.at).toFixed(1)} s`),
    );
  }

  /** Rebuilt only when the active device (or pad family) changes. */
  private renderControls(): void {
    const onPad = this.devices.active === 'gamepad';
    const key = onPad ? `pad:${this.devices.gamepad.family}` : 'keyboard';
    if (key === this.controlsFor) return;
    this.controlsFor = key;
    const rows = onPad ? padControls(this.devices.gamepad.labels) : KEYBOARD_CONTROLS;
    this.controls.replaceChildren(...rows.flatMap(([k, v]) => [text('dt', 'hud-key', k), text('dd', 'hud-value', v)]));
  }

  private set(key: string, value: string): void {
    const node = this.rows.get(key);
    if (node && node.textContent !== value) node.textContent = value;
  }
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

function bar(label: string, fill: HTMLElement): HTMLElement {
  const row = el('div', 'hud-bar-row');
  const track = el('div', 'hud-bar');
  track.append(fill);
  const value = el('span', 'hud-bar-value');
  row.append(text('span', 'hud-key', label), track, value);
  return row;
}

function setBar(fill: HTMLElement, scale: number): void {
  fill.style.transform = `scaleX(${scale})`;
  const value = fill.parentElement?.nextElementSibling;
  if (value) value.textContent = scale.toFixed(2);
}

function replaceItems(list: HTMLElement, items: string[]): void {
  const joined = items.join('\n');
  if (list.dataset.items === joined) return;
  list.dataset.items = joined;
  list.replaceChildren(...items.map((s) => text('li', 'hud-item', s)));
}
