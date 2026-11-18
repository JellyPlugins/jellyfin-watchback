using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.Watchback.Services.Common;
using Jellyfin.Plugin.Watchback.Services.YearlyRewind;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Watchback.Services.Activity;

/// <summary>Adopts existing Helper reports and journals without modifying their source files.</summary>
internal sealed class LegacyDataImportService : IHostedService
{
    private readonly IApplicationPaths _paths;
    private readonly IUserManager _users;
    private readonly IUserActivityCacheService _cache;
    private readonly ILogger<LegacyDataImportService> _logger;

    public LegacyDataImportService(IApplicationPaths paths, IUserManager users, IUserActivityCacheService cache, ILogger<LegacyDataImportService> logger)
    {
        _paths = paths;
        _users = users;
        _cache = cache;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        var root = Path.Join(_paths.DataPath, "jellyfin-watchback");
        ImportBaseline(root);
        foreach (var user in _users.GetUsers())
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                ImportUser(_paths.DataPath, root, user.Id);
            }
            catch (Exception ex) when (!ex.IsFatal())
            {
                _logger.LogWarning(ex, "Could not import existing rewind data for {UserId}; source data is unchanged.", user.Id);
            }
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private void ImportBaseline(string root)
    {
        var source = Path.Join(_paths.DataPath, "jellyfin-helper-useractivity-latest.json");
        if (!File.Exists(source) || File.Exists(Path.Join(root, "jellyfin-watchback-useractivity-latest.json")))
        {
            return;
        }

        try
        {
            using var stream = File.OpenRead(source);
            var baseline = JsonSerializer.Deserialize<UserActivityResult>(stream, JsonDefaults.Options)
                ?? throw new InvalidDataException("The legacy activity baseline is null.");
            _cache.SaveResult(baseline);
        }
        catch (Exception ex) when (!ex.IsFatal())
        {
            _logger.LogWarning(ex, "Could not import the existing activity baseline; current Jellyfin data will be queried.");
        }
    }

    internal static void ImportUser(string source, string target, Guid userId)
    {
        var id = userId.ToString("N") + ".json";
        if (!File.Exists(Path.Join(target, "activity-history", id)))
        {
            if (File.Exists(Path.Join(source, "activity-history", id)))
            {
                var history = new UserActivityHistoryStore(source).Load(userId);
                new UserActivityHistoryStore(target).Save(userId, history);
            }
            else
            {
                var legacy = Path.Join(source, "yearly-rewind", "history", id);
                var adopted = Path.Join(target, "yearly-rewind", "history", id);
                if (File.Exists(legacy) && !File.Exists(adopted))
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(adopted)!);
                    AtomicFile.WriteAllText(adopted, File.ReadAllText(legacy));
                }

                // Legacy conversion writes only to Watchback's own root.
                new UserActivityHistoryStore(target).Load(userId);
            }
        }

        var reports = new YearlyRewindStore(target);
        if (!File.Exists(Path.Join(target, "yearly-rewind", "reports", id)))
        {
            var report = new YearlyRewindStore(source).Load(userId);
            if (report is not null && report.UserId == userId)
            {
                reports.Publish(report);
            }
        }

        ImportPending(source, target, userId, id);
    }

    private static void ImportPending(string source, string target, Guid userId, string id)
    {
        var path = Path.Join(source, "yearly-rewind", "pending", id);
        if (!File.Exists(path) || File.Exists(Path.Join(target, "yearly-rewind", "pending", id)))
        {
            return;
        }

        using var stream = File.OpenRead(path);
        if (stream.Length > YearlyRewindStore.MaxSnapshotBytes)
        {
            throw new InvalidDataException("The legacy pending report exceeds its storage limit.");
        }

        var pending = JsonSerializer.Deserialize<YearlyRewindSnapshot>(stream, JsonDefaults.Options);
        if (pending is null || pending.UserId != userId)
        {
            throw new InvalidDataException("The legacy pending report belongs to another user.");
        }

        var current = new YearlyRewindStore(target).Load(userId);
        if (current is null || current.SnapshotAtUtc < pending.SnapshotAtUtc)
        {
            new YearlyRewindPendingStore(target).Seal(pending);
        }
    }
}
