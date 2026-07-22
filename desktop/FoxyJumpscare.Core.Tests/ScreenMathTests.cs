namespace FoxyJumpscare.Core.Tests;

public class ScreenMathTests
{
    [Fact]
    public void ToDip_IsIdentityAt100Percent()
    {
        var r = ScreenMath.ToDip(0, 0, 1920, 1080, 0, 0, 1.0);
        Assert.Equal(new DipRect(0, 0, 1920, 1080), r);
    }

    [Theory]
    [InlineData(1.25, 1536, 864)]   // 125%
    [InlineData(1.5, 1280, 720)]    // 150%
    [InlineData(2.0, 960, 540)]     // 200%
    public void ToDip_ShrinksByTheScaleFactor(double scale, double w, double h)
    {
        var r = ScreenMath.ToDip(0, 0, 1920, 1080, 0, 0, scale);
        Assert.Equal(w, r.Width, 3);
        Assert.Equal(h, r.Height, 3);
    }

    [Fact]
    public void ToDip_ExpressesPositionRelativeToTheOrigin()
    {
        // Second monitor to the right of a 1920-wide primary: its window-local
        // X must be 1920, not 3840.
        var r = ScreenMath.ToDip(1920, 0, 1920, 1080, 0, 0, 1.0);
        Assert.Equal(1920, r.X, 3);
        Assert.Equal(0, r.Y, 3);
    }

    [Fact]
    public void ToDip_HandlesAMonitorLeftOfThePrimary()
    {
        // A monitor placed to the left gives a negative virtual origin. The
        // primary then sits at a positive offset inside the spanning window.
        var r = ScreenMath.ToDip(0, 0, 1920, 1080, -1920, 0, 1.0);
        Assert.Equal(1920, r.X, 3);
    }

    [Fact]
    public void ToDip_HandlesAMonitorAboveThePrimary()
    {
        var r = ScreenMath.ToDip(0, 0, 1920, 1080, 0, -1080, 1.0);
        Assert.Equal(1080, r.Y, 3);
    }

    [Fact]
    public void ToDip_ScalesOffsetAsWellAsSize()
    {
        // The offset must be scaled too. Scaling only the size is the classic
        // mistake and puts the overlay in the wrong place on a scaled display.
        var r = ScreenMath.ToDip(1920, 0, 1920, 1080, 0, 0, 1.5);
        Assert.Equal(1280, r.X, 3);
        Assert.Equal(1280, r.Width, 3);
    }

    [Fact]
    public void ToDip_SupportsNonSquareScaling()
    {
        var r = ScreenMath.ToDip(0, 0, 1920, 1080, 0, 0, 2.0, 1.0);
        Assert.Equal(960, r.Width, 3);
        Assert.Equal(1080, r.Height, 3);
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(-1.5)]
    public void ToDip_RejectsANonPositiveScale(double scale)
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => ScreenMath.ToDip(0, 0, 100, 100, 0, 0, scale));
    }

    [Fact]
    public void VirtualBounds_SpansASingleScreen()
    {
        var v = ScreenMath.VirtualBounds([(0, 0, 1920, 1080)]);
        Assert.Equal((0, 0, 1920, 1080), v);
    }

    [Fact]
    public void VirtualBounds_SpansTwoSideBySideScreens()
    {
        var v = ScreenMath.VirtualBounds([(0, 0, 1920, 1080), (1920, 0, 1920, 1080)]);
        Assert.Equal((0, 0, 3840, 1080), v);
    }

    [Fact]
    public void VirtualBounds_HandlesNegativeCoordinates()
    {
        // Monitor to the left of the primary reports a negative Left.
        var v = ScreenMath.VirtualBounds([(-1920, 0, 1920, 1080), (0, 0, 1920, 1080)]);
        Assert.Equal((-1920, 0, 3840, 1080), v);
    }

    [Fact]
    public void VirtualBounds_HandlesMixedResolutionsAndVerticalOffset()
    {
        // Laptop panel below and left of a larger external display - the shape
        // that mixed-DPI setups usually take.
        var v = ScreenMath.VirtualBounds([(0, 0, 2560, 1440), (-1920, 1440, 1920, 1080)]);
        Assert.Equal((-1920, 0, 4480, 2520), v);
    }

    [Fact]
    public void VirtualBounds_RejectsNoScreens()
    {
        Assert.Throws<ArgumentException>(
            () => ScreenMath.VirtualBounds(Array.Empty<(int, int, int, int)>()));
    }
}
