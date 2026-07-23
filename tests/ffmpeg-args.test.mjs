import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CHROMAKEY,
  chromakeyFilter,
  buildAlphaArgs,
  buildOpaqueArgs,
} from '../tools/lib/ffmpeg-args.mjs';

const KEY = { key: '0x00FF00', similarity: 0.18, blend: 0.05 };

describe('chromakeyFilter', () => {
  it('emits chromakey followed by despill', () => {
    expect(chromakeyFilter(KEY)).toBe(
      'chromakey=0x00FF00:0.18:0.05,despill=type=green'
    );
  });
});

describe('buildAlphaArgs', () => {
  const args = buildAlphaArgs({ src: 'in.mp4', out: 'out.webm', chromakey: KEY });

  it('disables alt-ref frames', () => {
    // Load-bearing: VP9 alt-ref frames silently destroy the alpha channel.
    const i = args.indexOf('-auto-alt-ref');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('0');
  });

  it('requests an alpha-capable pixel format', () => {
    const i = args.indexOf('-pix_fmt');
    expect(args[i + 1]).toBe('yuva420p');
  });

  it('encodes VP9 video and Opus audio', () => {
    expect(args[args.indexOf('-c:v') + 1]).toBe('libvpx-vp9');
    expect(args[args.indexOf('-c:a') + 1]).toBe('libopus');
  });

  it('puts the output path last', () => {
    expect(args.at(-1)).toBe('out.webm');
  });
});

describe('buildOpaqueArgs', () => {
  const args = buildOpaqueArgs({
    src: 'in.mp4', out: 'out.mp4', chromakey: KEY, width: 1920, height: 1080,
  });

  it('composites the keyed foreground over a black background of source size', () => {
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toContain('color=c=black:s=1920x1080[bg]');
    expect(filter).toContain('[bg][fg]overlay=shortest=1');
  });

  it('flattens to an opaque pixel format', () => {
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('format=yuv420p');
  });

  it('encodes royalty-free VP9, not H.264', () => {
    // Load-bearing: Fedora and Arch ship VLC without an H.264 decoder, so an
    // H.264 desktop file is a black screen there. VP9's decoder is default.
    expect(args[args.indexOf('-c:v') + 1]).toBe('libvpx-vp9');
    expect(args).not.toContain('libx264');
  });

  it('uses constant-quality mode so -crf actually governs the rate', () => {
    // libvpx treats -crf as a mere ceiling unless -b:v is 0.
    expect(args[args.indexOf('-b:v') + 1]).toBe('0');
    expect(args.indexOf('-crf')).toBeGreaterThan(-1);
  });

  it('tolerates a source with no audio track', () => {
    // `0:a?` — the trailing ? makes the audio mapping optional.
    expect(args).toContain('0:a?');
  });
});

describe('DEFAULT_CHROMAKEY', () => {
  it('matches the values documented in the spec', () => {
    expect(DEFAULT_CHROMAKEY).toEqual({
      key: '0x00FF00', similarity: 0.18, blend: 0.05,
    });
  });
});
