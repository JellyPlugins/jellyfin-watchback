using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.Watchback.Configuration;

/// <summary>Persistent Watchback settings. Activity collection is always enabled.</summary>
public class PluginConfiguration : BasePluginConfiguration
{
    private string _start = YearlyRewindSettings.DefaultStartDate;
    private string _end = YearlyRewindSettings.DefaultEndDate;

    /// <summary>Gets or sets a value indicating whether personal rewinds are available.</summary>
    public bool YearlyRewindEnabled { get; set; }

    /// <summary>Gets or sets the annual display start as MM-dd.</summary>
    public string YearlyRewindStartDate
    {
        get => _start;
        set => _start = YearlyRewindSettings.IsValidDate(value) ? value : YearlyRewindSettings.DefaultStartDate;
    }

    /// <summary>Gets or sets the inclusive annual display end as MM-dd.</summary>
    public string YearlyRewindEndDate
    {
        get => _end;
        set => _end = YearlyRewindSettings.IsValidDate(value) ? value : YearlyRewindSettings.DefaultEndDate;
    }

    /// <summary>Gets or sets the legacy administration language, retained for configuration compatibility. The UI uses Jellyfin's active user language.</summary>
    public string Language { get; set; } = "en";

    /// <summary>Gets or sets the diagnostic logging threshold.</summary>
    public string PluginLogLevel { get; set; } = "INFO";
}
