/** The stored record, and how it survives an update. No browser APIs. */

import { DEFAULT_ONE_IN_N, drawRemaining } from './roll.mjs';

/**
 * Build the storage record to write from runtime.onInstalled.
 *
 * That listener fires on UPDATE as well as on first install, and the same code
 * runs both times, so this has to be safe to re-run against a populated store.
 * Every field is "keep what is there, otherwise seed a default" - nothing is
 * overwritten just because the extension was reinstalled or upgraded.
 *
 * Two of these were live defects. Writing `enabled: true` unconditionally
 * switched the extension back on for anyone who had turned it off, on every
 * single release. Redrawing `remaining` unconditionally threw away however
 * much of the countdown had already been served - at 1-in-100,000 that is up
 * to a week of browsing discarded by a version bump.
 *
 * `??` and not `||`, deliberately: `remaining: 0` and `enabled: false` are both
 * real values with meaning. 0 means a fire is pending and the next tick should
 * retry it; `||` would read both as unset and clobber them.
 *
 * `draw` is injectable so tests can tell a preserved countdown from a fresh
 * one without depending on Math.random.
 */
/**
 * Every default the extension has, in one place, for everything that reads
 * storage rather than only the install handler.
 *
 * `remaining` is deliberately absent: its default is a random draw against
 * whatever odds are in force, not a constant, so seedState computes it.
 *
 * This exists because panel.js kept a second copy of these and the two drifted.
 * The panel still said `fallbackWindow` defaulted to false a release after the
 * seed had switched to true, so on a store with the key unset the checkbox
 * reported the opposite of what the extension would actually do.
 */
export const DEFAULTS = {
  oneInN: DEFAULT_ONE_IN_N,
  enabled: true,
  fallbackWindow: true,
  fallbackChosen: false,
};

export function seedState(stored, draw = drawRemaining) {
  const current = stored ?? {};
  const oneInN = current.oneInN ?? DEFAULTS.oneInN;

  // `fallbackWindow` alone cannot distinguish a value the user picked from one
  // this function wrote for them, and for one release that mattered: 0.1.7 and
  // 0.1.8 seeded it false, 0.1.9 changed the default to true, and the line
  // above faithfully preserved the seeded false - so the new default reached
  // nobody who already had the extension. Every existing install stayed on the
  // old behaviour while the code, the tests and the panel all said otherwise.
  //
  // `fallbackChosen` records the difference. Only the panel sets it, and only
  // when the user works the control. Until then the stored value is this
  // extension's opinion, not theirs, and a new default is free to replace it.
  const fallbackChosen = current.fallbackChosen === true;

  return {
    oneInN,
    enabled: current.enabled ?? DEFAULTS.enabled,
    fallbackWindow: fallbackChosen
      ? current.fallbackWindow ?? DEFAULTS.fallbackWindow
      : DEFAULTS.fallbackWindow,
    fallbackChosen,
    remaining: current.remaining ?? draw(oneInN),
  };
}

/** The keys seedState reads, so callers fetch exactly what it needs. */
export const STATE_KEYS = [
  'oneInN',
  'enabled',
  'fallbackWindow',
  'fallbackChosen',
  'remaining',
];
