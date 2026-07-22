/**
 * The roll. Pure - no browser APIs, so it unit-tests in node.
 *
 * The original Terraria mod rolls 1-in-N once per wall-clock second. Doing
 * that literally is wrong in a browser: background timers are throttled and
 * MV3 service workers are killed, so dropped ticks would silently bias the
 * odds. Instead we sample the wait once from the equivalent geometric
 * distribution and count it down against measured active time. Same
 * distribution, no dependence on a reliable 1 Hz timer.
 *
 * Must stay identical to desktop/FoxyJumpscare.Core/Roll.cs.
 */

export const PRESETS = {
  'ultra-rare': 1_000_000,
  'rare': 300_000,
  'normal': 100_000,
  'terraria-faithful': 10_000,
};

export const DEFAULT_ONE_IN_N = PRESETS.normal;

/**
 * Inverse-transform sample of X ~ Geometric(p), p = 1/oneInN, support {1,2,...}.
 * E[X] = oneInN.
 */
export function drawRemaining(oneInN, rand = Math.random) {
  if (!Number.isFinite(oneInN) || oneInN < 1) {
    throw new Error(`oneInN must be a finite number >= 1, got ${oneInN}`);
  }

  const p = 1 / oneInN;
  // rand() returns [0,1); 1 - rand() gives (0,1], keeping ln() finite.
  const u = 1 - rand();
  const draw = Math.log(u) / Math.log(1 - p);

  // ln(1) === 0 yields -0, and oneInN === 1 yields -Infinity in the
  // denominator; both floor to 1, which is the correct minimum.
  return Math.max(1, Math.ceil(draw));
}
