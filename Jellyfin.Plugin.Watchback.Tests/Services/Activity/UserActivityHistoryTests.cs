using System.Text.Json;
using System.Xml.Serialization;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Watchback.Configuration;
using Jellyfin.Plugin.Watchback.Services;
using Jellyfin.Plugin.Watchback.Services.Activity;
using Jellyfin.Plugin.Watchback.Services.ConfigAccess;
using Jellyfin.Plugin.Watchback.Services.YearlyRewind;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace Jellyfin.Plugin.Watchback.Tests.Services.Activity;

public sealed class UserActivityHistoryTests : IDisposable
{
    private readonly string _directory = Path.Join(Path.GetTempPath(), "jfw-shared-history-" + Guid.NewGuid().ToString("N"));
    private readonly Guid _userId = Guid.NewGuid();
    private readonly DateTimeOffset _cutoff = new(2026, 12, 15, 0, 0, 0, TimeSpan.Zero);
    private readonly DateTimeOffset _localCutoff = new(TimeZoneInfo.ConvertTimeToUtc(new DateTime(2026, 12, 15), TimeZoneInfo.Local));
    private readonly UserPlaybackItem _movie = new() { ItemId = Guid.NewGuid(), Name = "Movie", ItemType = "Movie", RuntimeTicks = TimeSpan.TicksPerHour, Genres = [" Drama ", "Drama"] };

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, true);
    }

    private UserItemActivity State(DateTimeOffset? played, int count = 40, bool completed = true, long position = 0) => new()
    {
        UserId = _userId, LastPlayedDate = played?.UtcDateTime, PlayCount = count, Played = completed, PlaybackPositionTicks = position
    };

    private YearlyRewindSnapshot Build(UserActivityHistory history) => YearlyRewindAggregator.Build(
        _userId, history, _cutoff.AddYears(-1), _cutoff, _cutoff, TimeZoneInfo.Utc);

    [Fact]
    public void ObservationsAreIdempotentVersionMetadataAndRetainCounterResetsWithoutInventingDeltas()
    {
        var history = new UserActivityHistory();
        var played = _cutoff.AddDays(-10);
        Assert.True(history.Record(_movie, State(played), _cutoff, _cutoff));
        Assert.False(history.Record(_movie, State(played), _cutoff.AddMinutes(1), _cutoff));
        Assert.Null(history.Observations[0].PlayCountDelta);
        Assert.Single(history.Metadata);
        Assert.Equal("Drama", Assert.Single(history.Metadata.Values.Single().Genres));
        Assert.True(history.Record(_movie, State(played.AddDays(1), 42), _cutoff.AddMinutes(2), _cutoff.AddMinutes(2)));
        Assert.Equal(2, history.Observations[1].PlayCountDelta);
        Assert.True(history.Record(_movie, State(played.AddDays(2), 1), _cutoff.AddMinutes(3), _cutoff.AddMinutes(3)));
        Assert.Null(history.Observations[2].PlayCountDelta);
        Assert.False(history.Record(_movie, State(played), _cutoff.AddMinutes(4), _cutoff));
        Assert.True(history.Record(_movie with { Name = "Renamed" }, State(played.AddDays(2), 1), _cutoff.AddMinutes(5), _cutoff.AddMinutes(5)));
        Assert.Equal(2, history.Metadata.Count);
        var store = new UserActivityHistoryStore(Path.Join(_directory, "jellyfin-watchback"));
        store.Save(_userId, history);
        var saved = store.Load(_userId);
        Assert.Equal(4, saved.Observations.Count);
        Assert.Equal("Movie", saved.Observations[0].Item.Name);
        Assert.Equal("Renamed", saved.Observations[3].Item.Name);
        using var json = JsonDocument.Parse(File.ReadAllText(Path.Join(_directory, "jellyfin-watchback", "activity-history", _userId.ToString("N") + ".json")));
        Assert.False(json.RootElement.GetProperty("observations")[0].TryGetProperty("item", out _));
    }

    [Fact]
    public void MigrationPreservesMeasuredFactsAndNeverReadsTheOldFileAgain()
    {
        var legacy = Path.Join(_directory, "jellyfin-watchback", "yearly-rewind", "history", _userId.ToString("N") + ".json");
        Directory.CreateDirectory(Path.GetDirectoryName(legacy)!);
        var id = Guid.NewGuid();
        var span = new UserPlaybackInterval(_cutoff.AddMinutes(-2), _cutoff.AddMinutes(-1));
        File.WriteAllText(legacy, JsonSerializer.Serialize(new
        {
            SchemaVersion = 1,
            Coverage = new[] { new UserActivityCoverage { StartUtc = span.StartUtc, EndUtc = span.EndUtc } },
            Sessions = new[] { new { Id = id, Item = _movie, ThresholdSeconds = 1, QualifiedAtUtc = span.EndUtc, Intervals = new[] { span } } }
        }, JsonDefaults.Options));
        var store = new UserActivityHistoryStore(Path.Join(_directory, "jellyfin-watchback"));
        var migrated = store.Load(_userId);
        Assert.Equal(id, Assert.Single(migrated.Sessions).Id);
        Assert.Equal(_movie.ItemId, migrated.Sessions[0].Item.ItemId);
        Assert.Equal(span.StartUtc, Assert.Single(migrated.Coverage).StartUtc);
        Assert.Equal(60, Build(migrated).Items.Single().ActiveSeconds);
        File.WriteAllText(legacy, "broken rollback source");
        Assert.Equal(id, Assert.Single(store.Load(_userId).Sessions).Id);
        store.DeleteUser(_userId);
        store.DeleteUser(_userId);
        Assert.Empty(store.KnownUsers());
    }

    [Fact]
    public void BaselineUsesOneConservativePlayNotTheLifetimeCountAndDoesNotInventPatterns()
    {
        var history = new UserActivityHistory();
        history.Record(_movie, State(_cutoff.AddMonths(-2), 500), _cutoff.AddDays(-1), _cutoff.AddDays(-1));
        history.Record(_movie, State(_cutoff.AddMonths(-1), 501), _cutoff, _cutoff);
        var report = Build(history);
        var item = Assert.Single(report.Items);
        Assert.Equal(1, item.PlayCount);
        Assert.Equal(3600, item.ActiveSeconds);
        Assert.Equal(3600, item.EstimatedSeconds);
        Assert.True(item.HasReconstructedActivity);
        Assert.Equal(1, report.ReconstructedItemCount);
        Assert.Equal("Partial", report.DataState);
        Assert.Equal(0, report.ActiveDays);
        Assert.Equal(0, report.Insights!.LongestStreakDays);
        Assert.Equal(0, report.Insights.HourlySeconds.Sum());
        Assert.Equal(0, report.Insights.WeekdaySeconds.Sum());
        Assert.Equal(3600, report.Months.Sum(month => month.ActiveSeconds));
        Assert.Equal(3600, report.Months.Sum(month => month.EstimatedSeconds));
        Assert.Equal(3600, report.Months.SelectMany(month => month.Genres!).Sum(genre => genre.ActiveSeconds));
        var store = new YearlyRewindStore(Path.Join(_directory, "jellyfin-watchback"));
        store.Publish(report);
        Assert.Equal(1, store.Load(_userId)!.ReconstructedItemCount);
    }

    [Fact]
    public void MeasuredCoveragePreventsCountingTheSamePlaybackTwice()
    {
        var history = new UserActivityHistory();
        var played = _cutoff.AddMinutes(-30);
        history.Record(_movie, State(played), _cutoff, _cutoff);
        history.Coverage.Add(new UserActivityCoverage { StartUtc = played.AddHours(-1), EndUtc = _cutoff });
        history.Sessions.Add(new UserPlaybackSession
        {
            Item = _movie, QualifiedAtUtc = played.AddMinutes(1),
            Intervals = [new UserPlaybackInterval(played, played.AddMinutes(1))]
        });
        var report = Build(history);
        Assert.Equal(60, Assert.Single(report.Items).ActiveSeconds);
        Assert.False(report.Items[0].HasReconstructedActivity);
        Assert.Equal(60, report.Insights!.HourlySeconds.Sum());
    }

    [Fact]
    public void PartialPlaybackUsesKnownPositionAndUnknownDurationRemainsUnknown()
    {
        var history = new UserActivityHistory();
        history.Record(_movie, State(_cutoff.AddDays(-1), 1, false, TimeSpan.TicksPerMinute * 12), _cutoff, _cutoff);
        history.Record(_movie with { ItemId = Guid.NewGuid(), RuntimeTicks = 0 }, State(_cutoff.AddDays(-1)), _cutoff, _cutoff);
        history.Record(_movie with { ItemId = Guid.NewGuid() }, State(null), _cutoff, _cutoff);
        history.Record(_movie with { ItemId = Guid.NewGuid() }, State(_cutoff.AddDays(1)), _cutoff, _cutoff);
        history.Record(_movie with { ItemId = Guid.NewGuid() }, State(_cutoff.AddYears(-2)), _cutoff, _cutoff);
        var report = Build(history);
        Assert.Equal(2, report.Items.Count);
        Assert.Equal(720, report.Items.Sum(item => item.ActiveSeconds));
        Assert.Equal(2, report.ReconstructedItemCount);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void SharedJournalAlwaysRecordsIndependentlyOfYearlyRewindAndIgnoresLegacyDisableFlag(bool rewind)
    {
        var serializer = new XmlSerializer(typeof(PluginConfiguration));
        using var reader = new StringReader("<PluginConfiguration><ActivityHistoryEnabled>false</ActivityHistoryEnabled></PluginConfiguration>");
        var config = (PluginConfiguration)serializer.Deserialize(reader)!;
        config.YearlyRewindEnabled = rewind;
        var configuration = new Mock<IPluginConfigurationService>();
        configuration.SetupGet(value => value.IsInitialized).Returns(true);
        configuration.Setup(value => value.GetConfiguration()).Returns(config);
        var paths = new Mock<IApplicationPaths>();
        paths.SetupGet(value => value.DataPath).Returns(_directory);
        var user = new User("test", "default", "default") { Id = _userId };
        var users = new Mock<IUserManager>();
        users.Setup(value => value.GetUsers()).Returns([user]);
        users.Setup(value => value.GetUserById(_userId)).Returns(user);
        var source = new Mock<IUserActivityInsightsService>();
        var snapshot = new UserActivityResult { GeneratedAt = _localCutoff.UtcDateTime };
        snapshot.Items.Add(new UserActivitySummary
        {
            ItemId = _movie.ItemId, ItemName = "Movie", ItemType = "Movie", RuntimeTicks = _movie.RuntimeTicks,
            UserActivities = [State(_localCutoff.AddDays(-10))]
        });
        source.Setup(value => value.BuildActivityReport()).Returns(snapshot);
        var cache = new Mock<IUserActivityCacheService>();
        cache.Setup(value => value.LoadResult()).Returns(snapshot);
        var consumer = new YearlyRewindService(configuration.Object, paths.Object, NullLogger<YearlyRewindService>.Instance);
        using var service = new UserActivityHistoryService(configuration.Object, Mock.Of<ISessionManager>(), users.Object, Mock.Of<ILibraryManager>(),
            new VirtualItemDetector(paths.Object, NullLogger<VirtualItemDetector>.Instance), source.Object, cache.Object,
            paths.Object, new FixedClock(_localCutoff), [consumer], NullLogger<UserActivityHistoryService>.Instance);
        service.Tick(_localCutoff);
        var journal = Path.Join(_directory, "jellyfin-watchback", "activity-history", _userId.ToString("N") + ".json");
        Assert.True(File.Exists(journal));
        if (!rewind)
        {
            Assert.Single(new UserActivityHistoryStore(Path.Join(_directory, "jellyfin-watchback")).Load(_userId).Observations);
            Assert.Null(consumer.Load(_userId));
            config.YearlyRewindEnabled = true;
            service.Tick(_localCutoff.AddMinutes(1));
        }
        var report = consumer.Load(_userId)!;
        Assert.NotNull(report);
        Assert.Equal(1, report.ReconstructedItemCount);
        snapshot.Items.Clear();
        service.Record(snapshot);
        service.Tick(_localCutoff.AddHours(2));
        Assert.Equal(report.SnapshotId, consumer.Load(_userId)!.SnapshotId);
        Assert.True(File.Exists(journal));
        cache.Verify(value => value.SaveResult(It.IsAny<UserActivityResult>()), Times.AtLeastOnce);
    }

    [Fact]
    public void FailedCacheImportDoesNotPreventJellyfinRefreshAndSourceFailuresRetry()
    {
        var config = new PluginConfiguration { YearlyRewindEnabled = false };
        var configuration = new Mock<IPluginConfigurationService>();
        configuration.SetupGet(value => value.IsInitialized).Returns(true);
        configuration.Setup(value => value.GetConfiguration()).Returns(config);
        var paths = new Mock<IApplicationPaths>();
        paths.SetupGet(value => value.DataPath).Returns(_directory);
        var user = new User("test", "default", "default") { Id = _userId };
        var users = new Mock<IUserManager>();
        users.Setup(value => value.GetUsers()).Returns([user]);
        users.Setup(value => value.GetUserById(_userId)).Returns(user);
        var snapshot = new UserActivityResult { GeneratedAt = _cutoff.UtcDateTime };
        snapshot.Items.Add(new UserActivitySummary { ItemId = _movie.ItemId, ItemName = "Movie", ItemType = "Movie", UserActivities = [State(_cutoff.AddDays(-1))] });
        var source = new Mock<IUserActivityInsightsService>();
        source.SetupSequence(value => value.BuildActivityReport()).Throws(new IOException("temporarily unavailable")).Returns(snapshot);
        var cache = new Mock<IUserActivityCacheService>();
        cache.Setup(value => value.LoadResult()).Throws(new IOException("bad cache"));
        using var service = new UserActivityHistoryService(configuration.Object, Mock.Of<ISessionManager>(), users.Object, Mock.Of<ILibraryManager>(),
            new VirtualItemDetector(paths.Object, NullLogger<VirtualItemDetector>.Instance), source.Object, cache.Object,
            paths.Object, new FixedClock(_cutoff), [], NullLogger<UserActivityHistoryService>.Instance);
        service.Tick(_cutoff);
        service.Tick(_cutoff.AddSeconds(30));
        source.Verify(value => value.BuildActivityReport(), Times.Once);
        service.Tick(_cutoff.AddMinutes(1));
        source.Verify(value => value.BuildActivityReport(), Times.Exactly(2));
        var store = new UserActivityHistoryStore(Path.Join(_directory, "jellyfin-watchback"));
        Assert.Single(store.Load(_userId).Observations);
        config.YearlyRewindEnabled = false;
        snapshot.Items[0].UserActivities[0].PlayCount++;
        service.Record(snapshot);
        Assert.Equal(2, store.Load(_userId).Observations.Count);
    }

    [Theory]
    [InlineData("json")]
    [InlineData("schema")]
    [InlineData("legacy")]
    public void UnreadableUserHistoryIsPreservedWhileHealthyUsersContinueAndRecoveryRetries(string corruption)
    {
        var configuration = new Mock<IPluginConfigurationService>();
        var config = new PluginConfiguration { YearlyRewindEnabled = true };
        configuration.SetupGet(value => value.IsInitialized).Returns(true);
        configuration.Setup(value => value.GetConfiguration()).Returns(config);
        var paths = new Mock<IApplicationPaths>();
        paths.SetupGet(value => value.DataPath).Returns(_directory);
        var healthy = new User("healthy", "default", "default") { Id = _userId };
        var broken = new User("broken", "default", "default") { Id = Guid.NewGuid() };
        var users = new Mock<IUserManager>();
        users.Setup(value => value.GetUsers()).Returns([broken, healthy]);
        users.Setup(value => value.GetUserById(healthy.Id)).Returns(healthy);
        users.Setup(value => value.GetUserById(broken.Id)).Returns(broken);
        var brokenPath = corruption == "legacy"
            ? Path.Join(_directory, "jellyfin-watchback", "yearly-rewind", "history", broken.Id.ToString("N") + ".json")
            : Path.Join(_directory, "jellyfin-watchback", "activity-history", broken.Id.ToString("N") + ".json");
        Directory.CreateDirectory(Path.GetDirectoryName(brokenPath)!);
        var invalid = corruption == "schema" ? "{\"schemaVersion\":999}" : "not JSON";
        File.WriteAllText(brokenPath, invalid);
        var brokenState = State(_localCutoff.AddDays(-10));
        brokenState.UserId = broken.Id;
        var snapshot = new UserActivityResult
        {
            GeneratedAt = _localCutoff.UtcDateTime,
            Items = [new UserActivitySummary
            {
                ItemId = _movie.ItemId, ItemName = "Movie", ItemType = "Movie", RuntimeTicks = _movie.RuntimeTicks,
                UserActivities = [brokenState, State(_localCutoff.AddDays(-10))]
            }]
        };
        var source = new Mock<IUserActivityInsightsService>();
        source.Setup(value => value.BuildActivityReport()).Returns(snapshot);
        var consumer = new YearlyRewindService(configuration.Object, paths.Object, NullLogger<YearlyRewindService>.Instance);
        using var service = new UserActivityHistoryService(configuration.Object, Mock.Of<ISessionManager>(), users.Object, Mock.Of<ILibraryManager>(),
            new VirtualItemDetector(paths.Object, NullLogger<VirtualItemDetector>.Instance), source.Object, Mock.Of<IUserActivityCacheService>(),
            paths.Object, new FixedClock(_localCutoff), [consumer], NullLogger<UserActivityHistoryService>.Instance);
        service.Tick(_localCutoff);
        var store = new UserActivityHistoryStore(Path.Join(_directory, "jellyfin-watchback"));
        Assert.Single(store.Load(healthy.Id).Observations);
        var published = consumer.Load(healthy.Id)!;
        Assert.NotNull(published);
        Assert.Null(consumer.Load(broken.Id));
        Assert.Equal(invalid, File.ReadAllText(brokenPath));
        snapshot.Items[0].UserActivities[1].PlayCount++;
        service.Record(snapshot);
        Assert.Equal(2, store.Load(healthy.Id).Observations.Count);
        Assert.Equal(invalid, File.ReadAllText(brokenPath));
        store.Save(broken.Id, new UserActivityHistory()); // Simulate repairing only the failed user's file.
        service.Tick(_localCutoff.AddSeconds(30));
        Assert.Null(consumer.Load(broken.Id));
        service.Tick(_localCutoff.AddMinutes(1));
        Assert.NotNull(consumer.Load(broken.Id));
        Assert.Single(store.Load(broken.Id).Observations);
        Assert.Equal(published.SnapshotId, consumer.Load(healthy.Id)!.SnapshotId);
    }

    [Fact]
    public void MusicIsMeasuredSeparatelyAndRoundTripsWithItsGenresAndRepeatPlays()
    {
        var now = _cutoff.AddDays(-1);
        var music = _movie with { ItemId = Guid.NewGuid(), Name = "Track", ItemType = "Audio", Genres = ["Rock", "Pop"] };
        var history = new UserActivityHistory { MusicRecordingStartedAtUtc = now };
        history.Coverage.Add(new UserActivityCoverage { StartUtc = now, EndUtc = _cutoff });
        var tracker = new UserPlaybackTracker();
        foreach (var item in new[] { _movie, music, music })
        {
            var session = Guid.NewGuid().ToString();
            var playedAt = now.AddMinutes(history.Sessions.Count * 2);
            tracker.Observe(_userId, session, item, item.RuntimeTicks, new(0, false, false, true, false, playedAt), history);
            tracker.Observe(_userId, session, item, item.RuntimeTicks, new(TimeSpan.TicksPerMinute, false, false, false, true, playedAt.AddMinutes(1)), history);
        }

        var journals = new UserActivityHistoryStore(_directory);
        journals.Save(_userId, history);
        var reloaded = journals.Load(_userId);
        Assert.Equal(now, reloaded.MusicRecordingStartedAtUtc);
        var report = Build(reloaded);
        Assert.Equal(60, Assert.Single(report.Items).ActiveSeconds);
        Assert.Equal(120, Assert.Single(report.Music!.Items).ActiveSeconds);
        Assert.Equal(2, report.Music.Items[0].PlayCount);
        Assert.Equal(120, report.Music.Months.Sum(month => month.ActiveSeconds));
        var genres = report.Music.Months.SelectMany(month => month.Genres!).ToArray();
        Assert.Equal(2, genres.Length);
        Assert.All(genres, genre => Assert.Equal(120, genre.ActiveSeconds));
        Assert.Equal(120, report.Music.Insights!.HourlySeconds.Sum());
        Assert.Equal(60, report.Insights!.HourlySeconds.Sum());
        var reports = new YearlyRewindStore(_directory);
        Assert.True(reports.Publish(report));
        var saved = reports.Load(_userId)!;
        Assert.Equal(120, Assert.Single(saved.Music!.Items).ActiveSeconds);
        Assert.Equal(2, saved.Music.Items[0].PlayCount);
    }

    [Fact]
    public void OldVideoCoverageDoesNotHideMusicBaselineAndLifetimeCountsAreNotAnnualPlays()
    {
        var history = new UserActivityHistory { MusicRecordingStartedAtUtc = _cutoff.AddDays(-1) };
        history.Coverage.Add(new UserActivityCoverage { StartUtc = _cutoff.AddYears(-1), EndUtc = _cutoff });
        var track = _movie with { ItemId = Guid.NewGuid(), ItemType = "Audio" };
        history.Record(track, State(_cutoff.AddDays(-10), count: 250), _cutoff, _cutoff);
        var report = Build(history);
        Assert.Empty(report.Items);
        var item = Assert.Single(report.Music!.Items);
        Assert.Equal(1, item.PlayCount);
        Assert.True(item.HasReconstructedActivity);
        Assert.Equal(3600, item.EstimatedSeconds);
        Assert.Equal("Partial", report.Music.DataState);
        Assert.Equal(0, report.Music.ActiveDays);
    }

    [Fact]
    public void ReportsWithoutMusicKeepMusicAbsentAndDoNotRewriteFrozenVideoReports()
    {
        var history = new UserActivityHistory();
        history.Record(_movie, State(_cutoff.AddDays(-2)), _cutoff, _cutoff);
        var video = Build(history);
        Assert.Null(video.Music);
        var store = new YearlyRewindStore(_directory);
        Assert.True(store.Publish(video));
        history.Record(_movie with { ItemId = Guid.NewGuid(), ItemType = "Audio" }, State(_cutoff.AddDays(-2)), _cutoff, _cutoff);
        Assert.NotNull(Build(history).Music);
        Assert.False(store.Publish(Build(history)));
        Assert.Null(store.Load(_userId)!.Music);
    }

    [Fact]
    public async Task CollectorRecordsRealAudioEventsAndPersistsTheMusicCoverageBoundary()
    {
        var configuration = new Mock<IPluginConfigurationService>();
        configuration.SetupGet(value => value.IsInitialized).Returns(true);
        configuration.Setup(value => value.GetConfiguration()).Returns(new PluginConfiguration());
        var paths = new Mock<IApplicationPaths>();
        paths.SetupGet(value => value.DataPath).Returns(_directory);
        var listener = new User("listener", "default", "default") { Id = _userId };
        var users = new Mock<IUserManager>();
        users.Setup(value => value.GetUsers()).Returns([listener]);
        var insights = new Mock<IUserActivityInsightsService>();
        insights.Setup(value => value.BuildActivityReport()).Returns(new UserActivityResult { GeneratedAt = _cutoff.UtcDateTime });
        var sessions = new Mock<ISessionManager>();
        var subscribed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        sessions.SetupAdd(value => value.PlaybackStopped += It.IsAny<EventHandler<PlaybackStopEventArgs>>()).Callback(() => subscribed.TrySetResult());
        var now = _cutoff.AddMinutes(-5);
        var clock = new Mock<TimeProvider> { CallBase = true };
        clock.Setup(value => value.GetUtcNow()).Returns(() => now);
        var track = new MediaBrowser.Controller.Entities.Audio.Audio
        {
            Id = Guid.NewGuid(), Name = "Measured track", Path = "/music/track.flac", Genres = ["Jazz"], RunTimeTicks = TimeSpan.TicksPerMinute * 3
        };
        using var service = new UserActivityHistoryService(configuration.Object, sessions.Object, users.Object, Mock.Of<ILibraryManager>(),
            new VirtualItemDetector(paths.Object, NullLogger<VirtualItemDetector>.Instance), insights.Object, Mock.Of<IUserActivityCacheService>(),
            paths.Object, clock.Object, [], NullLogger<UserActivityHistoryService>.Instance);
        await service.StartAsync(CancellationToken.None);
        try
        {
            await subscribed.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            sessions.Raise(value => value.PlaybackStart += null, new PlaybackProgressEventArgs
            {
                Item = track, Users = [listener], PlaySessionId = "music-session", PlaybackPositionTicks = 0
            });
            now = now.AddSeconds(30);
            sessions.Raise(value => value.PlaybackProgress += null, new PlaybackProgressEventArgs
            {
                Item = track, Users = [listener], PlaySessionId = "music-session", PlaybackPositionTicks = TimeSpan.TicksPerSecond * 30
            });
            now = now.AddSeconds(30);
            sessions.Raise(value => value.PlaybackStopped += null, new PlaybackStopEventArgs
            {
                Item = track, Users = [listener], PlaySessionId = "music-session", PlaybackPositionTicks = TimeSpan.TicksPerMinute
            });
        }
        finally
        {
            await service.StopAsync(CancellationToken.None);
        }

        var history = new UserActivityHistoryStore(Path.Join(_directory, "jellyfin-watchback")).Load(_userId);
        Assert.Equal(_cutoff.AddMinutes(-5), history.MusicRecordingStartedAtUtc);
        Assert.Single(history.Sessions);
        var item = Assert.Single(Build(history).Music!.Items);
        Assert.Equal(60, item.ActiveSeconds);
        Assert.Equal("Jazz", Assert.Single(item.Genres));
    }

    [Theory]
    [InlineData("movie", true)]
    [InlineData("automated-audio", false)]
    [InlineData("virtual-audio", false)]
    [InlineData("folder", false)]
    [InlineData("missing-item", false)]
    public async Task CollectorAcceptsVideoAndRejectsAutomatedVirtualOrUnsupportedEvents(string scenario, bool recorded)
    {
        var configuration = new Mock<IPluginConfigurationService>();
        configuration.SetupGet(value => value.IsInitialized).Returns(true);
        configuration.Setup(value => value.GetConfiguration()).Returns(new PluginConfiguration());
        var paths = new Mock<IApplicationPaths>();
        paths.SetupGet(value => value.DataPath).Returns(_directory);
        var user = new User("listener", "default", "default") { Id = _userId };
        var users = new Mock<IUserManager>();
        users.Setup(value => value.GetUsers()).Returns([user]);
        var insights = new Mock<IUserActivityInsightsService>();
        insights.Setup(value => value.BuildActivityReport()).Returns(new UserActivityResult { GeneratedAt = _cutoff.UtcDateTime });
        var sessions = new Mock<ISessionManager>();
        var subscribed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        sessions.SetupAdd(value => value.PlaybackStopped += It.IsAny<EventHandler<PlaybackStopEventArgs>>()).Callback(() => subscribed.TrySetResult());
        var now = _cutoff.AddMinutes(-5);
        var clock = new Mock<TimeProvider> { CallBase = true };
        clock.Setup(value => value.GetUtcNow()).Returns(() => now);
        MediaBrowser.Controller.Entities.BaseItem? item = scenario switch
        {
            "movie" => new MediaBrowser.Controller.Entities.Movies.Movie(),
            "folder" => new MediaBrowser.Controller.Entities.Folder(),
            "missing-item" => null,
            _ => new MediaBrowser.Controller.Entities.Audio.Audio()
        };
        if (item is not null)
        {
            item.Id = Guid.NewGuid();
            item.Name = scenario;
            item.Path = "/media/playback";
            item.RunTimeTicks = TimeSpan.TicksPerMinute * 3;
            item.IsVirtualItem = scenario == "virtual-audio";
        }

        using var service = new UserActivityHistoryService(configuration.Object, sessions.Object, users.Object, Mock.Of<ILibraryManager>(),
            new VirtualItemDetector(paths.Object, NullLogger<VirtualItemDetector>.Instance), insights.Object, Mock.Of<IUserActivityCacheService>(),
            paths.Object, clock.Object, [], NullLogger<UserActivityHistoryService>.Instance);
        await service.StartAsync(CancellationToken.None);
        try
        {
            await subscribed.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
            sessions.Raise(value => value.PlaybackStart += null, new PlaybackProgressEventArgs
            {
                Item = item!, Users = [user], PlaySessionId = "session", PlaybackPositionTicks = 0, IsAutomated = scenario == "automated-audio"
            });
            now = now.AddSeconds(30);
            sessions.Raise(value => value.PlaybackProgress += null, new PlaybackProgressEventArgs
            {
                Item = item!, Users = [user], PlaySessionId = "session", PlaybackPositionTicks = TimeSpan.TicksPerSecond * 30, IsAutomated = scenario == "automated-audio"
            });
            now = now.AddSeconds(30);
            sessions.Raise(value => value.PlaybackStopped += null, new PlaybackStopEventArgs
            {
                Item = item!, Users = [user], PlaySessionId = "session", PlaybackPositionTicks = TimeSpan.TicksPerMinute, IsAutomated = scenario == "automated-audio"
            });
        }
        finally
        {
            await service.StopAsync(CancellationToken.None);
        }

        var history = new UserActivityHistoryStore(Path.Join(_directory, "jellyfin-watchback")).Load(_userId);
        if (recorded)
        {
            Assert.Equal("Movie", Assert.Single(history.Sessions).Item.ItemType);
            Assert.Equal(60, Assert.Single(Build(history).Items).ActiveSeconds);
        }
        else
        {
            Assert.Empty(history.Sessions);
            Assert.Empty(history.Metadata);
        }
    }

    [Fact]
    public void CollectorNotifiesEveryConsumerWhenNoUsersAreAvailable()
    {
        var configuration = new Mock<IPluginConfigurationService>();
        configuration.SetupGet(value => value.IsInitialized).Returns(true);
        var paths = new Mock<IApplicationPaths>();
        paths.SetupGet(value => value.DataPath).Returns(_directory);
        var users = new Mock<IUserManager>();
        users.Setup(value => value.GetUsers()).Returns([]);
        var insights = new Mock<IUserActivityInsightsService>();
        insights.Setup(value => value.BuildActivityReport()).Returns(new UserActivityResult { GeneratedAt = _cutoff.UtcDateTime });
        var consumer = new RecordingConsumer();
        var other = new RecordingConsumer();
        using var service = new UserActivityHistoryService(configuration.Object, Mock.Of<ISessionManager>(), users.Object, Mock.Of<ILibraryManager>(),
            new VirtualItemDetector(paths.Object, NullLogger<VirtualItemDetector>.Instance), insights.Object, Mock.Of<IUserActivityCacheService>(),
            paths.Object, new FixedClock(_cutoff), [consumer, other], NullLogger<UserActivityHistoryService>.Instance);
        service.Tick(_cutoff);
        foreach (var recorder in new[] { consumer, other })
        {
            Assert.Equal((_cutoff, 0, true, true), Assert.Single(recorder.Calls));
        }
    }

    private sealed class RecordingConsumer : IUserActivityHistoryConsumer
    {
        internal List<(DateTimeOffset At, int Users, bool NewBaseline, bool HistoryReady)> Calls { get; } = [];

        public bool NeedsCurrentState(DateTimeOffset now, IReadOnlyCollection<User> users) => false;

        public void Tick(DateTimeOffset now, IReadOnlyCollection<User> users, Func<Guid, UserActivityHistory> history, bool hasNewBaseline, bool historyReady = true)
            => Calls.Add((now, users.Count, hasNewBaseline, historyReady));

        public IEnumerable<Guid> KnownUsers() => [];

        public void DeleteUser(Guid userId)
        {
        }
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
