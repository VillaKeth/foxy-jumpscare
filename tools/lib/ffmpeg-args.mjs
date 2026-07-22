/**
 * Pure ffmpeg argument construction. No subprocesses, no I/O — this module
 * exists so the encoder flags can be asserted in fast unit tests instead of
 * only being verifiable by inspecting output video.
 */

export const DEFAULT_CHROMAKEY = {
  key: '0x00FF00',
  similarity: 0.18,
  blend: 0.05,
};

export function chromakeyFilter({ key, similarity, blend }) {
  return `chromakey=${key}:${similarity}:${blend},despill=type=green`;
}

/** Extension target: VP9 with a real alpha channel, in WebM. */
export function buildAlphaArgs({ src, out, chromakey, bitrate = '2M' }) {
  return [
    '-y',
    '-i', src,
    '-vf', `${chromakeyFilter(chromakey)},format=yuva420p`,
    '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuva420p',
    // Mandatory, not stylistic: alt-ref frames destroy the alpha channel.
    '-auto-alt-ref', '0',
    '-b:v', bitrate,
    '-c:a', 'libopus',
    '-b:a', '128k',
    out,
  ];
}

/** Desktop target: keyed foreground flattened over black, H.264 in MP4. */
export function buildOpaqueArgs({ src, out, chromakey, width, height, crf = 18 }) {
  const filter = [
    `[0:v]${chromakeyFilter(chromakey)}[fg]`,
    `color=c=black:s=${width}x${height}[bg]`,
    `[bg][fg]overlay=shortest=1,format=yuv420p[v]`,
  ].join(';');

  return [
    '-y',
    '-i', src,
    '-filter_complex', filter,
    '-map', '[v]',
    // Trailing ? keeps a silent source from failing the whole encode.
    '-map', '0:a?',
    '-c:v', 'libx264',
    '-crf', String(crf),
    '-preset', 'slow',
    '-c:a', 'aac',
    '-b:a', '192k',
    out,
  ];
}
