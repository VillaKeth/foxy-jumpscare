import { describe, it, expect } from 'vitest';
import { seedState, DEFAULTS } from '../../extension/src/lib/state.mjs';
import { DEFAULT_ONE_IN_N } from '../../extension/src/lib/roll.mjs';

/** Deterministic stand-in for drawRemaining, so a fresh draw is recognisable. */
const draw = () => 4242;

describe('seedState, on a first install', () => {
  it('fills in every default when nothing is stored', () => {
    expect(seedState({}, draw)).toEqual({
      oneInN: DEFAULT_ONE_IN_N,
      enabled: true,
      fallbackWindow: true,
      // Nothing has been chosen yet - a fresh install has taken every default
      // rather than picked any of them.
      fallbackChosen: false,
      remaining: 4242,
    });
  });

  it('treats missing storage the same as empty storage', () => {
    expect(seedState(undefined, draw).enabled).toBe(true);
  });

  it('seeds exactly the shared defaults, so no other reader can disagree', () => {
    // panel.js reads storage directly and has to fill in the same blanks this
    // does. It used to carry its own copy of them, and they drifted: the panel
    // said fallbackWindow defaulted to false a release after the seed started
    // saying true, so the checkbox could report the opposite of the behaviour.
    // One exported record, read by both, is what stops that recurring.
    expect(seedState({}, draw)).toEqual({ ...DEFAULTS, remaining: 4242 });
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
    // here, not an unset value, and every update must respect it. What marks it
    // as a choice is fallbackChosen - see the migration block below.
    const stored = { fallbackWindow: false, fallbackChosen: true };
    expect(seedState(stored, draw).fallbackWindow).toBe(false);
  });

  it('preserves a fully populated record untouched', () => {
    const stored = {
      oneInN: 60,
      enabled: false,
      fallbackWindow: false,
      fallbackChosen: true,
      remaining: 12,
    };
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

// 0.1.7 and 0.1.8 seeded `fallbackWindow: false` themselves. 0.1.9 changed the
// default to true - and `??` did its job and preserved the stored false, so the
// new default reached nobody who already had the extension installed. The store
// could not tell a value the user picked from one the extension had written for
// them, so respecting the user's choice and applying a new default were the
// same operation.
//
// `fallbackChosen` is what separates them from here on. Only the panel sets it,
// and only when the user works the control themselves.

describe('seedState, on a store that predates the choice being recorded', () => {
  it('adopts the current default, because the stored value was never a choice', () => {
    expect(seedState({ fallbackWindow: false }, draw).fallbackWindow).toBe(true);
  });

  it('marks it as still unchosen, so a later default can reach it too', () => {
    expect(seedState({ fallbackWindow: false }, draw).fallbackChosen).toBe(false);
  });

  it('does not override a value once the user has actually chosen it', () => {
    // The migration has to be a one-off. Unticking the box after it has run
    // must stick through every subsequent update.
    const unticked = { fallbackWindow: false, fallbackChosen: true };
    expect(seedState(unticked, draw).fallbackWindow).toBe(false);
  });

  it('leaves a deliberate tick alone as well', () => {
    const ticked = { fallbackWindow: true, fallbackChosen: true };
    expect(seedState(ticked, draw).fallbackWindow).toBe(true);
  });
});
