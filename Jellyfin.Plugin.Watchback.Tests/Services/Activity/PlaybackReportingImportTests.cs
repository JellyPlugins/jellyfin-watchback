using System.Globalization;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Watchback.Configuration;
using Jellyfin.Plugin.Watchback.Services;
using Jellyfin.Plugin.Watchback.Services.Activity;
using Jellyfin.Plugin.Watchback.Services.ConfigAccess;
using Jellyfin.Plugin.Watchback.Services.YearlyRewind;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace Jellyfin.Plugin.Watchback.Tests.Services.Activity;

public sealed class PlaybackReportingImportTests : IDisposable
{
    private readonly string _directory = Path.Join(Path.GetTempPath(), "jfw-reporting-" + Guid.NewGuid().ToString("N"));
    private readonly DateTimeOffset _cutoff = new(2026, 12, 15, 0, 0, 0, TimeSpan.Zero);
    private readonly Guid _userId = Guid.NewGuid();
    private readonly Guid _itemId = Guid.NewGuid();
    private readonly Mock<IApplicationPaths> _paths = new();
    private readonly Mock<IPluginManager> _plugins = new();

    public PlaybackReportingImportTests()
    {
        Directory.CreateDirectory(_directory);
        _paths.SetupGet(paths => paths.DataPath).Returns(_directory);
        _plugins.SetupGet(plugins => plugins.Plugins).Returns([new LocalPlugin(_directory, true, new PluginManifest { Id = PlaybackReportingReader.PluginId, Name = "Playback Reporting", Version = "1.0.0.0" })]);
    }

    public void Dispose() => Directory.Delete(_directory, true);

