import { describe, it, expect } from 'vitest';
import { seedState } from '../../extension/src/lib/state.mjs';
import { DEFAULT_ONE_IN_N } from '../../extension/src/lib/roll.mjs';

/** Deterministic stand-in for drawRemaining, so a fresh draw is recognisable. */
const draw = () => 4242;

describe('seedState, on a first install', () => {
  it('fills in every default when nothing is stored', () => {
    expect(seedState({}, draw)).toEqual({
      oneInN: DEFAULT_ONE_IN_N,
      enabled: true,
      fallbackWindow: true,
      remaining: 4242,
    });
  });

  it('treats missing storage the same as empty storage', () => {
    expect(seedState(undefined, draw).enabled).toBe(true);
  });
});

// onInstalled fires on UPDATE as well as install, and the same handler runs
// both times. Anything the user chose has to survive that, or every release
// quietly resets the extension underneath them.

describe('seedState, on an update', () => {
  it('leaves the extension disabled if the user disabled it', () => {
    expect(seedState({ enabled: false }, draw).enabled).toBe(false);
  });

  it('keeps the countdown rather than restarting it', () => {
    // The whole point of a rare scare is the wait. Redrawing on every update
    // throws away however much of it the user had already served.
    expect(seedState({ remaining: 61_000 }, draw).remaining).toBe(61_000);
  });

  it('keeps a countdown that has run down to zero', () => {
    // 0 is a real, meaningful value here: it means a fire is pending and the
    // next tick should retry it. It must not be mistaken for "unset".
    expect(seedState({ remaining: 0 }, draw).remaining).toBe(0);
  });

  it('keeps custom odds', () => {
    expect(seedState({ oneInN: 60 }, draw).oneInN).toBe(60);
  });

  it('keeps the black-window fallback switched off if the user unticked it', () => {
    // The one that actually needs ?? rather than ||: false is a real choice
    // here, not an unset value, and every update must respect it.
    expect(seedState({ fallbackWindow: false }, draw).fallbackWindow).toBe(false);
  });

  it('preserves a fully populated record untouched', () => {
    const stored = { oneInN: 60, enabled: false, fallbackWindow: false, remaining: 12 };
    expect(seedState(stored, draw)).toEqual(stored);
  });

  it('draws the countdown against the stored odds, not the default', () => {
    // A user on custom odds whose countdown is somehow missing should get a
    // wait drawn for THEIR odds.
    const seen = [];
    seedState({ oneInN: 60 }, (n) => { seen.push(n); return 1; });
    expect(seen).toEqual([60]);
  });
});
