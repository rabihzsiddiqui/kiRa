import { length } from '../../core/math';
import type { Action, RawInputSample } from '../../input/actions';
import { GamepadInput } from './GamepadInput';
import { KeyboardMouse } from './KeyboardMouse';
import { TouchControls } from './TouchControls';
import { wantsTouchControls } from './touchLayout';
import type { LookDelta } from './types';

export type DeviceKind = 'keyboard' | 'gamepad' | 'touch';

/**
 * Merges keyboard/mouse, gamepad and (on phones and tablets) touch controls into one
 * RawInputSample per fixed step.
 * Buttons OR together; the stronger stick wins, so neither device fights the other.
 * `active` is whichever was used last, so prompts show the right buttons.
 */
export class Devices {
  readonly keyboard: KeyboardMouse;
  readonly gamepad = new GamepadInput();
  /** On-screen controls, only on touch-first devices. */
  readonly touch: TouchControls | null;
  active: DeviceKind = 'keyboard';

  constructor(canvas: HTMLCanvasElement) {
    this.keyboard = new KeyboardMouse(canvas);
    const touchFirst = wantsTouchControls({
      coarsePointer: window.matchMedia('(pointer: coarse)').matches,
      maxTouchPoints: navigator.maxTouchPoints,
    });
    this.touch = touchFirst ? new TouchControls(document.body) : null;
    if (this.touch) this.active = 'touch';
  }

  /** `time` is REAL time. Never pass a scaled clock to the input buffer. */
  poll(time: number): RawInputSample {
    const kb = this.keyboard.poll();
    const pad = this.gamepad.poll();
    const touch = this.touch?.poll(time);
    if (this.gamepad.touched) this.active = 'gamepad';
    else if (this.touch?.touched) this.active = 'touch';
    else if (this.keyboard.consumeTouched()) this.active = 'keyboard';
    const buttons: Partial<Record<Action, boolean>> = { ...kb.buttons };
    let stick = kb.stick;
    for (const frame of [pad, touch]) {
      if (!frame) continue;
      for (const [action, down] of Object.entries(frame.buttons) as Array<[Action, boolean]>) {
        if (down) buttons[action] = true;
      }
      if (length(frame.stick) > length(stick)) stick = frame.stick;
    }
    return { time, stick, buttons };
  }

  /** Camera look for this render frame (real time). */
  look(realDt: number): LookDelta {
    const m = this.keyboard.consumeLook();
    const p = this.gamepad.look(realDt);
    const t = this.touch?.consumeLook() ?? { yaw: 0, pitch: 0 };
    return { yaw: m.yaw + p.yaw + t.yaw, pitch: m.pitch + p.pitch + t.pitch };
  }

  /** Drop held keys and taps on every device (a menu opened or closed). */
  release(): void {
    this.keyboard.release();
    this.touch?.release();
  }

  dispose(): void {
    this.keyboard.dispose();
    this.gamepad.dispose();
  }
}
