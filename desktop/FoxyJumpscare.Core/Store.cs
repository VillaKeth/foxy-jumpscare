using System.Text.Json;

namespace FoxyJumpscare.Core;

public static class Store
{
    private const string ConfigFile = "config.json";
    private const string StateFile = "state.json";

    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    public static string DefaultDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "FoxyJumpscare");

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
