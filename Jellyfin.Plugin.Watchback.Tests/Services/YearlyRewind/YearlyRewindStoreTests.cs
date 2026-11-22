using System.Text.Json;
using Jellyfin.Plugin.Watchback.Services;
using Jellyfin.Plugin.Watchback.Services.YearlyRewind;
using Xunit;

namespace Jellyfin.Plugin.Watchback.Tests.Services.YearlyRewind;

public sealed class YearlyRewindStoreTests : IDisposable
{
    private readonly string _directory = Path.Join(Path.GetTempPath(), "jfw-yearly-rewind-" + Guid.NewGuid().ToString("N"));
    private readonly Guid _userId = Guid.NewGuid();

    private YearlyRewindSnapshot Snapshot(int year) => new()
    {
        UserId = _userId,
        PeriodStartUtc = new DateTimeOffset(year - 1, 12, 15, 0, 0, 0, TimeSpan.Zero),
        SnapshotAtUtc = new DateTimeOffset(year, 12, 15, 0, 0, 0, TimeSpan.Zero),
        GeneratedAtUtc = new DateTimeOffset(year, 12, 15, 0, 0, 1, TimeSpan.Zero),
        TimeZoneId = "UTC",
        DataState = "Partial",
        Items = [new YearlyRewindItem { ItemId = Guid.NewGuid(), ItemType = "Movie", Name = "映画", ActiveSeconds = 123, PlayCount = 1 }]
    };

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }

    [Fact]
    public void Publish_AnnualReplacementKeepsExactlyOneReportWithoutArchive()
    {
        var store = new YearlyRewindStore(_directory);
        Assert.True(store.Publish(Snapshot(2026)));
        var next = Snapshot(2027);
        Assert.True(store.Publish(next));
        var restored = new YearlyRewindStore(_directory).Load(_userId)!;
        Assert.Equal(next.SnapshotId, restored.SnapshotId);
        Assert.Equal("映画", Assert.Single(restored.Items).Name);
        Assert.Equal(123, Assert.Single(restored.Items).ActiveSeconds);
        Assert.Single(Directory.GetFiles(_directory, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public void OpenRead_MissingReportDoesNotCreateFilesOrUseAnotherUsersReport()
    {
        var store = new YearlyRewindStore(_directory);
        Assert.Null(store.OpenRead(_userId));
        Assert.False(Directory.Exists(_directory));
        store.Publish(Snapshot(2026));
        Assert.Null(store.OpenRead(Guid.NewGuid()));
        using var stream = store.OpenRead(_userId);
        Assert.NotNull(stream);
    }

    [Fact]
    public void OpenRead_AnnualReplacementKeepsAnOpenResponseOnItsOriginalSnapshot()
    {
        var store = new YearlyRewindStore(_directory);
        var original = Snapshot(2026);
        store.Publish(original);
        using var first = store.OpenRead(_userId);
        var next = Snapshot(2027);
        Assert.True(store.Publish(next));
        using var second = store.OpenRead(_userId);
        Assert.Equal(original.SnapshotId, JsonSerializer.Deserialize<YearlyRewindSnapshot>(first!, JsonDefaults.Options)!.SnapshotId);
        Assert.Equal(next.SnapshotId, JsonSerializer.Deserialize<YearlyRewindSnapshot>(second!, JsonDefaults.Options)!.SnapshotId);
    }

    [Fact]
    public void Publish_RepeatedAndDelayedOlderTriggersCannotMutateCurrentReport()
    {
        var store = new YearlyRewindStore(_directory);
        var current = Snapshot(2027);
        store.Publish(current);
        Assert.False(store.Publish(Snapshot(2027)));
        Assert.False(store.Publish(Snapshot(2026)));
        Assert.Equal(current.SnapshotId, store.Load(_userId)!.SnapshotId);
    }

    [Fact]
    public void Load_IsolatesUsersAndKeepsReportAfterDisplaySeason()
    {
        var store = new YearlyRewindStore(_directory);
        var original = Snapshot(2026);
        store.Publish(original);
        Assert.Null(store.Load(Guid.NewGuid()));
        // Loading has no clock or display-window dependency, including after a restart.
        Assert.Equal(original.SnapshotId, new YearlyRewindStore(_directory).Load(_userId)!.SnapshotId);
    }

    [Fact]
    public void Load_CorruptionDoesNotAllowPublicationOverExistingReport()
    {
        var store = new YearlyRewindStore(_directory);
        store.Publish(Snapshot(2026));
        var path = Assert.Single(Directory.GetFiles(_directory, "*.json", SearchOption.AllDirectories));
        File.WriteAllText(path, "{broken");
        Assert.Throws<JsonException>(() => store.Load(_userId));
        Assert.Throws<JsonException>(() => store.Publish(Snapshot(2027)));
        Assert.Equal("{broken", File.ReadAllText(path));
    }

    [Fact]
    public void Publish_InvalidReplacementPreservesPreviousSnapshot()
    {
        var store = new YearlyRewindStore(_directory);
        var original = Snapshot(2026);
        store.Publish(original);
        var invalid = Snapshot(2027) with { PeriodStartUtc = DateTimeOffset.MaxValue };
        Assert.Throws<InvalidDataException>(() => store.Publish(invalid));
        Assert.Equal(original.SnapshotId, store.Load(_userId)!.SnapshotId);
    }

    [Fact]
    public void DeleteUser_DoesNotDeleteOtherUsers()
    {
        var store = new YearlyRewindStore(_directory);
        store.Publish(Snapshot(2026));
        var other = Snapshot(2026) with { UserId = Guid.NewGuid() };
        store.Publish(other);
        store.DeleteUser(_userId);
        Assert.Null(store.Load(_userId));
        Assert.NotNull(store.Load(other.UserId));
    }

    [Fact]
    public void InvalidIdentityAndRelativePathsAreRejected()
    {
        Assert.Throws<ArgumentException>(() => new YearlyRewindStore("relative"));
        var store = new YearlyRewindStore(_directory);
        Assert.Throws<ArgumentException>(() => store.Load(Guid.Empty));
        Assert.Throws<ArgumentException>(() => store.Publish(Snapshot(2026) with { UserId = Guid.Empty }));
    }

    [Fact]
    public async Task ConcurrentTriggersThroughSameStorePublishOnce()
    {
        var store = new YearlyRewindStore(_directory);
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(() => store.Publish(Snapshot(2026)))));
        Assert.Single(results, published => published);
        Assert.Single(Directory.GetFiles(_directory, "*", SearchOption.AllDirectories));
    }
    [Fact]
    public void PendingRejectsOversizedUtf8BeforeWritingAndRetainsExistingPendingAndPublishedReports()
    {
        var store = new YearlyRewindStore(_directory);
        var pending = new YearlyRewindPendingStore(_directory);
        var current = Snapshot(2026);
        var next = Snapshot(2027);
        store.Publish(current);
        pending.Seal(next);
        var oversized = Snapshot(2028);
        oversized.Items[0] = oversized.Items[0] with { Name = new string('界', (int)(YearlyRewindStore.MaxSnapshotBytes / 3) + 1) };
        Assert.Throws<InvalidDataException>(() => pending.Seal(oversized));
        Assert.Equal(next.SnapshotId, pending.LoadPending(_userId)!.SnapshotId);
        Assert.Equal(current.SnapshotId, store.Load(_userId)!.SnapshotId);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void FullAndLegacyGenreTimesRoundTripWithoutRewritingFrozenReports(bool fullTime)
    {
        var snapshot = Snapshot(2026) with
        {
            FullTimePerGenre = fullTime,
            Months = [new YearlyRewindMonth { ActiveSeconds = 3600, Genres = [
                new YearlyRewindGenre { Name = "Drama", ActiveSeconds = fullTime ? 3600 : 1800 },
                new YearlyRewindGenre { Name = "Adventure", ActiveSeconds = fullTime ? 3600 : 1800 }] }]
        };
        var store = new YearlyRewindStore(_directory);
        Assert.True(store.Publish(snapshot));
        Assert.Equal(fullTime, store.Load(_userId)!.FullTimePerGenre);
        snapshot.Months[0].Genres![0] = new YearlyRewindGenre { Name = "Drama", ActiveSeconds = 7200 };
        Assert.Throws<InvalidDataException>(() => store.Publish(snapshot));
        snapshot.Months[0].Genres![0] = new YearlyRewindGenre { Name = "Drama", ActiveSeconds = 0 };
        snapshot.Months[0].Genres![1] = new YearlyRewindGenre { Name = "Adventure", ActiveSeconds = 0 };
        Assert.Throws<InvalidDataException>(() => store.Publish(snapshot));
        Assert.Equal(fullTime ? 3600 : 1800, store.Load(_userId)!.Months[0].Genres![0].ActiveSeconds);
    }

    [Theory]
    [InlineData("negative")]
    [InlineData("too-long")]
    [InlineData("zero-start")]
    [InlineData("zero-end")]
    [InlineData("missing-start")]
    [InlineData("missing-end")]
    [InlineData("wrong-span")]
    public void InvalidCombinedStreakCannotReplaceAPublishedReport(string corruption)
    {
        var store = new YearlyRewindStore(_directory);
        var current = Snapshot(2026);
        Assert.True(store.Publish(current));
        var first = new DateOnly(2026, 7, 1);
        var streak = new YearlyRewindStreak { Days = 3, Start = first, End = first.AddDays(2) };
        streak = corruption switch
        {
            "negative" => streak with { Days = -1, Start = null, End = null },
            "too-long" => streak with { Days = 4, End = first.AddDays(3) },
            "zero-start" => streak with { Days = 0, End = null },
            "zero-end" => streak with { Days = 0, Start = null },
            "missing-start" => streak with { Start = null },
            "missing-end" => streak with { End = null },
            "wrong-span" => streak with { End = first },
            _ => throw new ArgumentOutOfRangeException(nameof(corruption))
        };
        var next = Snapshot(2027) with { ActiveDays = 3, ActivityStreak = streak };
        Assert.Throws<InvalidDataException>(() => store.Publish(next));
        Assert.Equal(current.SnapshotId, store.Load(_userId)!.SnapshotId);
    }

    [Fact]
    public void CombinedStreakRoundTripsWhenOptionalMusicInsightsAreUnavailable()
    {
        var store = new YearlyRewindStore(_directory);
        var snapshot = Snapshot(2026) with
        {
            ActiveDays = 1,
            ActivityStreak = new YearlyRewindStreak { Days = 1, Start = new DateOnly(2026, 7, 1), End = new DateOnly(2026, 7, 1) },
            Music = Snapshot(2026) with { ActiveDays = 1, Items = [new YearlyRewindItem { ItemId = Guid.NewGuid(), ItemType = "Audio", Name = "Track", ActiveSeconds = 123, PlayCount = 1 }] }
        };
        Assert.True(store.Publish(snapshot));
        var loaded = store.Load(_userId)!;
        Assert.Equal(snapshot.ActivityStreak, loaded.ActivityStreak);
        Assert.Null(loaded.Insights);
        Assert.Null(loaded.Music!.Insights);
        Assert.Equal(1, loaded.Music.ActiveDays);
        Assert.Equal("Audio", Assert.Single(loaded.Music.Items).ItemType);
    }

    [Fact]
    public void NullMonthlyGenreIsRejectedWithoutOverwritingThePublishedReport()
    {
        var store = new YearlyRewindStore(_directory);
        var current = Snapshot(2026);
        Assert.True(store.Publish(current));
        var invalid = Snapshot(2027) with
        {
            FullTimePerGenre = true,
            Months = [new YearlyRewindMonth { ActiveSeconds = 3600, Genres = [null!, new YearlyRewindGenre { Name = "Drama", ActiveSeconds = 3600 }] }]
        };
        Assert.Throws<InvalidDataException>(() => store.Publish(invalid));
        Assert.Equal(current.SnapshotId, store.Load(_userId)!.SnapshotId);
        Assert.Single(Directory.GetFiles(_directory, "*.json", SearchOption.AllDirectories));
    }

    [Theory]
    [InlineData("nested")]
    [InlineData("missing-items")]
    [InlineData("period-start")]
    [InlineData("cutoff")]
    [InlineData("generation")]
    [InlineData("zone")]
    [InlineData("video-item")]
    [InlineData("null-item")]
    public void InvalidMusicCannotReplaceAnExistingReport(string corruption)
    {
        var store = new YearlyRewindStore(_directory);
        var current = Snapshot(2026);
        Assert.True(store.Publish(current));
        var next = Snapshot(2027);
        var music = next with { Items = [next.Items[0] with { ItemType = "Audio" }] };
        music = corruption switch
        {
            "nested" => music with { Music = music },
            "missing-items" => music with { Items = null! },
            "period-start" => music with { PeriodStartUtc = music.PeriodStartUtc.AddDays(1) },
            "cutoff" => music with { SnapshotAtUtc = music.SnapshotAtUtc.AddSeconds(-1) },
            "generation" => music with { GeneratedAtUtc = music.GeneratedAtUtc.AddSeconds(1) },
            "zone" => music with { TimeZoneId = "Europe/Berlin" },
            "video-item" => music with { Items = next.Items },
            "null-item" => music with { Items = [null!] },
            _ => throw new ArgumentOutOfRangeException(nameof(corruption))
        };
        Assert.Throws<InvalidDataException>(() => store.Publish(next with { Music = music }));
        Assert.Equal(current.SnapshotId, store.Load(_userId)!.SnapshotId);
        Assert.Single(Directory.GetFiles(_directory, "*.json", SearchOption.AllDirectories));
    }

    [Fact]
    public void ExistingOversizedPendingIsQuarantinedWithoutBlockingAReplacement()
    {
        var store = new YearlyRewindStore(_directory);
        var pending = new YearlyRewindPendingStore(_directory);
        var current = Snapshot(2026);
        store.Publish(current);
        var directory = Path.Join(_directory, "yearly-rewind", "pending");
        Directory.CreateDirectory(directory);
        var path = Path.Join(directory, _userId.ToString("N") + ".json");
        using (var stream = File.Create(path)) stream.SetLength(YearlyRewindStore.MaxSnapshotBytes + 1);
        Assert.Null(pending.LoadPending(_userId));
        Assert.False(File.Exists(path));
        Assert.Single(Directory.GetFiles(directory, "*.oversized-*"));
        Assert.Equal(current.SnapshotId, store.Load(_userId)!.SnapshotId);
        var next = Snapshot(2027);
        pending.Seal(next);
        Assert.True(store.Publish(pending.LoadPending(_userId)!));
        pending.Complete(_userId);
        Assert.Equal(next.SnapshotId, store.Load(_userId)!.SnapshotId);
    }

}
