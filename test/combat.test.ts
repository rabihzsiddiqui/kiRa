import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessSandbox, type FrameInput } from '../src/sandbox/HeadlessSandbox';
import { AttackId, EVADES, EvadeId } from '../src/combat/moves';
import { DEFAULT_TUNING, PlayerStateId } from '../src/player/contracts';
import type { EvadeState } from '../src/player/states/EvadeState';
import type { PerfectBlockState } from '../src/player/states/PerfectStates';
import { vec2, TAU } from '../src/core/math';

// Camera looks down +Y (world forward), she starts facing +Y.
const FWD = vec2(0, 1);
const BACK = vec2(0, -1);
const LEFT = vec2(-1, 0);
const RIGHT = vec2(1, 0);

/** Sandbox with an enemy 5 m ahead and Z-target held. */
function lockedSandbox() {
  const sb = new HeadlessSandbox();
  const enemy = sb.addEnemy(0, 5);
  sb.run(2, { target: true });
  assert.ok(sb.targeting.isLocked, 'should be locked on');
  return { sb, enemy, L: (f: FrameInput = {}): FrameInput => ({ ...f, target: true }) };
}

const evadeId = (sb: HeadlessSandbox) => (sb.player.fsm.current as EvadeState).evade;

// ------------------------------------------------------------ sword attacks

test('untargeted: neutral attack = horizontal slice', () => {
  const sb = new HeadlessSandbox();
  sb.step({ attack: true });
  assert.equal(sb.player.state, PlayerStateId.Attack);
  assert.deepEqual(sb.attacks, [AttackId.Horizontal]);
});

test('untargeted: forward + attack = vertical slice', () => {
  const sb = new HeadlessSandbox();
  sb.step({ stick: FWD, attack: true });
  assert.deepEqual(sb.attacks, [AttackId.Vertical]);
});

test('side slashes follow the stick: right = reverse (sweeps right), left = horizontal (sweeps left)', () => {
  const right = new HeadlessSandbox();
  right.step({ stick: RIGHT, attack: true });
  assert.deepEqual(right.attacks, [AttackId.ReverseHorizontal]);
  const left = new HeadlessSandbox();
  left.step({ stick: LEFT, attack: true });
  assert.deepEqual(left.attacks, [AttackId.Horizontal]);
});

test('targeted: neutral = vertical, forward = thrust, right = reverse, left = horizontal', () => {
  const cases: Array<[ReturnType<typeof vec2> | undefined, AttackId]> = [
    [undefined, AttackId.Vertical],
    [FWD, AttackId.Thrust],
    [RIGHT, AttackId.ReverseHorizontal],
    [LEFT, AttackId.Horizontal],
  ];
  for (const [stick, expected] of cases) {
    const { sb, L } = lockedSandbox();
    sb.step(L({ stick, attack: true }));
    sb.run(4, L({ stick }));
    assert.deepEqual(sb.attacks, [expected], `stick ${JSON.stringify(stick)}`);
  }
});

test('combo: repeated neutral presses alternate horizontal / reverse', () => {
  const sb = new HeadlessSandbox();
  sb.step({ attack: true });
  sb.run(5);
  sb.step({ attack: true }); // buffered during startup/active
  sb.run(8);
  sb.step({ attack: true });
  sb.run(12);
  assert.deepEqual(sb.attacks, [AttackId.Horizontal, AttackId.ReverseHorizontal, AttackId.Horizontal]);
});

test('hitbox is only live during the active phase', () => {
  const sb = new HeadlessSandbox();
  sb.step({ attack: true });
  sb.run(40);
  const log = sb.hitboxLog.filter((h) => h.attack === AttackId.Horizontal);
  assert.equal(log.length, 2);
  assert.equal(log[0].active, true);
  assert.equal(log[1].active, false);
  const activeFrames = log[1].frame - log[0].frame;
  assert.ok(activeFrames >= 5 && activeFrames <= 7, `active for ${activeFrames} frames`);
});

