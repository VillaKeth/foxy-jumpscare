import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, loadPack, buildAssets } from '../tools/build-assets.mjs';
import { probe, carriesAlpha } from '../tools/lib/probe.mjs';
import { makeGreenscreen } from './helpers/synthetic.mjs';

const PACK = {
  name: 'test-pack',
  source: 'src.mp4',
  web: 'out.webm',
  desktop: 'out.mp4',
  chromakey: { key: '0x00FF00', similarity: 0.3, blend: 0.1 },
};

describe('parseArgs', () => {
  it('parses the tuning flags', () => {
    const opts = parseArgs(['--key', '0x00FF01', '--similarity', '0.25', '--blend', '0.08']);
    expect(opts).toEqual({ key: '0x00FF01', similarity: 0.25, blend: 0.08 });
  });

  it('returns an empty object when no flags are given', () => {
    expect(parseArgs([])).toEqual({});
  });

  it('rejects a flag with no value', () => {
    expect(() => parseArgs(['--similarity'])).toThrow(/--similarity/);
  });

  it('rejects a non-numeric similarity', () => {
    expect(() => parseArgs(['--similarity', 'loud'])).toThrow(/number/);
  });
});

describe('buildAssets', () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'foxy-build-'));
    await writeFile(join(dir, 'pack.json'), JSON.stringify(PACK, null, 2));
    await makeGreenscreen(join(dir, 'src.mp4'), { seconds: 1, width: 320, height: 240 });
  }, 120_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('emits a WebM flagged as carrying alpha', async () => {
    const { webm } = await buildAssets({ assetsDir: dir });
    const info = await probe(webm);
    // AlphaMode is the container-level flag browsers read. pix_fmt stays
    // yuv420p for VP9 alpha regardless, so it is not the signal to check.
    //
    // Necessary but NOT sufficient, and deliberately not claimed to be more:
    // this flag is set with or without -auto-alt-ref 0 on ffmpeg 8.x, and
    // ffmpeg cannot decode VP9 alpha back, so no ffmpeg-side check can prove
    // the key actually produced transparency. That is verified in a browser
    // (Task 4). Measured there: keyed-out pixels read RGBA [0,0,0,0].
    expect(carriesAlpha(info)).toBe(true);
    expect(info.alphaMode).toBe(true);
  }, 120_000);

  it('emits an opaque MP4 at source dimensions', async () => {
    const { mp4 } = await buildAssets({ assetsDir: dir });
    const info = await probe(mp4);
    expect(carriesAlpha(info)).toBe(false);
    expect(info.width).toBe(320);
    expect(info.height).toBe(240);
  }, 120_000);

  it('preserves the source duration in both outputs', async () => {
    const { webm, mp4 } = await buildAssets({ assetsDir: dir });
    const src = await probe(join(dir, 'src.mp4'));
    expect((await probe(webm)).durationSec).toBeCloseTo(src.durationSec, 0);
    expect((await probe(mp4)).durationSec).toBeCloseTo(src.durationSec, 0);
  }, 120_000);

  it('reports a clear error when the source is missing', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'foxy-empty-'));
    await writeFile(join(empty, 'pack.json'), JSON.stringify(PACK, null, 2));
    await expect(buildAssets({ assetsDir: empty })).rejects.toThrow(/src\.mp4/);
    await rm(empty, { recursive: true, force: true });
  });
});

describe('loadPack', () => {
  it('rejects a pack missing a required field', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'foxy-pack-'));
    await writeFile(join(dir, 'pack.json'), JSON.stringify({ name: 'broken' }));
    await expect(loadPack(join(dir, 'pack.json'))).rejects.toThrow(/source/);
    await rm(dir, { recursive: true, force: true });
  });
});
