#!/usr/bin/env node
/**
 * Build submittable store packages.
 *
 * Produces dist/packages/foxy-jumpscare-chrome-vX.Y.Z.zip and the Firefox
 * equivalent, each with manifest.json at the archive root, which is what both
 * stores require.
 *
 * Usage: npm run package
 */
import { readFile, writeFile, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './lib/zip.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// opera and edge build the same manifest-at-root zip as the others. Both are
// Chromium, so each zip submits to its store and, unzipped, is exactly what a
// friend points "Load unpacked" at. Edge's Partner Center wants precisely this
// shape: a .zip with the manifest at the root - see docs/publishing-edge.md.
const TARGETS = ['chrome', 'firefox', 'opera', 'edge'];

/** Every file under dir, as archive-relative POSIX paths. */
async function collect(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collect(path, base));
    } else {
      out.push({
        name: relative(base, path).split(sep).join('/'),
        data: await readFile(path),
      });
    }
  }
  return out;
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

  const files = await collect(src);

  // manifest.json must sit at the archive root. Zipping the directory itself
  // rather than its contents nests everything one level deeper, and both
  // stores reject that.
  if (!files.some((f) => f.name === 'manifest.json')) {
    console.error('\nmanifest.json is not at the archive root.\n');
    process.exit(1);
  }

  const zipPath = join(outDir, `foxy-jumpscare-${target}-v${version}.zip`);
  await rm(zipPath, { force: true });
  await writeFile(zipPath, createZip(files));

  const { size } = await stat(zipPath);
  const unpacked = files.reduce((n, f) => n + f.data.length, 0);
  console.log(
    `  ${target.padEnd(8)} ${zipPath}  ` +
    `${(size / 1024).toFixed(0)} KB zipped, ${(unpacked / 1024).toFixed(0)} KB unpacked, ` +
    `${files.length} files`
  );
}

console.log(
  `\n  version ${version} — bump extension/manifest.base.json before a resubmission.\n` +
  '  Validate the archive itself with: npm run lint:package\n'
);
