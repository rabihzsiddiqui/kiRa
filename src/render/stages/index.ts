import type { StageId } from '../../app/stages';
import { buildGroundsDay, buildGroundsDusk } from './groundsStage';
import type { StageBuilder } from './Stage';
import { buildVoidStage } from './voidStage';

export type { BuiltStage, StageBuilder, StageOptions } from './Stage';
export { faceLighting } from './faceLight';

/** One builder per stage in src/app/stages.ts. */
export const STAGE_BUILDERS: Readonly<Record<StageId, StageBuilder>> = {
  grounds: buildGroundsDay,
  dusk: buildGroundsDusk,
  void: buildVoidStage,
};
