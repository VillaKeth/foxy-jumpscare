#!/usr/bin/env node
/**
 * Behavioural verification of the Firefox build, in real Firefox.
 *
 * Playwright cannot load an MV3 extension in Firefox, so the Chromium suite in
 * tests/e2e/ does not cover it. This does, using Mozilla's own web-ext to
 * install the extension temporarily, and a throwaway build that reports what
 * happened back to a local collector.
 *
 * Reporting rather than screenshotting is deliberate: the earlier approach
 * captured the whole desktop, which meant capturing whatever the user had open.
 *
 * Usage:  npm run verify:firefox
 * Needs:  npm run build, npm run assets, and Firefox installed.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, appendFile, rm, mkdtemp, cp, access } from 'node:fs/promises';
import { join, dirname, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findFirefox } from './lib/find-firefox.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8393;
const PAGES = join(REPO_ROOT, 'tests', 'e2e', 'pages');
const DIST = join(REPO_ROOT, 'dist', 'firefox');

/** Appended to the copied build. Never shipped. */
const BACKGROUND_PROBE = `
const REPORT = 'http://localhost:${PORT}/report';
const send = (d) => fetch(REPORT, { method: 'POST', body: JSON.stringify(d) }).catch(() => {});

setTimeout(async () => {
  const all = await chrome.tabs.query({});
  send({ stage: 'tabs', count: all.length });

  // Take focus before firing. attemptFire only counts a scare as landed when a
  // browser window actually has OS focus - a scare nobody was looking at must
  // not spend the roll - and a browser launched by web-ext from a terminal does
  // not reliably have it. Without this the run measures the window manager
  // rather than the extension.
  //
  // This used to go unnoticed: an unfocused window took the standalone-window
  // fallback, which reported success anyway. Now that the fallback is opt-in
  // and off by default, an unfocused window makes attemptFire report false.
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (win) await chrome.windows.update(win.id, { focused: true }).catch(() => {});
  const refocused = await chrome.windows.getLastFocused().catch(() => null);
  send({ stage: 'focus', focused: refocused?.focused ?? null });

  const fired = await globalThis.__foxyTest.fireNow();
  send({ stage: 'fire', fired });

  setTimeout(async () => {
    for (const tab of await chrome.tabs.query({})) {
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const el = document.getElementById('foxy-jumpscare-overlay');
            return {
              present: Boolean(el),
              allow: el?.getAttribute('allow') ?? null,
              zIndex: el ? getComputedStyle(el).zIndex : null,
            };
          },
        });
        send({ stage: 'page', ...r.result });
      } catch (e) {
        send({ stage: 'page', error: String(e).slice(0, 120) });
      }
    }
  }, 700);
}, 7000);
`;

const OVERLAY_PROBE = `
const R = 'http://localhost:${PORT}/report';

// sendBeacon, NOT fetch. The overlay tears itself down on 'ended' - the parent
// content script removes the iframe within a few ms - and that destroys the
// document out from under any request still in flight. The sample below is
// taken at 600ms against a video that ends around 890ms, so on a cold start
// (first launch after a rebuild, slowest decode, slowest JIT) the POST was
// still open when the frame went away and the report was silently lost. That
// produced a run where 'video' arrived but 'playback' and 'alpha' did not, and
// four checks failed on an extension that was working correctly.
//
// Measured, twice, by posting the same payload both ways at 'ended': the fetch
// was lost every time, the beacon arrived every time. Beacons are handed to the
// browser and survive unload, which is exactly the property needed here.
//
// The collector reads the raw body and JSON.parses it, so it does not care that
// this arrives as text/plain rather than application/json.
const post = (d) => navigator.sendBeacon(R, JSON.stringify(d));

video.addEventListener('loadeddata', () =>
  post({ stage: 'video', w: video.videoWidth, h: video.videoHeight, duration: video.duration }));

setTimeout(() => {
  post({
    stage: 'playback', muted: video.muted, paused: video.paused,
    t: Number(video.currentTime.toFixed(2)), err: video.error?.message ?? null,
  });

  // Transparency: draw a frame and count how much of it keyed out. ffmpeg
  // cannot decode VP9 alpha, so a browser is the only place to check, and
  // Firefox is a separate implementation from Chromium's.
  try {
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(video, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let clear = 0, solid = 0, green = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a <= 2) clear++; else if (a === 255) solid++;
      if (a > 128 && d[i + 1] > 200 && d[i] < 80 && d[i + 2] < 80) green++;
    }
    const total = d.length / 4;
    post({
      stage: 'alpha',
      clearPct: +(100 * clear / total).toFixed(1),
      solidPct: +(100 * solid / total).toFixed(1),
      greenPct: +(100 * green / total).toFixed(2),
    });
  } catch (e) {
    post({ stage: 'alpha', error: String(e).slice(0, 120) });
  }
}, 600);
`;

const reports = [];

function startCollector() {
  return new Promise((res) => {
    const server = createServer(async (req, rq) => {
      if (req.method === 'POST' && req.url.startsWith('/report')) {
        let body = '';
        for await (const chunk of req) body += chunk;
        try { reports.push(JSON.parse(body)); } catch { /* ignore junk */ }
        rq.writeHead(204, { 'access-control-allow-origin': '*' });
        return rq.end();
      }
      const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'demo.html';
      try {
        const file = await readFile(join(PAGES, name));
        rq.writeHead(200, {
          'content-type': extname(name) === '.html' ? 'text/html; charset=utf-8' : 'text/plain',
        });
        rq.end(file);
      } catch {
        rq.writeHead(404);
        rq.end('not found');
      }
    });
    server.listen(PORT, () => res(server));
  });
}

