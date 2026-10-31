import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { vec2 } from '../src/core/math';
import { RapierMotor } from '../src/physics/RapierMotor';
import { SimpleMotor } from '../src/physics/SimpleMotor';

const DT = 1 / 60;

before(async () => {
  await RAPIER.init();
});

/** Flat floor with its top at y = 0, plus an optional wall across +Y (planar) at `wallAt`. */
function makeWorld(wallAt?: number) {
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.5, 50).setTranslation(0, -0.5, 0));
  // Planar +Y is world -Z (see src/physics/space.ts).
  if (wallAt !== undefined) world.createCollider(RAPIER.ColliderDesc.cuboid(10, 2, 0.25).setTranslation(0, 2, -(wallAt + 0.25)));
  world.step(); // builds the broad phase so the first query sees the floor
  return world;
}

function run(world: RAPIER.World, motor: RapierMotor, frames: number) {
  for (let i = 0; i < frames; i++) {
    motor.step(DT);
    world.step();
  }
}

test('rapier motor: stands on the floor without sinking into it', () => {
  const world = makeWorld();
  const motor = new RapierMotor(world);
  run(world, motor, 120);
  assert.ok(motor.grounded);
  assert.ok(Math.abs(motor.height) < 0.01, `height after 2 s: ${motor.height}`);
});

test('rapier motor: planar velocity moves her along planar +Y', () => {
  const world = makeWorld();
  const motor = new RapierMotor(world);
  run(world, motor, 5);
  motor.setPlanarVelocity(vec2(0, 6));
  run(world, motor, 60);
  assert.ok(Math.abs(motor.position.y - 6) < 0.3, `y ${motor.position.y}`);
  assert.ok(Math.abs(motor.position.x) < 0.01);
});

test('rapier motor: a wall stops her', () => {
  const world = makeWorld(3);
  const motor = new RapierMotor(world);
  run(world, motor, 5);
  motor.setPlanarVelocity(vec2(0, 6));
  run(world, motor, 120);
  const reach = 3 - motor.cfg.radius;
  assert.ok(motor.position.y <= reach + 0.05, `went through the wall: y ${motor.position.y}`);
  assert.ok(motor.position.y > reach - 0.2, `stopped short: y ${motor.position.y}`);
});

test('rapier motor: launch matches SimpleMotor airtime and grounded semantics', () => {
  const world = makeWorld();
  const rapier = new RapierMotor(world);
  const simple = new SimpleMotor();
  run(world, rapier, 10);

  rapier.launch(4);
  simple.launch(4);
  assert.equal(rapier.grounded, false, 'launch clears grounded on the same frame');
  assert.equal(simple.grounded, false);

  const airFrames = (step: () => void, grounded: () => boolean) => {
    let n = 0;
    do {
      step();
      n++;
    } while (!grounded() && n < 200);
    return n;
  };
  const rapierFrames = airFrames(() => run(world, rapier, 1), () => rapier.grounded);
  const simpleFrames = airFrames(() => simple.step(DT), () => simple.grounded);
  // t = 2v/g = 0.4 s = 24 frames. Allow a frame or two for the skin gap.
  assert.ok(Math.abs(rapierFrames - simpleFrames) <= 2, `rapier ${rapierFrames} vs simple ${simpleFrames}`);
});
