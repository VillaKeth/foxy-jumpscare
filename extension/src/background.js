import { drawRemaining, DEFAULT_ONE_IN_N } from './lib/roll.mjs';
import { TICK_SECONDS, creditTick } from './lib/ticker.mjs';
import { attemptFire } from './lib/fire.mjs';

const ALARM = 'foxy-tick';
const IDLE_THRESHOLD_SECONDS = 15;

async function getState() {
  const stored = await chrome.storage.local.get(['remaining', 'oneInN', 'enabled']);
  const oneInN = stored.oneInN ?? DEFAULT_ONE_IN_N;
  return {
    enabled: stored.enabled ?? true,
    oneInN,
    remaining: stored.remaining ?? drawRemaining(oneInN),
  };
}

/**
 * chrome.idle reports *system* idle, so it stays 'active' while the user works
 * in another application entirely. The focus check is what makes this mean
 * "actively browsing" rather than "awake and at the computer".
 */
async function isActiveBrowsing() {
  const idleState = await chrome.idle.queryState(IDLE_THRESHOLD_SECONDS);
  if (idleState !== 'active') return false;
  const win = await chrome.windows.getLastFocused().catch(() => null);
  return Boolean(win?.focused);
}

async function tick() {
  const state = await getState();
  if (!state.enabled) return;

  const active = await isActiveBrowsing();
  const credited = active ? TICK_SECONDS : 0;
  const { remaining, shouldFire } = creditTick(state, credited);

  await chrome.storage.local.set({ remaining, oneInN: state.oneInN, enabled: state.enabled });

  if (shouldFire) {
    const fired = await attemptFire(chrome);
    if (fired) {
      await chrome.storage.local.set({ remaining: drawRemaining(state.oneInN) });
    }
    // If it did not fire, remaining stays 0 and the next tick retries. The
    // roll is only spent on an overlay the user actually saw.
  }
}

function scheduleAlarm() {
  chrome.alarms.create(ALARM, { periodInMinutes: TICK_SECONDS / 60 });
}

chrome.runtime.onInstalled.addListener(async () => {
  const { oneInN = DEFAULT_ONE_IN_N } = await chrome.storage.local.get('oneInN');
  await chrome.storage.local.set({ oneInN, remaining: drawRemaining(oneInN), enabled: true });
  scheduleAlarm();
});

chrome.runtime.onStartup.addListener(scheduleAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) tick();
});

/**
 * "Test it now", from the toolbar panel.
 *
 * Note what this does *not* do: it never touches `remaining`. A test must not
 * spend the real roll, and a test that fails to inject must not spend it
 * either. The countdown is the same before and after, whatever happens here.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'foxy:test-fire') return undefined;

  attemptFire(chrome).then(
    (fired) => sendResponse({ fired }),
    (err) => sendResponse({ fired: false, error: String(err) })
  );
  return true; // keep the message channel open for the async reply
});

/**
 * Reachable only from the service-worker context - devtools, or Playwright via
 * context.serviceWorkers(). A web page cannot touch the worker's global scope,
 * so this is not an escape hatch for hostile sites. Used by the end-to-end
 * tests to fire on demand instead of waiting out a week-long countdown.
 */
globalThis.__foxyTest = {
  fireNow: () => attemptFire(chrome),
  setRemaining: (remaining) => chrome.storage.local.set({ remaining }),
  tickNow: () => tick(),
};
