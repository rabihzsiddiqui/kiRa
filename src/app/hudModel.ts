import { PlayerStateId } from '../player/contracts';
import type { EnemyStatus } from '../combat/Enemy';
import { evadeLabel } from './input/touchLayout';
import type { DeviceKind } from './input/Devices';
import type { PadLabels } from './input/padLayout';

/*
 * What the player HUD says, as pure functions (no DOM), so the tests drive it with a
 * HeadlessSandbox. The Hud class only paints these.
 */

/** The bits of game state the button prompts depend on. */
export interface PromptReadout {
  state: PlayerStateId;
  locked: boolean;
  viewLocked: boolean;
  targetNearby: boolean;
  /** 0..1 while charging a spin, null otherwise. */
  spinCharge: number | null;
}

export type PromptAction = 'attack' | 'evade' | 'block' | 'target';

export interface Prompt {
  action: PromptAction;
  /** What the button does right now. */
  verb: string;
  /** Lit up: a counter is open or a spin is ready to let go. */
  hot: boolean;
}

/**
 * Zelda style context prompts: each button says what it will do this moment.
 * Evade reads jump when locked (same rule as the touch button), attack reads the
 * counter during a perfect state, and spin while charging.
 */
export function actionPrompts(r: PromptReadout): Prompt[] {
  let attack = 'attack';
  let hot = false;
  if (r.state === PlayerStateId.PerfectDodge) [attack, hot] = ['phantom dash', true];
  else if (r.state === PlayerStateId.PerfectBlock) [attack, hot] = ['overpower', true];
  else if (r.spinCharge !== null) [attack, hot] = r.spinCharge >= 1 ? ['let go: spin', true] : ['charging', false];

  const lockedOn = r.locked || r.viewLocked;
  const target = lockedOn ? 'release' : r.targetNearby ? 'lock on' : 'center view';
  return [
    { action: 'attack', verb: attack, hot },
    { action: 'evade', verb: evadeLabel(lockedOn), hot: false },
    { action: 'block', verb: 'guard', hot: false },
    { action: 'target', verb: target, hot: false },
  ];
}

/** Button name per action on the device in use. Touch has its own on-screen buttons. */
export function promptKeys(kind: DeviceKind, pad: PadLabels): Record<PromptAction, string> {
  if (kind === 'gamepad') return { attack: pad.attack, evade: pad.evade, block: pad.block, target: pad.target };
  return { attack: 'j', evade: 'space', block: 'k', target: 'shift' };
}

/** Word under the target's name. Ready says nothing: there is nothing to act on. */
export function targetStatus(status: EnemyStatus): string {
  return status === 'ready' ? '' : status === 'staggered' ? 'posture broken' : status;
}

export type ControlRows = ReadonlyArray<readonly [string, string]>;

const KEYBOARD_CONTROLS: ControlRows = [
  ['move', 'wasd'],
  ['look', 'mouse'],
  ['attack', 'j'],
  ['spin', 'hold j, let go'],
  ['evade', 'space'],
  ['block', 'k'],
  ['target', 'shift, right mouse'],
  ['jump atk', 'evade while locked on'],
  ['roll atk', 'j during a roll'],
  ['dummy ai', 'h on / off'],
  ['strings', '1 to 4, 0 cycles'],
  ['pause sim', 'p'],
  ['options', 'o or esc'],
  ['mute', 'm'],
  ['controls', 'c'],
  ['debug', 'tab'],
];

const TOUCH_CONTROLS: ControlRows = [
  ['move', 'left thumb'],
  ['look', 'drag on the right'],
  ['attack', 'atk'],
  ['spin', 'hold atk, let go'],
  ['evade', 'roll'],
  ['block', 'block, hold'],
  ['target', 'lock, tap'],
  ['jump atk', 'jump (roll, while locked on)'],
  ['roll atk', 'atk during a roll'],
  ['dummy ai', 'ai pill'],
  ['pause sim', 'pause pill'],
  ['options', 'options pill'],
  ['debug', 'debug pill'],
];

const padControls = (l: PadLabels): ControlRows => [
  ['move', 'left stick'],
  ['look', 'right stick'],
  ['attack', l.attack],
  ['spin', `hold ${l.attack}, let go`],
  ['evade', l.evade],
  ['block', l.block],
  ['target', l.target],
  ['jump atk', 'evade while locked on'],
  ['roll atk', 'attack during a roll'],
  ['dummy ai', 'd-pad up'],
  ['strings', 'd-pad left / right'],
  ['options', 'start (pauses)'],
  ['debug', 'back'],
];

/** Full controls list for the device in use, in its own button names. */
export function controlsFor(kind: DeviceKind, pad: PadLabels): ControlRows {
  return kind === 'gamepad' ? padControls(pad) : kind === 'touch' ? TOUCH_CONTROLS : KEYBOARD_CONTROLS;
}
