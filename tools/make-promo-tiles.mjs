#!/usr/bin/env node
/**
 * Store promotional tiles, composited with ffmpeg.
 *
 * Chrome Web Store and Microsoft Partner Center happen to want the same two
 * sizes, so one run serves both listings:
 *
 *   440x280   "small promotional tile"
 *   1400x560  "large promotional tile" / "marquee"
 *
 * Both are optional on both stores and both affect placement, which is the
 * whole reason to bother: a listing with no tile is much less likely to be
 * surfaced anywhere but search results.
 *
 * These live in dist/store/ alongside the listing logo, NOT in extension/src/.
 * Nothing here is part of the shipped package - see the STORE_SIZES comment in
 * make-icons.mjs for why that separation matters.
 *
 * The head crop is deliberately the same one make-icons.mjs uses, so the tile
 * and the icon are recognisably the same fox at different sizes.
 *
 * Text is drawn with libfreetype via ffmpeg's drawtext. Apostrophes are avoided
 * in the copy rather than escaped: they need backslash-escaping inside a
 * filtergraph, and a stray one silently truncates the string rather than
 * failing, which is the kind of bug you only catch by looking at the output.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(REPO_ROOT, 'assets', 'foxy-icon.png');
const OUT_DIR = join(REPO_ROOT, 'dist', 'store');

// Matches DEFAULT_CROP in make-icons.mjs: ear tips to just under the open jaw.
const CROP = { x: 145, y: 8, side: 360 };

// Near-black with a red lift, rather than flat black. The extension is horror
// and the panel's own accent is this red, so the tiles read as the same product.
//
// Kept much darker and less saturated than the obvious choice: the fox is
// himself red, and a background anywhere near his own hue swallows him. The
// separation comes from his lit highlights against near-black, not from
// contrast in colour.
const BG_DARK = '0x080506';
const BG_LIFT = '0x1f0b09';

const FONT = 'C\\:/Windows/Fonts/arialbd.ttf';

// Arial Bold advance widths, measured off the rendered tiles rather than
// guessed. One ratio is not enough: all-caps runs about 0.68em per character
// while mixed case with digits and spaces runs about 0.47em, and using a single
// middling value let "JUMPSCARE" overhang the small tile while reporting fit.
// Both are rounded up, because the only job here is catching overflow.
const CAPS_WIDTH_RATIO = 0.72;
const MIXED_WIDTH_RATIO = 0.55;
const SAFE_MARGIN = 24;

// A space is roughly 0.28em, well under any letter, so counting it as a full
// character is what made the guard reject a marquee title that actually fitted.
const SPACE_WIDTH_RATIO = 0.28;

function estimateWidth(text, size) {
  const ratio = /[a-z]/.test(text) ? MIXED_WIDTH_RATIO : CAPS_WIDTH_RATIO;
  const spaces = (text.match(/ /g) ?? []).length;
  return ((text.length - spaces) * ratio + spaces * SPACE_WIDTH_RATIO) * size;
}

const TILES = [
  {
    name: 'promo-small-440x280.png',
    w: 440,
    h: 280,
    fox: { size: 158, x: 16, y: 62 },
    text: [
      { t: 'FOXY',      size: 34, x: 190, y: 92,  colour: 'white' },
      { t: 'JUMPSCARE', size: 34, x: 190, y: 134, colour: '0xE0503A' },
      { t: '1 in 100,000 a second', size: 16, x: 192, y: 188, colour: '0xB9A7A3' },
    ],
  },
  {
    name: 'promo-marquee-1400x560.png',
    w: 1400,
    h: 560,
    fox: { size: 430, x: 96, y: 66 },
    text: [
      { t: 'FOXY JUMPSCARE', size: 84, x: 520, y: 180, colour: 'white' },
      { t: '1 in 100,000 every active second.',
        size: 32, x: 524, y: 298, colour: '0xB9A7A3' },
      { t: 'It waits. Sometimes for a week.',
        size: 32, x: 524, y: 346, colour: '0xE0503A' },
    ],
  },
];

/**
 * drawtext silently draws past the frame edge rather than failing, so an
 * overlong string just loses its tail in the output PNG - invisible unless
 * somebody opens the file. Both tiles shipped truncated on the first run for
 * exactly this reason. Fail the build instead.
 */
function assertFits(tile) {
  for (const line of tile.text) {
    const estimated = estimateWidth(line.t, line.size);
    const right = line.x + estimated;
    if (right > tile.w - SAFE_MARGIN) {
      throw new Error(
        `${tile.name}: "${line.t}" needs about ${Math.round(right)}px but the tile ` +
        `is ${tile.w}px. Shrink fontsize, move x left, or shorten the copy.`
      );
    }
  }
}

function buildFilter(tile) {
  const steps = [
    // Diagonal wash, then the head over it.
    `[0:v]scale=${tile.w}:${tile.h}[bg]`,
    `[1:v]crop=${CROP.side}:${CROP.side}:${CROP.x}:${CROP.y},` +
      `scale=${tile.fox.size}:${tile.fox.size}:flags=lanczos[fox]`,
    `[bg][fox]overlay=${tile.fox.x}:${tile.fox.y}[composed]`,
  ];

  // Each drawtext consumes the previous label and emits the next.
  let label = 'composed';
  tile.text.forEach((line, i) => {
    const next = i === tile.text.length - 1 ? 'out' : `t${i}`;
    steps.push(
      `[${label}]drawtext=fontfile='${FONT}':text='${line.t}':` +
        `fontsize=${line.size}:fontcolor=${line.colour}:x=${line.x}:y=${line.y}[${next}]`
    );
    label = next;
  });

  return steps.join(';');
}

function render(tile) {
  const out = join(OUT_DIR, tile.name);
  const args = [
    '-y', '-v', 'error',
    // A single gradient frame. d=1 keeps it from generating a timeline.
    '-f', 'lavfi',
    '-i', `gradients=s=${tile.w}x${tile.h}:c0=${BG_DARK}:c1=${BG_LIFT}` +
          `:x0=0:y0=0:x1=${tile.w}:y1=${tile.h}:type=linear:d=1`,
    '-i', SOURCE,
    '-filter_complex', buildFilter(tile),
    '-map', '[out]',
    '-frames:v', '1',
    out,
  ];

  const res = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (res.error) throw new Error(`ffmpeg not runnable: ${res.error.message}`);
  if (res.status !== 0) throw new Error(res.stderr.trim() || `ffmpeg exited ${res.status}`);

  return out;
}

if (!existsSync(SOURCE)) {
  console.error(`\nSource image not found: ${SOURCE}\nPopulate the pack per assets/PACK.md.\n`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const tile of TILES) {
  assertFits(tile);
  console.log(`  ${tile.w}x${tile.h}  ${render(tile)}`);
}