test('a press too early in the move is dropped; one inside the buffer window fires', () => {
  // Chaining rolls: the second Evade waits for the first roll's cancel window.
  // (Attack during a roll is different: the roll keeps it for the roll thrust.)
  const rolls = (sb: HeadlessSandbox) => {
    let n = 0;
    sb.events.on('evadeStarted', () => n++);
    return () => n;
  };
  const early = new HeadlessSandbox();
  const earlyRolls = rolls(early);
  early.step({ evade: true });
  early.run(3);
  early.step({ evade: true }); // ~0.5 s before the roll can cancel: expires
  early.run(40);
  assert.equal(earlyRolls(), 1);

  const late = new HeadlessSandbox();
  const lateRolls = rolls(late);
  late.step({ evade: true });
  late.run(29);
  late.step({ evade: true }); // ~0.06 s before the cancel window: buffered
  late.run(10);
  assert.equal(lateRolls(), 2);
});

// ------------------------------------------------------------ spin attack

test('hold attack to charge, release after full charge = spin', () => {
  const sb = new HeadlessSandbox();
  sb.run(30, { attack: true }); // slash, then still holding
  assert.equal(sb.player.state, PlayerStateId.SpinCharge);
  sb.run(50, { attack: true });
  sb.step({});
  assert.deepEqual(sb.attacks, [AttackId.Horizontal, AttackId.Spin]);
  assert.ok(sb.cues.includes('spinCharge.ready'));
});

test('releasing a charge early just lowers the sword', () => {
  const sb = new HeadlessSandbox();
  sb.run(30, { attack: true });
  sb.run(10, { attack: true });
  sb.step({});
  assert.equal(sb.player.state, PlayerStateId.Grounded);
  assert.deepEqual(sb.attacks, [AttackId.Horizontal]);
});

test('quick 360 on the stick + attack = spin', () => {
  const sb = new HeadlessSandbox();
  const frames = 18;
  for (let i = 0; i <= frames; i++) {
    const a = (i / frames) * TAU * 0.95;
    sb.step({ stick: vec2(Math.cos(a), Math.sin(a)) });
  }
  sb.step({ attack: true });
  assert.deepEqual(sb.attacks, [AttackId.Spin]);
});

test('the spin turns the way the stick went: clockwise 360 = clockwise spin', () => {
  const spinWith = (sign: 1 | -1) => {
    const sb = new HeadlessSandbox();
    for (let i = 0; i <= 18; i++) {
      const a = sign * (i / 18) * TAU * 0.95;
      sb.step({ stick: vec2(Math.cos(a), Math.sin(a)) });
    }
    sb.step({ attack: true });
    return sb.attacks;
  };
  assert.deepEqual(spinWith(-1), [AttackId.SpinClockwise]);
  assert.deepEqual(spinWith(1), [AttackId.Spin]);
});

test('stick wiggle does not count as a 360', () => {
  const sb = new HeadlessSandbox();
  for (let i = 0; i < 30; i++) {
    const a = Math.sin(i) * 1.5;
    sb.step({ stick: vec2(Math.cos(a), Math.sin(a)) });
  }
  sb.step({ attack: true });
  assert.notEqual(sb.attacks[0], AttackId.Spin);
});

// ------------------------------------------------------------ evasion

test('untargeted evade = forward roll', () => {
  const sb = new HeadlessSandbox();
  sb.step({ evade: true });
  assert.equal(sb.player.state, PlayerStateId.Evade);
  assert.equal(evadeId(sb), EvadeId.Roll);
});

test('traversal roll keeps her running momentum: no stop between the roll and the run', () => {
  const sb = new HeadlessSandbox();
  sb.run(30, { stick: FWD });
  sb.step({ stick: FWD, evade: true });
  const speeds: number[] = [];
  for (let i = 0; i < 45; i++) {
    sb.step({ stick: FWD });
    speeds.push(Math.hypot(sb.motor.planarVelocity.x, sb.motor.planarVelocity.y));
  }
  assert.ok(sb.trace.some((t) => t.endsWith('Evade -> Grounded')), 'the roll finished');
  const slowest = Math.min(...speeds);
  assert.ok(slowest >= DEFAULT_TUNING.runSpeed - 1e-6, `never dropped below run speed (${slowest.toFixed(2)} m/s)`);
});

