import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Installability checks: the manifest, its icons, the worker and the page that links them. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  display: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
}

test('manifest has what browsers need to offer an install', () => {
  const m = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8')) as Manifest;
  assert.ok(m.name && m.short_name && m.start_url);
  assert.ok(['fullscreen', 'standalone'].includes(m.display));
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'a 192 and a 512 icon');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'a maskable icon for Android');
  for (const icon of m.icons) {
    const file = join(PUBLIC, icon.src);
    assert.ok(existsSync(file), `${icon.src} exists`);
    // PNG header and its pixel size match what the manifest claims.
    const png = readFileSync(file);
    assert.equal(png.toString('ascii', 1, 4), 'PNG');
    const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    assert.equal(`${w}x${h}`, icon.sizes, `${icon.src} is really ${icon.sizes}`);
  }
});

test('the page links the manifest and icons, and a service worker is there to register', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /name="theme-color"/);
  assert.ok(existsSync(join(PUBLIC, 'sw.js')));
  assert.ok(existsSync(join(PUBLIC, 'icons/apple-touch-icon.png')));
});
