import { describe, it, expect } from 'vitest';
import {
  TICK_SECONDS,
  creditTick,
  countsTowardCountdown,
  isInjectableUrl,
} from '../../extension/src/lib/ticker.mjs';

describe('TICK_SECONDS', () => {
  it('is 60, the chrome.alarms floor', () => {
    expect(TICK_SECONDS).toBe(60);
  });
});

describe('creditTick', () => {
  it('subtracts credited seconds', () => {
    expect(creditTick({ remaining: 500 }, 60)).toEqual({ remaining: 440, shouldFire: false });
  });

  it('fires when the countdown reaches zero', () => {
    expect(creditTick({ remaining: 60 }, 60)).toEqual({ remaining: 0, shouldFire: true });
  });

  it('fires when the countdown would go negative, and clamps at zero', () => {
    expect(creditTick({ remaining: 10 }, 60)).toEqual({ remaining: 0, shouldFire: true });
  });

  it('keeps firing while remaining is zero', () => {
    // A failed injection leaves remaining at 0; the next tick must retry
    // rather than treating the roll as spent.
    expect(creditTick({ remaining: 0 }, 60)).toEqual({ remaining: 0, shouldFire: true });
  });

  it('does not advance when no active seconds are credited', () => {
    expect(creditTick({ remaining: 500 }, 0)).toEqual({ remaining: 500, shouldFire: false });
  });
});

describe('countsTowardCountdown', () => {
  it('counts a minute spent in the browser', () => {
    expect(countsTowardCountdown({ idleState: 'active', browserFocused: true })).toBe(true);
  });

  it('does not count time in another app, by default', () => {
    // chrome.idle is system-wide: it reads 'active' while the user plays a
    // game with the browser in the background. The focus check is what keeps
    // those minutes off a countdown advertised as "active browsing".
    expect(countsTowardCountdown({ idleState: 'active', browserFocused: false })).toBe(false);
  });

  it('counts time in another app when the user asked for that', () => {
    const away = { idleState: 'active', browserFocused: false };
    expect(countsTowardCountdown(away, { countOutsideBrowser: true })).toBe(true);
  });

  it('never counts an idle or locked machine, even when counting outside the browser', () => {
    // A machine left on overnight must not burn the odds, whatever the user
    // asked for. The option widens "active" to other apps, not to absence.
    for (const idleState of ['idle', 'locked']) {
      for (const browserFocused of [true, false]) {
        const minute = { idleState, browserFocused };
        expect(countsTowardCountdown(minute, { countOutsideBrowser: true })).toBe(false);
        expect(countsTowardCountdown(minute)).toBe(false);
      }
    }
  });
});

describe('isInjectableUrl', () => {
  it('accepts ordinary web pages', () => {
    expect(isInjectableUrl('https://example.com/x')).toBe(true);
    expect(isInjectableUrl('http://example.com')).toBe(true);
  });

  it('rejects privileged schemes', () => {
    for (const url of [
      'chrome://extensions',
      'about:config',
      'edge://settings',
      'devtools://devtools/bundled/x.html',
      'view-source:https://example.com',
      'chrome-extension://abc/page.html',
      'moz-extension://abc/page.html',
    ]) {
      expect(isInjectableUrl(url), url).toBe(false);
    }
  });

  it('rejects the extension stores, which block injection', () => {
    expect(isInjectableUrl('https://chromewebstore.google.com/detail/x')).toBe(false);
    expect(isInjectableUrl('https://chrome.google.com/webstore/detail/x')).toBe(false);
    expect(isInjectableUrl('https://addons.mozilla.org/en-US/firefox/')).toBe(false);
  });

  it('rejects empty and missing urls', () => {
    expect(isInjectableUrl('')).toBe(false);
    expect(isInjectableUrl(undefined)).toBe(false);
    expect(isInjectableUrl(null)).toBe(false);
  });
});
