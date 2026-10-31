import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * CLAUDE.md hard rule 1: the gameplay core stays engine-agnostic.
 * tsconfig.core.json already fails on DOM use (no DOM lib). This catches the other
 * half: imports of an engine package or of the browser-only folders.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const CORE_DIRS = ['core', 'input', 'targeting', 'combat', 'fsm', 'player', 'feel', 'sandbox', 'camera', 'enemies', 'character'];
const ENGINE_PACKAGES = /^(three|@dimforge\/|postprocessing)/;
const BROWSER_ONLY = ['render', 'app', 'audio', 'physics/RapierMotor', 'physics/RapierCameraProbe'];

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (path.endsWith('.ts')) yield path;
  }
}

function importsOf(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) specs.push(m[1] ?? m[2] ?? m[3]);
  return specs;
}

test('gameplay core imports no engine, renderer or browser-only module', () => {
  const violations: string[] = [];
  for (const dir of CORE_DIRS) {
    for (const file of files(join(SRC, dir))) {
      for (const spec of importsOf(readFileSync(file, 'utf8'))) {
        const target = spec.startsWith('.') ? relative(SRC, resolve(dirname(file), spec)) : null;
        const bad =
          ENGINE_PACKAGES.test(spec) ||
          (target !== null && BROWSER_ONLY.some((b) => target === b || target.startsWith(`${b}/`)));
        if (bad) violations.push(`${relative(SRC, file)} imports "${spec}"`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('boundary check sees real imports (guards against a broken regex)', () => {
  const seen = importsOf(readFileSync(join(SRC, 'player/PlayerController.ts'), 'utf8'));
  assert.ok(seen.includes('./contracts'), `got ${JSON.stringify(seen)}`);
});
