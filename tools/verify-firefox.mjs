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
  // fallback, which reported success anyway. The fallback is on by default
  // again, so pin the setting off below rather than relying on the default -
  // otherwise an unfocused window quietly passes every check by opening a
  // black standalone window instead of injecting anywhere.
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (win) await chrome.windows.update(win.id, { focused: true }).catch(() => {});
  const refocused = await chrome.windows.getLastFocused().catch(() => null);
  send({ stage: 'focus', focused: refocused?.focused ?? null });

  // fallbackChosen too, or seedState reads the false as a default this
  // extension wrote and replaces it with the current one.
  await chrome.storage.local.set({ fallbackWindow: false, fallbackChosen: true });

  // The transparency check needs a page whose colour is unmistakable, in the
  // tab that will be captured. Everything above still runs against demo.html.
  await chrome.tabs.create({ url: 'http://localhost:${PORT}/solid.html', active: true });
  await new Promise((r) => setTimeout(r, 800));
  const before = await sampleViewport();

  const fired = await globalThis.__foxyTest.fireNow();
  send({ stage: 'fire', fired });

  // Several samples, keeping whichever caught the most on screen.
  //
  // One fixed sample is not reliable: the overlay has to load its own page and
  // decode a first frame before there is anything to capture at all, and that
  // takes anywhere from ~200ms to most of the clip depending on how warm the
  // profile is. The same working build measured 9.5%, 4.1% and 0.1% of the
  // viewport drawn on three consecutive runs, and the last one failed.
  //
  // The delay between them is not optional. A capture returns in about 50ms,
  // so four back-to-back shots cover only ~200ms and all of them landed before
  // the first frame - reporting 0.1% drawn on a build that was working. These
  // are spaced to span the whole 890ms clip instead.
  setTimeout(async () => {
    const shots = [];
    for (let i = 0; i < 4; i += 1) {
      shots.push(await sampleViewport());
      await new Promise((r) => setTimeout(r, 220));
    }
    const after = shots.reduce((a, b) => (b.otherPct > a.otherPct ? b : a));
    send({
      stage: 'composite',
      before,
      after,
      // The page survived behind the overlay: every corner is still the page's
      // own colour. An opaque frame canvas - the fullscreen-white failure -
      // replaces these.
      pageVisible: Boolean(after.corners) && after.corners.every(Boolean),
      // ...and the overlay actually drew, so the check above cannot pass by the
      // overlay never appearing at all.
      drewPct: +(after.otherPct - before.otherPct).toFixed(1),
    });
  }, 260);

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

/**
 * What the screen actually looks like.
 *
 * Everything else in this file measures the video, the iframe element, or the
 * extension's own report of what it did - all of which stay correct while the
 * user sees a fullscreen white rectangle, because the failure is in how Gecko
 * paints the frame's canvas and not in anything the extension can observe about
 * itself. Capturing the rendered tab is the only way to ask the question.
 *
 * OffscreenCanvas rather than a DOM canvas: this runs in the background script,
 * which has no document to hang one off in the MV3 build.
 */
async function sampleViewport() {
  const KEY = [255, 0, 255];       // solid.html's background
  const TOLERANCE = 8;
  try {
    const url = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    const isKey = (o) => KEY.every((c, i) => Math.abs(d[o + i] - c) <= TOLERANCE);
    let other = 0;
    for (let i = 0; i < d.length; i += 4) if (!isKey(i)) other += 1;

    const at = (x, y) => isKey(((y * canvas.width) + x) * 4);
    const w = canvas.width - 5;
    const h = canvas.height - 5;
    return {
      w: canvas.width,
      h: canvas.height,
      otherPct: +((100 * other) / (d.length / 4)).toFixed(1),
      corners: [at(4, 4), at(w, 4), at(4, h), at(w, h)],
    };
  } catch (e) {
    return { error: String(e).slice(0, 160), corners: null, otherPct: 0 };
  }
}
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
    // The trigger state for the opaque-canvas bug, reported so a green run
    // cannot be mistaken for a run that never exercised it.
    scheme: getComputedStyle(document.documentElement).colorScheme,
    prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
  });

  // Sample the alpha at a FIXED point in the clip rather than at whatever
  // frame happens to be showing 600ms in. Foxy grows through the lunge, so how
  // much of the frame has keyed out is a function of when you look: the same
  // working build measured 86%, 74% and 44% clear on three consecutive runs,
  // and the last one failed a >50% threshold. Pausing and seeking to mid-clip
  // makes it the same frame every time - and is what the Chromium test in
  // tests/e2e/overlay.spec.mjs already does, so the two now agree.
  //
  // Playback is reported above, before the pause, so the 'playing, not
  // blocked' check still sees the real thing.
  video.pause();
  video.currentTime = video.duration * 0.5;
  video.addEventListener('seeked', sampleAlpha, { once: true });
}, 600);

function sampleAlpha() {
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
}
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
  // Dark, because a default profile is light and the transparency bug this
  // suite exists to catch only fires on a browser set to dark. Firefox gives
  // an opaque canvas to a document that does not support the scheme it is
  // shown under, so a light browser never exercises it and the composite
  // checks below pass on a build that is fullscreen white for most users.
  //
  // BOTH prefs are required and they are not the same switch. The first
  // darkens the browser chrome; the second is what content - and therefore the
  // overlay frame - actually reads for prefers-color-scheme. Setting only the
  // first leaves content light, which is how a whole afternoon of reproduction
  // attempts came back green against a build that was fullscreen white on the
  // reporter's machine. 0 is dark here, not light.
  '--pref', 'ui.systemUsesDarkTheme=1',
  '--pref', 'layout.css.prefers-color-scheme.content-override=0',
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
const NEEDED = ['fire', 'video', 'playback', 'alpha', 'composite'];
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

// Printed, not asserted. A green run means nothing unless the run was actually
// in the state that breaks: the overlay frame must be seeing a dark preference,
// or the opaque-canvas failure cannot occur and the composite checks below are
// measuring an easier browser than the one users have.
console.log(`\n  overlay frame: color-scheme=${by('playback')?.scheme} ` +
  `prefers-dark=${by('playback')?.prefersDark}`);

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

  // The pair that has to be read together. "Page still visible" passes trivially
  // if the overlay never drew, and "overlay drew" passes on an overlay that
  // covered the page completely - only both at once describe a scare that
  // composited.
  check('overlay drew over the page', (by('composite')?.drewPct ?? 0) > 2,
    by('composite')
      ? `${by('composite').before.otherPct}% -> ${by('composite').after.otherPct}% not page colour`
      : 'no report'),
  check('page still visible behind the overlay', by('composite')?.pageVisible === true,
    by('composite')?.after?.corners
      ? `corners on page colour: ${by('composite').after.corners.filter(Boolean).length}/4`
      : by('composite')?.after?.error ?? 'no report'),
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
