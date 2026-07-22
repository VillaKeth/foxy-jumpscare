import { drawRemaining, DEFAULT_ONE_IN_N } from './lib/roll.mjs';
import { TICK_SECONDS, creditTick } from './lib/ticker.mjs';

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
    console.log('[foxy] would fire (overlay not wired yet)');
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
