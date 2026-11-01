import { vec2, type Vec2 } from '../../core/math';
import { Action } from '../../input/actions';
import { evadeLabel, knobOffset, LOOK_SENSITIVITY, stickFromDrag, zoneAt } from './touchLayout';
import type { DeviceFrame, LookDelta } from './types';

/** Sandbox controls with no gameplay action behind them. */
export type TouchDebug = 'hud' | 'ai' | 'pause' | 'options' | 'fullscreen';

interface ButtonDef {
  action: Action;
  label: string;
  className: string;
  /** Tap to latch on, tap again to let go (the lock button). */
  toggle?: boolean;
}

const BUTTONS: readonly ButtonDef[] = [
  { action: Action.Attack, label: 'atk', className: 'touch-btn touch-btn-attack' },
  { action: Action.Evade, label: evadeLabel(false), className: 'touch-btn touch-btn-evade' }, // relabeled by lock state
  { action: Action.Block, label: 'block', className: 'touch-btn touch-btn-block' },
  { action: Action.Target, label: 'lock', className: 'touch-btn touch-btn-target', toggle: true },
];

const PILLS: ReadonlyArray<[TouchDebug, string]> = [
  ['hud', 'hud'],
  ['ai', 'ai'],
  ['pause', 'pause'],
  ['options', 'options'],
  ['fullscreen', 'full'],
];

/**
 * On-screen controls for phones and tablets. Left thumb: a floating joystick that appears
 * where the thumb lands. Right side: drag to look. Bottom right: attack, evade (labeled
 * roll, or jump while locked on), block, lock. Top right: small sandbox toggles.
 *
 * Same contract as the other devices: poll() once per fixed step returns a DeviceFrame,
 * with taps latched so a press and release between two polls is still seen.
 */
export class TouchControls {
  readonly root: HTMLElement;
  /** True on the poll where the screen was touched. Devices uses it to pick the active device. */
  touched = false;
  onDebug?: (d: TouchDebug) => void;

  private readonly stickBase: HTMLElement;
  private readonly stickKnob: HTMLElement;
  private readonly buttons = new Map<Action, HTMLElement>();
  private stickId: number | null = null;
  private origin = vec2();
  private stick: Vec2 = vec2();
  private lookId: number | null = null;
  private lookLast = vec2();
  private lookX = 0;
  private lookY = 0;
  private readonly held = new Set<Action>();
  private readonly latched = new Set<Action>();
  private targetOn = false;
  private touchedSincePoll = false;
  private isLocked: () => boolean = () => false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'touch');
    this.stickBase = el('div', 'touch-stick');
    this.stickKnob = el('div', 'touch-stick-knob');
    this.stickBase.append(this.stickKnob);
    this.stickBase.hidden = true;
    this.root.append(this.stickBase);

    const cluster = el('div', 'touch-buttons');
    for (const def of BUTTONS) {
      const b = el('button', def.className);
      b.textContent = def.label;
      b.setAttribute('aria-label', def.label);
      this.bindButton(b, def);
      this.buttons.set(def.action, b);
      cluster.append(b);
    }
    const pills = el('div', 'touch-pills');
    for (const [d, label] of PILLS) {
      if (d === 'fullscreen' && !document.fullscreenEnabled) continue; // iPhone Safari: no element fullscreen
      const p = el('button', 'touch-pill');
      p.textContent = label;
      p.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onDebug?.(d);
      });
      pills.append(p);
    }
    this.root.append(cluster, pills);

    // Anything not on a button: the joystick on the left, looking around on the right.
    this.root.addEventListener('pointerdown', (e) => this.down(e));
    this.root.addEventListener('pointermove', (e) => this.move(e));
    for (const type of ['pointerup', 'pointercancel'] as const) this.root.addEventListener(type, (e) => this.up(e));
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    parent.append(this.root);
  }

  /** Locked on or view locked, so the evade button can say what it will do. */
  setLockQuery(isLocked: () => boolean): void {
    this.isLocked = isLocked;
  }

  /** One fixed step's worth of input. `time` is real time. */
  poll(time: number): DeviceFrame {
    // The lock button is a toggle: with nothing in range it holds a view lock until tapped again.
    this.relabelEvade();

    const buttons: Partial<Record<Action, boolean>> = {};
    for (const a of [...this.held, ...this.latched]) buttons[a] = true;
    if (this.targetOn) buttons[Action.Target] = true;
    this.latched.clear();

    this.touched = this.touchedSincePoll;
    this.touchedSincePoll = false;
    return { stick: { ...this.stick }, buttons };
  }

  /** Let go of everything: buttons, stick, look drag. The lock latch stays (it is a toggle). */
  release(): void {
    this.held.clear();
    this.latched.clear();
    this.stick = vec2();
    this.stickId = null;
    this.lookId = null;
    this.lookX = 0;
    this.lookY = 0;
    this.stickBase.hidden = true;
    for (const b of this.buttons.values()) b.classList.remove('touch-btn-down');
  }

  /** Drag-to-look since the last call, radians. Call once per render frame. */
  consumeLook(): LookDelta {
    const d = { yaw: this.lookX * LOOK_SENSITIVITY, pitch: this.lookY * LOOK_SENSITIVITY };
    this.lookX = 0;
    this.lookY = 0;
    return d;
  }

  private bindButton(b: HTMLElement, def: ButtonDef): void {
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      capture(b, e.pointerId); // sliding off the button still releases it
      this.touchedSincePoll = true;
      if (def.toggle) {
        this.setTarget(!this.targetOn);
        return;
      }
      this.held.add(def.action);
      this.latched.add(def.action);
      b.classList.add('touch-btn-down');
    });
    const release = () => {
      if (def.toggle) return;
      this.held.delete(def.action);
      b.classList.remove('touch-btn-down');
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
  }

  /** Evade reads "jump" while locked on, "roll" otherwise. Touches the DOM only on a change. */
  private relabelEvade(): void {
    const b = this.buttons.get(Action.Evade);
    const label = evadeLabel(this.isLocked());
    if (!b || b.textContent === label) return;
    b.textContent = label;
    b.setAttribute('aria-label', label);
  }

  private setTarget(on: boolean): void {
    this.targetOn = on;
    this.buttons.get(Action.Target)?.classList.toggle('touch-btn-on', on);
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    this.touchedSincePoll = true;
    if (zoneAt(e.clientX, window.innerWidth) === 'stick' && this.stickId === null) {
      this.stickId = e.pointerId;
      this.origin = vec2(e.clientX, e.clientY);
      this.stickBase.hidden = false;
      this.stickBase.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookLast = vec2(e.clientX, e.clientY);
    }
    capture(this.root, e.pointerId);
  }

  private move(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      const dx = e.clientX - this.origin.x;
      const dy = e.clientY - this.origin.y;
      this.stick = stickFromDrag(dx, dy);
      const k = knobOffset(dx, dy);
      this.stickKnob.style.transform = `translate(calc(-50% + ${k.x}px), calc(-50% + ${k.y}px))`;
      this.touchedSincePoll = true;
    } else if (e.pointerId === this.lookId) {
      this.lookX += e.clientX - this.lookLast.x;
      this.lookY += e.clientY - this.lookLast.y;
      this.lookLast = vec2(e.clientX, e.clientY);
      this.touchedSincePoll = true;
    }
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.stick = vec2();
      this.stickBase.hidden = true;
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
    }
  }
}

/** Best effort: the pointer may already be gone (a very quick tap), which throws. */
function capture(target: HTMLElement, pointerId: number): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Not captured: the release still arrives on the element in the normal case.
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
