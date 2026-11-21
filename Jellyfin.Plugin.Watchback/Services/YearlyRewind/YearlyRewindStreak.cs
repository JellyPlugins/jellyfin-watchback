using System;

namespace Jellyfin.Plugin.Watchback.Services.YearlyRewind;

/// <summary>The earliest longest run of measured active calendar days across all media.</summary>
internal sealed record YearlyRewindStreak
{
    public int Days { get; init; }

    public DateOnly? Start { get; init; }

    public DateOnly? End { get; init; }
}
