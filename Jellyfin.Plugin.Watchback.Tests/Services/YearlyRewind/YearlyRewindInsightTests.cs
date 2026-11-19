using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.Json;
using Jellyfin.Plugin.Watchback.Services;
using Jellyfin.Plugin.Watchback.Services.Activity;
using Jellyfin.Plugin.Watchback.Services.YearlyRewind;
using Xunit;

namespace Jellyfin.Plugin.Watchback.Tests.Services.YearlyRewind;

public sealed class YearlyRewindInsightTests : IDisposable
{
    private readonly Guid _user = Guid.NewGuid();
    private readonly string _directory = Path.Join(Path.GetTempPath(), "jfw-rewind-insights-" + Guid.NewGuid().ToString("N"));
    private readonly UserActivityHistory _history = new();
    private readonly UserPlaybackItem _movie = new() { ItemId = Guid.NewGuid(), Name = "Movie", ItemType = "Movie", Genres = ["Drama", "Adventure"] };

    private static DateTimeOffset Parse(string value) => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture);

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
    }

    private void Watch(DateTimeOffset from, DateTimeOffset to, UserPlaybackItem? item = null)
    {
        var session = new UserPlaybackSession { Item = item ?? _movie, QualifiedAtUtc = to };
        session.Intervals.Add(new UserPlaybackInterval(from, to));
        _history.Sessions.Add(session);
    }

    private YearlyRewindSnapshot Build(TimeZoneInfo? zone = null, YearlyRewindSnapshot? previous = null)
    {
        zone ??= TimeZoneInfo.Utc;
        var start = YearlyRewindWindow.LatestSnapshotAt(new DateTimeOffset(2026, 2, 1, 0, 0, 0, TimeSpan.Zero), "01-01", zone);
        var cutoff = YearlyRewindWindow.NextSnapshotAt(start, "01-01", zone);
        _history.Coverage.Add(new UserActivityCoverage { StartUtc = start, EndUtc = cutoff });
        return YearlyRewindAggregator.Build(_user, _history, start, cutoff, cutoff, zone, previous);
    }

    [Fact]
    public void LocalHoursAndWeekdaysPreserveUnionTimeAcrossMidnightWithQuarterHourOffset()
    {
        var from = Parse("2026-03-02T17:45:00Z");
        Watch(from, from.AddHours(1));
        Watch(from, from.AddHours(1), new UserPlaybackItem { ItemId = Guid.NewGuid(), Name = "Episode", ItemType = "Episode", Genres = ["Drama"] });
        var report = Build(TimeZoneInfo.FindSystemTimeZoneById("Asia/Kathmandu"));
        var insights = report.Insights!;
        Assert.Equal(3600, report.Items.Sum(item => item.ActiveSeconds));
        Assert.Equal(1800, insights.HourlySeconds[23]);
        Assert.Equal(1800, insights.HourlySeconds[0]);
        Assert.Equal(1800, insights.WeekdaySeconds[0]);
        Assert.Equal(1800, insights.WeekdaySeconds[1]);
        Assert.Equal(3600, insights.HourlySeconds.Sum());
        Assert.Equal(3600, insights.WeekdaySeconds.Sum());
        Assert.Equal(2, insights.LongestStreakDays);
        Assert.Equal(new DateOnly(2026, 3, 2), insights.LongestStreakStart);
        Assert.Equal(new DateOnly(2026, 3, 3), insights.LongestStreakEnd);
        var genres = report.Months[2].Genres!;
        Assert.Equal(3600, genres.Single(genre => genre.Name == "Drama").ActiveSeconds);
        Assert.Equal(1800, genres.Single(genre => genre.Name == "Adventure").ActiveSeconds);
        Assert.Equal(5400, genres.Sum(genre => genre.ActiveSeconds));
    }

    [Theory]
    [InlineData("2026-03-29T00:30:00Z", 1, 1800, 3, 1800)]
    [InlineData("2026-10-25T00:30:00Z", 2, 5400, 3, 1800)]
    public void DaylightSavingSkipsAndRepeatsHoursWithoutInventingTime(string instant, int firstHour, int firstSeconds, int lastHour, int lastSeconds)
    {
        var from = Parse(instant);
        Watch(from, from.AddSeconds(firstSeconds + lastSeconds));
        var report = Build(TimeZoneInfo.FindSystemTimeZoneById("Europe/Berlin"));
        Assert.Equal(firstSeconds, report.Insights!.HourlySeconds[firstHour]);
        Assert.Equal(lastSeconds, report.Insights.HourlySeconds[lastHour]);
        Assert.Equal(firstSeconds + lastSeconds, report.Insights.WeekdaySeconds[6]);
        Assert.Equal(1, report.Insights.LongestStreakDays);
    }

    [Fact]
    public void LongestStreakCrossesNewYearAndUsesTheEarliestTie()
    {
        foreach (var from in new[] { "2025-12-30", "2025-12-31", "2026-01-01", "2026-03-01", "2026-03-02", "2026-03-03" }.Select(date => Parse(date + "T12:00:00Z")))
        {
            Watch(from, from.AddMinutes(10));
        }

        var start = Parse("2025-12-15T00:00:00Z");
        var report = YearlyRewindAggregator.Build(_user, _history, start, start.AddYears(1), start.AddYears(1), TimeZoneInfo.Utc);
        Assert.Equal(6, report.ActiveDays);
        Assert.Equal(3, report.Insights!.LongestStreakDays);
        Assert.Equal(new DateOnly(2025, 12, 30), report.Insights.LongestStreakStart);
        Assert.Equal(new DateOnly(2026, 1, 1), report.Insights.LongestStreakEnd);
    }

    [Fact]
    public void UnqualifiedAndFutureQualifiedSessionsDoNotEnterInsights()
    {
        var from = Parse("2026-03-02T10:00:00Z");
        Watch(from, from.AddHours(1));
        _history.Sessions[0].QualifiedAtUtc = null;
        Watch(from, from.AddHours(1));
        _history.Sessions[1].QualifiedAtUtc = Parse("2027-01-02T00:00:00Z");
        var report = Build();
        Assert.All(report.Insights!.HourlySeconds, seconds => Assert.Equal(0, seconds));
        Assert.All(report.Insights.WeekdaySeconds, seconds => Assert.Equal(0, seconds));
        Assert.Equal(0, report.Insights.LongestStreakDays);
        Assert.Null(report.Insights.LongestStreakStart);
    }

    [Fact]
    public void MonthlyGenresNormalizeDuplicatesAndIncludeUnknownMetadata()
    {
        var from = Parse("2026-04-01T10:00:00Z");
        Watch(from, from.AddHours(1), _movie with { Genres = [" Drama ", "Drama", "Adventure"] });
        Watch(from.AddHours(1), from.AddHours(2), _movie with { Genres = ["Changed later"] });
        Watch(from.AddHours(2), from.AddHours(3), _movie with { ItemId = Guid.NewGuid(), Genres = [] });
        var report = Build();
        var genres = report.Months[3].Genres!;
        Assert.Equal(3, genres.Count);
        Assert.All(genres, genre => Assert.Equal(genre.Name is null ? 3600 : 7200, genre.ActiveSeconds));
        Assert.Contains(genres, genre => genre.Name is null);
        Assert.DoesNotContain(genres, genre => genre.Name == "Changed later");
        Assert.Equal(18000, genres.Sum(genre => genre.ActiveSeconds));
        Assert.Equal(10800, report.Months[3].ActiveSeconds);
        Assert.True(report.FullTimePerGenre);
    }

    [Fact]
    public void CombinedStreakJoinsVideoAndMusicDaysWithoutDoubleCountingSharedDays()
    {
        var first = Parse("2026-07-01T12:00:00Z");
        Watch(first, first.AddMinutes(3));
        Watch(first.AddDays(1), first.AddDays(1).AddMinutes(3));
        var track = _movie with { ItemId = Guid.NewGuid(), ItemType = "Audio" };
        for (var day = 1; day <= 3; day++) Watch(first.AddDays(day), first.AddDays(day).AddMinutes(3), track);
        _history.Sessions.Add(new UserPlaybackSession
        {
            Item = track, Intervals = [new UserPlaybackInterval(first.AddDays(4), first.AddDays(4).AddMinutes(1))]
        }); // An unqualified play cannot extend the streak.
        var report = Build();
        Assert.Equal(4, report.ActivityStreak!.Days);
        Assert.Equal(new DateOnly(2026, 7, 1), report.ActivityStreak.Start);
        Assert.Equal(new DateOnly(2026, 7, 4), report.ActivityStreak.End);
        Assert.Equal(2, report.Insights!.LongestStreakDays);
        Assert.Equal(3, report.Music!.Insights!.LongestStreakDays);
        var store = new YearlyRewindStore(_directory);
        Assert.True(store.Publish(report));
        Assert.Equal(report.ActivityStreak, store.Load(_user)!.ActivityStreak);
        Assert.Throws<InvalidDataException>(() => store.Publish(report with { ActivityStreak = report.ActivityStreak with { Days = 2, End = new DateOnly(2026, 7, 2) } }));
        Assert.Throws<InvalidDataException>(() => store.Publish(report with { ActivityStreak = report.ActivityStreak with { Days = 6, End = new DateOnly(2026, 7, 6) } }));
        Assert.Throws<InvalidDataException>(() => store.Publish(report with { ActivityStreak = report.ActivityStreak with { Start = null } }));
        Assert.Throws<InvalidDataException>(() => store.Publish(report with { ActivityStreak = report.ActivityStreak with { End = new DateOnly(2026, 7, 1) } }));
    }

    [Fact]
    public void ReconstructedActivityDoesNotInventCombinedStreakDates()
    {
        var cutoff = Parse("2026-12-15T00:00:00Z");
        var history = new UserActivityHistory();
        history.Record(_movie with { RuntimeTicks = TimeSpan.TicksPerHour },
            new UserItemActivity { Played = true, LastPlayedDate = cutoff.AddDays(-1).UtcDateTime }, cutoff, cutoff);
        var report = YearlyRewindAggregator.Build(_user, history, cutoff.AddYears(-1), cutoff, cutoff, TimeZoneInfo.Utc);
        Assert.Equal(0, report.ActivityStreak!.Days);
        Assert.Null(report.ActivityStreak.Start);
        Assert.Null(report.ActivityStreak.End);
        var store = new YearlyRewindStore(_directory);
        Assert.True(store.Publish(report));
        Assert.Throws<InvalidDataException>(() => store.Publish(report with { ActivityStreak = report.ActivityStreak with { Start = new DateOnly(2026, 12, 14) } }));
    }

    [Fact]
    public void ComparisonCopiesOnlyTheAdjacentReportsFactsAndNeverItsOlderComparison()
    {
        var from = Parse("2026-04-01T10:00:00Z");
        Watch(from, from.AddHours(1));
        var original = Build();
        var previous = original with { PeriodStartUtc = original.PeriodStartUtc.AddYears(-1), SnapshotAtUtc = original.PeriodStartUtc };
        var report = Build(previous: previous);
        var comparison = report.Comparison!;
        Assert.Equal(previous.PeriodStartUtc, comparison.PeriodStartUtc);
        Assert.Equal(previous.SnapshotAtUtc, comparison.SnapshotAtUtc);
        Assert.Equal(3600, comparison.ActiveSeconds);
        Assert.Equal(1, comparison.MovieCount);
        Assert.Equal(1, comparison.ActiveDays);
        Assert.Equal("Adventure", comparison.TopGenre);
        Assert.Equal(["Adventure", "Drama"], comparison.Genres);
        var again = Build(previous: previous with { Comparison = comparison });
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(again, JsonDefaults.Options));
        var summary = json.RootElement.GetProperty("comparison");
        Assert.False(summary.TryGetProperty("items", out _));
        Assert.False(summary.TryGetProperty("comparison", out _));
    }

    [Fact]
    public void MusicComparisonRetainsTrackAndPlayCountsAcrossAnnualReports()
    {
        var from = Parse("2026-04-01T10:00:00Z");
        var track = _movie with { ItemType = "Audio" };
        Watch(from, from.AddMinutes(3), track);
        Watch(from.AddHours(1), from.AddHours(1).AddMinutes(3), track);
        var previous = Build();
        var cutoff = previous.SnapshotAtUtc.AddYears(1);
        var history = new UserActivityHistory();
        history.Record(track, new UserItemActivity { Played = true, PlayCount = 100, LastPlayedDate = cutoff.AddDays(-1).UtcDateTime }, cutoff, cutoff);
        var report = YearlyRewindAggregator.Build(_user, history, previous.SnapshotAtUtc, cutoff, cutoff, TimeZoneInfo.Utc, previous);
        var comparison = report.Music!.Comparison!;
        Assert.Equal(1, comparison.TrackCount);
        Assert.Equal(2, comparison.PlayCount);
        Assert.Equal(360, comparison.ActiveSeconds);
        var store = new YearlyRewindStore(_directory);
        Assert.True(store.Publish(report));
        Assert.Equal(2, store.Load(_user)!.Music!.Comparison!.PlayCount);
        Assert.Throws<InvalidDataException>(() => store.Publish(report with { Music = report.Music with { Comparison = comparison with { TrackCount = -1 } } }));
        Assert.Throws<InvalidDataException>(() => store.Publish(report with { Music = report.Music with { Comparison = comparison with { PlayCount = -1 } } }));
    }

    [Fact]
    public void FirstYearSkippedYearsForeignUsersAndMissingCollectionHaveNoComparison()
    {
        var report = Build();
        Assert.Null(report.Comparison);
        var previous = report with { PeriodStartUtc = report.PeriodStartUtc.AddYears(-1), SnapshotAtUtc = report.PeriodStartUtc };
        Assert.Null(Build(previous: previous with { UserId = Guid.NewGuid() }).Comparison);
        Assert.Null(Build(previous: previous with { SnapshotAtUtc = report.PeriodStartUtc.AddYears(-1) }).Comparison);
        Assert.Null(Build(previous: previous with { DataState = "NotCollected" }).Comparison);
    }

    [Fact]
    public void NewFactsRoundtripAndInvalidTotalsOrStreaksAreRejected()
    {
        var from = Parse("2026-04-01T10:00:00Z");
        Watch(from, from.AddHours(1));
        var report = Build();
        var store = new YearlyRewindStore(_directory);
        Assert.True(store.Publish(report));
        Assert.Equal(3600, store.Load(_user)!.Insights!.HourlySeconds.Sum());
        Assert.Equal(2, store.Load(_user)!.Months[3].Genres!.Count);
        var newer = report with { SnapshotAtUtc = report.SnapshotAtUtc.AddYears(1), GeneratedAtUtc = report.GeneratedAtUtc.AddYears(1) };
        Assert.Throws<InvalidDataException>(() => store.Publish(newer with { Insights = report.Insights! with { HourlySeconds = new Collection<double>(new double[24]) } }));
        Assert.Throws<InvalidDataException>(() => store.Publish(newer with { Insights = report.Insights! with { LongestStreakDays = 2 } }));
        Assert.Equal(report.SnapshotId, store.Load(_user)!.SnapshotId);
    }
    [Theory]
    [InlineData("empty")]
    [InlineData("null")]
    [InlineData("valid")]
    public void MissingSeriesIdentityDoesNotCreateAnExtraSeriesInTheComparison(string identity)
    {
        Guid? id = identity == "valid" ? Guid.NewGuid() : identity == "empty" ? Guid.Empty : null;
        var item = _movie with { ItemType = "Episode", SeriesId = id };
        var key = _history.Remember(item);
        Assert.Equal(id == Guid.Empty ? null : id, _history.Metadata[key].SeriesId);
        Watch(Parse("2026-03-01T12:00:00Z"), Parse("2026-03-01T12:10:00Z"), item);
        var report = Build();
        Assert.Equal(id == Guid.Empty ? null : id, Assert.Single(report.Items).SeriesId);
        var following = YearlyRewindAggregator.Build(_user, new UserActivityHistory(), report.SnapshotAtUtc, report.SnapshotAtUtc.AddYears(1),
            report.SnapshotAtUtc.AddYears(1), TimeZoneInfo.Utc, report);
        Assert.Equal(identity == "valid" ? 1 : 0, following.Comparison!.SeriesCount);
    }

}
