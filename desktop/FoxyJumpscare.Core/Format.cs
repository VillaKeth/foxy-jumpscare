namespace FoxyJumpscare.Core;

/// <summary>
/// Human-readable durations and odds for the desktop window. Pure, so it unit
/// tests without a desktop runtime.
///
/// Mirrors extension/src/lib/format.mjs, with one deliberate difference: the
/// desktop counts "active use", not "browsing", and states the mean directly
/// in active-use time. That needs no guess about how many hours a day the
/// machine is used - E[X] for a 1-in-N-per-second roll is exactly N seconds.
/// </summary>
public static class Format
{
    /// <summary>Coarse duration, two units at most, for a glanceable number.</summary>
    public static string Duration(long seconds)
    {
        var total = Math.Max(0, seconds);
        if (total < 60) return $"{total}s";

        var days = total / 86_400;
        var hours = (total % 86_400) / 3_600;
        var minutes = (total % 3_600) / 60;

        if (days > 0) return hours > 0 ? $"{days}d {hours}h" : $"{days}d";
        if (hours > 0) return minutes > 0 ? $"{hours}h {minutes}m" : $"{hours}h";
        return $"{minutes}m";
    }

    /// <summary>
    /// The mean wait for a 1-in-N-per-active-second roll, phrased for a human.
    /// E[X] = N active seconds, so this is assumption-free.
    /// </summary>
    public static string DescribeOdds(int oneInN) =>
        $"averages about {Duration(oneInN)} of active use";
}
