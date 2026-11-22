using System;
using System.Collections.ObjectModel;

namespace Jellyfin.Plugin.Watchback.Services.YearlyRewind;

internal sealed class YearlyRewindMonth
{
    public DateTimeOffset StartUtc { get; init; }

    public DateTimeOffset EndUtc { get; init; }

    public double ActiveSeconds { get; set; }

    public double EstimatedSeconds { get; set; }

    // Recorded duration imported from Playback Reporting; separate from inferred runtime.
    public double PlaybackReportingSeconds { get; set; }

    public Collection<YearlyRewindGenre>? Genres { get; init; }
}
