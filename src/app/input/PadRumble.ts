import { AttackId } from '../../combat/moves';
import type { FxCue, FxCueData, FxSink } from '../../feel/CombatFeel';
import type { Devices } from './Devices';

/**
 * Controller haptics, driven by the same cues as the VFX and audio. Only rumbles while
 * the pad is the active device, so a pad left plugged in stays quiet.
 */
export class PadRumble implements FxSink {
  constructor(private readonly devices: Devices) {}

  cue(name: FxCue, data: FxCueData): void {
    if (this.devices.active !== 'gamepad') return;
    const pad = this.devices.gamepad;
    switch (name) {
      case 'perfectDodge':
        pad.rumble(0.2, 0.6, 120); // light and quick: she slipped past it
        break;
      case 'perfectBlock':
        pad.rumble(Math.min(1, 0.7 + 0.1 * (data.chain ?? 0)), 0.4, 90); // a hard clash, harder each chain
        break;
      case 'guard.impact':
        pad.rumble(0.35, 0.2, 60);
        break;
      case 'player.hurt':
        pad.rumble(0.8, 0.3, 200);
        break;
      case 'hit':
        if (data.attack === AttackId.PhantomDash || data.attack === AttackId.Overpower) pad.rumble(1, 0.6, 160);
        else pad.rumble(data.broke ? 0.6 : 0, data.broke ? 0.5 : 0.35, data.broke ? 120 : 40);
        break;
      default:
        break;
    }
  }
}
