/**
 * Data-driven move definitions. Designers tune feel here without touching state logic.
 * All times are seconds from the start of the move (60 fps: 1 frame = 0.0167 s).
 */

export enum AttackId {
  Horizontal = 'horizontal',
  /** Sweeps left to right (Horizontal sweeps right to left). */
  ReverseHorizontal = 'reverse_horizontal',
  /** "/" diagonal: from over her right shoulder down to her left hip. */
  Vertical = 'vertical',
  /** "\" diagonal: from over her left shoulder down to her right hip. */
  VerticalLeft = 'vertical_left',
  /** Stab from her right hip. */
  Thrust = 'thrust',
  /** Second stab, drawn back across her left side. */
  ThrustLeft = 'thrust_left',
  Spin = 'spin',
  JumpAttack = 'jump_attack',
  /** Perfect dodge counter: a blur-fast dash slash into the attacker. */
  PhantomDash = 'phantom_dash',
  /** Perfect block counter: heavy two-handed strike that breaks posture. */
  Overpower = 'overpower',

  // Combo enders: the 4th hit of a combo, picked by the input of that 4th press.
  /** Horizontal input: a full-turn spinning cut. */
  FinisherSpin = 'finisher_spin',
  /** Right input: rising diagonal cut with a hop. */
  FinisherRising = 'finisher_rising',
  /** Vertical input: leaping two-handed overhead cleave. */
  FinisherCleave = 'finisher_cleave',
  /** Thrust input: long driving lunge. */
  FinisherLunge = 'finisher_lunge',
}

/** Which side of her body the blade finishes on. The next swing in a combo starts there. */
export type Side = 'left' | 'right';

export enum EvadeId {
  Roll = 'roll',
  SideHopLeft = 'side_hop_left',
  SideHopRight = 'side_hop_right',
  Backflip = 'backflip',
}

export type HitShape =
  | { kind: 'arc'; range: number; arcDeg: number } // sweeping slash, centered on facing
  | { kind: 'line'; range: number; width: number }; // thrust

export interface AttackDef {
  id: AttackId;
  anim: string;
  damage: number;
  startup: number; // wind-up, no hitbox
  active: number; // hitbox live
  recovery: number; // follow-through
  /** Earliest time a buffered Attack can chain into the next combo hit. */
  comboOpen: number;
  /** Earliest time Evade can cancel the move. */
  evadeCancel: number;
  /** Earliest time Block can cancel the move. */
  blockCancel: number;
  /** Forward speed during startup + active (m/s). Gives slashes weight. */
  lunge: number;
  /** Turn rate toward the locked target during startup (rad/s). Soft aim assist. */
  tracking: number;
  /** Where the blade ends up. A combo's next swing flows from this side (see COMBO). */
  endSide: Side;
  /** If Attack is still held when this move ends, go into spin charge. */
  chargeable: boolean;
  /**
   * Leap toward the target (jump attack) or dash (upSpeed 0). Homes in on the target every
   * frame at a steady speed, never covering more than maxDistance in total or getting
   * closer than stopShort. travelTime defaults to startup + active; for a jump, match it
   * to the airtime (2 * upSpeed / gravity) so she doesn't stop dead in mid-air.
   */
  leap?: { upSpeed: number; maxDistance: number; stopShort: number; travelTime?: number };
  /** Invulnerable for the whole move (counter attacks). */
  invulnerable?: boolean;
  /** Damage to the enemy's posture/balance meter. Full meter = stagger. */
  poiseDamage: number;
  hit: HitShape;
}

