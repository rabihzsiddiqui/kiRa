import type { EnemyAttackDef } from '../combat/Enemy';

/**
 * Enemy attack strings as data. Times are WORLD seconds, so slow-mo stretches them.
 *
 *   |---- windup ----|-- active --|-- recovery --|  next step ...
 *   ^ telegraph (glint, or red glow if unblockable)
 */
export interface StringStep {
  attack: EnemyAttackDef;
  /** Telegraph to hitbox open. The window the player reads and reacts to. */
  windup: number;
  /** Hitbox live. */
  active: number;
  /** After the hitbox closes, before the next step (or the end of the string). */
  recovery: number;
  /** Weapon glint at windup start. Follow-ups in a fast combo usually skip it. */
  telegraph: boolean;
}

export interface AttackString {
  id: string;
  label: string;
  steps: StringStep[];
}

const SLASH_ARC = { kind: 'arc', range: 2.5, arcDeg: 120 } as const;

export const DUMMY_STRINGS: readonly AttackString[] = [
  {
    id: 'single',
    label: 'single slash',
    steps: [
      {
        attack: { id: 'single_slash', damage: 1, hit: SLASH_ARC },
        windup: 0.6, active: 0.1, recovery: 0.6, telegraph: true,
      },
    ],
  },
  {
    // Hits land 0.25 s apart, inside the PerfectBlock state, so one well-timed block
    // can chain all three (PerfectBlockState stays perfect for the next hit).
    id: 'combo3',
    label: '3-hit combo',
    steps: [
      {
        attack: { id: 'combo_1', damage: 1, hit: SLASH_ARC },
        windup: 0.55, active: 0.08, recovery: 0, telegraph: true,
      },
      {
        attack: { id: 'combo_2', damage: 1, hit: SLASH_ARC },
        windup: 0.17, active: 0.08, recovery: 0, telegraph: false,
      },
      {
        attack: { id: 'combo_3', damage: 1.5, hit: SLASH_ARC },
        windup: 0.17, active: 0.1, recovery: 0.7, telegraph: false,
      },
    ],
  },
  {
    // Glint, then a long hold: punishes panic blocks and rolls.
    id: 'delayed',
    label: 'delayed overhead',
    steps: [
      {
        attack: { id: 'delayed_overhead', damage: 2, hit: { kind: 'arc', range: 2.6, arcDeg: 50 } },
        windup: 1.25, active: 0.1, recovery: 0.8, telegraph: true,
      },
    ],
  },
  {
    // Can't be blocked. Perfect dodge it (or get out of the line).
    id: 'unblockable',
    label: 'unblockable thrust',
    steps: [
      {
        attack: { id: 'unblockable_thrust', damage: 2, hit: { kind: 'line', range: 3.4, width: 0.6 }, unblockable: true },
        windup: 0.8, active: 0.12, recovery: 0.9, telegraph: true,
      },
    ],
  },
];
