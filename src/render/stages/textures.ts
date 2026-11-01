import * as THREE from 'three';

/*
 * Procedural canvas textures for the stages and the dummy. No image files. Without a DOM
 * (headless tests) they come back null and materials fall back to their flat color.
 */

/** Small seeded PRNG, so the textures and scatter look the same on every load. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvasTexture(
  size: number,
  draw: (g: CanvasRenderingContext2D, size: number) => void,
  opts: { repeat?: number; color?: boolean } = {},
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  draw(g, size);
  const tex = new THREE.CanvasTexture(c);
  if (opts.color !== false) tex.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat, opts.repeat);
  }
  tex.anisotropy = 4;
  return tex;
}

/** Speckle noise over a base color: dots of lighter and darker shades. */
function speckle(g: CanvasRenderingContext2D, size: number, base: string, shades: string[], count: number, seed: number, maxR = 2): void {
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    g.fillStyle = shades[Math.floor(r() * shades.length)];
    g.globalAlpha = 0.15 + r() * 0.35;
    const x = r() * size;
    const y = r() * size;
    const rad = 0.5 + r() * maxR;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
    // Wrap the edges so the tile repeats without seams.
    if (x < maxR) g.fillRect(x + size - rad, y - rad, rad * 2, rad * 2);
    if (y < maxR) g.fillRect(x - rad, y + size - rad, rad * 2, rad * 2);
  }
  g.globalAlpha = 1;
}

/** Soft blotches (big, faint circles) for large scale variation. */
function blotches(g: CanvasRenderingContext2D, size: number, shades: string[], count: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = size * (0.05 + r() * 0.15);
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, shades[Math.floor(r() * shades.length)]);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.25;
    g.fillStyle = grad;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.save();
      g.translate(ox, oy);
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      g.restore();
    }
  }
  g.globalAlpha = 1;
}

/** Packed sand for the courtyard floor. Tinted by the material color. */
export const sandTexture = (repeat: number) =>
  canvasTexture(
    512,
    (g, s) => {
      speckle(g, s, '#ffffff', ['#d8cfc0', '#efe8dc', '#bfb3a0', '#fffaf0'], 9000, 11, 1.6);
      blotches(g, s, ['#cfc3ad', '#fff8ea'], 26, 12);
      // Small pebbles.
      const r = rng(13);
      for (let i = 0; i < 220; i++) {
        g.fillStyle = r() < 0.5 ? '#9f9584' : '#c9bfae';
        g.globalAlpha = 0.6;
        g.beginPath();
        g.ellipse(r() * s, r() * s, 1 + r() * 2.5, 1 + r() * 1.8, r() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    },
    { repeat },
  );

/** Grass seen from above: blade speckle and soft patches. */
export const grassTexture = (repeat: number) =>
  canvasTexture(
    512,
    (g, s) => {
      speckle(g, s, '#ffffff', ['#c9d9b0', '#f4ffe6', '#a9bf8e', '#e0ecc8'], 14000, 21, 1.2);
      blotches(g, s, ['#a6b98a', '#ffffff', '#d9caa0'], 30, 22);
      const r = rng(23);
      g.strokeStyle = '#8fa874';
      g.lineWidth = 1;
      for (let i = 0; i < 1600; i++) {
        const x = r() * s;
        const y = r() * s;
        g.globalAlpha = 0.25 + r() * 0.3;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 4);
        g.stroke();
      }
      g.globalAlpha = 1;
    },
    { repeat },
  );

/**
 * Dressed stone blocks in courses, mortar lines between. Rows are offset by half a block,
 * like a real wall. The texture is one block row tall per quarter.
 */
export const stoneBlockTexture = () =>
  canvasTexture(
    512,
    (g, s) => {
      g.fillStyle = '#8f8a84';
      g.fillRect(0, 0, s, s);
      const r = rng(31);
      const rows = 4;
      const rowH = s / rows;
      for (let row = 0; row < rows; row++) {
        const blocks = 3;
        const w = s / blocks;
        const off = row % 2 ? w / 2 : 0;
        for (let b = -1; b <= blocks; b++) {
          const x = b * w + off;
          const shade = 200 + Math.floor(r() * 40);
          g.fillStyle = `rgb(${shade},${shade - 4},${shade - 10})`;
          g.fillRect(x + 3, row * rowH + 3, w - 6, rowH - 6);
          // A darker lower edge and lighter top edge give each block some depth.
          g.fillStyle = 'rgba(0,0,0,0.12)';
          g.fillRect(x + 3, row * rowH + rowH - 9, w - 6, 6);
          g.fillStyle = 'rgba(255,255,255,0.10)';
          g.fillRect(x + 3, row * rowH + 3, w - 6, 4);
        }
      }
      const n = rng(32);
      for (let i = 0; i < 5000; i++) {
        g.fillStyle = n() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
        g.fillRect(n() * s, n() * s, 1 + n() * 2, 1 + n() * 2);
      }
    },
    { repeat: 1 },
  );

/** Fine stone grain for the columns, no mortar. */
export const stoneGrainTexture = () =>
  canvasTexture(
    256,
    (g, s) => {
      speckle(g, s, '#ffffff', ['#d6d0c8', '#f5f1ea', '#bdb6ac'], 5000, 41, 1.4);
      blotches(g, s, ['#c8c0b4', '#ffffff'], 12, 42);
    },
    { repeat: 1 },
  );

/** Woven burlap for the dummy: a coarse over-under weave with uneven threads. */
export const burlapTexture = () =>
  canvasTexture(
    256,
    (g, s) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, s, s);
      const r = rng(51);
      const step = 8;
      for (let y = 0; y < s; y += step) {
        for (let x = 0; x < s; x += step) {
          const over = ((x + y) / step) % 2 === 0;
          const v = 205 + Math.floor(r() * 35);
          g.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
          if (over) g.fillRect(x, y + 1, step, step - 2);
          else g.fillRect(x + 1, y, step - 2, step);
        }
      }
      g.strokeStyle = 'rgba(70,50,30,0.25)';
      for (let i = 0; i <= s; i += step) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, s);
        g.moveTo(0, i);
        g.lineTo(s, i);
        g.stroke();
      }
    },
    { repeat: 1 },
  );

/** Wood grain running along V. */
export const woodTexture = () =>
  canvasTexture(
    256,
    (g, s) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, s, s);
      const r = rng(61);
      for (let i = 0; i < 70; i++) {
        const x = r() * s;
        const v = 150 + Math.floor(r() * 90);
        g.strokeStyle = `rgba(${v},${v - 20},${v - 45},0.5)`;
        g.lineWidth = 1 + r() * 3;
        g.beginPath();
        g.moveTo(x, 0);
        for (let y = 0; y <= s; y += 16) g.lineTo(x + Math.sin(y * 0.03 + i) * 3, y);
        g.stroke();
      }
      // A few knots.
      for (let i = 0; i < 3; i++) {
        g.fillStyle = 'rgba(90,60,35,0.4)';
        g.beginPath();
        g.ellipse(r() * s, r() * s, 3 + r() * 3, 6 + r() * 6, 0, 0, Math.PI * 2);
        g.fill();
      }
    },
    { repeat: 1 },
  );
