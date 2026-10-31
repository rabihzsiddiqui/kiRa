import { length, scale, vec2, type Vec2 } from '../../core/math';
import { Action } from '../../input/actions';
import type { DeviceFrame, LookDelta } from './types';

/** "standard" mapping indices: https://w3c.github.io/gamepad/#remapping */
const BUTTON = { A: 0, X: 2, RB: 5, LT: 6 } as const;
const AXIS = { LX: 0, LY: 1, RX: 2, RY: 3 } as const;

const BINDINGS: ReadonlyArray<[number, Action]> = [
  [BUTTON.X, Action.Attack],
  [BUTTON.A, Action.Evade],
  [BUTTON.RB, Action.Block],
  [BUTTON.LT, Action.Target],
];

const STICK_DEADZONE = 0.15;
const TRIGGER_THRESHOLD = 0.4;
const LOOK_SPEED = 2.8; // radians per second at full tilt

/**
 * Gamepad API. Polled, not event driven, so no tap latch is needed: anything held
 * across a poll is seen. Uses the first pad with the standard mapping.
 */
export class GamepadInput {
  name: string | null = null;

  poll(): DeviceFrame {
    const pad = this.pad();
    if (!pad) return { stick: vec2(), buttons: {} };

    const buttons: Partial<Record<Action, boolean>> = {};
    for (const [index, action] of BINDINGS) {
      const b = pad.buttons[index];
      if (b && (b.pressed || b.value > TRIGGER_THRESHOLD)) buttons[action] = true;
    }
    // Pad Y axes point down; the core's stick y is up/forward.
    return { stick: deadzone(vec2(pad.axes[AXIS.LX] ?? 0, -(pad.axes[AXIS.LY] ?? 0))), buttons };
  }

  /** Right stick look for this render frame. */
  look(realDt: number): LookDelta {
    const pad = this.pad();
    if (!pad) return { yaw: 0, pitch: 0 };
    const r = deadzone(vec2(pad.axes[AXIS.RX] ?? 0, pad.axes[AXIS.RY] ?? 0));
    return { yaw: r.x * LOOK_SPEED * realDt, pitch: r.y * LOOK_SPEED * realDt };
  }

  private pad(): Gamepad | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (p && p.connected && p.mapping === 'standard') {
        this.name = p.id;
        return p;
      }
    }
    this.name = null;
    return null;
  }
}

/** Radial deadzone, rescaled so the stick still reaches full length at the rim. */
function deadzone(v: Vec2): Vec2 {
  const l = length(v);
  if (l < STICK_DEADZONE) return vec2();
  const k = Math.min(1, (l - STICK_DEADZONE) / (1 - STICK_DEADZONE));
  return scale(v, k / l);
}
