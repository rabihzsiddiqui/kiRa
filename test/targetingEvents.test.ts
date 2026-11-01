import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessSandbox } from '../src/sandbox/HeadlessSandbox';

/*
 * The lock-on sound (SoundFx.lockOn / lockOff, wired in main.ts) hangs off these events:
 * once when the lock starts, once when it ends, and nothing while it's held.
 */

function logged(sb: HeadlessSandbox): string[] {
  const log: string[] = [];
  sb.targeting.events.on('targetLocked', () => log.push('locked'));
  sb.targeting.events.on('targetReleased', ({ reason }) => log.push(`released:${reason}`));
  return log;
}

test('lock on once, hold quietly, release once', () => {
  const sb = new HeadlessSandbox();
  sb.addEnemy(0, 5);
  const log = logged(sb);
  sb.run(30, { target: true });
  assert.ok(sb.targeting.isLocked);
  assert.deepEqual(log, ['locked'], 'one chime, not one per frame');
  sb.run(5);
  assert.deepEqual(log, ['locked', 'released:button']);
});

test('nothing in range: no lock-on sound', () => {
  const sb = new HeadlessSandbox();
  sb.addEnemy(0, 40);
  const log = logged(sb);
  sb.run(10, { target: true });
  sb.run(5);
  assert.deepEqual(log, []);
});

test('the target dying under the lock is a lost lock, not a release', () => {
  const sb = new HeadlessSandbox();
  const enemy = sb.addEnemy(0, 5);
  const log = logged(sb);
  sb.run(5, { target: true });
  enemy.alive = false;
  sb.run(5, { target: true });
  assert.deepEqual(log, ['locked', 'released:lost']);
});

/*
 * View lock (the camera recenter): SoundFx.viewLock hangs off viewLocked / viewReleased.
 * It never stacks with the lock-on sound.
 */
function viewLogged(sb: HeadlessSandbox): string[] {
  const log = logged(sb);
  sb.targeting.events.on('viewLocked', () => log.push('view:on'));
  sb.targeting.events.on('viewReleased', () => log.push('view:off'));
  return log;
}

test('target held with nothing in range: view lock on once, off on release', () => {
  const sb = new HeadlessSandbox();
  sb.addEnemy(0, 40);
  const log = viewLogged(sb);
  sb.run(20, { target: true });
  assert.ok(sb.targeting.isViewLocked);
  assert.deepEqual(log, ['view:on']);
  sb.run(5);
  assert.deepEqual(log, ['view:on', 'view:off']);
});

test('a lock never plays the view lock sound', () => {
  const sb = new HeadlessSandbox();
  sb.addEnemy(0, 5);
  const log = viewLogged(sb);
  sb.run(10, { target: true });
  sb.run(5);
  assert.deepEqual(log, ['locked', 'released:button']);
});

test('a target coming into range mid hold hands over to the lock quietly', () => {
  const sb = new HeadlessSandbox();
  const enemy = sb.addEnemy(0, 40);
  const log = viewLogged(sb);
  sb.run(5, { target: true });
  enemy.position.y = 5;
  sb.run(5, { target: true });
  assert.ok(sb.targeting.isLocked);
  sb.run(5);
  assert.deepEqual(log, ['view:on', 'locked', 'released:button']);
});

test('holding on after the target dies stays quiet', () => {
  const sb = new HeadlessSandbox();
  const enemy = sb.addEnemy(0, 5);
  const log = viewLogged(sb);
  sb.run(5, { target: true });
  enemy.alive = false;
  sb.run(5, { target: true });
  assert.ok(sb.targeting.isViewLocked);
  sb.run(5);
  assert.deepEqual(log, ['locked', 'released:lost']);
});
