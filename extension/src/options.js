import { PRESETS, DEFAULT_ONE_IN_N, drawRemaining } from './lib/roll.mjs';

const enabledEl = document.getElementById('enabled');
const oddsEl = document.getElementById('odds');
const statusEl = document.getElementById('status');

function presetNameFor(oneInN) {
  return Object.keys(PRESETS).find((k) => PRESETS[k] === oneInN) ?? 'normal';
}

async function load() {
  const { enabled = true, oneInN = DEFAULT_ONE_IN_N } =
    await chrome.storage.local.get(['enabled', 'oneInN']);
  enabledEl.checked = enabled;
  oddsEl.value = presetNameFor(oneInN);
}

enabledEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ enabled: enabledEl.checked });
  statusEl.textContent = 'Saved.';
});

oddsEl.addEventListener('change', async () => {
  const oneInN = PRESETS[oddsEl.value];
  // Re-draw, otherwise a countdown started at the old odds keeps running and
  // the change appears to do nothing for weeks.
  await chrome.storage.local.set({ oneInN, remaining: drawRemaining(oneInN) });
  statusEl.textContent = 'Saved. Countdown restarted at the new odds.';
});

load();