    private SqliteConnection Database(bool create = true)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Join(_directory, "playback_reporting.db"), Pooling = false }.ToString());
        connection.Open();
        if (create)
        {
            using var command = connection.CreateCommand();
            command.CommandText = "CREATE TABLE IF NOT EXISTS PlaybackActivity (DateCreated DATETIME NOT NULL, UserId TEXT, ItemId TEXT, ItemType TEXT, ItemName TEXT, PlaybackMethod TEXT, ClientName TEXT, DeviceName TEXT, PlayDuration INT)";
            command.ExecuteNonQuery();
        }

        return connection;
    }

    private void Insert(SqliteConnection connection, string? date = null, string duration = "600", Guid? user = null, string type = "Movie")
    {
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO PlaybackActivity VALUES ($date,$user,$item,$type,'Historical movie','DirectPlay','Client','Device',$duration)";
        command.Parameters.AddWithValue("$date", date ?? _cutoff.AddDays(-10).ToString("yyyy-MM-dd HH:mm:ss.FFFFFFF'Z'", CultureInfo.InvariantCulture));
        command.Parameters.AddWithValue("$user", (user ?? _userId).ToString("N"));
        command.Parameters.AddWithValue("$item", _itemId.ToString("N"));
        command.Parameters.AddWithValue("$type", type);
        command.Parameters.AddWithValue("$duration", duration);
        command.ExecuteNonQuery();
    }

    private PlaybackReportingReader Reader() => new(_paths.Object, _plugins.Object);

    private UserPlaybackItem Item() => new() { ItemId = _itemId, Name = "Historical movie", ItemType = "Movie", RuntimeTicks = TimeSpan.TicksPerHour, Genres = ["Drama"] };

    private YearlyRewindSnapshot Build(UserActivityHistory history) => YearlyRewindAggregator.Build(_userId, history, _cutoff.AddYears(-1), _cutoff, _cutoff, TimeZoneInfo.Utc);

    [Fact]
    public void MissingPluginOrDatabaseIsOptionalAndNeverCreatesTheSource()
    {
        Assert.Empty(Reader().Read(_cutoff));
        Assert.False(File.Exists(Path.Join(_directory, "playback_reporting.db")));
        using var db = Database();
        Insert(db);
        _plugins.SetupGet(plugins => plugins.Plugins).Returns([]);
        Assert.Empty(Reader().Read(_cutoff));
    }

    [Theory]
    [InlineData("2026-12-05 02:03:04", false)]
    [InlineData("2026-12-05 02:03:04.1234567", false)]
    [InlineData("2026-12-05 02:03:04.1234567Z", true)]
    [InlineData("2026-12-05T02:03:04+02:00", true)]
    public void ReadsUpstreamLocalFractionalUtcAndOffsetTimestamps(string timestamp, bool explicitOffset)
    {
        using var db = Database();
        Insert(db, timestamp);
        var before = File.ReadAllBytes(Path.Join(_directory, "playback_reporting.db"));
        var row = Assert.Single(Reader().Read(_cutoff));
        var expected = DateTimeOffset.Parse(timestamp, CultureInfo.InvariantCulture, explicitOffset ? DateTimeStyles.None : DateTimeStyles.AssumeLocal).ToUniversalTime();
        Assert.Equal(expected, row.StartedAtUtc);
        Assert.Equal(600, row.ActiveSeconds);
        Assert.Equal(_userId, row.UserId);
        Assert.Equal(before, File.ReadAllBytes(Path.Join(_directory, "playback_reporting.db")));
    }

    [Fact]
    public void SkipsInvalidRowsAndUsesAStableIdentityAcrossUpdatesAndVacuum()
    {
        using var db = Database();
        Insert(db);
        Insert(db, "invalid");
        Insert(db, duration: "-1");
        Insert(db, duration: "NaN");
        Insert(db, user: Guid.Empty);
        Insert(db, type: "Audio");
        Insert(db, "2030-01-01 00:00:00");
        var first = Assert.Single(Reader().Read(_cutoff));
        using var update = db.CreateCommand();
        update.CommandText = "UPDATE PlaybackActivity SET PlayDuration=1200 WHERE PlayDuration=600; VACUUM";
        update.ExecuteNonQuery();
        var second = Assert.Single(Reader().Read(_cutoff));
        Assert.Equal(first.SourceKey, second.SourceKey);
        Assert.Equal(1200, second.ActiveSeconds);
    }

    [Fact]
    public void ImportIsIdempotentPersistsProvenanceAndSuppressesDuplicateJellyfinEstimates()
    {
        using var db = Database();
        Insert(db);
        var entry = Assert.Single(Reader().Read(_cutoff));
        var history = new UserActivityHistory { PlaybackReportingBeforeUtc = _cutoff.AddDays(-1) };
        Assert.True(history.Import(entry, Item(), _cutoff));
        Assert.False(history.Import(entry, Item(), _cutoff));
        Assert.True(history.Import(entry with { ActiveSeconds = 1200 }, Item(), _cutoff));
        Assert.Single(history.ImportedPlayback);
        history.Record(Item(), new UserItemActivity { UserId = _userId, Played = true, PlayCount = 100, LastPlayedDate = entry.StartedAtUtc.UtcDateTime }, _cutoff, _cutoff);
        var store = new UserActivityHistoryStore(Path.Join(_directory, "jellyfin-watchback"));
        store.Save(_userId, history);
        var loaded = store.Load(_userId);
        Assert.Equal(entry.SourceKey, Assert.Single(loaded.ImportedPlayback).SourceKey);
        Assert.Equal(_itemId, loaded.ImportedPlayback[0].Item.ItemId);
        var report = Build(loaded);
        Assert.Equal("Partial", report.DataState);
        Assert.Equal(1200, Assert.Single(report.Items).ActiveSeconds);
        Assert.Equal(1200, report.Items[0].EstimatedSeconds);
        Assert.Equal(1, report.Items[0].PlayCount);
        Assert.Equal(1, report.PlaybackReportingPlayCount);
        Assert.Equal(1200, report.Months.Sum(month => month.ActiveSeconds));
        Assert.Equal(1200, report.Months.SelectMany(month => month.Genres!).Sum(genre => genre.ActiveSeconds));
        Assert.Equal(0, report.ActiveDays);
        Assert.Equal(0, report.Insights!.HourlySeconds.Sum());
        Assert.Equal(0, report.Insights.LongestStreakDays);
        var reports = new YearlyRewindStore(Path.Join(_directory, "jellyfin-watchback"));
        reports.Publish(report);
        Assert.Equal(1, reports.Load(_userId)!.PlaybackReportingPlayCount);
    }

    [Fact]
    public void RepeatedHistoricalPlaysCountAndOwnPlaybackAfterTheBoundaryRemainsSeparate()
    {
        using var db = Database();
        Insert(db);
        Insert(db, "2026-12-06 00:00:00Z");
        var history = new UserActivityHistory { PlaybackReportingBeforeUtc = _cutoff.AddDays(-1) };
        foreach (var entry in Reader().Read(_cutoff)) history.Import(entry, Item(), _cutoff);
        var key = history.Remember(Item());
        history.Sessions.Add(new UserPlaybackSession { Item = Item(), MetadataKey = key, QualifiedAtUtc = _cutoff.AddMinutes(-1), Intervals = [new(_cutoff.AddMinutes(-2), _cutoff.AddMinutes(-1))] });
        var report = Build(history);
        Assert.Equal(1260, Assert.Single(report.Items).ActiveSeconds);
        Assert.Equal(3, report.Items[0].PlayCount);
        Assert.Equal(2, report.PlaybackReportingPlayCount);
        Assert.Equal(60, report.Insights!.HourlySeconds.Sum());
        var ownPeriodEntry = new PlaybackReportingReader.Entry("own", _userId, _itemId, "Movie", "Movie", _cutoff.AddMinutes(-5), 900);
        Assert.False(history.Import(ownPeriodEntry, Item(), _cutoff));
        Assert.Equal(2, history.ImportedPlayback.Count);
    }

    [Fact]
    public void BoundaryClipsHistoricalDurationAndReportsNeverCountFutureOrOutOfPeriodImports()
    {
        var boundary = _cutoff.AddHours(-1);
        var history = new UserActivityHistory { PlaybackReportingBeforeUtc = boundary };
        var entry = new PlaybackReportingReader.Entry("boundary", _userId, _itemId, "Movie", "Movie", boundary.AddMinutes(-5), 3600);
        Assert.True(history.Import(entry, Item(), _cutoff));
        Assert.Equal(300, history.ImportedPlayback[0].ActiveSeconds);
        history.Import(entry with { SourceKey = "old", StartedAtUtc = _cutoff.AddYears(-2) }, Item(), _cutoff);
        history.Import(entry with { SourceKey = "future-import" }, Item(), _cutoff.AddDays(1));
        Assert.Equal(300, Assert.Single(Build(history).Items).ActiveSeconds);
        Assert.Equal(1, Build(history).PlaybackReportingPlayCount);
    }

    [Fact]
    public void ExistingSchemaTwoJournalsLoadAndRejectMalformedImportedRecords()
    {
        var store = new UserActivityHistoryStore(Path.Join(_directory, "jellyfin-watchback"));
        var history = new UserActivityHistory();
        history.Record(Item(), new UserItemActivity { UserId = _userId }, _cutoff, _cutoff);
        store.Save(_userId, history);
        var path = Path.Join(_directory, "jellyfin-watchback", "activity-history", _userId.ToString("N") + ".json");
        var json = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(path))!.AsObject();
        json.Remove("importedPlayback");
        json.Remove("playbackReportingBeforeUtc");
        File.WriteAllText(path, json.ToJsonString());
        Assert.Empty(store.Load(_userId).ImportedPlayback);
        history.PlaybackReportingBeforeUtc = _cutoff;
        var entry = new PlaybackReportingReader.Entry("source", _userId, _itemId, "Movie", "Movie", _cutoff.AddDays(-1), 600);
        history.Import(entry, Item(), _cutoff);
        history.ImportedPlayback.Add(history.ImportedPlayback[0]);
        Assert.Throws<InvalidDataException>(() => store.Save(_userId, history));
        history.ImportedPlayback.RemoveAt(1);
        history.ImportedPlayback[0] = history.ImportedPlayback[0] with { ActiveSeconds = double.NaN };
        Assert.Throws<InvalidDataException>(() => store.Save(_userId, history));
    }

    [Fact]
    public void EarliestOwnCoverageAndTheImportBoundarySurviveRestart()
    {
        var store = new UserActivityHistoryStore(Path.Join(_directory, "jellyfin-watchback"));
        var start = _cutoff.AddMonths(-1);
        var history = new UserActivityHistory { Coverage = [new() { StartUtc = start, EndUtc = start.AddMinutes(1) }] };
        store.Save(_userId, history);
        var loaded = store.Load(_userId);
        var entry = new PlaybackReportingReader.Entry("source", _userId, _itemId, "Movie", "Movie", start.AddMinutes(1), 600);
        Assert.False(loaded.Import(entry, Item(), _cutoff));
        loaded.PlaybackReportingBeforeUtc = start;
        store.Save(_userId, loaded);
        var restarted = store.Load(_userId);
        Assert.Equal(start, restarted.PlaybackReportingBeforeUtc);
        Assert.False(restarted.Import(entry, Item(), _cutoff.AddYears(1)));
        Assert.True(restarted.Import(entry with { StartedAtUtc = start.AddDays(-1) }, Item(), _cutoff.AddYears(1)));
    }

    [Fact]
    public void ATemporarilyLockedSourceIsReportedRatherThanModifiedOrPartiallyImported()
    {
        using var db = Database();
        Insert(db);
        using var transaction = db.CreateCommand();
        transaction.CommandText = "BEGIN EXCLUSIVE";
        transaction.ExecuteNonQuery();
        try
        {
            Assert.Throws<SqliteException>(() => Reader().Read(_cutoff));
        }
        finally
        {
            transaction.CommandText = "ROLLBACK";
            transaction.ExecuteNonQuery();
        }

        Assert.Single(Reader().Read(_cutoff));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void CollectorImportsWhileDisabledAndNeverRewritesFrozenReports(bool initiallyEnabled)
    {
        using var db = Database();
        Insert(db);
        var config = new PluginConfiguration { YearlyRewindEnabled = initiallyEnabled };
        var configuration = new Mock<IPluginConfigurationService>();
        configuration.SetupGet(value => value.IsInitialized).Returns(true);
        configuration.Setup(value => value.GetConfiguration()).Returns(config);
        var user = new User("test", "default", "default") { Id = _userId };
        var users = new Mock<IUserManager>();
        users.Setup(value => value.GetUsers()).Returns([user]);
        var insights = new Mock<IUserActivityInsightsService>();
        insights.Setup(value => value.BuildActivityReport()).Returns(new UserActivityResult { GeneratedAt = _cutoff.UtcDateTime });
        var consumer = new YearlyRewindService(configuration.Object, _paths.Object, NullLogger<YearlyRewindService>.Instance);
        using var service = new UserActivityHistoryService(configuration.Object, Mock.Of<ISessionManager>(), users.Object, Mock.Of<ILibraryManager>(),
            new VirtualItemDetector(_paths.Object, NullLogger<VirtualItemDetector>.Instance), insights.Object, Mock.Of<IUserActivityCacheService>(),
            _paths.Object, TimeProvider.System, [consumer], NullLogger<UserActivityHistoryService>.Instance, Reader());
        service.Tick(_cutoff);
        var store = new UserActivityHistoryStore(Path.Join(_directory, "jellyfin-watchback"));
        Assert.Single(store.Load(_userId).ImportedPlayback);
        if (!initiallyEnabled) Assert.Null(consumer.Load(_userId));
        config.YearlyRewindEnabled = true;
        service.Tick(_cutoff.AddMinutes(1));
        var report = consumer.Load(_userId)!;
        Assert.Equal(1, report.PlaybackReportingPlayCount);
        Insert(db, "2026-12-07 00:00:00Z");
        service.Tick(_cutoff.AddHours(2));
        Assert.Equal(2, store.Load(_userId).ImportedPlayback.Count);
        Assert.Equal(report.SnapshotId, consumer.Load(_userId)!.SnapshotId);
        Assert.Equal(1, consumer.Load(_userId)!.PlaybackReportingPlayCount);
    }

    [Fact]
    public void FailedJellyfinRefreshDoesNotRescanHistoricalDataEverySecond()
    {
        using var db = Database();
        Insert(db);
        var config = new PluginConfiguration { YearlyRewindEnabled = true };
        var configuration = new Mock<IPluginConfigurationService>();
        configuration.SetupGet(value => value.IsInitialized).Returns(true);
        configuration.Setup(value => value.GetConfiguration()).Returns(config);
        var user = new User("test", "default", "default") { Id = _userId };
        var users = new Mock<IUserManager>();
        users.Setup(value => value.GetUsers()).Returns([user]);
        var insights = new Mock<IUserActivityInsightsService>();
        insights.Setup(value => value.BuildActivityReport()).Throws(new IOException("temporarily unavailable"));
        var consumer = new YearlyRewindService(configuration.Object, _paths.Object, NullLogger<YearlyRewindService>.Instance);
        using var service = new UserActivityHistoryService(configuration.Object, Mock.Of<ISessionManager>(), users.Object, Mock.Of<ILibraryManager>(),
            new VirtualItemDetector(_paths.Object, NullLogger<VirtualItemDetector>.Instance), insights.Object, Mock.Of<IUserActivityCacheService>(),
            _paths.Object, TimeProvider.System, [consumer], NullLogger<UserActivityHistoryService>.Instance, Reader());
        for (var second = 0; second < 10; second++) service.Tick(_cutoff.AddSeconds(second));
        _plugins.VerifyGet(plugins => plugins.Plugins, Times.Once);
        Assert.Null(consumer.Load(_userId));
    }

    [Fact]
    public void AlreadySealedReportsRecoverEvenWhenTheOptionalSourceIsUnavailable()
    {
        using var db = Database(false);
        var report = Build(new UserActivityHistory());
        new YearlyRewindPendingStore(Path.Join(_directory, "jellyfin-watchback")).Seal(report);
        var configuration = new Mock<IPluginConfigurationService>();
        configuration.SetupGet(value => value.IsInitialized).Returns(true);
        configuration.Setup(value => value.GetConfiguration()).Returns(new PluginConfiguration { YearlyRewindEnabled = true });
        var user = new User("test", "default", "default") { Id = _userId };
        var users = new Mock<IUserManager>();
        users.Setup(value => value.GetUsers()).Returns([user]);
        var insights = new Mock<IUserActivityInsightsService>();
        insights.Setup(value => value.BuildActivityReport()).Returns(new UserActivityResult { GeneratedAt = _cutoff.UtcDateTime });
        var consumer = new YearlyRewindService(configuration.Object, _paths.Object, NullLogger<YearlyRewindService>.Instance);
        using var service = new UserActivityHistoryService(configuration.Object, Mock.Of<ISessionManager>(), users.Object, Mock.Of<ILibraryManager>(),
            new VirtualItemDetector(_paths.Object, NullLogger<VirtualItemDetector>.Instance), insights.Object, Mock.Of<IUserActivityCacheService>(),
            _paths.Object, TimeProvider.System, [consumer], NullLogger<UserActivityHistoryService>.Instance, Reader());
        service.Tick(_cutoff);
        Assert.Equal(report.SnapshotId, consumer.Load(_userId)!.SnapshotId);
    }

    [Fact]
    public void BrokenSourceRetriesWithoutStoppingOwnCollectionOrFreezingIncompleteReports()
    {
        using var db = Database(false);
        var config = new PluginConfiguration { YearlyRewindEnabled = true };
        var configuration = new Mock<IPluginConfigurationService>();
        configuration.SetupGet(value => value.IsInitialized).Returns(true);
        configuration.Setup(value => value.GetConfiguration()).Returns(config);
        var user = new User("test", "default", "default") { Id = _userId };
        var users = new Mock<IUserManager>();
        users.Setup(value => value.GetUsers()).Returns([user]);
        var insights = new Mock<IUserActivityInsightsService>();
        insights.Setup(value => value.BuildActivityReport()).Returns(new UserActivityResult { GeneratedAt = _cutoff.UtcDateTime });
        var consumer = new YearlyRewindService(configuration.Object, _paths.Object, NullLogger<YearlyRewindService>.Instance);
        using var service = new UserActivityHistoryService(configuration.Object, Mock.Of<ISessionManager>(), users.Object, Mock.Of<ILibraryManager>(),
            new VirtualItemDetector(_paths.Object, NullLogger<VirtualItemDetector>.Instance), insights.Object, Mock.Of<IUserActivityCacheService>(),
            _paths.Object, TimeProvider.System, [consumer], NullLogger<UserActivityHistoryService>.Instance, Reader());
        service.Tick(_cutoff);
        Assert.Null(consumer.Load(_userId));
        service.Record(new UserActivityResult { GeneratedAt = _cutoff.UtcDateTime });
        Assert.Null(consumer.Load(_userId));
        using var repaired = Database();
        Insert(repaired);
        service.Tick(_cutoff.AddMinutes(2));
        Assert.Equal(1, consumer.Load(_userId)!.PlaybackReportingPlayCount);
        Assert.NotEmpty(new UserActivityHistoryStore(Path.Join(_directory, "jellyfin-watchback")).Load(_userId).Coverage);
    }
}
