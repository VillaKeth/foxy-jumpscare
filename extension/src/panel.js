import { PRESETS, DEFAULT_ONE_IN_N, drawRemaining } from './lib/roll.mjs';
import { describeOdds, formatDuration } from './lib/format.mjs';

const el = (id) => document.getElementById(id);
const enabledEl = el('enabled');
const oddsEl = el('odds');
const customFieldEl = el('custom-field');
const customEl = el('custom');
const remainingEl = el('remaining');
const noteEl = el('odds-note');
const statusEl = el('status');
const testEl = el('test');
const fallbackEl = el('fallback');

const presetNameFor = (oneInN) =>
  Object.keys(PRESETS).find((k) => PRESETS[k] === oneInN) ?? 'custom';

/** The odds the controls currently describe, or null if the custom box is junk. */
function selectedOneInN() {
  if (oddsEl.value !== 'custom') return PRESETS[oddsEl.value];
  const n = Math.floor(Number(customEl.value));
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function renderOdds(oneInN) {
  // "1 in N" alone reads as "one every N seconds". It is a chance, rolled
  // afresh every second - the average is a consequence of that, not the rule.
  noteEl.textContent =
    `1 in ${oneInN.toLocaleString()} chance every active second, so ${describeOdds(oneInN)}.`;
}

function renderRemaining(remaining) {
  remainingEl.textContent = remaining <= 0 ? 'any second' : formatDuration(remaining);
}

async function load() {
  const {
    enabled = true,
    oneInN = DEFAULT_ONE_IN_N,
    remaining = 0,
    fallbackWindow = false,
  } = await chrome.storage.local.get(['enabled', 'oneInN', 'remaining', 'fallbackWindow']);

  enabledEl.checked = enabled;
  fallbackEl.checked = fallbackWindow;
  oddsEl.value = presetNameFor(oneInN);
  customEl.value = String(oneInN);
  customFieldEl.classList.toggle('hidden', oddsEl.value !== 'custom');
  renderOdds(oneInN);
  renderRemaining(remaining);
}

/**
 * Persist the odds and restart the countdown.
 *
 * The redraw is not optional: a countdown drawn at the old odds keeps running
 * against the new setting, so changing the rarity would appear to do nothing
 * for a week. Redrawing is also the only way "Custom: 60" is testable at all.
 */
async function commitOdds() {
  const oneInN = selectedOneInN();
  if (oneInN === null) {
    statusEl.textContent = 'Enter a whole number of 1 or more.';
    return;
  }

  const remaining = drawRemaining(oneInN);
  await chrome.storage.local.set({ oneInN, remaining });
  renderOdds(oneInN);
  renderRemaining(remaining);
  statusEl.textContent = 'Saved. Countdown restarted.';
}

enabledEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ enabled: enabledEl.checked });
  statusEl.textContent = enabledEl.checked ? 'Enabled.' : 'Disabled. Nothing will fire.';
});

fallbackEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ fallbackWindow: fallbackEl.checked });
  statusEl.textContent = fallbackEl.checked
    ? 'Will use a black fullscreen window when there is no page.'
    : 'Will wait for an ordinary tab instead.';
});

oddsEl.addEventListener('change', () => {
  const custom = oddsEl.value === 'custom';
  customFieldEl.classList.toggle('hidden', !custom);
  // Switching *to* Custom should not commit whatever number happens to be in
  // the box - wait for the user to type one.
  if (custom) customEl.focus();
  else commitOdds();
});

customEl.addEventListener('change', commitOdds);

testEl.addEventListener('click', async () => {
  testEl.disabled = true;
  statusEl.textContent = 'Firing…';

  // Deliberately routed through the background rather than fired here: the
  // panel is a moz-extension: page and cannot inject into tabs itself.
  const res = await chrome.runtime.sendMessage({ type: 'foxy:test-fire' }).catch(() => null);

  testEl.disabled = false;
  statusEl.textContent = res?.fired
    ? 'Fired. The real countdown was not spent.'
    : 'Could not fire — open an ordinary http(s) tab and try again.';
});

// The background ticks every 60s; keep the countdown honest if the panel is
// left open (it stays open indefinitely when used as the options page).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.remaining) renderRemaining(changes.remaining.newValue ?? 0);
});

load();
