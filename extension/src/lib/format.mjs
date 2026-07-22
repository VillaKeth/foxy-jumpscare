/** Human-readable durations for the panel. Pure - no browser APIs. */

/**
 * The countdown is denominated in seconds of *active browsing*, not wall
 * clock: it only advances while the browser is focused and the user is not
 * idle. Turning that into "about once a week" therefore needs an assumption
 * about how much of a day is spent browsing. Four hours is the figure the
 * store listing copy was written against - change it here and the panel, the
 * presets, and the listing all stay consistent.
 */
export const BROWSING_HOURS_PER_DAY = 4;

/** Coarse duration - two units at most, because this is a glanceable number. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;

  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/**
 * Mean wait for 1-in-N per active second, phrased for a human.
 *
 * Below a day it is quoted in browsing time, because "about once every 0.7
 * days" is both wrong-sounding and misleading - that is under three hours of
 * actual browsing.
 */
export function describeOdds(oneInN) {
  const days = oneInN / 3600 / BROWSING_HOURS_PER_DAY;
  if (days < 1) return `about every ${formatDuration(oneInN)} of browsing`;

  // Threshold on the *rounded* figure, or 13.9 days prints as "14 days" - a
  // number nobody says out loud when they mean two weeks.
  const whole = Math.round(days);
  if (whole < 14) return `about once every ${whole} days`;
  return `about once every ${Math.round(days / 7)} weeks`;
}
