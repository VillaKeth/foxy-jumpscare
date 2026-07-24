#!/usr/bin/env node
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// opera is byte-for-byte the chrome build: Opera (incl. Opera GX) is Chromium
// and loads an MV3 service-worker extension unchanged. It exists as its own
// target so "load the Opera build" is unambiguous and an Opera add-ons store
// upload has a folder of its own, not a Chrome one relabelled by hand.
const TARGETS = ['chrome', 'firefox', 'opera'];
// A bare GUID, not an email-style id. An email-style id embeds a domain in
// every published copy of the manifest and in AMO's public API, and an add-on
// id can never be changed once a listing exists - so the domain would be
// permanent and public. This form carries no attribution at all.
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

  if (target === 'firefox') {
    manifest.background = { scripts: ['background.js'], type: 'module' };
    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        // 140 rather than 115 because data_collection_permissions below only
        // exists from 140. 140 is the current ESR line, so this still covers
        // enterprise and LTS installs.
        strict_min_version: '140.0',
        // Required by AMO for new extensions. This one reads nothing and sends
        // nothing anywhere, so the honest declaration is "none".
        data_collection_permissions: { required: ['none'] },
      },
    };
    manifest.browser_specific_settings.gecko_android = {
      strict_min_version: '142.0',
    };
  } else {
    // chrome and opera are both Chromium: an MV3 service-worker background and
    // no browser_specific_settings. Opera GX loads this manifest unchanged.
    manifest.background = { service_worker: 'background.js', type: 'module' };
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
