#!/usr/bin/env node
/**
 * Generate the extension icons.
 *
 * Two sources, in priority order:
 *
 *  1. `assets/foxy-icon.png`, if the local pack has one. Cropped to the head
 *     and resized, exactly like the desktop tray icon - a full-body render is
 *     an unreadable smudge at 16px.
 *  2. Otherwise, original art drawn below: a stylised fox head, bold shapes
 *     only, so it survives 16px. No image library; PNG is encoded here with
 *     zlib, which node already has.
 *
 * The fallback is not a consolation prize. It is what a clone of this repo
 * builds, because the pack image is copyrighted FNAF material and gitignored
 * like every other asset. The icon is also the most public artifact there is -
 * store listing, toolbar, AMO's public API - so deriving it from the pack is a
 * deliberate local choice, not the default. See assets/PACK.md.
 *
 * The output directory is derived, not tracked.
 *
 * Usage: npm run icons
 *        node tools/make-icons.mjs --source path.png --crop-x 145 --crop-y 8 --crop-side 360
 */
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from './lib/crc32.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(REPO_ROOT, 'extension', 'src', 'icons');
const SIZES = [16, 32, 48, 96, 128];

// Tuned to the Withered Foxy render in this pack: ear tips to just under the
// open jaw. Override for a different source image.
const DEFAULT_CROP = { x: 145, y: 8, side: 360 };

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

// --- deriving from the pack image ------------------------------------------

/** `--crop-x 145` -> `{ 'crop-x': '145' }`. Absent flags stay undefined. */
function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

/**
 * Crop to the head, then resize. Lanczos rather than the default: at 16px the
 * difference between a fox and a smudge is entirely in the resampling.
 *
 * -pix_fmt rgba is load-bearing - the source render is transparent outside the
 * subject, and losing that alpha puts a black box in the toolbar.
 */
function deriveIcon(source, crop, size, outFile) {
  const filter = [
    `crop=${crop.side}:${crop.side}:${crop.x}:${crop.y}`,
    `scale=${size}:${size}:flags=lanczos`,
  ].join(',');

  const res = spawnSync(
    'ffmpeg',
    ['-y', '-v', 'error', '-i', source, '-vf', filter, '-pix_fmt', 'rgba', outFile],
    { encoding: 'utf8' }
  );

  if (res.error) throw new Error(`ffmpeg not runnable: ${res.error.message}`);
  if (res.status !== 0) throw new Error(res.stderr.trim() || `ffmpeg exited ${res.status}`);
}

// --- main ------------------------------------------------------------------

const argv = flags(process.argv.slice(2));
const source = resolve(argv.source ?? join(REPO_ROOT, 'assets', 'foxy-icon.png'));
const crop = {
  x: Number(argv['crop-x'] ?? DEFAULT_CROP.x),
  y: Number(argv['crop-y'] ?? DEFAULT_CROP.y),
  side: Number(argv['crop-side'] ?? DEFAULT_CROP.side),
};

await mkdir(OUT_DIR, { recursive: true });

// An explicit --source that is missing is a typo, not a fallback: fail loudly
// rather than silently shipping the drawn art the caller did not ask for.
if (argv.source && !existsSync(source)) {
  console.error(`\nSource image not found: ${source}\n`);
  process.exit(1);
}

const usePack = existsSync(source);

// Without a pack image, icons already on disk are left alone. That is what
// makes the submitted package reproducible: an AMO reviewer copies icons/*.png
// out of it, builds, and gets the same bytes back - exactly as they already do
// with foxy.webm. Redrawing over them here would guarantee a mismatch instead.
// Delete the directory to force the original art back.
if (!usePack && SIZES.every((size) => existsSync(join(OUT_DIR, `icon-${size}.png`)))) {
  console.log(`  keeping existing icons in ${OUT_DIR} (no pack image)`);
  process.exit(0);
}

console.log(usePack ? `  from ${source}` : '  from original art (no pack image)');

for (const size of SIZES) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  if (usePack) deriveIcon(source, crop, size, file);
  else await writeFile(file, encodePng(size, render(size)));
  console.log(`  ${size}x${size}  ${file}`);
}
