using System;
using System.Collections.ObjectModel;

namespace Jellyfin.Plugin.Watchback.Services.YearlyRewind;

/// <summary>Only the preceding report's comparison facts, without its items or older comparisons.</summary>
internal sealed record YearlyRewindComparison
{
    public required DateTimeOffset PeriodStartUtc { get; init; }

    public required DateTimeOffset SnapshotAtUtc { get; init; }

    public required string TimeZoneId { get; init; }

    public required string DataState { get; init; }

    public double ActiveSeconds { get; init; }

    public double EstimatedSeconds { get; init; }

    // Recorded duration imported from Playback Reporting; separate from inferred runtime.
    public double PlaybackReportingSeconds { get; init; }

    public int ReconstructedItemCount { get; init; }

    public int MovieCount { get; init; }

    public int EpisodeCount { get; init; }

    public int SeriesCount { get; init; }

    // Older frozen comparisons did not retain music counts; missing values are unknown.
    public int? TrackCount { get; init; }

    public int? PlayCount { get; init; }

    public int ActiveDays { get; init; }

    public Collection<string> Genres { get; init; } = [];

    public string? TopGenre { get; init; }
}