function check(label, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

const firefox = await findFirefox();
if (!firefox) {
  console.error('\nFirefox not found. Install it, or run the manual checklist in docs/firefox-checklist.md.\n');
  process.exit(1);
}

try {
  await access(join(DIST, 'manifest.json'));
  await access(join(DIST, 'foxy.webm'));
} catch {
  console.error('\ndist/firefox is missing or has no video. Run "npm run assets" then "npm run build".\n');
  process.exit(1);
}

console.log(`  firefox  ${firefox}`);

const workDir = await mkdtemp(join(tmpdir(), 'foxy-ff-'));
const buildDir = join(workDir, 'ext');
await cp(DIST, buildDir, { recursive: true });
await appendFile(join(buildDir, 'background.js'), `\n// verify-firefox probe\n${BACKGROUND_PROBE}`);
await appendFile(join(buildDir, 'overlay.js'), `\n// verify-firefox probe\n${OVERLAY_PROBE}`);

const server = await startCollector();

// Run web-ext's JS entry directly with node rather than the .bin shim. On
// Windows the shim is a .cmd, which needs shell: true, and with a shell every
// argument - including the command itself - is concatenated unescaped. Both the
// repo path and Firefox's install path contain spaces, so that route silently
// tears the command apart. No shell, no quoting problem.
const webExtJs = join(REPO_ROOT, 'node_modules', 'web-ext', 'bin', 'web-ext.js');

const child = spawn(process.execPath, [
  webExtJs,
  'run',
  '--source-dir', buildDir,
  '--firefox', firefox,
  '--start-url', `http://localhost:${PORT}/demo.html`,
  '--no-reload',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let webExtOutput = '';
child.stdout.on('data', (d) => { webExtOutput += d; });
child.stderr.on('data', (d) => { webExtOutput += d; });

console.log('  launching Firefox, waiting for the overlay to fire...');

/**
 * Wait for every stage the checks below actually read, not just the last one to
 * be written.
 *
 * This used to wait on 'alpha' alone and then kill Firefox. That was only ever
 * safe by accident: 'alpha' was the report most likely to go missing, so the
 * loop usually sat here for the full deadline and everything else arrived in
 * the meantime. Once the overlay probe was switched to sendBeacon and 'alpha'
 * started landing reliably at around fire+650ms, the loop began exiting there
 * and killing the browser before the background probe's 'page' check at
 * fire+700ms could report - turning one intermittent failure into a different
 * one, in a build that was working.
 *
 * The deadline still bounds it, so a genuinely broken build fails instead of
 * hanging.
 */
const NEEDED = ['fire', 'video', 'playback', 'alpha'];
const haveAll = () =>
  NEEDED.every((s) => reports.some((r) => r.stage === s)) &&
  // Same tab-order reasoning as pageHit below: waiting for merely *a* 'page'
  // report lets an unrelated tab's present:false answer end the wait and kill
  // the browser before the tab that actually has the overlay replies.
  reports.some((r) => r.stage === 'page' && r.present === true);

const deadline = Date.now() + 45_000;
while (Date.now() < deadline && !haveAll()) {
  await new Promise((r) => setTimeout(r, 250));
}

child.kill();
server.close();
await rm(workDir, { recursive: true, force: true }).catch(() => {});

const by = (stage) => reports.find((r) => r.stage === stage);

/**
 * The background probe emits one 'page' report per open tab, so "did the
 * overlay land?" is a question about ANY tab, not about whichever tab happened
 * to answer first. Reading reports[0] made the result depend on tab order: any
 * second tab in the profile could report present:false ahead of the real one
 * and fail a build that was working.
 */
const pageHit = reports.find((r) => r.stage === 'page' && r.present === true);
const anyPage = pageHit ?? by('page');

console.log('\n  Firefox behavioural checks:');

const ok = [
  // The focus detail is here because it is the one thing that can make this
  // check fail on a working build: no focused window means no scare the user
  // could have seen, which attemptFire correctly reports as not fired.
  check('extension fired', by('fire')?.fired === true,
    `window focused: ${by('focus')?.focused ?? 'unknown'}`),
  check('overlay iframe injected', Boolean(pageHit),
    anyPage ? `z-index ${anyPage.zIndex}, allow="${anyPage.allow}"` : 'no report'),
  check('VP9 video decoded', by('video')?.w > 0,
    by('video') ? `${by('video').w}x${by('video').h}, ${by('video').duration}s` : 'no report'),
  check('playing, not blocked', by('playback')?.paused === false),
  check('audio not muted (autoplay delegation works)', by('playback')?.muted === false),
  check('transparency present', (by('alpha')?.clearPct ?? 0) > 50,
    by('alpha') ? `${by('alpha').clearPct}% clear, ${by('alpha').solidPct}% opaque` : 'no report'),
  check('no green fringe', (by('alpha')?.greenPct ?? 100) < 0.5,
    by('alpha') ? `${by('alpha').greenPct}% green` : 'no report'),
].every(Boolean);

console.log();
if (!ok) {
  if (reports.length === 0) {
    console.error('  No reports arrived at all — web-ext output follows:\n');
    console.error(webExtOutput.trim().split('\n').map((l) => `    ${l}`).join('\n') || '    (nothing)');
    console.error();
  }
  console.error('  Firefox verification FAILED\n');
  process.exit(1);
}
console.log('  Firefox verification passed\n');
