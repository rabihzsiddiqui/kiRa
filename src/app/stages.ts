/*
 * The stage list, as plain data (no DOM, no three.js), so the options menu and the tests
 * share it. A stage only changes how the arena looks: the layout in arena.ts (walls,
 * pillars, dummy) is the same on every stage, so collisions and gameplay never change.
 */

export type StageId = 'grounds' | 'dusk' | 'void';

export interface StageInfo {
  id: StageId;
  label: string;
  blurb: string;
  /** CSS background for the menu's preview swatch. */
  swatch: string;
}

export const STAGES: readonly StageInfo[] = [
  {
    id: 'grounds',
    label: 'training grounds',
    blurb: 'daytime, stone pillars, a scarecrow that hits back.',
    swatch: 'linear-gradient(180deg, #5b9be0 0%, #cfe3f2 55%, #6f9a45 56%, #c9a978 100%)',
  },
  {
    id: 'dusk',
    label: 'grounds at dusk',
    blurb: 'same yard. the sun is clocking out.',
    swatch: 'linear-gradient(180deg, #3b3a78 0%, #f0a070 55%, #4d5a32 56%, #a77f5c 100%)',
  },
  {
    id: 'void',
    label: 'the void',
    blurb: 'the original dark arena. good for judging effects.',
    swatch: 'linear-gradient(180deg, #09090b 0%, #18181b 55%, #312e81 56%, #18181b 100%)',
  },
];

export const DEFAULT_STAGE: StageId = 'grounds';

/** Where the choice is remembered between visits. */
export const STAGE_STORAGE_KEY = 'kira.stage';

export function parseStage(value: string | null | undefined): StageId | null {
  return STAGES.find((s) => s.id === value)?.id ?? null;
}

/** `?stage=` wins (handy for links and screenshots), then the saved choice, then the default. */
export function initialStage(search: string, stored: string | null): StageId {
  return parseStage(new URLSearchParams(search).get('stage')) ?? parseStage(stored) ?? DEFAULT_STAGE;
}

export function stageInfo(id: StageId): StageInfo {
  const info = STAGES.find((s) => s.id === id);
  if (!info) throw new Error(`unknown stage ${id}`);
  return info;
}