export const ATTACKS: Readonly<Record<AttackId, AttackDef>> = {
  [AttackId.Horizontal]: {
    id: AttackId.Horizontal, anim: 'atk_horizontal', damage: 1,
    startup: 0.1, active: 0.1, recovery: 0.25,
    comboOpen: 0.15, evadeCancel: 0.22, blockCancel: 0.25,
    lunge: 2.5, tracking: 10, endSide: 'left', chargeable: true,
    poiseDamage: 10,
    hit: { kind: 'arc', range: 2.0, arcDeg: 140 },
  },
  [AttackId.ReverseHorizontal]: {
    id: AttackId.ReverseHorizontal, anim: 'atk_reverse_horizontal', damage: 1,
    startup: 0.1, active: 0.1, recovery: 0.25,
    comboOpen: 0.15, evadeCancel: 0.22, blockCancel: 0.25,
    lunge: 2.5, tracking: 10, endSide: 'right', chargeable: true,
    poiseDamage: 10,
    hit: { kind: 'arc', range: 2.0, arcDeg: 140 },
  },
  [AttackId.Vertical]: {
    id: AttackId.Vertical, anim: 'atk_vertical', damage: 1.5,
    startup: 0.14, active: 0.08, recovery: 0.3,
    comboOpen: 0.2, evadeCancel: 0.28, blockCancel: 0.3,
    lunge: 2, tracking: 12, endSide: 'left', chargeable: true,
    poiseDamage: 15,
    hit: { kind: 'arc', range: 2.2, arcDeg: 60 },
  },
  [AttackId.VerticalLeft]: {
    id: AttackId.VerticalLeft, anim: 'atk_vertical_left', damage: 1.5,
    startup: 0.14, active: 0.08, recovery: 0.3,
    comboOpen: 0.2, evadeCancel: 0.28, blockCancel: 0.3,
    lunge: 2, tracking: 12, endSide: 'right', chargeable: true,
    poiseDamage: 15,
    hit: { kind: 'arc', range: 2.2, arcDeg: 60 },
  },
  [AttackId.Thrust]: {
    id: AttackId.Thrust, anim: 'atk_thrust', damage: 1.5,
    startup: 0.12, active: 0.08, recovery: 0.3,
    comboOpen: 0.2, evadeCancel: 0.28, blockCancel: 0.3,
    lunge: 5, tracking: 14, endSide: 'left', chargeable: true,
    poiseDamage: 15,
    hit: { kind: 'line', range: 2.6, width: 0.4 },
  },
  [AttackId.ThrustLeft]: {
    id: AttackId.ThrustLeft, anim: 'atk_thrust_left', damage: 1.5,
    startup: 0.12, active: 0.08, recovery: 0.3,
    comboOpen: 0.2, evadeCancel: 0.28, blockCancel: 0.3,
    lunge: 5, tracking: 14, endSide: 'right', chargeable: true,
    poiseDamage: 15,
    hit: { kind: 'line', range: 2.6, width: 0.4 },
  },
  [AttackId.Spin]: {
    id: AttackId.Spin, anim: 'atk_spin', damage: 2,
    startup: 0.08, active: 0.35, recovery: 0.35,
    comboOpen: Infinity, evadeCancel: 0.6, blockCancel: 0.6,
    lunge: 1, tracking: 0, endSide: 'right', chargeable: false,
    poiseDamage: 25,
    hit: { kind: 'arc', range: 2.4, arcDeg: 360 },
  },
  [AttackId.JumpAttack]: {
    id: AttackId.JumpAttack, anim: 'atk_jump', damage: 2,
    startup: 0.3, active: 0.12, recovery: 0.35,
    comboOpen: 0.55, evadeCancel: 0.6, blockCancel: 0.6,
    lunge: 0, tracking: 20, endSide: 'right', chargeable: false,
    // 0.5 s in the air at g = 20, travelling the whole time. Capped at 4 m so a far
    // target gets a natural hop that lands short instead of a 14 m/s launch.
    leap: { upSpeed: 5, maxDistance: 4, stopShort: 1.2, travelTime: 0.5 },
    poiseDamage: 20,
    hit: { kind: 'arc', range: 2.2, arcDeg: 60 },
  },
  [AttackId.PhantomDash]: {
    id: AttackId.PhantomDash, anim: 'atk_phantom_dash', damage: 4,
    startup: 0.1, active: 0.14, recovery: 0.3,
    comboOpen: 0.38, evadeCancel: 0.34, blockCancel: 0.4,
    lunge: 0, tracking: 0, endSide: 'left', chargeable: false, invulnerable: true,
    leap: { upSpeed: 0, maxDistance: 9, stopShort: 0.9 },
    poiseDamage: 35,
    hit: { kind: 'arc', range: 2.4, arcDeg: 180 },
  },
  [AttackId.Overpower]: {
    id: AttackId.Overpower, anim: 'atk_overpower', damage: 5,
    startup: 0.12, active: 0.1, recovery: 0.4,
    comboOpen: 0.45, evadeCancel: 0.4, blockCancel: 0.45,
    lunge: 4, tracking: 30, endSide: 'right', chargeable: false, invulnerable: true,
    poiseDamage: 60,
    hit: { kind: 'arc', range: 2.3, arcDeg: 90 },
  },

  // ---- combo enders. Heavier, slower to recover, and they end the combo.
  [AttackId.FinisherSpin]: {
    id: AttackId.FinisherSpin, anim: 'atk_finisher_spin', damage: 2.5,
    startup: 0.12, active: 0.22, recovery: 0.4,
    comboOpen: Infinity, evadeCancel: 0.5, blockCancel: 0.55,
    lunge: 3, tracking: 10, endSide: 'left', chargeable: false,
    poiseDamage: 30,
    hit: { kind: 'arc', range: 2.3, arcDeg: 360 },
  },
  [AttackId.FinisherRising]: {
    id: AttackId.FinisherRising, anim: 'atk_finisher_rising', damage: 2.5,
    startup: 0.14, active: 0.1, recovery: 0.42,
    comboOpen: Infinity, evadeCancel: 0.48, blockCancel: 0.55,
    lunge: 0, tracking: 14, endSide: 'right', chargeable: false,
    // A short hop that carries the cut up and through. Airtime 0.35 s at g = 20.
    leap: { upSpeed: 3.5, maxDistance: 1.6, stopShort: 1.0, travelTime: 0.35 },
    poiseDamage: 30,
    hit: { kind: 'arc', range: 2.2, arcDeg: 100 },
  },
  [AttackId.FinisherCleave]: {
    id: AttackId.FinisherCleave, anim: 'atk_finisher_cleave', damage: 3,
    startup: 0.3, active: 0.1, recovery: 0.42,
    comboOpen: Infinity, evadeCancel: 0.55, blockCancel: 0.6,
    lunge: 0, tracking: 16, endSide: 'right', chargeable: false,
    // Leaps in and lands on the cut. Airtime 0.4 s at g = 20.
    leap: { upSpeed: 4, maxDistance: 2.5, stopShort: 1.1, travelTime: 0.4 },
    poiseDamage: 35,
    hit: { kind: 'arc', range: 2.4, arcDeg: 60 },
  },
  [AttackId.FinisherLunge]: {
    id: AttackId.FinisherLunge, anim: 'atk_finisher_lunge', damage: 3,
    startup: 0.16, active: 0.12, recovery: 0.42,
    comboOpen: Infinity, evadeCancel: 0.5, blockCancel: 0.55,
    lunge: 9, tracking: 16, endSide: 'right', chargeable: false,
    poiseDamage: 35,
    hit: { kind: 'line', range: 3.2, width: 0.5 },
  },
};

