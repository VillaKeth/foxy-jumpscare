namespace FoxyJumpscare.Core;

/// <summary>A rectangle in device-independent units.</summary>
public readonly record struct DipRect(double X, double Y, double Width, double Height);

/// <summary>
/// Physical-pixel to device-independent conversion for overlay placement.
///
/// Pure so it can be tested without a display. Windows reports monitor bounds in
/// physical pixels while WPF positions in device-independent units, and getting
/// this wrong leaves the overlay mis-sized on any scaled display - which is most
/// laptops. A mixed-DPI rig cannot be conjured in CI, so the arithmetic is
/// tested here directly instead.
/// </summary>
public static class ScreenMath
{
    /// <summary>
    /// Convert a physical rectangle to DIPs, expressed relative to a physical
    /// origin. The origin is the virtual desktop's top-left, which is negative
    /// when a monitor sits above or left of the primary.
    /// </summary>
    public static DipRect ToDip(
        int left, int top, int width, int height,
        int originLeft, int originTop,
        double scale)
        => ToDip(left, top, width, height, originLeft, originTop, scale, scale);

    /// <summary>As above, with independent horizontal and vertical scaling.</summary>
    public static DipRect ToDip(
        int left, int top, int width, int height,
        int originLeft, int originTop,
        double scaleX, double scaleY)
    {
        if (scaleX <= 0 || scaleY <= 0)
            throw new ArgumentOutOfRangeException(
                nameof(scaleX), "DPI scale must be positive");

        return new DipRect(
            (left - originLeft) / scaleX,
            (top - originTop) / scaleY,
            width / scaleX,
            height / scaleY);
    }

    /// <summary>
    /// The bounding box of every monitor, in physical pixels. Left and top can
    /// be negative when a monitor is positioned above or left of the primary.
    /// </summary>
    public static (int Left, int Top, int Width, int Height) VirtualBounds(
        IEnumerable<(int Left, int Top, int Width, int Height)> screens)
    {
        var all = screens.ToList();
        if (all.Count == 0)
            throw new ArgumentException("At least one screen is required", nameof(screens));

        var left = all.Min(s => s.Left);
        var top = all.Min(s => s.Top);
        var right = all.Max(s => s.Left + s.Width);
        var bottom = all.Max(s => s.Top + s.Height);

        return (left, top, right - left, bottom - top);
    }
}
