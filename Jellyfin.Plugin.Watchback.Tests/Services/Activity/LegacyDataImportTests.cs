using Jellyfin.Plugin.Watchback.Services.Activity;
using Jellyfin.Plugin.Watchback.Services.YearlyRewind;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace Jellyfin.Plugin.Watchback.Tests.Services.Activity;

public sealed class LegacyDataImportTests : IDisposable
{
    private readonly string _source = Path.Join(Path.GetTempPath(), "watchback-import-" + Guid.NewGuid().ToString("N"));
    private string Target => Path.Join(_source, "jellyfin-watchback");

    public void Dispose()
    {
        if (Directory.Exists(_source)) Directory.Delete(_source, true);
    }

    [Fact]
    public void Import_RetainsSourceBytesAndDoesNotOverwriteWatchbackHistory()
    {
        var id = Guid.NewGuid();
        var source = new UserActivityHistoryStore(_source);
        source.Save(id, new UserActivityHistory());
        var path = Path.Join(_source, "activity-history", id.ToString("N") + ".json");
        var before = File.ReadAllBytes(path);
        LegacyDataImportService.ImportUser(_source, Target, id);
        var target = new UserActivityHistoryStore(Target);
        var adopted = target.Load(id);
        adopted.Coverage.Add(new UserActivityCoverage { StartUtc = DateTimeOffset.UnixEpoch, EndUtc = DateTimeOffset.UnixEpoch.AddDays(1) });
        target.Save(id, adopted);
        LegacyDataImportService.ImportUser(_source, Target, id);
        Assert.Single(target.Load(id).Coverage);
        Assert.Equal(before, File.ReadAllBytes(path));
    }

    [Fact]
    public void Import_PreservesTheFrozenSnapshotAndIgnoresForeignUserIds()
    {
        var id = Guid.NewGuid();
        var start = new DateTimeOffset(2025, 12, 15, 0, 0, 0, TimeSpan.Zero);
        var report = YearlyRewindAggregator.Build(id, new UserActivityHistory(), start, start.AddYears(1), start.AddYears(1), TimeZoneInfo.Utc, null);
        var source = new YearlyRewindStore(_source);
        source.Publish(report);
        var path = Path.Join(_source, "yearly-rewind", "reports", id.ToString("N") + ".json");
        var before = File.ReadAllBytes(path);
        LegacyDataImportService.ImportUser(_source, Target, id);
        Assert.Equal(report.SnapshotId, new YearlyRewindStore(Target).Load(id)!.SnapshotId);
        Assert.Equal(before, File.ReadAllBytes(path));
        LegacyDataImportService.ImportUser(_source, Target, Guid.NewGuid());
        Assert.Single(new YearlyRewindStore(Target).KnownUsers());
    }

    [Fact]
    public void Import_RetainsPendingPublicationAndLeavesTheSourceUntouched()
    {
        var id = Guid.NewGuid();
        var start = new DateTimeOffset(2025, 12, 15, 0, 0, 0, TimeSpan.Zero);
        var report = YearlyRewindAggregator.Build(id, new UserActivityHistory(), start, start.AddYears(1), start.AddYears(1), TimeZoneInfo.Utc, null);
        new YearlyRewindPendingStore(_source).Seal(report);
        var path = Path.Join(_source, "yearly-rewind", "pending", id.ToString("N") + ".json");
        var before = File.ReadAllBytes(path);
        LegacyDataImportService.ImportUser(_source, Target, id);
        Assert.Equal(report.SnapshotId, new YearlyRewindPendingStore(Target).LoadPending(id)!.SnapshotId);
        Assert.Equal(before, File.ReadAllBytes(path));
        new YearlyRewindStore(Target).Publish(report);
        new YearlyRewindPendingStore(Target).Complete(id);
        LegacyDataImportService.ImportUser(_source, Target, id);
        Assert.Null(new YearlyRewindPendingStore(Target).LoadPending(id));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Import_AdoptsTheBaselineOnlyWhenWatchbackHasNoCache(bool existing)
    {
        Directory.CreateDirectory(_source);
        var file = Path.Join(_source, "jellyfin-helper-useractivity-latest.json");
        File.WriteAllText(file, "{\"generatedAt\":\"2026-11-01T00:00:00Z\",\"items\":[]}");
        var before = File.ReadAllBytes(file);
        if (existing)
        {
            Directory.CreateDirectory(Target);
            File.WriteAllText(Path.Join(Target, "jellyfin-watchback-useractivity-latest.json"), "{}");
        }

        var paths = new Mock<IApplicationPaths>();
        paths.SetupGet(value => value.DataPath).Returns(_source);
        var users = new Mock<IUserManager>();
        users.Setup(value => value.GetUsers()).Returns([]);
        var cache = new Mock<IUserActivityCacheService>();
        var service = new LegacyDataImportService(paths.Object, users.Object, cache.Object, NullLogger<LegacyDataImportService>.Instance);
        await service.StartAsync(TestContext.Current.CancellationToken);
        cache.Verify(value => value.SaveResult(It.IsAny<UserActivityResult>()), existing ? Times.Never() : Times.Once());
        Assert.Equal(before, File.ReadAllBytes(file));
        await service.StopAsync(TestContext.Current.CancellationToken);
    }
}
