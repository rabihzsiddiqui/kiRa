import type { PadMenu } from './input/padLayout';
import { STAGES, type StageId } from './stages';

/** An on / off row under "display". The owner keeps the value; the menu reads and flips it. */
export interface MenuToggle {
  label: string;
  blurb: string;
  get: () => boolean;
  set: (on: boolean) => void;
}

/**
 * Options panel: the stage, and display switches (controls card, debug panels). Picking a stage applies it at once
 * (you see it behind the panel) and the menu stays open, so stages can be compared.
 * The owner pauses the sim while `open` is true and passes in keyboard and pad presses.
 */
export class OptionsMenu {
  open = false;
  /** A stage was picked. */
  onStage?: (id: StageId) => void;
  /** The menu opened or closed. */
  onToggle?: (open: boolean) => void;

  private readonly backdrop: HTMLElement;
  private readonly hint: HTMLElement;
  /** Every focusable row, stages then toggles, in the order the arrows walk them. */
  private readonly options: HTMLButtonElement[] = [];
  private readonly picks: Array<() => void> = [];
  private readonly switches: Array<{ button: HTMLButtonElement; state: HTMLElement; toggle: MenuToggle }> = [];
  private focus = 0;
  private current: StageId;

  constructor(parent: HTMLElement, current: StageId, toggles: readonly MenuToggle[] = []) {
    this.current = current;
    this.backdrop = el('div', 'menu-backdrop');
    this.backdrop.hidden = true;
    // A click on the dimmed area outside the panel closes it.
    this.backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === this.backdrop) this.hide();
    });

    const panel = el('section', 'menu');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'menu-title');

    const header = el('header', 'menu-header');
    const title = el('h2', 'menu-title');
    title.id = 'menu-title';
    title.append('options', el('span', 'mark'));
    const close = el('button', 'menu-close');
    close.textContent = 'close';
    close.addEventListener('click', () => this.hide());
    header.append(title, close);

    const section = el('p', 'menu-section');
    section.textContent = 'stage';
    const group = el('div', 'menu-options');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', 'stage');
    for (const stage of STAGES) {
      const b = el('button', 'menu-option');
      b.setAttribute('role', 'radio');
      b.dataset.stage = stage.id;
      const swatch = el('span', 'menu-swatch');
      swatch.style.background = stage.swatch;
      const text = el('span', 'menu-option-text');
      const name = el('span', 'menu-option-title');
      name.textContent = stage.label;
      const blurb = el('span', 'menu-option-blurb');
      blurb.textContent = stage.blurb;
      text.append(name, blurb);
      b.append(swatch, text);
      this.addRow(b, () => this.pickStage(stage.id));
      group.append(b);
    }
    panel.append(header, section, group);

    if (toggles.length > 0) {
      const display = el('p', 'menu-section menu-section-gap');
      display.textContent = 'display';
      const list = el('div', 'menu-options');
      for (const toggle of toggles) {
        const b = el('button', 'menu-option menu-switch');
        b.setAttribute('role', 'switch');
        const text = el('span', 'menu-option-text');
        const name = el('span', 'menu-option-title');
        name.textContent = toggle.label;
        const blurb = el('span', 'menu-option-blurb');
        blurb.textContent = toggle.blurb;
        text.append(name, blurb);
        const state = el('span', 'menu-switch-state');
        b.append(text, state);
        this.switches.push({ button: b, state, toggle });
        this.addRow(b, () => {
          toggle.set(!toggle.get());
          this.refresh();
        });
        list.append(b);
      }
      panel.append(display, list);
    }

    this.hint = el('p', 'menu-hint');
    panel.append(this.hint);
    this.backdrop.append(panel);
    parent.append(this.backdrop);
    this.refresh();
  }

  /** `hint` says how to close it on the device in use. */
  show(hint: string): void {
    if (this.open) return;
    this.open = true;
    this.hint.textContent = hint;
    this.backdrop.hidden = false;
    this.refresh(); // a switch may have been flipped from the keyboard since
    this.setFocus(Math.max(0, STAGES.findIndex((s) => s.id === this.current)));
    this.options[this.focus].focus({ preventScroll: true });
    this.onToggle?.(true);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.backdrop.hidden = true;
    (document.activeElement as HTMLElement | null)?.blur();
    this.onToggle?.(false);
  }

  toggle(hint: string): void {
    if (this.open) this.hide();
    else this.show(hint);
  }

  /** Show which stage is live (when it is changed from somewhere else). */
  setCurrent(id: StageId): void {
    this.current = id;
    this.refresh();
  }

  /** Keyboard while open. Returns true if the key was used. */
  key(e: KeyboardEvent): boolean {
    switch (e.code) {
      case 'Escape':
      case 'KeyO':
        this.hide();
        return true;
      case 'ArrowUp':
      case 'KeyW':
        this.move(-1);
        return true;
      case 'ArrowDown':
      case 'KeyS':
        this.move(1);
        return true;
      case 'Enter':
      case 'Space':
        this.pick();
        return true;
      default:
        return false;
    }
  }

  /** Pad while open ('menu' toggling is the owner's job). */
  pad(m: PadMenu): void {
    if (m === 'up') this.move(-1);
    else if (m === 'down') this.move(1);
    else if (m === 'select') this.pick();
    else if (m === 'back') this.hide();
  }

  private move(dir: 1 | -1): void {
    this.setFocus((this.focus + dir + this.options.length) % this.options.length);
    this.options[this.focus].focus({ preventScroll: true });
  }

  private addRow(b: HTMLButtonElement, pick: () => void): void {
    const i = this.options.length;
    b.addEventListener('click', () => {
      this.setFocus(i);
      this.pick();
    });
    b.addEventListener('pointerenter', () => this.setFocus(i));
    this.options.push(b);
    this.picks.push(pick);
  }

  private pick(): void {
    this.picks[this.focus]?.();
  }

  private pickStage(id: StageId): void {
    if (id === this.current) return;
    this.current = id;
    this.refresh();
    this.onStage?.(id);
  }

  private setFocus(i: number): void {
    this.focus = i;
    this.options.forEach((b, k) => b.classList.toggle('menu-option-focus', k === i));
  }

  private refresh(): void {
    for (const b of this.options) {
      if (!b.dataset.stage) continue;
      const on = b.dataset.stage === this.current;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('menu-option-on', on);
    }
    for (const { button, state, toggle } of this.switches) {
      const on = toggle.get();
      button.setAttribute('aria-checked', String(on));
      state.textContent = on ? 'on' : 'off';
      state.classList.toggle('menu-switch-on', on);
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
