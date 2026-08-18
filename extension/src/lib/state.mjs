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
export function seedState(stored, draw = drawRemaining) {
  const current = stored ?? {};
  const oneInN = current.oneInN ?? DEFAULT_ONE_IN_N;

  return {
    oneInN,
    enabled: current.enabled ?? true,
    fallbackWindow: current.fallbackWindow ?? true,
    remaining: current.remaining ?? draw(oneInN),
  };
}

/** The keys seedState reads, so callers fetch exactly what it needs. */
export const STATE_KEYS = ['oneInN', 'enabled', 'fallbackWindow', 'remaining'];
