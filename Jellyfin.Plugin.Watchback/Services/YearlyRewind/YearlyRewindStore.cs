using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using Jellyfin.Plugin.Watchback.Services.Common;

namespace Jellyfin.Plugin.Watchback.Services.YearlyRewind;

/// <summary>Keeps one current report per user with atomic annual replacement and no report archive.</summary>
internal sealed class YearlyRewindStore
{
    internal const long MaxSnapshotBytes = 16 * 1024 * 1024;
    private readonly string _reportsPath;
    private readonly Lock _gate = new();

    internal YearlyRewindStore(string dataPath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(dataPath);
        if (!Path.IsPathFullyQualified(dataPath))
        {
            throw new ArgumentException("The data directory must be absolute.", nameof(dataPath));
        }

        _reportsPath = Path.Join(dataPath, "yearly-rewind", "reports");
    }

    internal YearlyRewindSnapshot? Load(Guid userId)
    {
        ValidateUserId(userId);
        lock (_gate)
        {
            return LoadCore(userId);
        }
    }

    internal FileStream? OpenRead(Guid userId)
    {
        ValidateUserId(userId);
        try
        {
            // Publication replaces files atomically. An open response keeps its original
            // bytes while a new annual report can replace the directory entry.
            return new FileStream(GetPath(userId), FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 4096, FileOptions.Asynchronous | FileOptions.SequentialScan);
        }
        catch (FileNotFoundException)
        {
            return null;
        }
        catch (DirectoryNotFoundException)
        {
            return null;
        }
    }

    /// <summary>Publishes a new annual snapshot without replacing the same or a later cycle.</summary>
    /// <param name="snapshot">The completed snapshot to publish.</param>
    /// <returns>True when a later snapshot was published; false for repeated or older triggers.</returns>
    internal bool Publish(YearlyRewindSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        Validate(snapshot, snapshot.UserId);
        lock (_gate)
        {
            var current = LoadCore(snapshot.UserId);
            if (current is not null && current.SnapshotAtUtc >= snapshot.SnapshotAtUtc)
            {
                return false;
            }

            var json = JsonSerializer.Serialize(snapshot, JsonDefaults.Options);
            if (System.Text.Encoding.UTF8.GetByteCount(json) > MaxSnapshotBytes)
            {
                throw new InvalidDataException("The rewind snapshot exceeds the storage limit.");
            }

            AtomicFile.WriteAllText(GetPath(snapshot.UserId), json);
            return true;
        }
    }

    internal Guid[] KnownUsers()
    {
        var directory = _reportsPath;
        if (!Directory.Exists(directory))
        {
            return [];
        }

        return Directory.GetFiles(directory, "*.json")
            .Select(Path.GetFileNameWithoutExtension).Select(name => Guid.TryParseExact(name, "N", out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty).ToArray();
    }

    internal void DeleteUser(Guid userId)
    {
        ValidateUserId(userId);
        lock (_gate)
        {
            File.Delete(GetPath(userId));
        }
    }

    private YearlyRewindSnapshot? LoadCore(Guid userId)
    {
        var path = GetPath(userId);
        if (!File.Exists(path))
        {
            return null;
        }

        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length > MaxSnapshotBytes)
        {
            throw new InvalidDataException("The rewind snapshot exceeds the storage limit.");
        }

        // Corruption must surface to the caller rather than masquerade as an absent report.
        var snapshot = JsonSerializer.Deserialize<YearlyRewindSnapshot>(stream, JsonDefaults.Options)
            ?? throw new InvalidDataException("The rewind snapshot is null.");
        Validate(snapshot, userId);
        return snapshot;
    }

    private static void Validate(YearlyRewindSnapshot snapshot, Guid userId)
    {
        ValidateUserId(userId);
        if (snapshot.SchemaVersion != 1 || snapshot.UserId != userId || snapshot.SnapshotId == Guid.Empty
            || snapshot.PeriodStartUtc >= snapshot.SnapshotAtUtc || snapshot.GeneratedAtUtc < snapshot.SnapshotAtUtc
            || snapshot.PeriodStartUtc.Offset != TimeSpan.Zero || snapshot.SnapshotAtUtc.Offset != TimeSpan.Zero
            || snapshot.GeneratedAtUtc.Offset != TimeSpan.Zero || string.IsNullOrWhiteSpace(snapshot.TimeZoneId)
            || snapshot.DataState is not ("Ready" or "Empty" or "NotCollected" or "Partial")
            || snapshot.Items is null)
        {
            throw new InvalidDataException("The rewind snapshot has an invalid schema, identity or period.");
        }

        foreach (var item in snapshot.Items)
        {
            if (item is null || item.ItemId == Guid.Empty || item.Name is null
                || item.ItemType is not ("Movie" or "Episode" or "Audio") || !double.IsFinite(item.ActiveSeconds)
                || item.ActiveSeconds < 0 || item.PlayCount < 0 || item.Genres is null
                || !double.IsFinite(item.EstimatedSeconds) || item.EstimatedSeconds < 0 || item.EstimatedSeconds > item.ActiveSeconds
                || (item.EstimatedSeconds > 0 && !item.HasReconstructedActivity)
                || item.PlaybackReportingPlayCount < 0 || item.PlaybackReportingPlayCount > item.PlayCount
                || (item.PlaybackReportingPlayCount > 0 && !item.HasReconstructedActivity))
            {
                throw new InvalidDataException("The rewind snapshot contains an invalid item.");
            }
        }

        if (snapshot.Music is { } music)
        {
            if (music.Music is not null || music.Items is null || music.PeriodStartUtc != snapshot.PeriodStartUtc
                || music.SnapshotAtUtc != snapshot.SnapshotAtUtc || music.GeneratedAtUtc != snapshot.GeneratedAtUtc
                || music.TimeZoneId != snapshot.TimeZoneId || music.Items.Any(item => item is null || item.ItemType != "Audio"))
            {
                throw new InvalidDataException("The rewind snapshot contains invalid music data.");
            }

            Validate(music, userId);
        }

        if (snapshot.ActivityStreak is { } streak
            && (streak.Days < 0 || streak.Days > snapshot.ActiveDays + (snapshot.Music?.ActiveDays ?? 0)
                || streak.Days < Math.Max(snapshot.Insights?.LongestStreakDays ?? 0, snapshot.Music?.Insights?.LongestStreakDays ?? 0)
                || (streak.Days == 0 && (streak.Start.HasValue || streak.End.HasValue))
                || (streak.Days > 0 && (!streak.Start.HasValue || !streak.End.HasValue || streak.End.Value.DayNumber - streak.Start.Value.DayNumber + 1 != streak.Days))))
        {
            throw new InvalidDataException("The rewind snapshot contains an invalid combined activity streak.");
        }

        ValidateInsights(snapshot);
    }

