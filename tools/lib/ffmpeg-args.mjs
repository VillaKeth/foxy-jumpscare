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
 * Desktop target, transparent: the keyed frames and their alpha matte encoded
 * SIDE BY SIDE in one ordinary video, colour on the left, matte on the right.
 * The player reassembles them into BGRA at blit time.
 *
 * Why not just hand the desktop the alpha WebM the extension already uses:
 * nothing in the desktop stack can decode it. WebM alpha lives in a per-block
 * container extension, and libavcodec - which is what libVLC decodes with -
 * does not surface that plane. `ffmpeg -vf alphaextract` on foxy.webm fails
 * with "Requested planes not available", and VLC inherits exactly that. Every
 * other alpha-capable codec (qtrle, ProRes 4444, FFV1) trades the royalty-free
 * VP9 guarantee that buildOpaqueArgs documents at length. Packing the matte
 * into the picture needs no alpha support from anything, so it cannot regress
 * on a distro that ships a reduced codec set.
 *
 * One video also means one decoder, which is what keeps every monitor in
 * lock-step and the scream playing once - see OverlayWindow.
 *
 * The colour half is flattened over black, which is precisely premultiplied
 * alpha, so the blit needs no divide and dark edge pixels do not halo.
 *
 * 4:2:0, VP9 profile 0 - the same combination as buildOpaqueArgs, which has
 * played on stock Ubuntu, Fedora and Arch. Profile 0 is the widest-support
 * baseline, so it is the right default for a file that has to decode on a
 * stranger's distro.
 *
 * It was briefly 4:4:4 / profile 1, on the theory that half-resolution chroma
 * would let the two halves bleed across the seam. That worry was overstated:
 * the matte is greyscale, so its detail lives entirely in LUMA, which 4:2:0
 * keeps at full resolution - the silhouette stays sharp. Subsampling only
 * shares chroma, and only across the one sample straddling the join, so the
 * error is confined to the first pixel column or two of the matte. That is
 * frame x=0, which is background.
 *
 * Measured on Linux, same clip, same binary: 4:4:4 produced no libVLC
 * converter complaints and 4:2:0 produced 228 of them - but BOTH rendered
 * every frame, and so did the plain 1280-wide foxy.mp4. Those messages are
 * libVLC narrating a failed conversion path before finding a working one, not
 * a failure. They are silenced at the source now (see OverlayWindow's --quiet)
 * rather than steered around by picking a codec profile on log noise.
 *
 * Note what flattens the colour half: `premultiply=inplace=1`, NOT an overlay
 * onto a `color=c=black` source the way buildOpaqueArgs does it. That matters
 * for correctness, not tidiness. `color` synthesises its own timeline at its
 * own default rate - 25 fps - and `overlay` adopts it, so that branch gets
 * resampled while the alphaextract branch stays at the source's 29.97. hstack
 * then lines up two different timelines and the halves stop being the same
 * moment: the matte from one frame punches out the colour of another, which
 * renders as blocks of unkeyed black around anything moving fast. Multiplying
 * in place introduces no second input, so both halves stay frame-locked to the
 * source. Do not reintroduce a synthetic background here.
 */
export function buildMatteArgs({ src, out, chromakey, crf = 18 }) {
  const filter = [
    `[0:v]${chromakeyFilter(chromakey)},split=2[k1][k2]`,
    `[k1]premultiply=inplace=1,format=gbrp[colour]`,
    `[k2]alphaextract,format=gbrp[matte]`,
    `[colour][matte]hstack=inputs=2,format=yuv420p[v]`,
  ].join(';');

  return [
    '-y',
    '-i', src,
    '-filter_complex', filter,
    '-map', '[v]',
    '-map', '0:a?',
    '-c:v', 'libvpx-vp9',
    // Profile 0. Anything higher narrows which libVLC builds can decode AND
    // convert it - see the note above; a recipient lost the picture entirely.
    '-profile:v', '0',
    '-pix_fmt', 'yuv420p',
    '-b:v', '0',
    // Tighter than the opaque build's 30. Quantisation noise in the colour half
    // is a jumpscare nobody inspects; the same noise in the MATTE is a visible
    // halo around a character composited onto the user's actual desktop.
    '-crf', String(crf),
    '-row-mt', '1',
    '-deadline', 'good',
    '-cpu-used', '2',
    '-c:a', 'aac',
    '-b:a', '192k',
    out,
  ];
}

/**
 * Desktop target: keyed foreground flattened over black, VP9 in MP4.
 *
 * Superseded as the default by buildMatteArgs, which lets the overlay be
 * transparent. Still built, and still the fallback both desktop apps load when
 * the matte cut is absent from the pack.
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
 *
 * Known wart, pre-dating the matte cut: the `color` source runs at 25 fps and
 * overlay adopts it, so a 29.97 fps source is resampled 26 frames -> 21 here.
 * Harmless for an opaque fallback; fatal for a matte, which is why
 * buildMatteArgs flattens a different way.
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
