# Asset Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `tools/build-assets.mjs`, which keys the green out of a source greenscreen video and emits the two derived formats the extension and desktop app each require.

**Architecture:** A thin CLI over ffmpeg, split into three focused modules: pure argument builders (unit-testable with no subprocess), an ffprobe wrapper, and a subprocess runner. The CLI composes them. Purity in the argument builders is what makes the critical `-auto-alt-ref 0` flag assertable in a fast unit test rather than only discoverable by eyeballing output video.

**Tech Stack:** Node 24 ESM (no runtime dependencies beyond node builtins), vitest for tests, ffmpeg + ffprobe on PATH.

## Global Constraints

- Node 24+, ESM only (`.mjs`, `import`). No CommonJS.
- **Zero runtime npm dependencies.** vitest is `devDependencies` only.
- ffmpeg and ffprobe must be on PATH. Verified present on this box: ffmpeg 8.1.1.
- The VP9 alpha pass **must** pass `-auto-alt-ref 0`. Alt-ref frames silently destroy the alpha channel; the failure presents as "transparency randomly stopped working."
- Alpha output pixel format is `yuva420p`. Opaque output is `yuv420p`.
- All media in `assets/` is gitignored, **including the source**. Only `assets/pack.json` is tracked.
- Keying parameters live in `assets/pack.json` so a rebuild reproduces the tuned result, not the defaults.
- Default chromakey values: key `0x00FF00`, similarity `0.18`, blend `0.05`.

---

### Task 1: Argument builders

Scaffolds the npm project (this is the first task that needs it) and implements the pure ffmpeg argument construction.

**Files:**
- Create: `package.json`
- Create: `vitest.config.mjs`
- Create: `tools/lib/ffmpeg-args.mjs`
- Test: `tests/ffmpeg-args.test.mjs`
- Modify: `.claude/CLAUDE.md` (build commands), `README.md` (build commands)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `DEFAULT_CHROMAKEY: { key: string, similarity: number, blend: number }`
  - `chromakeyFilter(chromakey) -> string`
  - `buildAlphaArgs({ src, out, chromakey, bitrate? }) -> string[]`
  - `buildOpaqueArgs({ src, out, chromakey, width, height, crf? }) -> string[]`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "foxy-jumpscare",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "assets": "node tools/build-assets.mjs",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create `vitest.config.mjs`**

Integration tests shell out to ffmpeg, which is far slower than the default 5s timeout allows.

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
```

- [ ] **Step 3: Install**

Run: `npm install`
Expected: `added N packages`, and `node_modules/` created. `node_modules/` is already gitignored.

- [ ] **Step 4: Write the failing test**

Create `tests/ffmpeg-args.test.mjs`:

```javascript
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
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test -- ffmpeg-args`
Expected: FAIL — `Failed to load ../tools/lib/ffmpeg-args.mjs`

- [ ] **Step 6: Write the implementation**

Create `tools/lib/ffmpeg-args.mjs`:

```javascript
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
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- ffmpeg-args`
Expected: PASS, 9 tests.

- [ ] **Step 8: Update the documented build commands**

Both docs currently say `npm --prefix extension ...`. The project uses a single root `package.json` instead.

In `README.md`, replace the assets line in the Build block:

```
# Assets — keys the greenscreen source into the two derived formats
npm run assets
```

In `.claude/CLAUDE.md`, replace the assets line in the toolchain block:

```
# assets — run first; both builds expect the derived files
npm run assets
```

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.mjs tools/lib/ffmpeg-args.mjs tests/ffmpeg-args.test.mjs README.md .claude/CLAUDE.md
git commit -m "feat(assets): add ffmpeg argument builders"
```

---

### Task 2: Subprocess runner and ffprobe wrapper

**Files:**
- Create: `tools/lib/run.mjs`
- Create: `tools/lib/probe.mjs`
- Create: `tests/helpers/synthetic.mjs`
- Test: `tests/probe.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces:
  - `run(cmd, args) -> Promise<void>` — rejects with a readable message on non-zero exit or missing binary
  - `probe(file) -> Promise<{ width, height, pixFmt, durationSec }>`
  - `hasAlpha(pixFmt) -> boolean`
  - `makeGreenscreen(path, { seconds?, width?, height? }) -> Promise<void>` (test helper)

- [ ] **Step 1: Write the failing test**

Create `tests/probe.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- probe`
Expected: FAIL — `Failed to load ../tools/lib/probe.mjs`

- [ ] **Step 3: Write the subprocess runner**

Create `tools/lib/run.mjs`:

```javascript
import { spawn } from 'node:child_process';

