import { describe, it, expect } from 'vitest';
import { formatDuration, describeOdds } from '../../extension/src/lib/format.mjs';
import { PRESETS } from '../../extension/src/lib/roll.mjs';

describe('formatDuration', () => {
  it('shows seconds below a minute', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('shows at most two units', () => {
    expect(formatDuration(90)).toBe('1m');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(3660)).toBe('1h 1m');
    expect(formatDuration(90_061)).toBe('1d 1h');
  });

  it('drops a zero second unit rather than printing "1d 0h"', () => {
    expect(formatDuration(86_400)).toBe('1d');
    expect(formatDuration(7200)).toBe('2h');
  });

  it('never renders a negative countdown', () => {
    // remaining clamps at 0 in the ticker, but the panel also reads storage
    // written by older builds.
    expect(formatDuration(-500)).toBe('0s');
  });
});

describe('describeOdds', () => {
  it('matches the wording the store listing was written against', () => {
    expect(describeOdds(PRESETS['ultra-rare'])).toBe('about once every 10 weeks');
    expect(describeOdds(PRESETS.rare)).toBe('about once every 3 weeks');
    expect(describeOdds(PRESETS.normal)).toBe('about once every 7 days');
  });

  it('quotes sub-day odds in browsing time, not calendar days', () => {
    // 10,000 active seconds is 2h46m of browsing - calling that "once a day"
    // (as the old options page did) is wrong in both directions.
    expect(describeOdds(PRESETS['terraria-faithful'])).toBe('about every 2h 46m of browsing');
  });

  it('handles a custom value the presets do not cover', () => {
    expect(describeOdds(60)).toBe('about every 1m of browsing');
    expect(describeOdds(200_000)).toBe('about once every 2 weeks');
  });
});
