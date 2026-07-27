namespace FoxyJumpscare.Core.Tests;

public class StoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(
        Path.GetTempPath(), "foxy-store-" + Guid.NewGuid().ToString("N"));

    public StoreTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, true);
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void LoadConfig_ReturnsSpecDefaults_WhenNoFileExists()
    {
        var config = Store.LoadConfig(_dir);
        Assert.True(config.Enabled);
        Assert.Equal(100_000, config.OneInN);
        Assert.Equal(30, config.TickSeconds);
        Assert.Equal(60, config.IdleThresholdSeconds);
        Assert.Equal(1500, config.FailsafeMarginMs);
        Assert.False(config.RunAtStartup);
    }

    [Fact]
    public void SaveConfig_ThenLoadConfig_RoundTrips()
    {
        Store.SaveConfig(_dir, new AppConfig
        {
            Enabled = false,
            OneInN = 10_000,
            RunAtStartup = true,
        });

        var loaded = Store.LoadConfig(_dir);
        Assert.False(loaded.Enabled);
        Assert.Equal(10_000, loaded.OneInN);
        Assert.True(loaded.RunAtStartup);
    }

    [Fact]
    public void LoadConfig_FallsBackToDefaults_OnCorruptFile()
    {
        // A half-written file after a power cut must not brick the app.
        File.WriteAllText(Path.Combine(_dir, "config.json"), "{ this is not json");
        Assert.Equal(100_000, Store.LoadConfig(_dir).OneInN);
    }

    [Fact]
    public void LoadState_ReturnsZeroRemaining_WhenNoFileExists()
    {
        Assert.Equal(0, Store.LoadState(_dir).Remaining);
    }

    [Fact]
    public void SaveState_ThenLoadState_RoundTrips()
    {
        Store.SaveState(_dir, new AppState { Remaining = 12_345 });
        Assert.Equal(12_345, Store.LoadState(_dir).Remaining);
    }

    [Fact]
    public void SaveState_HandlesValuesBeyondIntRange()
    {
        // ultra-rare draws can exceed int.MaxValue on an unlucky sample.
        const long big = 5_000_000_000L;
        Store.SaveState(_dir, new AppState { Remaining = big });
        Assert.Equal(big, Store.LoadState(_dir).Remaining);
    }

    [Fact]
    public void SaveConfig_CreatesTheDirectoryIfMissing()
    {
        var nested = Path.Combine(_dir, "nested");
        Store.SaveConfig(nested, new AppConfig());
        Assert.True(File.Exists(Path.Combine(nested, "config.json")));
    }

    [Fact]
    public void DefaultDirectory_IsUnderAppData()
    {
        Assert.Contains("FoxyJumpscare", Store.DefaultDirectory);
    }

    [Fact]
    public void DefaultDirectory_IsAbsolute()
    {
        // A relative config path is not a cosmetic problem. On Unix with no
        // HOME set, GetFolderPath returns "" and Path.Combine produced the
        // bare name "FoxyJumpscare", which resolved against the working
        // directory - normally the app's own folder, where a file of that
        // exact name already exists. CreateDirectory then threw "The file
        // already exists" and the packaged Linux build died on startup.
        Assert.True(Path.IsPathRooted(Store.DefaultDirectory),
            $"config directory must be absolute, got '{Store.DefaultDirectory}'");
        Assert.True(Path.IsPathRooted(Store.ConfigRoot),
            $"config root must be absolute, got '{Store.ConfigRoot}'");
    }
}
