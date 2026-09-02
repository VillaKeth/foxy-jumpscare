import { drawRemaining } from './lib/roll.mjs';
import { TICK_SECONDS, creditTick } from './lib/ticker.mjs';
import { attemptFire } from './lib/fire.mjs';
import { seedState, STATE_KEYS } from './lib/state.mjs';

const ALARM = 'foxy-tick';
const IDLE_THRESHOLD_SECONDS = 15;

/**
 * The current settings, with defaults filled in for anything unset.
 *
 * Same function the install handler uses, on purpose: the running extension
 * and a freshly seeded store cannot then disagree about what a default is.
 * Every default it fills in comes from DEFAULTS in state.mjs, which panel.js
 * reads too, so no reader of storage can invent its own.
 */
const getState = async () => seedState(await chrome.storage.local.get(STATE_KEYS));

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
    const fired = await attemptFire(chrome, { allowStandaloneWindow: state.fallbackWindow });
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
  // Fires on update as well as on first install. seedState keeps whatever the
  // user already chose and fills in only what is missing - see the note there
  // for what that handler used to reset on every release.
  await chrome.storage.local.set(seedState(await chrome.storage.local.get(STATE_KEYS)));
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

  // Honours the fallback setting too, so "Test it now" shows what a real fire
  // would do rather than a more forgiving version of it.
  getState()
    .then((state) => attemptFire(chrome, { allowStandaloneWindow: state.fallbackWindow }))
    .then(
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
  // Reads the stored setting rather than taking attemptFire's default, so the
  // hook fires the same way a real tick would. A hook that always declined the
  // fallback could not exercise it at all; one that always allowed it would
  // report a scare the shipped default would never show.
  fireNow: async () => {
    const { fallbackWindow } = await getState();
    return attemptFire(chrome, { allowStandaloneWindow: fallbackWindow });
  },
  setRemaining: (remaining) => chrome.storage.local.set({ remaining }),
  tickNow: () => tick(),
};
