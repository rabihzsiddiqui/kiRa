import { Enemy } from '../combat/Enemy';
import type { Game } from './Game';
import { actionPrompts, controlsFor, promptKeys, targetStatus, type PromptAction } from './hudModel';
import type { DeviceKind, Devices } from './input/Devices';

/** Sandbox switches worth a chip in the corner. main.ts owns them; the HUD only reads. */
export interface HudStatus {
  paused: boolean;
  muted: boolean;
  slowmo: boolean;
  infinitePerfect: boolean;
  hitAreas: boolean;
}

/** Display names for enemies by their combat name. */
const ENEMY_NAMES: Record<string, string> = { dummy: 'training dummy' };

interface PromptRow {
  row: HTMLElement;
  key: HTMLElement;
  verb: HTMLElement;
}

/**
 * The player's HUD, always on. Top left: wordmark and what the sandbox is doing.
 * Top middle: the locked target's posture. Bottom right: what each button does right
 * now. Bottom left: the controls card (c, or options). Read only, like the debug panels.
 * While the debug panels are open it hides its corners, since they cover the same ground.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly target: HTMLElement;
  private readonly targetName: HTMLElement;
  private readonly targetState: HTMLElement;
  private readonly poise: HTMLElement;
  private readonly prompts: HTMLElement;
  private readonly promptRows = new Map<PromptAction, PromptRow>();
  private readonly charge: HTMLElement;
  private readonly card: HTMLElement;
  private readonly cardList: HTMLElement;
  private readonly cardHint: HTMLElement;
  private readonly mouseHint: HTMLElement;
  private controlsFor = '';
  private showControls: boolean;

  constructor(
    parent: HTMLElement,
    private readonly game: Game,
    private readonly devices: Devices,
    private readonly read: () => HudStatus,
    showControls: boolean,
  ) {
    this.showControls = showControls;
    this.root = el('div', 'ghud');

    const brand = el('div', 'ghud-brand');
    const word = text('span', 'ghud-word', 'kiRa');
    word.append(el('span', 'ghud-word-mark'));
    this.status = el('div', 'ghud-status');
    brand.append(word, this.status);

    this.target = el('div', 'ghud-target');
    this.target.hidden = true;
    const head = el('div', 'ghud-target-head');
    this.targetName = el('span', 'ghud-target-name');
    this.targetState = el('span', 'ghud-target-state');
    head.append(this.targetName, this.targetState);
    const track = el('div', 'ghud-poise');
    this.poise = el('div', 'ghud-poise-fill');
    track.append(this.poise);
    this.target.append(head, track);

    this.prompts = el('div', 'ghud-prompts');
    for (const action of ['attack', 'evade', 'block', 'target'] as const) {
      const row = el('div', 'ghud-prompt');
      const key = el('span', 'ghud-key');
      const verb = el('span', 'ghud-verb');
      row.append(key, verb);
      this.prompts.append(row);
      this.promptRows.set(action, { row, key, verb });
    }
    // Spin charge fills under the attack prompt.
    const chargeTrack = el('div', 'ghud-charge');
    this.charge = el('div', 'ghud-charge-fill');
    chargeTrack.append(this.charge);
    this.promptRows.get('attack')?.row.append(chargeTrack);

    this.card = el('section', 'ghud-card');
    const title = text('h2', 'ghud-card-title', 'controls');
    title.append(el('span', 'mark'));
    this.cardList = el('dl', 'ghud-card-list');
    this.card.append(title, this.cardList);
    this.cardHint = el('p', 'ghud-card-hint');

    this.mouseHint = text('p', 'ghud-mouse-hint', 'click the arena to capture the mouse');
    this.root.append(brand, this.target, this.prompts, this.card, this.cardHint, this.mouseHint);
    parent.append(this.root);
  }

  get controlsShown(): boolean {
    return this.showControls;
  }

  set controlsShown(on: boolean) {
    this.showControls = on;
  }

  /** `debugOpen`: the debug panels are up, so the corners step aside. */
  update(debugOpen: boolean): void {
    const kind = this.devices.active;
    const touch = kind === 'touch';
    this.root.classList.toggle('ghud-debug', debugOpen);

    this.mouseHint.hidden = kind !== 'keyboard' || this.devices.keyboard.pointerLocked;
    this.renderStatus();
    this.renderTarget();

    // Touch has real buttons on screen; prompts would sit under the thumb.
    this.prompts.hidden = touch || debugOpen;
    if (!this.prompts.hidden) this.renderPrompts();

    this.card.hidden = !this.showControls || debugOpen;
    // Collapsed: one line saying how to open it. Touch opens it from options.
    this.cardHint.hidden = this.showControls || debugOpen || touch;
    this.renderControls(kind);
    setText(this.cardHint, kind === 'gamepad' ? 'controls in options (start)' : 'c  controls');
  }

  private renderStatus(): void {
    const g = this.game;
    const s = this.read();
    const ai = g.dummyAI;
    const chips: string[] = [];
    if (!ai.enabled) chips.push('dummy idle');
    else chips.push(ai.selection === 'cycle' ? 'dummy: all strings' : `dummy: ${ai.strings[ai.selection]?.label ?? '?'}`);
    if (s.paused) chips.push('paused');
    if (s.muted) chips.push('muted');
    if (!s.slowmo) chips.push('slow-mo off');
    if (s.infinitePerfect) chips.push('every dodge perfect');
    if (s.hitAreas) chips.push('hit areas');
    const joined = chips.join('\n');
    if (this.status.dataset.chips === joined) return;
    this.status.dataset.chips = joined;
    this.status.replaceChildren(
      ...chips.map((c, i) => text('span', i === 0 && ai.enabled ? 'ghud-chip ghud-chip-on' : 'ghud-chip', c)),
    );
  }

  private renderTarget(): void {
    const t = this.game.targeting.current;
    const enemy = t instanceof Enemy ? t : null;
    this.target.hidden = !enemy;
    if (!enemy) return;
    setText(this.targetName, ENEMY_NAMES[enemy.name] ?? enemy.name);
    setText(this.targetState, targetStatus(enemy.status));
    const frac = Math.max(0, Math.min(1, enemy.poise.value / enemy.poise.cfg.max));
    this.poise.style.transform = `scaleX(${frac})`;
    this.target.classList.toggle('ghud-target-broken', enemy.status === 'staggered');
  }

  private renderPrompts(): void {
    const g = this.game;
    const charge = g.player.spinCharge;
    const prompts = actionPrompts({
      state: g.player.state,
      locked: g.targeting.isLocked,
      viewLocked: g.targeting.isViewLocked,
      targetNearby: g.targeting.targetNearby,
      spinCharge: charge,
    });
    const keys = promptKeys(this.devices.active, this.devices.gamepad.labels);
    for (const p of prompts) {
      const r = this.promptRows.get(p.action);
      if (!r) continue;
      setText(r.key, keys[p.action]);
      setText(r.verb, p.verb);
      r.row.classList.toggle('ghud-prompt-hot', p.hot);
    }
    const attack = this.promptRows.get('attack');
    attack?.row.classList.toggle('ghud-prompt-charging', charge !== null);
    this.charge.style.transform = `scaleX(${charge ?? 0})`;
  }

  /** Rebuilt only when the active device (or pad family) changes. */
  private renderControls(kind: DeviceKind): void {
    const key = kind === 'gamepad' ? `pad:${this.devices.gamepad.family}` : kind;
    if (key === this.controlsFor) return;
    this.controlsFor = key;
    const rows = controlsFor(kind, this.devices.gamepad.labels);
    this.cardList.replaceChildren(
      ...rows.flatMap(([k, v]) => [text('dt', 'ghud-card-key', k), text('dd', 'ghud-card-value', v)]),
    );
  }
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
