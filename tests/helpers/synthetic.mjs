import { run } from '../../tools/lib/run.mjs';

/**
 * Generate a synthetic greenscreen clip: pure 0x00FF00 background with an
 * opaque red box in the middle, and a sine tone for the audio track.
 * Keying the green should leave the red box and nothing else.
 */
export function makeGreenscreen(out, { seconds = 1, width = 320, height = 240, fps = 25 } = {}) {
  const boxW = Math.floor(width / 3);
  const boxH = Math.floor(height / 3);
  const boxX = Math.floor((width - boxW) / 2);
  const boxY = Math.floor((height - boxH) / 2);

  return run('ffmpeg', [
    '-y',
    // The rate is a parameter because 25 is also ffmpeg's default for a
    // synthesised source, so a 25 fps fixture cannot detect a filtergraph
    // branch that silently resamples TO 25. See the matte test.
    '-f', 'lavfi', '-i', `color=c=0x00FF00:s=${width}x${height}:d=${seconds}:r=${fps}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-vf', `drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=red@1:t=fill`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-shortest',
    out,
  ]);
}