/**
 * Run a command to completion. Resolves on exit 0, rejects otherwise.
 * ffmpeg writes progress to stderr, so stderr is captured rather than
 * inherited, and only surfaced when something actually failed.
 */
export function run(cmd, args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      onStderr?.(chunk.toString());
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`${cmd} not found on PATH. Install it and retry.`));
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} exited with code ${code}\n${stderr.slice(-2000)}`));
      }
    });
  });
}

/** Same as run(), but resolves with stdout. */
export function runCapture(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`${cmd} not found on PATH. Install it and retry.`));
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${cmd} exited with code ${code}\n${stderr.slice(-2000)}`));
      }
    });
  });
}
```

- [ ] **Step 4: Write the probe wrapper**

Create `tools/lib/probe.mjs`:

```javascript
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
```

- [ ] **Step 5: Write the synthetic-clip test helper**

Create `tests/helpers/synthetic.mjs`. This is what makes the pipeline testable without the real Foxy footage: a solid green frame with a red box on it, plus a tone, so keying the green should leave exactly the red box.

```javascript
import { run } from '../../tools/lib/run.mjs';

/**
 * Generate a synthetic greenscreen clip: pure 0x00FF00 background with an
 * opaque red box in the middle, and a sine tone for the audio track.
 * Keying the green should leave the red box and nothing else.
 */
export function makeGreenscreen(out, { seconds = 1, width = 320, height = 240 } = {}) {
  const boxW = Math.floor(width / 3);
  const boxH = Math.floor(height / 3);
  const boxX = Math.floor((width - boxW) / 2);
  const boxY = Math.floor((height - boxH) / 2);

  return run('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', `color=c=0x00FF00:s=${width}x${height}:d=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-vf', `drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=red@1:t=fill`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-shortest',
    out,
  ]);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- probe`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add tools/lib/run.mjs tools/lib/probe.mjs tests/helpers/synthetic.mjs tests/probe.test.mjs
git commit -m "feat(assets): add subprocess runner and ffprobe wrapper"
```

---

### Task 3: The build script

**Files:**
- Create: `tools/build-assets.mjs`
- Create: `assets/pack.json`
- Test: `tests/build-assets.test.mjs`

**Interfaces:**
- Consumes: `buildAlphaArgs`, `buildOpaqueArgs`, `DEFAULT_CHROMAKEY` (Task 1); `run`, `probe`, `hasAlpha` (Task 2); `makeGreenscreen` (Task 2)
- Produces:
  - `parseArgs(argv) -> { key?, similarity?, blend?, src?, outDir? }`
  - `loadPack(packPath) -> Promise<pack>`
  - `buildAssets({ assetsDir, overrides }) -> Promise<{ webm, mp4 }>`

- [ ] **Step 1: Create the tracked manifest**

Create `assets/pack.json`:

```json
{
  "name": "withered-foxy",
  "source": "foxy-src.mp4",
  "web": "foxy.webm",
  "desktop": "foxy.mp4",
  "chromakey": {
    "key": "0x00FF00",
    "similarity": 0.18,
    "blend": 0.05
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/build-assets.test.mjs`:

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, loadPack, buildAssets } from '../tools/build-assets.mjs';
import { probe, hasAlpha } from '../tools/lib/probe.mjs';
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

  it('emits a WebM that actually carries alpha', async () => {
    const { webm } = await buildAssets({ assetsDir: dir });
    const info = await probe(webm);
    // Regression guard for -auto-alt-ref: without it this comes back opaque.
    expect(hasAlpha(info.pixFmt)).toBe(true);
    expect(info.pixFmt).toBe('yuva420p');
  }, 120_000);

  it('emits an opaque MP4 at source dimensions', async () => {
    const { mp4 } = await buildAssets({ assetsDir: dir });
    const info = await probe(mp4);
    expect(hasAlpha(info.pixFmt)).toBe(false);
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- build-assets`
Expected: FAIL — `Failed to load ../tools/build-assets.mjs`

- [ ] **Step 4: Write the implementation**

Create `tools/build-assets.mjs`:

```javascript
#!/usr/bin/env node
import { readFile, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAlphaArgs, buildOpaqueArgs, DEFAULT_CHROMAKEY } from './lib/ffmpeg-args.mjs';
import { run } from './lib/run.mjs';
import { probe, hasAlpha } from './lib/probe.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_PACK_FIELDS = ['source', 'web', 'desktop'];

export function parseArgs(argv) {
  const opts = {};
  const numeric = new Set(['similarity', 'blend']);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const name = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${arg} requires a value`);
    }

    if (numeric.has(name)) {
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        throw new Error(`${arg} must be a number, got "${value}"`);
      }
      opts[name] = parsed;
    } else {
      opts[name] = value;
    }
    i += 1;
  }

  return opts;
}

