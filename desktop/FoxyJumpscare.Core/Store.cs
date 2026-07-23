using System.Text.Json;

namespace FoxyJumpscare.Core;

public static class Store
{
    private const string ConfigFile = "config.json";
    private const string StateFile = "state.json";

    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    /// <summary>
    /// Where per-user settings live: %APPDATA% on Windows, ~/.config elsewhere.
    ///
    /// Guaranteed to be an ABSOLUTE path. On Unix, GetFolderPath returns an
    /// empty string when neither XDG_CONFIG_HOME nor HOME is set - which
    /// happens under systemd units, some app launchers, and containers.
    /// Path.Combine("", "FoxyJumpscare") then produces a relative path that
    /// resolves against the working directory, and since the app is normally
    /// launched from its own folder, the target collides with the executable
    /// itself: Directory.CreateDirectory throws "The file ... already exists"
    /// and the app dies on startup before it ever draws anything.
    /// </summary>
    public static string ConfigRoot
    {
        get
        {
            var root = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (!string.IsNullOrEmpty(root)) return root;

            // UserProfile reads the passwd entry when HOME is missing, so it
            // can still find a home directory that GetFolderPath gave up on.
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (!string.IsNullOrEmpty(home)) return Path.Combine(home, ".config");

            // Nowhere to call home. Temp is a poor place for settings, but it
            // is absolute and writable, so the app starts and stays usable.
            return Path.GetTempPath();
        }
    }

    public static string DefaultDirectory => Path.Combine(ConfigRoot, "FoxyJumpscare");

    public static AppConfig LoadConfig(string dir) => Load<AppConfig>(dir, ConfigFile);
    public static AppState LoadState(string dir) => Load<AppState>(dir, StateFile);

    public static void SaveConfig(string dir, AppConfig config) => Save(dir, ConfigFile, config);
    public static void SaveState(string dir, AppState state) => Save(dir, StateFile, state);

    /// <summary>
    /// Missing or unreadable files fall back to defaults rather than throwing.
    /// A half-written file after a power cut must not stop the app starting.
    /// </summary>
    private static T Load<T>(string dir, string name) where T : new()
    {
        var path = Path.Combine(dir, name);
        if (!File.Exists(path)) return new T();

        try
        {
            return JsonSerializer.Deserialize<T>(File.ReadAllText(path)) ?? new T();
        }
        catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException)
        {
            return new T();
        }
    }

    private static void Save<T>(string dir, string name, T value)
    {
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, name), JsonSerializer.Serialize(value, Options));
    }
}
