import { runCapture } from './run.mjs';

/** Pixel formats that carry an alpha channel. */
const ALPHA_PIX_FMT = /^(yuva|rgba|bgra|argb|abgr|ya\d)/;

export function hasAlpha(pixFmt) {
  return ALPHA_PIX_FMT.test(pixFmt);
}

export async function probe(file) {
  const stdout = await runCapture('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,pix_fmt:format=duration',
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
    durationSec: Number(data.format?.duration ?? 0),
  };
}