export const attackDuration = (d: AttackDef): number => d.startup + d.active + d.recovery;

/**
 * The input families of the attack table. IntentResolver maps stick + lock state to a
 * family; COMBO maps the family to the actual swing.
 */
export enum SwingFamily {
  Horizontal = 'horizontal',
  /** Right + Attack: the side slash that travels toward her right. */
  Reverse = 'reverse',
  Vertical = 'vertical',
  Thrust = 'thrust',
}

export interface ComboFamily {
  /** First swing of a combo. */
  opener: AttackId;
  /** Later swings, picked by where the previous one left the blade, so each cut flows into the next. */
  from: Readonly<Record<Side, AttackId>>;
  /** The combo ender: last hit of a full combo (PlayerTuning.maxCombo). */
  finisher: AttackId;
}

/**
 * Combo table. Repeating an input does not repeat the same swing: each one comes back
 * from where the last left off. Vertical goes /, \, /, then the ender. Mixed inputs flow
 * the same way (a forehand that ends on her left leads into a \ from the left shoulder).
 * The 4th hit is always the ender for whatever input made it.
 */
export const COMBO: Readonly<Record<SwingFamily, ComboFamily>> = {
  [SwingFamily.Horizontal]: {
    opener: AttackId.Horizontal,
    from: { right: AttackId.Horizontal, left: AttackId.ReverseHorizontal },
    finisher: AttackId.FinisherSpin,
  },
  [SwingFamily.Reverse]: {
    opener: AttackId.ReverseHorizontal,
    from: { right: AttackId.Horizontal, left: AttackId.ReverseHorizontal },
    finisher: AttackId.FinisherRising,
  },
  [SwingFamily.Vertical]: {
    opener: AttackId.Vertical,
    from: { right: AttackId.Vertical, left: AttackId.VerticalLeft },
    finisher: AttackId.FinisherCleave,
  },
  [SwingFamily.Thrust]: {
    opener: AttackId.Thrust,
    from: { right: AttackId.Thrust, left: AttackId.ThrustLeft },
    finisher: AttackId.FinisherLunge,
  },
};

export interface EvadeDef {
  id: EvadeId;
  anim: string;
  duration: number;
  speed: number; // planar m/s
  /** Vertical launch speed. Tune with gravity so airtime matches duration (t = 2v/g). */
  upSpeed: number;
  invulnFrom: number;
  invulnTo: number;
  /** Earliest time a buffered action can cancel into the next move. */
  cancelFrom: number;
  /** Roll turns to face its travel direction; hops and flips keep facing the target. */
  faceTravel: boolean;
}

export const EVADES: Readonly<Record<EvadeId, EvadeDef>> = {
  [EvadeId.Roll]: {
    id: EvadeId.Roll, anim: 'evade_roll', duration: 0.5, speed: 7, upSpeed: 0,
    invulnFrom: 0.04, invulnTo: 0.3, cancelFrom: 0.42, faceTravel: true,
  },
  [EvadeId.SideHopLeft]: {
    id: EvadeId.SideHopLeft, anim: 'evade_hop_left', duration: 0.4, speed: 6, upSpeed: 4,
    invulnFrom: 0, invulnTo: 0.25, cancelFrom: 0.36, faceTravel: false,
  },
  [EvadeId.SideHopRight]: {
    id: EvadeId.SideHopRight, anim: 'evade_hop_right', duration: 0.4, speed: 6, upSpeed: 4,
    invulnFrom: 0, invulnTo: 0.25, cancelFrom: 0.36, faceTravel: false,
  },
  [EvadeId.Backflip]: {
    id: EvadeId.Backflip, anim: 'evade_backflip', duration: 0.55, speed: 5.5, upSpeed: 5.5,
    invulnFrom: 0.05, invulnTo: 0.35, cancelFrom: 0.5, faceTravel: false,
  },
};
