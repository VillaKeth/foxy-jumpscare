#!/usr/bin/env node
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['chrome', 'firefox'];
const GECKO_ID = '{47d51fee-cbcf-4204-b2b6-a2b72c965b26}';

/**
 * Chrome and Firefox disagree on how an MV3 background is declared, and
 * Firefox additionally requires an explicit add-on id. Everything else is
 * shared, so the difference lives here rather than in two whole manifests.
 */
export function manifestFor(target, base) {
  if (!TARGETS.includes(target)) {
    throw new Error(`Unknown target "${target}" - expected one of ${TARGETS.join(', ')}`);
  }

  const manifest = structuredClone(base);

  if (target === 'chrome') {
    manifest.background = { service_worker: 'background.js', type: 'module' };
  } else {
    manifest.background = { scripts: ['background.js'], type: 'module' };
    manifest.browser_specific_settings = {
      gecko: { id: GECKO_ID, strict_min_version: '115.0' },
    };
  }

  return manifest;
}

export async function buildExtension({
  target,
  outDir = join(REPO_ROOT, 'dist', target),
  srcDir = join(REPO_ROOT, 'extension', 'src'),
  assetsDir = join(REPO_ROOT, 'assets'),
} = {}) {
  const base = JSON.parse(
    await readFile(join(REPO_ROOT, 'extension', 'manifest.base.json'), 'utf8')
  );

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await cp(srcDir, outDir, { recursive: true });
  await writeFile(
    join(outDir, 'manifest.json'),
    `${JSON.stringify(manifestFor(target, base), null, 2)}\n`
  );

  // The video is optional at build time so the extension can be built and
  // loaded before the asset pack exists. It simply will not play.
  try {
    await cp(join(assetsDir, 'foxy.webm'), join(outDir, 'foxy.webm'));
  } catch {
    console.warn('  warning: assets/foxy.webm missing - run "npm run assets" first');
  }

  return outDir;
}

const isMain = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    for (const target of TARGETS) {
      console.log(`  ${target}  ${await buildExtension({ target })}`);
    }
  } catch (err) {
    console.error(`\nExtension build failed:\n${err.message}\n`);
    process.exit(1);
  }
}
