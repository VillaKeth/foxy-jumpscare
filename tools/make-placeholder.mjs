#!/usr/bin/env node
/**
 * Generate a placeholder greenscreen clip at assets/foxy-src.mp4.
 *
 * The real asset is copyrighted FNAF material and is deliberately not in this
 * repo, which would otherwise make the entire pipeline untestable on a fresh
 * checkout. This produces a crude blocky animatronic-fox stand-in on a pure
 * 0x00FF00 background, lunging at the camera, with a noise burst for audio.
 *
 * It is obviously a placeholder and is meant to be. Drop the real clip over the
 * top and rebuild - nothing else changes.
 *
 * Refuses to clobber an existing foxy-src.mp4 without --force. ffmpeg runs with
 * -y, so without that check this overwrites the real clip in place, with no
 * prompt - and the real clip is not in the repo to restore from.
 */
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './lib/run.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const WIDTH = 1280;
const HEIGHT = 720;
const SECONDS = 2;
const FPS = 30;

const RUST = '0x7A2E10';
const DARK = '0x2B1A10';
const EYE = '0xFFD23F';

// Head size grows over the clip: the lunge. Everything else is positioned
// relative to it, so the whole face scales as one.
const S = `(160+t*460)`;
const HX = `((iw-${S})/2)`;
const HY = `((ih-${S})/2)`;

/** drawbox with expression-valued geometry. */
function box(x, y, w, h, color) {
  return `drawbox=x='${x}':y='${y}':w='${w}':h='${h}':color=${color}@1:t=fill`;
}

const face = [
  // ears
  box(`${HX}+${S}*0.02`, `${HY}-${S}*0.24`, `${S}*0.30`, `${S}*0.30`, RUST),
  box(`${HX}+${S}*0.68`, `${HY}-${S}*0.24`, `${S}*0.30`, `${S}*0.30`, RUST),
  // head
  box(HX, HY, S, S, RUST),
  // eyes
  box(`${HX}+${S}*0.18`, `${HY}+${S}*0.26`, `${S}*0.17`, `${S}*0.17`, EYE),
  box(`${HX}+${S}*0.65`, `${HY}+${S}*0.26`, `${S}*0.17`, `${S}*0.17`, EYE),
  // pupils
  box(`${HX}+${S}*0.23`, `${HY}+${S}*0.31`, `${S}*0.07`, `${S}*0.07`, DARK),
  box(`${HX}+${S}*0.70`, `${HY}+${S}*0.31`, `${S}*0.07`, `${S}*0.07`, DARK),
  // snout / open jaw
  box(`${HX}+${S}*0.30`, `${HY}+${S}*0.60`, `${S}*0.40`, `${S}*0.32`, DARK),
  // teeth
  box(`${HX}+${S}*0.34`, `${HY}+${S}*0.60`, `${S}*0.06`, `${S}*0.10`, '0xFFFFFF'),
  box(`${HX}+${S}*0.47`, `${HY}+${S}*0.60`, `${S}*0.06`, `${S}*0.10`, '0xFFFFFF'),
  box(`${HX}+${S}*0.60`, `${HY}+${S}*0.60`, `${S}*0.06`, `${S}*0.10`, '0xFFFFFF'),
].join(',');

const out = join(REPO_ROOT, 'assets', 'foxy-src.mp4');

if (existsSync(out) && !process.argv.includes('--force')) {
  console.error(`  ${out} already exists - leaving it alone.`);
  console.error('  That file is the real greenscreen source on a populated checkout,');
  console.error('  it is gitignored, and nothing here can put it back. Overwrite with:');
  console.error('    npm run assets:placeholder -- --force');
  process.exit(1);
}

await run('ffmpeg', [
  '-y',
  '-f', 'lavfi', '-i', `color=c=0x00FF00:s=${WIDTH}x${HEIGHT}:d=${SECONDS}:r=${FPS}`,
  '-f', 'lavfi', '-i', `anoisesrc=d=${SECONDS}:c=pink:a=0.5`,
  '-filter_complex', `[0:v]${face}[v]`,
  '-map', '[v]',
  '-map', '1:a',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
  '-c:a', 'aac', '-b:a', '128k',
  '-shortest',
  out,
]);

console.log(`  placeholder  ${out}`);
console.log('  This is a stand-in. Replace it with the real greenscreen clip and rerun "npm run assets".');
