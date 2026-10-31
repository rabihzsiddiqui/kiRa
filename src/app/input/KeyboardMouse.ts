import { normalize, vec2, type Vec2 } from '../../core/math';
import { Action } from '../../input/actions';
import type { DeviceFrame, LookDelta } from './types';

/** Physical input -> logical actions. Sources are KeyboardEvent.code or "Mouse<button>". */
const BINDINGS: Readonly<Record<string, readonly Action[]>> = {
  KeyJ: [Action.Attack],
  Space: [Action.Evade],
  KeyK: [Action.Block],
  ShiftLeft: [Action.Target],
  ShiftRight: [Action.Target],
  Mouse2: [Action.Target],
};

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
const MOUSE_SENSITIVITY = 0.0025; // radians per pixel

/**
 * Keyboard + mouse. Events arrive whenever the browser likes, but the sim polls once per
 * fixed step, so a key pressed and released between two polls is latched as "down" for
 * one poll. Without that, quick taps vanish.
 */
export class KeyboardMouse {
  private readonly down = new Set<string>();
  private readonly latched = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private readonly off: Array<() => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.listen(window, 'keydown', (e) => {
      if (!(e.code in BINDINGS) && !MOVE_KEYS.has(e.code)) return;
      e.preventDefault(); // Space would scroll, Shift could trigger browser shortcuts
      this.press(e.code);
    });
    this.listen(window, 'keyup', (e) => this.down.delete(e.code));
    this.listen(canvas, 'mousedown', (e) => {
      if (!this.pointerLocked) return; // the first click only captures the mouse
      this.press(`Mouse${e.button}`);
    });
    this.listen(window, 'mouseup', (e) => this.down.delete(`Mouse${e.button}`));
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
    this.listen(canvas, 'click', () => {
      if (!this.pointerLocked) void canvas.requestPointerLock();
    });
    this.listen(window, 'mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    // Releasing keys while the tab is in the background never fires keyup.
    this.listen(window, 'blur', () => this.down.clear());
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** One fixed step's worth of input. Clears the tap latch. */
  poll(): DeviceFrame {
    const held = (src: string) => this.down.has(src) || this.latched.has(src);
    const buttons: Partial<Record<Action, boolean>> = {};
    for (const [src, actions] of Object.entries(BINDINGS)) {
      if (held(src)) for (const action of actions) buttons[action] = true;
    }

    const x = (held('KeyD') ? 1 : 0) - (held('KeyA') ? 1 : 0);
    const y = (held('KeyW') ? 1 : 0) - (held('KeyS') ? 1 : 0);
    const stick: Vec2 = x || y ? normalize(vec2(x, y)) : vec2();

    this.latched.clear();
    return { stick, buttons };
  }

  /** Mouse movement since the last call, in radians. Call once per render frame. */
  consumeLook(): LookDelta {
    const d = { yaw: this.lookX * MOUSE_SENSITIVITY, pitch: this.lookY * MOUSE_SENSITIVITY };
    this.lookX = 0;
    this.lookY = 0;
    return d;
  }

  dispose(): void {
    for (const f of this.off) f();
  }

  private press(src: string): void {
    this.down.add(src);
    this.latched.add(src);
  }

  private listen<K extends keyof WindowEventMap>(
    target: Window | HTMLElement,
    type: K,
    fn: (e: WindowEventMap[K]) => void,
  ): void {
    const handler = fn as EventListener;
    target.addEventListener(type, handler);
    this.off.push(() => target.removeEventListener(type, handler));
  }
}
