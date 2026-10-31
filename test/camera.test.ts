import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { add, length, normalize, sub, vec2, type Vec2 } from '../src/core/math';
import {
  CameraRig,
  type CameraCollider,
  type CameraPose,
  type CameraRigConfig,
  type CameraTargeting,
  type LookInput,
} from '../src/camera/CameraRig';
import { RapierCameraProbe } from '../src/physics/RapierCameraProbe';
import { planarFrom3, planarTo3, type Vec3 } from '../src/physics/space';

const DT = 1 / 60;
const ASPECT = 16 / 9;
const NO_LOOK: LookInput = { yaw: 0, pitch: 0 };
const BREAK_RANGE = 16; // DEFAULT_TARGETING.breakRange

before(async () => {
  await RAPIER.init();
});

/** Targeting stand-in: lock on/off by hand, direction from live positions. */
class FakeTargeting implements CameraTargeting {
  locked = false;
  wantsRecenter = false;
  constructor(
    readonly player: { position: Vec2 },
    readonly target: Vec2,
  ) {}
  get isLocked() {
    return this.locked;
  }
  directionToTarget() {
    return this.locked ? normalize(sub(this.target, this.player.position)) : null;
  }
  distanceToTarget() {
    return this.locked ? length(sub(this.target, this.player.position)) : Infinity;
  }
}

function setup(cfg: Partial<CameraRigConfig> = {}, collider: CameraCollider | null = null, target = vec2(0, 6)) {
  const subject = { position: vec2(0, 0), height: 0, facing: vec2(0, 1) };
  const targeting = new FakeTargeting(subject, target);
  const rig = new CameraRig(targeting, collider, cfg);
  const step = (look: LookInput = NO_LOOK) => rig.update(DT, look, subject);
  return { rig, subject, targeting, step };
}

