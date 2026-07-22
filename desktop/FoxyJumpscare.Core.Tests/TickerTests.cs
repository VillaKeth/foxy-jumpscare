namespace FoxyJumpscare.Core.Tests;

public class TickerTests
{
    [Fact]
    public void TickSeconds_Is30()
    {
        Assert.Equal(30, Ticker.TickSeconds);
    }

    [Fact]
    public void Credit_SubtractsActiveSeconds()
    {
        var result = Ticker.Credit(500, 30);
        Assert.Equal(470, result.Remaining);
        Assert.False(result.ShouldFire);
    }

    [Fact]
    public void Credit_FiresWhenCountdownReachesZero()
    {
        var result = Ticker.Credit(30, 30);
        Assert.Equal(0, result.Remaining);
        Assert.True(result.ShouldFire);
    }

    [Fact]
    public void Credit_ClampsAtZeroRatherThanGoingNegative()
    {
        var result = Ticker.Credit(10, 30);
        Assert.Equal(0, result.Remaining);
        Assert.True(result.ShouldFire);
    }

    [Fact]
    public void Credit_KeepsFiringWhileRemainingIsZero()
    {
        // A failed overlay leaves Remaining at 0; the next tick must retry
        // rather than treating the roll as spent.
        var result = Ticker.Credit(0, 30);
        Assert.True(result.ShouldFire);
    }

    [Fact]
    public void Credit_DoesNotAdvanceWhenNothingIsCredited()
    {
        var result = Ticker.Credit(500, 0);
        Assert.Equal(500, result.Remaining);
        Assert.False(result.ShouldFire);
    }
}
