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

/**
 * Desktop target: keyed foreground flattened over black, VP9 in MP4.
 *
 * VP9, not H.264, and the reason is portability, not preference. H.264 is
 * patent-encumbered, so Fedora and Arch/EndeavourOS ship their VLC WITHOUT its
 * decoder by default - installing the full `vlc` player is not enough on Arch.
 * The scare was then a silent black screen on those distros: libVLC loaded,
 * every other plugin loaded, and only the H.264 frames never decoded. VP9's
 * decoder (libvpx) is royalty-free and ships in the base VLC package on every
 * mainstream distro, so the same file plays on stock Ubuntu, Fedora and Arch
 * with nothing extra installed - verified across all three.
 *
 * The container stays .mp4 and the codec tag is vp09; libVLC probes by content,
 * so the desktop apps load the same "foxy.mp4" path unchanged. Audio stays AAC:
 * its free decoder (faad) is also default across distros, so the scream plays
 * where the picture does.
 */
export function buildOpaqueArgs({ src, out, chromakey, width, height, crf = 30 }) {
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
    '-c:v', 'libvpx-vp9',
    // -b:v 0 puts libvpx in constant-quality mode, where -crf alone governs
    // the rate; without it the CRF is only a ceiling and the file bloats.
    '-b:v', '0',
    '-crf', String(crf),
    // row-mt + a mid deadline keep the VP9 encode from being glacial; the clip
    // is a second long, so quality per byte matters more than encode wall time.
    '-row-mt', '1',
    '-deadline', 'good',
    '-cpu-used', '2',
    '-c:a', 'aac',
    '-b:a', '192k',
    out,
  ];
}
