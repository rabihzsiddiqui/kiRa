import type { Vec2 } from '../../core/math';
import type { Action } from '../../input/actions';

/** What one device contributes to a fixed step. Devices merge into a RawInputSample. */
export interface DeviceFrame {
  stick: Vec2;
  buttons: Partial<Record<Action, boolean>>;
}

/** Camera look, radians. Positive yaw turns right, positive pitch looks down. */
export interface LookDelta {
  yaw: number;
  pitch: number;
}