export async function loadPack(packPath) {
  const pack = JSON.parse(await readFile(packPath, 'utf8'));
  for (const field of REQUIRED_PACK_FIELDS) {
    if (!pack[field]) {
      throw new Error(`${packPath} is missing required field "${field}"`);
    }
  }
  return pack;
}

export async function buildAssets({ assetsDir, overrides = {} } = {}) {
  const dir = assetsDir ?? join(REPO_ROOT, 'assets');
  const pack = await loadPack(join(dir, 'pack.json'));

  const src = join(dir, pack.source);
  try {
    await access(src);
  } catch {
    throw new Error(
      `Source video not found: ${src}\n` +
      `Drop the greenscreen clip there — see assets/PACK.md.`
    );
  }

  const chromakey = {
    ...DEFAULT_CHROMAKEY,
    ...pack.chromakey,
    ...(overrides.key !== undefined && { key: overrides.key }),
    ...(overrides.similarity !== undefined && { similarity: overrides.similarity }),
    ...(overrides.blend !== undefined && { blend: overrides.blend }),
  };

  const { width, height } = await probe(src);
  const webm = join(dir, pack.web);
  const mp4 = join(dir, pack.desktop);

  await run('ffmpeg', buildAlphaArgs({ src, out: webm, chromakey }));
  await run('ffmpeg', buildOpaqueArgs({ src, out: mp4, chromakey, width, height }));

  // The alpha channel is the one thing that fails silently, so verify it
  // rather than trusting the encoder.
  const webmInfo = await probe(webm);
  if (!hasAlpha(webmInfo.pixFmt)) {
    throw new Error(
      `${webm} came back as ${webmInfo.pixFmt}, which has no alpha channel. ` +
      `Check that -auto-alt-ref 0 is being passed.`
    );
  }

  return { webm, mp4 };
}

