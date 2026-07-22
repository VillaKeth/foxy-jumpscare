#!/usr/bin/env node
/**
 * Generate the extension icons.
 *
 * Deliberately original art, not a frame of the video: the icon is the one
 * image that ends up on the store listing, in the toolbar, and in every
 * screenshot of the browser's extension list. Deriving it from copyrighted
 * material would put that material in all of those places.
 *
 * A stylised fox head - bold shapes only, because it has to survive being
 * rendered at 16px. No image library; PNG is encoded here with zlib, which
 * node already has.
 *
 * Usage: npm run icons
 */
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from './lib/crc32.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(REPO_ROOT, 'extension', 'src', 'icons');
const SIZES = [16, 32, 48, 96, 128];

// --- minimal PNG encoder ---------------------------------------------------

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const body = out.subarray(4, 8 + data.length);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  // 10..12 default to 0: deflate, adaptive filtering, no interlace

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- the icon --------------------------------------------------------------

const BG = [26, 17, 20, 255];
const FUR = [190, 58, 26, 255];
const FUR_DARK = [140, 38, 16, 255];
const MUZZLE = [38, 22, 18, 255];
const EYE = [255, 205, 60, 255];
const PUPIL = [20, 12, 10, 255];

/** Signed distance style helpers, all in 0..1 space. */
const inEllipse = (x, y, cx, cy, rx, ry) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

/** Point-in-triangle via barycentric sign tests. */
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = d(px, py, ax, ay, bx, by);
  const d2 = d(px, py, bx, by, cx, cy);
  const d3 = d(px, py, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function colourAt(x, y) {
  // Ears first so the head overlaps their bases.
  if (inTriangle(x, y, 0.16, 0.44, 0.30, 0.06, 0.44, 0.40)) return FUR_DARK;
  if (inTriangle(x, y, 0.84, 0.44, 0.70, 0.06, 0.56, 0.40)) return FUR_DARK;

  if (inEllipse(x, y, 0.5, 0.56, 0.36, 0.34)) {
    // Snout, kept small and low so it reads as a muzzle rather than a mouth.
    if (inEllipse(x, y, 0.5, 0.80, 0.115, 0.085)) return MUZZLE;

    // Eyes
    for (const cx of [0.355, 0.645]) {
      if (inEllipse(x, y, cx, 0.545, 0.082, 0.070)) {
        return inEllipse(x, y, cx, 0.55, 0.034, 0.036) ? PUPIL : EYE;
      }
    }
    return FUR;
  }

  return BG;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  // 2x supersampling: at 16px an aliased edge is the difference between a fox
  // and a smudge.
  const samples = [0.25, 0.75];

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const sy of samples) {
        for (const sx of samples) {
          const [cr, cg, cb, ca] = colourAt((px + sx) / size, (py + sy) / size);
          r += cr; g += cg; b += cb; a += ca;
        }
      }
      const n = samples.length ** 2;
      const i = (py * size + px) * 4;
      rgba[i] = Math.round(r / n);
      rgba[i + 1] = Math.round(g / n);
      rgba[i + 2] = Math.round(b / n);
      rgba[i + 3] = Math.round(a / n);
    }
  }
  return rgba;
}

await mkdir(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  await writeFile(file, encodePng(size, render(size)));
  console.log(`  ${size}x${size}  ${file}`);
}
