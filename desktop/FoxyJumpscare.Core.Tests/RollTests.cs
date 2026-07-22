namespace FoxyJumpscare.Core.Tests;

public class RollTests
{
    [Fact]
    public void Presets_MatchTheSpec()
    {
        Assert.Equal(1_000_000, Roll.Presets["ultra-rare"]);
        Assert.Equal(300_000, Roll.Presets["rare"]);
        Assert.Equal(100_000, Roll.Presets["normal"]);
        Assert.Equal(10_000, Roll.Presets["terraria-faithful"]);
    }

    [Fact]
    public void DefaultOneInN_IsTheRarePreset()
    {
        Assert.Equal(300_000, Roll.DefaultOneInN);
    }

    [Fact]
    public void DrawRemaining_HasMeanAboutN()
    {
        const int n = 1000;
        const int trials = 200_000;
        double total = 0;
        for (var i = 0; i < trials; i++) total += Roll.DrawRemaining(n);
        var mean = total / trials;

        // Geometric(p=1/n) has mean n and sd ~n, so the sample mean's standard
        // error is n/sqrt(trials) ~ 2.24. A 5% band is ~22x that - loose enough
        // never to flake, tight enough to catch an order-of-magnitude mistake.
        Assert.InRange(mean, n * 0.95, n * 1.05);
    }

    [Fact]
    public void DrawRemaining_IsNeverLessThanOne()
    {
        for (var i = 0; i < 10_000; i++)
            Assert.True(Roll.DrawRemaining(10) >= 1);
    }

    [Fact]
    public void DrawRemaining_ReturnsOne_AtTheUpperBoundary()
    {
        // rand() == 0 gives u = 1, and ln(1) == 0.
        Assert.Equal(1, Roll.DrawRemaining(100_000, () => 0.0));
    }

    [Fact]
    public void DrawRemaining_ReturnsLargeFiniteValue_AsUApproachesZero()
    {
        var draw = Roll.DrawRemaining(100_000, () => 1.0 - 1e-12);
        Assert.True(draw > 1_000_000, $"expected a large draw, got {draw}");
    }

    [Fact]
    public void DrawRemaining_HandlesOneInOne()
    {
        // p == 1 puts -Infinity in the denominator; the result must still be 1.
        Assert.Equal(1, Roll.DrawRemaining(1, () => 0.5));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void DrawRemaining_RejectsNonsensicalN(int oneInN)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Roll.DrawRemaining(oneInN));
    }

    [Fact]
    public void DrawRemaining_MatchesTheJavaScriptImplementation()
    {
        // Same formula, same inputs, same answer. The extension and the desktop
        // app must not drift apart: max(1, ceil(ln(u) / ln(1 - p))).
        const int n = 100_000;
        foreach (var r in new[] { 0.1, 0.25, 0.5, 0.75, 0.9 })
        {
            var p = 1.0 / n;
            var expected = Math.Max(1, (long)Math.Ceiling(Math.Log(1.0 - r) / Math.Log(1.0 - p)));
            Assert.Equal(expected, Roll.DrawRemaining(n, () => r));
        }
    }
}
