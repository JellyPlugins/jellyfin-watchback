namespace Jellyfin.Plugin.Watchback.Api;

/// <summary>Partial settings update supplied by an administrator.</summary>
public sealed class ConfigurationUpdateRequest
{
    /// <summary>Gets the requested display switch.</summary>
    public bool? YearlyRewindEnabled { get; init; }

    /// <summary>Gets the annual start date.</summary>
    public string? YearlyRewindStartDate { get; init; }

    /// <summary>Gets the annual end date.</summary>
    public string? YearlyRewindEndDate { get; init; }

    /// <summary>Gets the administration language.</summary>
    public string? Language { get; init; }
}