/** Normalized device coords of a world point. |x|, |y| <= 1 is on screen. */
function project(pose: CameraPose, p: Vec3) {
  const f = norm3(sub3(pose.lookAt, pose.position));
  const r = norm3(cross(f, { x: 0, y: 1, z: 0 }));
  const u = cross(r, f);
  const d = sub3(p, pose.position);
  const depth = dot3(d, f);
  const tanV = Math.tan((pose.fov * Math.PI) / 360);
  return { x: dot3(d, r) / (depth * tanV * ASPECT), y: dot3(d, u) / (depth * tanV), depth };
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot3 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len3 = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const norm3 = (a: Vec3): Vec3 => scale3(a, 1 / len3(a));
const scale3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/** Feet and head of a character standing at planar `p`. */
const body = (p: Vec2, height: number): Vec3[] => [planarTo3(p, 0.05), planarTo3(p, height)];

// ------------------------------------------------------------------ free orbit

test('free orbit: sits behind and above her, then follows when she moves', () => {
  const { subject, step } = setup();
  let pose = step();
  for (let i = 0; i < 30; i++) pose = step();
  const cam = planarFrom3(pose.position);
  assert.ok(cam.y < -4, `behind her (planar y ${cam.y.toFixed(2)})`);
  assert.ok(pose.position.y > 1.45, 'above the focus');

  for (let i = 0; i < 120; i++) {
    subject.position = add(subject.position, vec2(6 * DT, 0));
    pose = step();
  }
  const lag = planarFrom3(pose.lookAt).x - subject.position.x;
  assert.ok(Math.abs(lag) < 1, `focus keeps up while running (lag ${lag.toFixed(2)} m)`);
});

test('camera basis matches where the camera actually looks', () => {
  const { rig, step } = setup();
  let pose = step();
  for (let i = 0; i < 60; i++) pose = step({ yaw: 0.02, pitch: 0 });
  const look = normalize(planarFrom3(sub3(pose.lookAt, pose.position)));
  assert.ok(Math.abs(look.x - rig.basis.forward.x) < 1e-6 && Math.abs(look.y - rig.basis.forward.y) < 1e-6);
  // Positive look yaw turns right: forward rotates clockwise from above, toward +x.
  assert.ok(rig.basis.forward.x > 0.5, `turned right (forward ${JSON.stringify(rig.basis.forward)})`);
});

// --------------------------------------------------------------------- lock-on

test('lock-on keeps both framed while circle-strafing at any distance up to break range', () => {
  for (const radius of [1, 3, 6, 10, BREAK_RANGE - 0.5]) {
    for (const dir of [1, -1]) {
      const target = vec2(0, radius);
      const { subject, targeting, step } = setup({}, null, target);
      targeting.locked = true;
      for (let i = 0; i < 60; i++) step(); // settle

      // Strafe a full circle around the target at strafe speed (4 m/s), facing it.
      const frames = Math.ceil(((2 * Math.PI * radius) / 4) / DT);
      let sumX = 0;
      for (let i = 0; i < frames; i++) {
        const theta = (dir * 4 * DT * (i + 1)) / radius;
        subject.position = add(target, vec2(radius * Math.sin(theta), -radius * Math.cos(theta)));
        subject.facing = normalize(sub(target, subject.position));
        const pose = step();

        const her = body(subject.position, 1.7).map((p) => project(pose, p));
        const it = body(target, 1.8).map((p) => project(pose, p));
        for (const [who, pts] of [['her', her], ['target', it]] as const) {
          for (const p of pts) {
            const where = `r=${radius} dir=${dir} frame ${i}: ${who} at (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`;
            assert.ok(p.depth > 0.5, `in front of the camera, ${where}`);
            assert.ok(Math.abs(p.x) <= 0.95 && Math.abs(p.y) <= 0.95, `on screen, ${where}`);
          }
        }
        sumX += her[1].x;
      }
      assert.ok(sumX / frames < -0.1, `r=${radius}: she sits left of center (mean x ${(sumX / frames).toFixed(2)})`);
    }
  }
});

test('breaking lock eases back to orbit with no snap', () => {
  const target = vec2(0, 6);
  const { rig, subject, targeting, step } = setup({}, null, target);
  targeting.locked = true;
  let prev = step();
  const move = () => {
    subject.position = add(subject.position, vec2(4 * DT, 0)); // keep strafing right
    subject.facing = normalize(sub(target, subject.position));
  };
  for (let i = 0; i < 120; i++) {
    move();
    prev = step();
  }

  // The jump a snap would cause: lock focus vs free focus.
  const lockedLookAt = prev.lookAt;
  targeting.locked = false;
  let maxMove = 0;
  let maxLook = 0;
  let maxTurn = 0;
  let maxJerk = 0; // change in per-frame movement: a snap shows up here as a spike
  let maxLookJerk = 0;
  const first = step();
  let lastMove = len3(sub3(first.position, prev.position));
  let lastLook = len3(sub3(first.lookAt, prev.lookAt));
  prev = first;
  for (let i = 0; i < 60; i++) {
    move();
    const pose = step();
    const moved = len3(sub3(pose.position, prev.position));
    maxJerk = Math.max(maxJerk, Math.abs(moved - lastMove));
    lastMove = moved;
    maxMove = Math.max(maxMove, moved);
    const looked = len3(sub3(pose.lookAt, prev.lookAt));
    maxLookJerk = Math.max(maxLookJerk, Math.abs(looked - lastLook));
    lastLook = looked;
    maxLook = Math.max(maxLook, looked);
    const a = norm3(sub3(prev.lookAt, prev.position));
    const b = norm3(sub3(pose.lookAt, pose.position));
    maxTurn = Math.max(maxTurn, Math.acos(Math.min(1, dot3(a, b))));
    prev = pose;
  }
  const settledShift = len3(sub3(prev.lookAt, lockedLookAt));
  assert.ok(settledShift > 1, `framing really changed (${settledShift.toFixed(2)} m)`);
  // About 3 m of reframing over the 0.3 s ease peaks around 0.3 m per frame. A snap would
  // move the whole 3 m in one frame; a hitch shows as a jump in per-frame movement.
  assert.ok(maxMove < 0.4, `camera moved at most ${maxMove.toFixed(3)} m in one frame`);
  assert.ok(maxLook < 0.4, `look point moved at most ${maxLook.toFixed(3)} m in one frame`);
  assert.ok(maxJerk < 0.04, `camera movement changed by at most ${maxJerk.toFixed(3)} m between frames`);
  assert.ok(maxLookJerk < 0.04, `look movement changed by at most ${maxLookJerk.toFixed(3)} m between frames`);
  assert.ok(maxTurn < (3 * Math.PI) / 180, `view turned at most ${((maxTurn * 180) / Math.PI).toFixed(2)} deg in one frame`);
  assert.equal(rig.lockBlend, 0, 'fully back to orbit within 1 s');
});

test('target button with nothing in range swings the camera behind her', () => {
  const { rig, subject, targeting, step } = setup();
  step();
  for (let i = 0; i < 30; i++) step({ yaw: 0.06, pitch: 0 }); // look well off to the side
  assert.ok(Math.abs(rig.yaw.value) > 1);

  subject.facing = vec2(0, 1);
  targeting.wantsRecenter = true;
  for (let i = 0; i < 30; i++) step();
  assert.ok(Math.abs(rig.yaw.value) < 0.05, `behind her after 0.5 s (yaw ${rig.yaw.value.toFixed(3)})`);
});

// --------------------------------------------------------------- spring arm

/** Infinite wall across planar y = wallY (three z = -wallY), solid on the far side. */
function planeWall(wallY: number): CameraCollider & { enabled: boolean } {
  const wallZ = -wallY;
  return {
    enabled: true,
    cast(from, to, radius) {
      if (!this.enabled) return 1;
      const stop = wallZ - radius;
      if (to.z <= stop) return 1;
      return Math.max(0, (stop - from.z) / (to.z - from.z));
    },
  };
}

test('spring arm: never pushes through a wall, and eases back out when it clears', () => {
  const wall = planeWall(-1.5); // 1.5 m behind her
  const { subject, step } = setup({}, wall);
  let pose = step();
  for (let i = 0; i < 240; i++) {
    subject.position = vec2(Math.sin(i * 0.05) * 3, -0.5 + Math.sin(i * 0.03) * 0.4);
    pose = step({ yaw: Math.sin(i * 0.04) * 0.03, pitch: 0 });
    assert.ok(pose.position.z <= 1.5 - 0.2, `frame ${i}: camera z ${pose.position.z.toFixed(3)} is past the wall`);
  }

  wall.enabled = false;
  let prev = pose;
  let maxStep = 0;
  for (let i = 0; i < 60; i++) {
    pose = step();
    maxStep = Math.max(maxStep, len3(sub3(pose.position, prev.position)));
    prev = pose;
  }
  assert.ok(maxStep < 0.3, `arm grew back smoothly (max ${maxStep.toFixed(3)} m per frame)`);
  assert.ok(len3(sub3(pose.position, pose.lookAt)) > 5, 'back to full length');
});

test('spring arm with Rapier: stops at a pillar and at the floor', () => {
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  const floor = world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0));
  const pillarAt = planarTo3(vec2(0, -3), 2);
  const pillar = world.createCollider(RAPIER.ColliderDesc.cylinder(2, 0.6).setTranslation(pillarAt.x, pillarAt.y, pillarAt.z));
  world.createCollider(RAPIER.ColliderDesc.ball(0.5).setTranslation(0, 1.5, 2)); // a "character" behind her
  world.step();
  const probe = new RapierCameraProbe(world, [floor, pillar]);
  assert.equal(probe.cast({ x: 0, y: 1.5, z: 0.5 }, { x: 0, y: 1.5, z: 1.5 }, 0.25), 1, 'non-blockers are ignored');

  const { step } = setup({}, probe);
  let pose = step();
  for (let i = 0; i < 30; i++) pose = step();
  const cam = planarFrom3(pose.position);
  const fromAxis = length(sub(cam, vec2(0, -3)));
  assert.ok(cam.y > -3, `camera stayed on her side of the pillar (planar y ${cam.y.toFixed(2)})`);
  assert.ok(fromAxis > 0.6 + 0.2, `not inside the pillar (${fromAxis.toFixed(2)} m from its axis)`);

  // Look up hard: the arm swings under the focus and must stop at the floor.
  const low = setup({}, probe);
  low.subject.position = vec2(0, 5); // clear of the pillar
  for (let i = 0; i < 90; i++) pose = low.step({ yaw: 0, pitch: -0.05 });
  assert.ok(pose.position.y >= 0.2, `above the floor (y ${pose.position.y.toFixed(3)})`);
});

