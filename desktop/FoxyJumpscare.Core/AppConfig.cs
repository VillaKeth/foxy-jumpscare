namespace FoxyJumpscare.Core;

public sealed class AppConfig
{
    public bool Enabled { get; set; } = true;
    public int OneInN { get; set; } = Roll.DefaultOneInN;
    public int TickSeconds { get; set; } = Ticker.TickSeconds;
    public int IdleThresholdSeconds { get; set; } = 60;

    /// <summary>
    /// How long past the video's own length the force-close waits. There is
    /// deliberately no duration setting - on-screen time is the video's length.
    /// </summary>
    public int FailsafeMarginMs { get; set; } = 1500;

    public bool RunAtStartup { get; set; }
}

public sealed class AppState
{
    /// <summary>
    /// Active seconds left before firing. long rather than int: an unlucky
    /// ultra-rare draw can exceed int.MaxValue.
    /// </summary>
    public long Remaining { get; set; }
}