test('traversal roll with the stick released still eases to a stop', () => {
  const sb = new HeadlessSandbox();
  sb.step({ evade: true });
  let endSpeed = Infinity;
  for (let i = 0; i < 60 && sb.player.state === PlayerStateId.Evade; i++) {
    sb.step();
    endSpeed = Math.hypot(sb.motor.planarVelocity.x, sb.motor.planarVelocity.y);
  }
  assert.equal(sb.player.state, PlayerStateId.Grounded);
  assert.ok(endSpeed < 0.5, `slowed to a stop (${endSpeed.toFixed(2)} m/s)`);
});

test('a roll beats running: it covers clearly more ground than running for as long', () => {
  const roll = EVADES[EvadeId.Roll];
  const frames = Math.round(roll.duration * 60);
  const ran = new HeadlessSandbox();
  ran.run(30, { stick: FWD });
  const r0 = ran.motor.position.y;
  ran.run(frames, { stick: FWD });
  const rolled = new HeadlessSandbox();
  rolled.run(30, { stick: FWD });
  const p0 = rolled.motor.position.y;
  rolled.step({ stick: FWD, evade: true });
  rolled.run(frames - 1, { stick: FWD });
  const run = ran.motor.position.y - r0;
  const dist = rolled.motor.position.y - p0;
  assert.ok(dist > run * 1.2, `roll ${dist.toFixed(2)} m vs run ${run.toFixed(2)} m`);
});

test('the roll steers: holding the stick to one side bends it that way, at a limited rate', () => {
  const sb = new HeadlessSandbox();
  sb.step({ stick: FWD, evade: true });
  sb.run(6, { stick: FWD }); // ~0.1 s straight
  assert.equal(sb.player.state, PlayerStateId.Evade);
  const before = { ...sb.motor.position };
  sb.run(12, { stick: RIGHT }); // ~0.2 s steering right
  assert.equal(sb.player.state, PlayerStateId.Evade, 'still rolling');
  const v = sb.motor.planarVelocity;
  const heading = Math.atan2(v.x, v.y); // 0 = forward, + = toward the right
  assert.ok(sb.motor.position.x - before.x > 0.15, `drifted right (${(sb.motor.position.x - before.x).toFixed(2)} m)`);
  assert.ok(heading > 0.4, `bent toward the stick (${heading.toFixed(2)} rad)`);
  assert.ok(heading < 0.2 * EVADES[EvadeId.Roll].steerRate + 0.05, 'but no faster than its steer rate');
  assert.ok(sb.motor.facing.x > 0.3, 'she turns with it');
});

test('hops and flips commit: the stick cannot bend them once started', () => {
  const { sb, L } = lockedSandbox();
  sb.step(L({ stick: RIGHT, evade: true }));
  sb.run(3, L({ stick: RIGHT }));
  sb.run(10, L({ stick: FWD }));
  const v = sb.motor.planarVelocity;
  assert.ok(Math.abs(v.y) < 0.05 && v.x > 0, `still hopping straight right (${v.x.toFixed(2)}, ${v.y.toFixed(2)})`);
});

test('targeted evade + left/right = side hop, + back = backflip', () => {
  const cases: Array<[ReturnType<typeof vec2>, EvadeId]> = [
    [LEFT, EvadeId.SideHopLeft],
    [RIGHT, EvadeId.SideHopRight],
    [BACK, EvadeId.Backflip],
  ];
  for (const [stick, expected] of cases) {
    const { sb, L } = lockedSandbox();
    sb.step(L({ stick, evade: true }));
    sb.run(4, L({ stick }));
    assert.equal(sb.player.state, PlayerStateId.Evade);
    assert.equal(evadeId(sb), expected);
  }
});

test('side hop keeps her facing the target', () => {
  const { sb, L } = lockedSandbox();
  sb.step(L({ stick: RIGHT, evade: true }));
  sb.run(15, L({ stick: RIGHT }));
  assert.ok(sb.motor.facing.y > 0.9, 'still facing the enemy');
  assert.ok(sb.motor.position.x > 1, 'moved right');
});

