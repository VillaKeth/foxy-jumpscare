import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probe, hasAlpha } from '../tools/lib/probe.mjs';
import { run } from '../tools/lib/run.mjs';
import { makeGreenscreen } from './helpers/synthetic.mjs';

let dir;
let src;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'foxy-probe-'));
  src = join(dir, 'src.mp4');
  await makeGreenscreen(src, { seconds: 1, width: 320, height: 240 });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('probe', () => {
  it('reports dimensions, pixel format and duration', async () => {
    const info = await probe(src);
    expect(info.width).toBe(320);
    expect(info.height).toBe(240);
    expect(info.pixFmt).toBe('yuv420p');
    expect(info.durationSec).toBeCloseTo(1, 1);
  });

  it('rejects a file with no video stream', async () => {
    const audioOnly = join(dir, 'audio.m4a');
    await run('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:a', 'aac', audioOnly,
    ]);
    await expect(probe(audioOnly)).rejects.toThrow(/no video stream/i);
  });
});

describe('hasAlpha', () => {
  it('recognises alpha-carrying pixel formats', () => {
    expect(hasAlpha('yuva420p')).toBe(true);
    expect(hasAlpha('rgba')).toBe(true);
    expect(hasAlpha('bgra')).toBe(true);
  });

  it('rejects opaque pixel formats', () => {
    expect(hasAlpha('yuv420p')).toBe(false);
    expect(hasAlpha('rgb24')).toBe(false);
    // Guards a substring bug: yuv444p contains no alpha despite the 'yuv'.
    expect(hasAlpha('yuv444p')).toBe(false);
  });
});

describe('run', () => {
  it('rejects with a readable message when the binary is missing', async () => {
    await expect(run('definitely-not-a-real-binary', [])).rejects.toThrow(
      /not found on PATH/
    );
  });

  it('rejects with the exit code when the command fails', async () => {
    await expect(run('ffmpeg', ['-i', 'no-such-file.mp4'])).rejects.toThrow(
      /exited with code/
    );
  });
});
