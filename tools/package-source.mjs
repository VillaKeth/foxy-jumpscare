#!/usr/bin/env node
/**
 * Build the source archive AMO asks for when a submission contains generated
 * files. Ours does: manifest.json, the icons, and foxy.webm are all produced
 * by tools in this repo.
 *
 * Usage: npm run package:source
 */
import { readFile, writeFile, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './lib/zip.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// An allowlist, not a denylist. A denylist that misses one entry ships
// something private; an allowlist that misses one entry just fails the build.
const INCLUDE = [
  'REVIEWERS.md',
  'README.md',
  'package.json',
  'package-lock.json',
  'vitest.config.mjs',
  'playwright.config.mjs',
  'extension',
  'tools',
  'tests',
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'test-results', 'playwright-report']);

/**
 * Anything that looks like a credential aborts the build rather than being
 * quietly dropped. If one of these ever ends up inside an included directory,
 * the right outcome is a loud stop, not a near-miss.
 */
const FORBIDDEN = /(credential|secret|\.env$|\.pem$|\.key$)/i;

async function collect(path, base) {
  const info = await stat(path);

  if (info.isDirectory()) {
    if (SKIP_DIRS.has(basename(path))) return [];
    const out = [];
    for (const entry of await readdir(path)) {
      out.push(...await collect(join(path, entry), base));
    }
    return out;
  }

  if (FORBIDDEN.test(basename(path))) {
    console.error(`\nRefusing to package a possible credential file:\n  ${path}\n`);
    process.exit(1);
  }

  return [{
    name: relative(base, path).split(sep).join('/'),
    data: await readFile(path),
  }];
}

const { version } = JSON.parse(
  await readFile(join(REPO_ROOT, 'extension', 'manifest.base.json'), 'utf8')
);

const files = [];
for (const entry of INCLUDE) {
  try {
    files.push(...await collect(join(REPO_ROOT, entry), REPO_ROOT));
  } catch {
    console.error(`\nMissing: ${entry}\n`);
    process.exit(1);
  }
}

const outDir = join(REPO_ROOT, 'dist', 'packages');
await mkdir(outDir, { recursive: true });
const zipPath = join(outDir, `foxy-jumpscare-source-v${version}.zip`);
await rm(zipPath, { force: true });
await writeFile(zipPath, createZip(files));

const { size } = await stat(zipPath);
console.log(`\n  ${zipPath}`);
console.log(`  ${(size / 1024).toFixed(0)} KB, ${files.length} files\n`);
console.log('  Upload alongside the extension when AMO asks for source code.\n');
