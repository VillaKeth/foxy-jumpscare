#!/usr/bin/env node
import { readFile, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAlphaArgs, buildOpaqueArgs, DEFAULT_CHROMAKEY } from './lib/ffmpeg-args.mjs';
import { run } from './lib/run.mjs';
import { probe, carriesAlpha } from './lib/probe.mjs';

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
  if (!carriesAlpha(webmInfo)) {
    throw new Error(
      `${webm} carries no alpha channel (pix_fmt ${webmInfo.pixFmt}, ` +
      `alpha_mode unset). Check that -auto-alt-ref 0 is being passed.`
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
