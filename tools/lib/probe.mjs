import { runCapture } from './run.mjs';

/** Pixel formats that carry an alpha channel in the primary stream. */
const ALPHA_PIX_FMT = /^(yuva|rgba|bgra|argb|abgr|ya\d)/;

export function hasAlpha(pixFmt) {
  return ALPHA_PIX_FMT.test(pixFmt);
}

/**
 * Whether a probed file carries alpha at all.
 *
 * WebM/VP9 does not signal alpha through the pixel format: the primary stream
 * stays yuv420p and the alpha plane rides alongside it in a separate Matroska
 * layer, flagged by the track's AlphaMode element. Checking pix_fmt alone
 * reports a perfectly good alpha WebM as opaque.
 */
export function carriesAlpha(info) {
  return hasAlpha(info.pixFmt) || info.alphaMode;
}

/**
 * Exact decoded frame count. Slower than reading nb_frames because it walks the
 * file, but nb_frames is a container hint and is absent or wrong often enough
 * that it cannot be used to prove a filtergraph did not resample.
 */
export async function countFrames(file) {
  const stdout = await runCapture('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-count_frames',
    '-show_entries', 'stream=nb_read_frames',
    '-of', 'json',
    file,
  ]);
  return Number(JSON.parse(stdout).streams?.[0]?.nb_read_frames ?? 0);
}

export async function probe(file) {
  const stdout = await runCapture('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,pix_fmt:stream_tags=alpha_mode:format=duration',
    '-of', 'json',
    file,
  ]);

  const data = JSON.parse(stdout);
  const stream = data.streams?.[0];
  if (!stream) {
    throw new Error(`No video stream found in ${file}`);
  }

  return {
    width: stream.width,
    height: stream.height,
    pixFmt: stream.pix_fmt,
    alphaMode: stream.tags?.alpha_mode === '1',
    durationSec: Number(data.format?.duration ?? 0),
  };
}
