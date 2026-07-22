#!/usr/bin/env node
/**
 * Install the extension in your own Firefox, and produce a signed .xpi you
 * can hand to other people.
 *
 *   npm run dev:firefox    temporary install in a throwaway profile - for a
 *                          quick look. Gone when Firefox closes.
 *   npm run sign:firefox   uploads to AMO for unlisted signing and writes the
 *                          signed .xpi. This is the one that installs
 *                          permanently and that friends can install.
 *
 * Release Firefox will not permanently install an unsigned extension, and
 * unlike Chrome there is no developer-mode switch that changes that. Unlisted
 * signing is the supported way to distribute privately: Mozilla signs it, but
 * it never appears on addons.mozilla.org.
 *
 * Credentials come from .amo-credentials.json (gitignored) or the environment:
 *   AMO_API_KEY / AMO_API_SECRET
 * Get them at https://addons.mozilla.org/developers/addon/api/key/
 */
import { spawn } from 'node:child_process';
import { readFile, access, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findFirefox } from './lib/find-firefox.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(REPO_ROOT, 'dist', 'firefox');
const ARTIFACTS = join(REPO_ROOT, 'dist', 'packages');
const CREDENTIALS = join(REPO_ROOT, '.amo-credentials.json');

// Run web-ext's JS entry with node rather than the .bin shim: on Windows the
// shim is a .cmd, which needs shell: true, and a shell concatenates every
// argument unescaped. This repo's path contains a space, so that route tears
// the command apart. Same reasoning as tools/verify-firefox.mjs.
const WEB_EXT = join(REPO_ROOT, 'node_modules', 'web-ext', 'bin', 'web-ext.js');

function die(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** Resolve to web-ext's exit code rather than throwing, so we can report it. */
const run = (args) =>
  new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [WEB_EXT, ...args], { stdio: 'inherit' });
    child.on('close', resolvePromise);
  });

async function readCredentials() {
  try {
    const { apiKey, apiSecret } = JSON.parse(await readFile(CREDENTIALS, 'utf8'));
    if (apiKey && apiSecret) return { apiKey, apiSecret };
  } catch { /* fall through to the environment */ }

  const { AMO_API_KEY: apiKey, AMO_API_SECRET: apiSecret } = process.env;
  if (apiKey && apiSecret) return { apiKey, apiSecret };

  return null;
}

async function assertBuilt() {
  try {
    await access(join(DIST, 'manifest.json'));
  } catch {
    die('dist/firefox is not built. Run "npm run build" first.');
  }

  try {
    await access(join(DIST, 'foxy.webm'));
  } catch {
    die('dist/firefox has no video. Run "npm run assets" first.');
  }
}

const command = process.argv[2];
await assertBuilt();

if (command === 'run') {
  const firefox = await findFirefox();
  if (!firefox) die('Firefox not found. Install it from https://www.mozilla.org/firefox/');

  console.log('\n  Temporary install. Click the fox in the toolbar to open the panel.');
  console.log('  Set Rarity to Custom and try 60, or just press "Test it now".');
  console.log('  Close Firefox to end.\n');

  process.exit(await run(['run', '--source-dir', DIST, '--firefox', firefox, '--no-reload']));
}

if (command === 'sign' || command === 'publish') {
  // "sign" is private distribution: AMO signs it, it never appears on the
  // site. "publish" pushes a version to the public listing. The first listed
  // submission has to be made in the web UI, because it needs listing
  // metadata - screenshots, category, support contact - that this CLI cannot
  // supply. After that, this is the one-command update path.
  const channel = command === 'publish' ? 'listed' : 'unlisted';
  const credentials = await readCredentials();
  if (!credentials) {
    die(
      'No AMO credentials.\n\n' +
      '  1. Sign in at https://addons.mozilla.org/developers/addon/api/key/\n' +
      '  2. Generate credentials\n' +
      `  3. Save them as ${CREDENTIALS}:\n\n` +
      '       { "apiKey": "user:12345:678", "apiSecret": "abc..." }\n\n' +
      '  That file is gitignored. Or set AMO_API_KEY and AMO_API_SECRET instead.'
    );
  }

  const { version } = JSON.parse(await readFile(join(DIST, 'manifest.json'), 'utf8'));
  await mkdir(ARTIFACTS, { recursive: true });

  console.log(`\n  Submitting v${version} to the ${channel} channel.`);
  console.log(channel === 'listed'
    ? '  This goes to the public addons.mozilla.org listing.\n'
    : '  Private: signed, but never shown on addons.mozilla.org.\n');

  const code = await run([
    'sign',
    '--source-dir', DIST,
    '--artifacts-dir', ARTIFACTS,
    '--channel', channel,
    '--api-key', credentials.apiKey,
    '--api-secret', credentials.apiSecret,
  ]);

  if (code !== 0) {
    die(
      'Signing failed.\n\n' +
      '  "Version already exists" means bump "version" in\n' +
      '  extension/manifest.base.json and rebuild - AMO will not re-sign a\n' +
      '  version number it has already seen, even a rejected one.'
    );
  }

  if (channel === 'listed') {
    console.log('\n  Uploaded. Finish the listing and submit for review at');
    console.log('  https://addons.mozilla.org/developers/\n');
  } else {
    console.log(`\n  Signed .xpi is in ${ARTIFACTS}`);
    console.log('  Install it by dragging it onto a Firefox window, or send it to someone.');
    console.log('  See docs/install-firefox.md for what to tell them.\n');
  }
  process.exit(0);
}

die('Usage: node tools/firefox-dist.mjs <run|sign|publish>');
