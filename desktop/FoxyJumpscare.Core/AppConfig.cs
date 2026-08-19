namespace FoxyJumpscare.Core;

public sealed class AppConfig
{
    public bool Enabled { get; set; } = true;
    public int OneInN { get; set; } = Roll.DefaultOneInN;
    public int TickSeconds { get; set; } = Ticker.TickSeconds;
    public int IdleThresholdSeconds { get; set; } = 60;

    /// <summary>
    /// How long past the video's own length the force-close waits. Also how
    /// long the player is kept alive after the clip ends so the audio buffer
    /// drains - closing the instant a sub-second clip decodes cut the scream
    /// before it reached the speakers.
    /// </summary>
    public int FailsafeMarginMs { get; set; } = 1500;

    /// <summary>
    /// How long the last frame stays on screen after the video ends.
    ///
    /// This used to be the whole of <see cref="FailsafeMarginMs"/>, because the
    /// picture was simply left up for the audio drain: 0.77s of lunge followed
    /// by 1.5s of Foxy hanging there motionless, which is two thirds of the
    /// scare spent on a freeze-frame. Cutting it to zero read as too abrupt.
    /// So it is its own setting - the hold is a judgement call about how the
    /// scare feels, and it has nothing to do with what the audio needs.
    ///
    /// Third pass, 2026-08-19: 600ms was still reported as "frozen for a
    /// noticeable amount of time". Measured against the clip it sits on: the
    /// video runs ~0.7s, so a 600ms hold was very nearly half the time Foxy
    /// was on screen, all of it a single motionless frame. 250ms leaves a beat
    /// on the landing without reading as a stall.
    ///
    /// Clamped to <see cref="FailsafeMarginMs"/> at use, since the overlay is
    /// gone by then regardless.
    /// </summary>
    public int OverlayHoldMs { get; set; } = 250;

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
