import type { FxCue, FxSink } from '../feel/CombatFeel';

/**
 * Stand-in until Phase 5 (ThreeFx): records cues so the debug overlay can show them.
 */
export class LogFxSink implements FxSink {
  readonly recent: Array<{ cue: FxCue; at: number }> = [];

  constructor(private readonly now: () => number) {}

  cue(name: FxCue): void {
    this.recent.unshift({ cue: name, at: this.now() });
    if (this.recent.length > 6) this.recent.pop();
  }
}
