namespace FoxyJumpscare.Core;

public readonly record struct TickResult(long Remaining, bool ShouldFire);

/// <summary>
/// Pure tick accounting. Must stay identical to extension/src/lib/ticker.mjs,
/// apart from the tick period - the extension is pinned to 60s by the
/// chrome.alarms floor, which does not apply here.
/// </summary>
public static class Ticker
{
    public const int TickSeconds = 30;

    /// <summary>
    /// Credit elapsed active time against the countdown. Remaining clamps at 0
    /// rather than going negative, and ShouldFire stays true while it sits at 0.
    /// That is what lets a failed overlay retry on the next tick instead of
    /// silently spending the roll.
    /// </summary>
    public static TickResult Credit(long remaining, int activeSeconds)
    {
        var next = Math.Max(0, remaining - activeSeconds);
        return new TickResult(next, next <= 0);
    }
}
