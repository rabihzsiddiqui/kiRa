import { length, scale, vec2, type Vec2 } from '../../core/math';
import { Action } from '../../input/actions';

/*
 * Gamepad layout, pure functions only (no navigator), so it is tested with fake pads.
 * Indices follow the W3C "standard" mapping: https://w3c.github.io/gamepad/#remapping
 * Pads that report no mapping usually still put face buttons at 0 to 3, shoulders at
 * 4 to 7 and sticks at axes 0 to 3, so they are read the same way instead of ignored.
 */

/** The parts of the browser's Gamepad we read. */
export interface PadLike {
  readonly id: string;
  readonly mapping: string;
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: ReadonlyArray<{ readonly pressed: boolean; readonly value: number }>;
}

export type PadFamily = 'xbox' | 'playstation' | 'switch' | 'generic';

export const BUTTON = {
  south: 0, // A / cross / B
  east: 1,
  west: 2, // X / square / Y
  north: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  back: 8,
  start: 9,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const;

const AXIS = { lx: 0, ly: 1, rx: 2, ry: 3 } as const;

/** Physical position -> action. Same positions on every family, so muscle memory carries over. */
const ACTIONS: ReadonlyArray<[number, Action]> = [
  [BUTTON.west, Action.Attack],
  [BUTTON.south, Action.Evade],
  [BUTTON.rb, Action.Block],
  [BUTTON.lt, Action.Target],
];

/** Sandbox debug controls on the pad (keyboard has its own keys). */
export type PadDebug = 'pause' | 'overlay' | 'ai' | 'prevString' | 'nextString' | 'hitAreas';
const DEBUG: ReadonlyArray<[number, PadDebug]> = [
  [BUTTON.start, 'pause'],
  [BUTTON.back, 'overlay'],
  [BUTTON.dpadUp, 'ai'],
  [BUTTON.dpadLeft, 'prevString'],
  [BUTTON.dpadRight, 'nextString'],
  [BUTTON.dpadDown, 'hitAreas'],
];

export const STICK_DEADZONE = 0.15;
export const TRIGGER_THRESHOLD = 0.4;

export function padFamily(id: string): PadFamily {
  if (/054c|dualsense|dualshock|playstation|ps[345]/i.test(id)) return 'playstation';
  if (/057e|pro controller|joy-?con|nintendo/i.test(id)) return 'switch';
  if (/xbox|xinput|045e/i.test(id)) return 'xbox';
  return 'generic';
}

/** Lowercase button names per family, for prompts and the overlay. */
export interface PadLabels {
  attack: string;
  evade: string;
  block: string;
  target: string;
}

export function padLabels(family: PadFamily): PadLabels {
  switch (family) {
    case 'playstation':
      return { attack: '□', evade: '×', block: 'r1', target: 'l2' };
    case 'switch':
      return { attack: 'y', evade: 'b', block: 'r', target: 'zl' };
    default:
      return { attack: 'x', evade: 'a', block: 'rb', target: 'lt' };
  }
}

export interface PadFrame {
  stick: Vec2;
  /** Right stick after deadzone and response curve, -1..1 per axis. y is down. */
  look: Vec2;
  buttons: Partial<Record<Action, boolean>>;
  /** Debug buttons held this poll. */
  debug: Set<PadDebug>;
  /** Anything pressed or pushed past the deadzone: this pad is the active device. */
  active: boolean;
}

export function readPad(pad: PadLike): PadFrame {
  const held = (i: number) => {
    const b = pad.buttons[i];
    return !!b && (b.pressed || b.value > TRIGGER_THRESHOLD);
  };
  const buttons: Partial<Record<Action, boolean>> = {};
  for (const [i, action] of ACTIONS) if (held(i)) buttons[action] = true;
  const debug = new Set<PadDebug>();
  for (const [i, d] of DEBUG) if (held(i)) debug.add(d);

  // Pad Y axes point down; the core's stick y is up/forward.
  const stick = deadzone(vec2(pad.axes[AXIS.lx] ?? 0, -(pad.axes[AXIS.ly] ?? 0)));
  const rawLook = deadzone(vec2(pad.axes[AXIS.rx] ?? 0, pad.axes[AXIS.ry] ?? 0));
  // Squared response: small pushes aim finely, full tilt still turns fast.
  const look = scale(rawLook, length(rawLook));

  const active =
    length(stick) > 0 || length(rawLook) > 0 || pad.buttons.some((b) => b.pressed || b.value > TRIGGER_THRESHOLD);
  return { stick, look, buttons, debug, active };
}

/** Radial deadzone, rescaled so the stick still reaches full length at the rim. */
export function deadzone(v: Vec2): Vec2 {
  const l = length(v);
  if (l < STICK_DEADZONE) return vec2();
  const k = Math.min(1, (l - STICK_DEADZONE) / (1 - STICK_DEADZONE));
  return scale(v, k / l);
}

/** First connected pad, preferring one with the standard mapping. */
export function pickPad(pads: ReadonlyArray<PadLike | null>): PadLike | null {
  let fallback: PadLike | null = null;
  for (const p of pads) {
    if (!p || !p.connected) continue;
    if (p.mapping === 'standard') return p;
    fallback ??= p;
  }
  return fallback;
}