// ------------------------------------------------------------ event hooks

test('perfect dodge punches the FOV out, then it eases back', () => {
  const { rig, step } = setup();
  const base = step().fov;
  rig.cue('perfectDodge');
  let pose = step();
  for (let i = 0; i < 18; i++) pose = step();
  assert.ok(pose.fov > base + 7, `punched out (fov ${pose.fov.toFixed(1)})`);
  assert.ok(pose.roll > 0, 'dutch roll');
  for (let i = 0; i < 60; i++) pose = step();
  assert.equal(pose.fov, base, 'back to base after hold + release');
  assert.equal(pose.roll, 0);
});

test('counter lets the dodge punch go early and dollies in', () => {
  const { rig, step } = setup();
  let pose = step();
  const armBefore = len3(sub3(pose.position, pose.lookAt));
  rig.cue('perfectDodge');
  for (let i = 0; i < 10; i++) step();
  rig.cue('counter.phantomDash');
  for (let i = 0; i < 10; i++) pose = step();
  assert.ok(len3(sub3(pose.position, pose.lookAt)) < armBefore * 0.92, 'dollied toward the action');
  for (let i = 0; i < 20; i++) pose = step();
  assert.ok(pose.fov < 60.5, `fov released with the counter (fov ${pose.fov.toFixed(2)})`);
});

test('reduced motion: no shake and no dutch roll', () => {
  const calm = setup({ reducedMotion: true });
  const ref = setup({ reducedMotion: true });
  calm.step();
  ref.step();
  calm.rig.cue('perfectBlock');
  calm.rig.cue('perfectDodge');
  for (let i = 0; i < 6; i++) {
    const a = calm.step();
    const b = ref.step();
    assert.deepEqual(a.lookAt, b.lookAt, 'no shake on the look point');
    assert.equal(a.roll, 0);
  }

  const shaky = setup();
  shaky.step();
  shaky.rig.cue('perfectBlock');
  const s = shaky.step();
  const r = setup();
  r.step();
  assert.notDeepEqual(s.lookAt, r.step().lookAt, 'shake is on by default');
});
