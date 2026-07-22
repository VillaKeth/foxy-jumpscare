namespace FoxyJumpscare.Core;

/// <summary>
/// The roll. Pure - no UI, no P/Invoke, so it tests without a desktop runtime.
///
/// The original Terraria mod rolls 1-in-N once per wall-clock second. Doing that
/// literally is wrong for a process that runs all day: timers drift across sleep
/// and hibernation, and a dropped tick silently biases the odds. Instead we
/// sample the wait once from the equivalent geometric distribution and count it
/// down against measured active time.
///
/// Must stay identical to extension/src/lib/roll.mjs.
/// </summary>
public static class Roll
{
    public static readonly IReadOnlyDictionary<string, int> Presets =
        new Dictionary<string, int>
        {
            ["ultra-rare"] = 1_000_000,
            ["rare"] = 300_000,
            ["normal"] = 100_000,
            ["terraria-faithful"] = 10_000,
        };

    public const int DefaultOneInN = 300_000;

    /// <summary>
    /// Inverse-transform sample of X ~ Geometric(p), p = 1/oneInN,
    /// support {1,2,...}. E[X] = oneInN.
    /// </summary>
    public static long DrawRemaining(int oneInN, Func<double>? rand = null)
    {
        if (oneInN < 1)
            throw new ArgumentOutOfRangeException(
                nameof(oneInN), oneInN, "oneInN must be >= 1");

        rand ??= Random.Shared.NextDouble;

        var p = 1.0 / oneInN;
        // NextDouble() returns [0,1); 1 - it gives (0,1], keeping Log finite.
        var u = 1.0 - rand();
        var draw = Math.Log(u) / Math.Log(1.0 - p);

        // ln(1) == 0 yields -0, and oneInN == 1 puts -Infinity in the
        // denominator; both floor to 1, the correct minimum.
        return Math.Max(1, (long)Math.Ceiling(draw));
    }
}
