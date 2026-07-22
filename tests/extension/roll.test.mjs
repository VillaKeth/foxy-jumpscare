import { describe, it, expect } from 'vitest';
import { PRESETS, DEFAULT_ONE_IN_N, drawRemaining } from '../../extension/src/lib/roll.mjs';

describe('PRESETS', () => {
  it('matches the values in the spec', () => {
    expect(PRESETS).toEqual({
      'ultra-rare': 1_000_000,
      'rare': 300_000,
      'normal': 100_000,
      'terraria-faithful': 10_000,
    });
  });

  it('defaults to the normal preset', () => {
    expect(DEFAULT_ONE_IN_N).toBe(100_000);
  });
});

describe('drawRemaining', () => {
  it('has a mean of about N over many draws', () => {
    const N = 1000;
    const trials = 200_000;
    let total = 0;
    for (let i = 0; i < trials; i += 1) total += drawRemaining(N);
    const mean = total / trials;
    // Geometric(p=1/N) has mean N and sd ~N, so the sample mean's standard
    // error is N/sqrt(trials) ~ 2.24. A 5% band is ~22x that — loose enough
    // never to flake, tight enough to catch an off-by-one-order mistake.
    expect(mean).toBeGreaterThan(N * 0.95);
    expect(mean).toBeLessThan(N * 1.05);
  });

  it('never returns less than 1', () => {
    for (let i = 0; i < 10_000; i += 1) {
      expect(drawRemaining(10)).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns 1 at the U=1 boundary', () => {
    // rand() === 0 gives u = 1 - 0 = 1, and ln(1) = 0.
    expect(drawRemaining(100_000, () => 0)).toBe(1);
  });

  it('returns a large finite value as U approaches 0', () => {
    const draw = drawRemaining(100_000, () => 1 - 1e-12);
    expect(Number.isFinite(draw)).toBe(true);
    expect(draw).toBeGreaterThan(1_000_000);
  });

  it('always returns an integer', () => {
    for (let i = 0; i < 1000; i += 1) {
      expect(Number.isInteger(drawRemaining(500))).toBe(true);
    }
  });

  it('rejects a nonsensical N', () => {
    expect(() => drawRemaining(0)).toThrow(/oneInN/);
    expect(() => drawRemaining(-5)).toThrow(/oneInN/);
    expect(() => drawRemaining(Number.NaN)).toThrow(/oneInN/);
  });
});