test('targeted evade with neutral or forward stick = jump attack, never a roll', () => {
  for (const stick of [undefined, FWD]) {
    const { sb, L } = lockedSandbox();
    sb.step(L({ stick, evade: true }));
    assert.equal(sb.player.state, PlayerStateId.Attack, `stick ${JSON.stringify(stick)}`);
    assert.deepEqual(sb.attacks, [AttackId.JumpAttack]);
    sb.run(30, L());
    assert.ok(sb.motor.position.y > 2.5, `leapt toward target (y=${sb.motor.position.y.toFixed(2)})`);
  }
});

test('jump attack: capped distance when the target is far, steady speed, no mid-air stop', () => {
  const sb = new HeadlessSandbox();
  sb.addEnemy(0, 10);
  sb.run(2, { target: true });
  assert.ok(sb.targeting.isLocked);
  sb.step({ target: true, evade: true });
  assert.deepEqual(sb.attacks, [AttackId.JumpAttack]);
  const speeds: number[] = [];
  while (sb.motor.height > 0 || sb.motor.verticalSpeed > 0) {
    speeds.push(Math.hypot(sb.motor.planarVelocity.x, sb.motor.planarVelocity.y));
    sb.step({ target: true });
  }
  const travelled = sb.motor.position.y;
  assert.ok(travelled <= 4.01 && travelled > 3.8, `capped at 4 m (went ${travelled.toFixed(2)})`);
  const airborne = speeds.slice(1, -1);
  assert.ok(Math.min(...airborne) > 0.9 * Math.max(...airborne), 'steady speed for the whole jump');
});

test('jump attack: up close it stops short of the target', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 3);
  sb.run(2, { target: true });
  sb.step({ target: true, evade: true });
  sb.run(50, { target: true });
  const gap = e.position.y - sb.motor.position.y;
  assert.ok(Math.abs(gap - 1.2) < 0.1, `landed ${gap.toFixed(2)} m away (stopShort 1.2)`);
});

test('jump attack homes in on a moving target', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 4);
  sb.run(2, { target: true });
  sb.step({ target: true, evade: true });
  for (let i = 0; i < 30; i++) {
    e.position = { x: e.position.x + 3 / 60, y: e.position.y }; // sidesteps right at 3 m/s
    sb.step({ target: true });
  }
  assert.ok(sb.motor.position.x > 0.6, `followed it sideways (x ${sb.motor.position.x.toFixed(2)})`);
});

test('locked-on presses fire on the same frame (no chord wait)', () => {
  const a = lockedSandbox();
  a.sb.step(a.L({ attack: true }));
  assert.equal(a.sb.player.state, PlayerStateId.Attack);
  const b = lockedSandbox();
  b.sb.step(b.L({ stick: LEFT, evade: true }));
  assert.equal(b.sb.player.state, PlayerStateId.Evade);
});

test('jump attack chains out of a slash once the combo window opens', () => {
  const { sb, L } = lockedSandbox();
  sb.step(L({ attack: true }));
  sb.run(6, L());
  sb.step(L({ evade: true })); // buffered, fires when the slash allows it
  sb.run(20, L());
  assert.deepEqual(sb.attacks, [AttackId.Vertical, AttackId.JumpAttack]);
});

// ------------------------------------------------------------ block

test('block nullifies frontal hits, not hits from behind', () => {
  const sb = new HeadlessSandbox();
  const front = sb.addEnemy(0, 3);
  const behind = sb.addEnemy(0, -3);
  sb.run(20, { block: true }); // past the perfect window
  assert.equal(sb.player.state, PlayerStateId.Guard);
  assert.equal(sb.hitFrom(front), 'blocked');
  assert.equal(sb.player.state, PlayerStateId.GuardRecoil);
  sb.run(20, { block: true });
  assert.equal(sb.hitFrom(behind), 'hit');
  assert.equal(sb.player.state, PlayerStateId.HitStun);
});

test('unblockable attacks go through guard', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 3);
  sb.run(20, { block: true });
  assert.equal(sb.hitFrom(e, { unblockable: true }), 'hit');
});

// ------------------------------------------------------------ perfect block

