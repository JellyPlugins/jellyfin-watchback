using System;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.Watchback.Services.Activity;

/// <summary>A historical Playback Reporting entry, without invented pause or playback intervals.</summary>
internal sealed record ImportedPlayback
{
    public required string SourceKey { get; init; }

    public required string MetadataKey { get; init; }

    [JsonIgnore]
    public UserPlaybackItem Item { get; set; } = null!;

    public DateTimeOffset StartedAtUtc { get; init; }

    public DateTimeOffset ImportedAtUtc { get; init; }

    public double ActiveSeconds { get; init; }
}