    private static void ValidateInsights(YearlyRewindSnapshot snapshot)
    {
        if (snapshot.Insights is { } insights)
        {
            var total = snapshot.Items.Sum(item => item.ActiveSeconds - item.EstimatedSeconds);
            var tolerance = Math.Max(0.001, total * 1e-10);
            if (!double.IsFinite(total) || insights.HourlySeconds is null || insights.HourlySeconds.Count != 24
                || insights.WeekdaySeconds is null || insights.WeekdaySeconds.Count != 7
                || insights.HourlySeconds.Concat(insights.WeekdaySeconds).Any(amount => !double.IsFinite(amount) || amount < 0)
                || Math.Abs(insights.HourlySeconds.Sum() - total) > tolerance
                || Math.Abs(insights.WeekdaySeconds.Sum() - total) > tolerance
                || insights.LongestStreakDays < 0 || insights.LongestStreakDays > snapshot.ActiveDays
                || (insights.LongestStreakDays == 0 && (insights.LongestStreakStart.HasValue || insights.LongestStreakEnd.HasValue))
                || (insights.LongestStreakDays > 0 && (!insights.LongestStreakStart.HasValue || !insights.LongestStreakEnd.HasValue
                    || insights.LongestStreakEnd.Value.DayNumber - insights.LongestStreakStart.Value.DayNumber + 1 != insights.LongestStreakDays)))
            {
                throw new InvalidDataException("The rewind snapshot contains invalid viewing insights.");
            }
        }

        ValidateMonths(snapshot);
        ValidateComparison(snapshot);
    }

    private static void ValidateMonths(YearlyRewindSnapshot snapshot)
    {
        foreach (var month in snapshot.Months ?? [])
        {
            if (month?.Genres is not { } genres)
            {
                continue;
            }

            var genreSeconds = genres.Sum(genre => genre?.ActiveSeconds ?? 0);
            var tolerance = Math.Max(0.001, month.ActiveSeconds * 1e-10);
            if (genres.Any(genre => genre is null || !double.IsFinite(genre.ActiveSeconds) || genre.ActiveSeconds < 0
                || (genre.Name is not null && string.IsNullOrWhiteSpace(genre.Name)))
                || !double.IsFinite(month.ActiveSeconds) || !double.IsFinite(month.EstimatedSeconds) || month.EstimatedSeconds < 0 || month.EstimatedSeconds > month.ActiveSeconds
                || !double.IsFinite(genreSeconds)
                || (snapshot.FullTimePerGenre
                    ? genreSeconds < month.ActiveSeconds - tolerance || genres.Any(genre => genre.ActiveSeconds > month.ActiveSeconds + tolerance)
                    : Math.Abs(genreSeconds - month.ActiveSeconds) > tolerance))
            {
                throw new InvalidDataException("The rewind snapshot contains invalid monthly genres.");
            }
        }
    }

    private static void ValidateComparison(YearlyRewindSnapshot snapshot)
    {
        if (snapshot.Comparison is { } comparison
            && (comparison.PeriodStartUtc >= comparison.SnapshotAtUtc || comparison.SnapshotAtUtc != snapshot.PeriodStartUtc
                || comparison.PeriodStartUtc.Offset != TimeSpan.Zero || comparison.SnapshotAtUtc.Offset != TimeSpan.Zero
                || string.IsNullOrWhiteSpace(comparison.TimeZoneId) || comparison.DataState is not ("Ready" or "Empty" or "Partial")
                || !double.IsFinite(comparison.ActiveSeconds) || comparison.ActiveSeconds < 0
                || !double.IsFinite(comparison.EstimatedSeconds) || comparison.EstimatedSeconds < 0 || comparison.EstimatedSeconds > comparison.ActiveSeconds
                || comparison.ReconstructedItemCount < 0 || (comparison.EstimatedSeconds > 0 && comparison.ReconstructedItemCount == 0)
                || comparison.TrackCount < 0 || comparison.PlayCount < 0
                || comparison.MovieCount < 0 || comparison.EpisodeCount < 0 || comparison.SeriesCount < 0 || comparison.ActiveDays < 0
                || comparison.Genres is null || comparison.Genres.Any(string.IsNullOrWhiteSpace)
                || (comparison.TopGenre is not null && !comparison.Genres.Contains(comparison.TopGenre))))
        {
            throw new InvalidDataException("The rewind snapshot contains an invalid preceding-period comparison.");
        }
    }

    private static void ValidateUserId(Guid userId)
    {
        if (userId == Guid.Empty)
        {
            throw new ArgumentException("A non-empty user ID is required.", nameof(userId));
        }
    }

    private string GetPath(Guid userId) => Path.Join(_reportsPath, userId.ToString("N") + ".json");
}
