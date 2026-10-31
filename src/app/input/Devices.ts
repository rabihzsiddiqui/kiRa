import { length } from '../../core/math';
import type { Action, RawInputSample } from '../../input/actions';
import { GamepadInput } from './GamepadInput';
import { KeyboardMouse } from './KeyboardMouse';
import type { LookDelta } from './types';

/**
 * Merges keyboard/mouse and gamepad into one RawInputSample per fixed step.
 * Buttons OR together; the stronger stick wins, so neither device fights the other.
 */
export class Devices {
  readonly keyboard: KeyboardMouse;
  readonly gamepad = new GamepadInput();

  constructor(canvas: HTMLCanvasElement) {
    this.keyboard = new KeyboardMouse(canvas);
  }

  /** `time` is REAL time. Never pass a scaled clock to the input buffer. */
  poll(time: number): RawInputSample {
    const kb = this.keyboard.poll();
    const pad = this.gamepad.poll();
    const buttons: Partial<Record<Action, boolean>> = { ...kb.buttons };
    for (const [action, down] of Object.entries(pad.buttons) as Array<[Action, boolean]>) {
      if (down) buttons[action] = true;
    }
    const stick = length(pad.stick) > length(kb.stick) ? pad.stick : kb.stick;
    return { time, stick, buttons };
  }

  /** Camera look for this render frame (real time). */
  look(realDt: number): LookDelta {
    const m = this.keyboard.consumeLook();
    const p = this.gamepad.look(realDt);
    return { yaw: m.yaw + p.yaw, pitch: m.pitch + p.pitch };
  }

  dispose(): void {
    this.keyboard.dispose();
  }
}