const isMain = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const overrides = parseArgs(process.argv.slice(2));
    const { webm, mp4 } = await buildAssets({ overrides });
    console.log(`  web     ${webm}`);
    console.log(`  desktop ${mp4}`);
  } catch (err) {
    console.error(`\nAsset build failed:\n${err.message}\n`);
    process.exit(1);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- build-assets`
Expected: PASS, 9 tests. The `buildAssets` cases each take a few seconds because they invoke ffmpeg.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, 24 tests across three files.

- [ ] **Step 7: Verify the CLI reports a useful error with no source present**

Run: `npm run assets`
Expected: exit 1, with `Source video not found: ...assets\foxy-src.mp4` and the pointer to `assets/PACK.md`. This is the correct state until the real clip is dropped in.

- [ ] **Step 8: Commit**

```bash
git add tools/build-assets.mjs assets/pack.json tests/build-assets.test.mjs
git commit -m "feat(assets): add greenscreen keying build script"
```

---

### Task 4: Real-footage verification

The synthetic clip proves the pipeline runs. It cannot prove the keying values suit real footage — a solid `0x00FF00` background keys perfectly at almost any threshold, while a real greenscreen is unevenly lit and never does. This task tunes against the actual clip.

**Files:**
- Modify: `assets/pack.json` (tuned values)
- Create: `assets/foxy-src.mp4` (untracked — supplied by the user)

**Interfaces:**
- Consumes: `buildAssets` (Task 3)
- Produces: tuned `chromakey` values committed in `assets/pack.json`

- [ ] **Step 1: Place the source clip**

Copy the greenscreen Foxy MP4 to `assets/foxy-src.mp4`.

Run: `node -e "console.log(require('fs').statSync('assets/foxy-src.mp4').size)"`
Expected: a non-zero byte count.

- [ ] **Step 2: Confirm it is gitignored**

Run: `git status --short assets/`
Expected: `assets/foxy-src.mp4` does **not** appear. If it does, `.gitignore` is wrong — stop and fix it before committing anything.

- [ ] **Step 3: Build with defaults**

Run: `npm run assets`
Expected: prints the two output paths, exit 0.

- [ ] **Step 4: Inspect the key over both backgrounds**

Create a scratch `check.html` outside the repo, open it in a browser, and view `foxy.webm` against white and against near-black:

```html
<div style="background:#fff;padding:20px">
  <video src="FULL/PATH/TO/assets/foxy.webm" autoplay loop muted></video>
</div>
<div style="background:#111;padding:20px">
  <video src="FULL/PATH/TO/assets/foxy.webm" autoplay loop muted></video>
</div>
```

Expected: no green fringe on Foxy's outline against **either** background, and no chunks eaten out of him. A fringe invisible on white is often obvious on dark.

- [ ] **Step 5: Retune if the key is wrong**

Green fringe remaining → raise `--similarity` in steps of `0.03`. Hard, jagged edge → raise `--blend` in steps of `0.02`. Parts of Foxy disappearing → `--similarity` is too high, back it off.

Run: `npm run assets -- --similarity 0.21 --blend 0.07`

Repeat steps 4-5 until the edge is clean.

- [ ] **Step 6: Write the tuned values into the manifest**

Update `chromakey` in `assets/pack.json` with whatever values step 5 settled on, so a fresh checkout rebuilds the tuned result rather than the defaults.

- [ ] **Step 7: Rebuild from the manifest and confirm it matches**

Run: `npm run assets`
Expected: exit 0, and the output is visually identical to the tuned result — confirming the values are actually being read from the manifest rather than overridden on the command line.

- [ ] **Step 8: Confirm the desktop output**

Run: `node -e "import('./tools/lib/probe.mjs').then(async m => console.log(await m.probe('assets/foxy.mp4')))"`
Expected: `pixFmt: 'yuv420p'`, dimensions matching the source, non-zero duration. Open it in a media player — Foxy should be on solid black with no green.

- [ ] **Step 9: Commit**

```bash
git add assets/pack.json
git commit -m "chore(assets): tune chromakey values for source footage"
```

---

## Self-Review

**Spec coverage.** The spec's Assets section requires: source never consumed directly (Task 3 reads `pack.source` and derives both outputs), two derived formats with the stated codecs (Task 1 builders, Task 3 wiring), `-auto-alt-ref 0` (Task 1 unit test, Task 3 runtime assertion, Task 3 integration test), keying params in `pack.json` (Tasks 3 and 4), tunable parameters (Task 3 `parseArgs`, Task 4 tuning loop), keying verified over light and dark backgrounds (Task 4 step 4). The spec's `assets/PACK.md` documents `node tools/build-assets.mjs`; Task 1 step 8 aligns the other two docs to the `npm run assets` form, which invokes exactly that.

**Type consistency.** `chromakey` is `{ key, similarity, blend }` everywhere. `probe()` returns `{ width, height, pixFmt, durationSec }` and every consumer uses those names. `buildAssets` returns `{ webm, mp4 }`, matching its test.

**Known limitation, deliberate.** The pipeline verifies alpha is *present* but not that the key is *good* — edge quality is judged by eye in Task 4. Automating that would require perceptual comparison against a reference render, which is not worth building for a one-time tuning step.

## Next

Plans 2 (extension) and 3 (desktop) are not yet written. Both depend on this pipeline's outputs existing, but neither depends on its internals, so they can be written and executed in either order once this lands.
