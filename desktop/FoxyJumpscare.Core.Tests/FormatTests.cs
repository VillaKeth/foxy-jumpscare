using FoxyJumpscare.Core;
using Xunit;

namespace FoxyJumpscare.Core.Tests;

public class FormatTests
{
    [Theory]
    [InlineData(0, "0s")]
    [InlineData(59, "59s")]
    [InlineData(90, "1m")]
    [InlineData(3600, "1h")]
    [InlineData(3660, "1h 1m")]
    [InlineData(7200, "2h")]
    [InlineData(86_400, "1d")]
    [InlineData(90_061, "1d 1h")]
    public void Duration_ShowsAtMostTwoUnits(long seconds, string expected) =>
        Assert.Equal(expected, Format.Duration(seconds));

    [Fact]
    public void Duration_NeverNegative() =>
        // Remaining clamps at 0 in the ticker, but the window also reads state
        // written by older builds.
        Assert.Equal("0s", Format.Duration(-500));

    [Theory]
    [InlineData(10_000, "averages about 2h 46m of active use")]
    [InlineData(300_000, "averages about 3d 11h of active use")]
    [InlineData(60, "averages about 1m of active use")]
    public void DescribeOdds_StatesTheMeanInActiveUseTime(int oneInN, string expected) =>
        // E[X] = N active seconds, so this needs no hours-per-day assumption.
        Assert.Equal(expected, Format.DescribeOdds(oneInN));
}