test('perfect block: clash, slow-mo, then overpower counter', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 2.5);
  sb.step({ block: true });
  assert.equal(sb.hitFrom(e), 'perfectBlock');
  assert.equal(sb.player.state, PlayerStateId.PerfectBlock);
  assert.ok(sb.cues.includes('perfectBlock'));
  sb.step({ block: true });
  assert.ok(sb.time.worldScale < 0.1, 'hit stop');

  sb.step({ block: true, attack: true });
  sb.run(30, { block: true });
  assert.deepEqual(sb.attacks, [AttackId.Overpower]);
  assert.ok(sb.cues.includes('counter.overpower'));
});

test('perfect block chains across a multi-hit string', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 2.5);
  sb.step({ block: true });
  assert.equal(sb.hitFrom(e), 'perfectBlock');
  sb.run(5, { block: true });
  assert.equal(sb.hitFrom(e), 'perfectBlock');
  assert.equal((sb.player.fsm.current as PerfectBlockState).chain, 1);
});

test('mashing block voids the perfect window', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 2.5);
  sb.step({ block: true });
  sb.step({});
  sb.step({ block: true });
  assert.equal(sb.hitFrom(e), 'blocked');
});

test('late block is a normal block', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 2.5);
  sb.run(12, { block: true }); // 0.2 s > 0.12 s window
  assert.equal(sb.hitFrom(e), 'blocked');
});

// ------------------------------------------------------------ perfect dodge

test('perfect dodge: flip, slow-mo, phantom dash toward the attacker', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(3, 3);
  sb.step({ stick: RIGHT, evade: true });
  sb.step({});
  assert.equal(sb.hitFrom(e), 'perfectDodge');
  assert.equal(sb.player.state, PlayerStateId.PerfectDodge);
  assert.ok(sb.cues.includes('perfectDodge'));

  sb.step({});
  assert.ok(Math.abs(sb.time.worldScale - 0.15) < 0.01, `world slowed (${sb.time.worldScale})`);
  assert.ok(Math.abs(sb.time.playerScale - 0.55) < 0.01, 'player less slowed');
  assert.equal(sb.hitFrom(e), 'evaded', 'invulnerable during the flip');

  const before = { ...sb.motor.position };
  sb.step({ attack: true }); // pressed early: latched until the counter opens
  sb.run(40);
  assert.deepEqual(sb.attacks, [AttackId.PhantomDash]);
  const distBefore = Math.hypot(e.position.x - before.x, e.position.y - before.y);
  const distAfter = Math.hypot(e.position.x - sb.motor.position.x, e.position.y - sb.motor.position.y);
  assert.ok(distAfter < distBefore && distAfter < 1.5, `dashed in (${distAfter.toFixed(2)} m)`);
});

test('perfect dodge works on unblockable attacks', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 3);
  sb.step({ evade: true });
  assert.equal(sb.hitFrom(e, { unblockable: true }), 'perfectDodge');
});

test('late dodge: i-frames only (no slow-mo), then vulnerable', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 3);
  sb.step({ evade: true });
  sb.run(12); // 0.2 s
  assert.equal(sb.hitFrom(e), 'evaded');
  assert.equal(sb.time.worldScale, 1);
  sb.run(8); // 0.33 s, past i-frames
  assert.equal(sb.hitFrom(e), 'hit');
});

test('slow-mo wears off on its own if she does not counter', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 3);
  sb.step({ evade: true });
  sb.hitFrom(e);
  sb.run(90);
  assert.equal(sb.time.worldScale, 1);
  assert.equal(sb.player.state, PlayerStateId.Grounded);
  assert.ok(sb.cues.includes('slowmo.end'));
  assert.deepEqual(sb.attacks, []);
});

test('mashing attack before the perfect dodge does not auto-counter', () => {
  const sb = new HeadlessSandbox();
  const e = sb.addEnemy(0, 3);
  sb.step({ evade: true });
  sb.step({ attack: true }); // pressed before the hit: flushed on perfect dodge
  sb.hitFrom(e);
  sb.run(60);
  assert.ok(!sb.attacks.includes(AttackId.PhantomDash));
});
