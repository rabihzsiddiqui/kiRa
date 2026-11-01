import { vec2 } from '../../core/math';
import { padFamily, padLabels, pickPad, readPad, type PadDebug, type PadFamily, type PadLabels, type PadMenu } from './padLayout';
import type { DeviceFrame, LookDelta } from './types';

const LOOK_SPEED = 2.8; // radians per second at full tilt

export interface PadConnection {
  connected: boolean;
  name: string;
  family: PadFamily;
}

/**
 * Gamepad API. Polled, not event driven, so no tap latch is needed: anything held across
 * a poll is seen. Reads the first connected pad (standard mapping preferred), so pads
 * that report no mapping still work. Layout logic lives in padLayout.ts (tested).
 */
export class GamepadInput {
  name: string | null = null;
  family: PadFamily = 'generic';
  /** True on the poll where the pad was touched (stick or button). Devices uses it to pick the active device. */
  touched = false;
  onDebug?: (d: PadDebug) => void;
  /** Options menu presses, fired once per press. */
  onMenu?: (m: PadMenu) => void;
  onConnection?: (c: PadConnection) => void;

  private prevDebug = new Set<PadDebug>();
  private prevMenu = new Set<PadMenu>();
  private readonly off: Array<() => void> = [];

  constructor() {
    const listen = (type: 'gamepadconnected' | 'gamepaddisconnected', connected: boolean) => {
      const fn = (e: GamepadEvent) =>
        this.onConnection?.({ connected, name: e.gamepad.id, family: padFamily(e.gamepad.id) });
      window.addEventListener(type, fn);
      this.off.push(() => window.removeEventListener(type, fn));
    };
    listen('gamepadconnected', true);
    listen('gamepaddisconnected', false);
  }

  get labels(): PadLabels {
    return padLabels(this.family);
  }

  /** One fixed step's worth of input. */
  poll(): DeviceFrame {
    const pad = this.pad();
    if (!pad) {
      this.touched = false;
      return { stick: vec2(), buttons: {} };
    }
    const f = readPad(pad);
    this.touched = f.active;
    return { stick: f.stick, buttons: f.buttons };
  }

  /** Right stick look for this render frame. Also fires debug and menu button presses. */
  look(realDt: number): LookDelta {
    const pad = this.pad();
    if (!pad) return { yaw: 0, pitch: 0 };
    const f = readPad(pad);
    for (const d of f.debug) if (!this.prevDebug.has(d)) this.onDebug?.(d);
    this.prevDebug = f.debug;
    for (const m of f.menu) if (!this.prevMenu.has(m)) this.onMenu?.(m);
    this.prevMenu = f.menu;
    return { yaw: f.look.x * LOOK_SPEED * realDt, pitch: f.look.y * LOOK_SPEED * realDt };
  }

  /** Haptics, where the browser and pad support it. Magnitudes 0..1. */
  rumble(strong: number, weak: number, ms: number): void {
    const pad = this.pad() as Gamepad | null;
    const actuator = pad?.vibrationActuator;
    if (!actuator || typeof actuator.playEffect !== 'function') return;
    actuator
      .playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak })
      .catch(() => {}); // unsupported effect: no rumble, no error
  }

  dispose(): void {
    for (const f of this.off) f();
  }

  private pad(): Gamepad | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = pickPad(pads) as Gamepad | null;
    this.name = pad?.id ?? null;
    if (pad) this.family = padFamily(pad.id);
    return pad;
  }
}
