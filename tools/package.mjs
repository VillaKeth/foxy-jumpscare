#!/usr/bin/env node
/**
 * Build submittable store packages.
 *
 * Produces dist/foxy-jumpscare-chrome-vX.Y.Z.zip and the Firefox equivalent,
 * each with manifest.json at the archive root, which is what both stores
 * require.
 *
 * Usage: npm run package
 */
import { readFile, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['chrome', 'firefox'];

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? await dirSize(path) : (await stat(path)).size;
  }
  return total;
}

const version = JSON.parse(
  await readFile(join(REPO_ROOT, 'extension', 'manifest.base.json'), 'utf8')
).version;

const outDir = join(REPO_ROOT, 'dist', 'packages');
await mkdir(outDir, { recursive: true });

for (const target of TARGETS) {
  const src = join(REPO_ROOT, 'dist', target);

  try {
    await stat(join(src, 'manifest.json'));
  } catch {
    console.error(`\n${src} is not built. Run "npm run build" first.\n`);
    process.exit(1);
  }

  try {
    await stat(join(src, 'foxy.webm'));
  } catch {
    console.error(`\n${src} has no video. Run "npm run assets" first.\n`);
    process.exit(1);
  }

  const zip = join(outDir, `foxy-jumpscare-${target}-v${version}.zip`);
  await rm(zip, { force: true });

  // Compress-Archive with a \* source puts the directory's *contents* at the
  // archive root. Zipping the directory itself nests everything one level
  // deeper, and both stores reject a manifest that is not at the root.
  await execFileAsync('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${src}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal`,
  ]);

  const { size } = await stat(zip);
  console.log(
    `  ${target.padEnd(8)} ${zip}  ` +
    `${(size / 1024).toFixed(0)} KB zipped, ${((await dirSize(src)) / 1024).toFixed(0)} KB unpacked`
  );
}

console.log(`\n  version ${version} — remember to bump extension/manifest.base.json before a resubmission.\n`);
