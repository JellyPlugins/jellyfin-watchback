using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using Microsoft.Data.Sqlite;

namespace Jellyfin.Plugin.Watchback.Services.Activity;

/// <summary>Optional, read-only access to Playback Reporting's existing SQLite history.</summary>
internal sealed class PlaybackReportingReader
{
    internal static readonly Guid PluginId = new("5c534381-91a3-43cb-907a-35aa02eb9d2c");
    private static readonly string[] TimestampFormats =
    [
        "yyyy-MM-dd HH:mm:ss.FFFFFFFK", "yyyy-MM-ddTHH:mm:ss.FFFFFFFK",
        "yyyy-MM-dd HH:mmK", "yyyy-MM-ddTHH:mmK", "yyyyMMddHHmmssK", "yyyyMMddTHHmmssFFFFFFFK"
    ];

    private readonly IPluginManager _plugins;
    private readonly string _path;

    public PlaybackReportingReader(IApplicationPaths paths, IPluginManager plugins)
    {
        _path = Path.Join(paths.DataPath, "playback_reporting.db");
        _plugins = plugins;
    }

    internal IReadOnlyList<Entry> Read(DateTimeOffset now)
    {
        // A leftover database alone is not proof that the integration is installed.
        if (!_plugins.Plugins.Any(plugin => plugin.Id == PluginId))
        {
            return [];
        }

        try
        {
            // Unlike File.Exists, metadata lookup propagates access and I/O failures.
            _ = File.GetAttributes(_path);
        }
        catch (FileNotFoundException)
        {
            return [];
        }
        catch (DirectoryNotFoundException)
        {
            return [];
        }

        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = _path,
            Mode = SqliteOpenMode.ReadOnly,
            Pooling = false,
            DefaultTimeout = 2
        }.ToString());
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT DateCreated, UserId, ItemId, ItemType, ItemName, PlayDuration FROM PlaybackActivity ORDER BY DateCreated, UserId, ItemId";
        using var reader = command.ExecuteReader();
        var result = new List<Entry>();
        while (reader.Read())
        {
            if (Enumerable.Range(0, 6).Any(reader.IsDBNull)
                || !Guid.TryParse(reader.GetString(1), out var user) || user == Guid.Empty
                || !Guid.TryParse(reader.GetString(2), out var item) || item == Guid.Empty
                || !DateTime.TryParseExact(reader.GetString(0), TimestampFormats, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var local)
                || reader.GetString(3) is not ("Movie" or "Episode" or "Audio")
                || !double.TryParse(Convert.ToString(reader.GetValue(5), CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds)
                || !double.IsFinite(seconds) || seconds <= 0 || (local.Kind == DateTimeKind.Unspecified && TimeZoneInfo.Local.IsInvalidTime(local)))
            {
                continue;
            }

            // Upstream stores server-local timestamps without an offset. Resolve an ambiguous
            // wall time deterministically; precise historical pause/DST intervals are unavailable.
            var started = local.Kind != DateTimeKind.Unspecified
                ? new DateTimeOffset(local.ToUniversalTime())
                : (TimeZoneInfo.Local.IsAmbiguousTime(local)
                    ? new DateTimeOffset(local, TimeZoneInfo.Local.GetAmbiguousTimeOffsets(local).Max()).ToUniversalTime()
                    : new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, TimeZoneInfo.Local)));
            if (started >= now)
            {
                continue;
            }

            // Upstream identifies updates by date/user/item. Exclude mutable duration and SQLite
            // rowid so retries, updated totals, backups and VACUUM do not duplicate a playback.
            var identity = user.ToString("N") + ":" + item.ToString("N") + ":" + reader.GetString(0);
            var key = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(identity)));
            result.Add(new Entry(key, user, item, reader.GetString(3), reader.GetString(4), started, seconds));
        }

        return result.GroupBy(row => row.SourceKey, StringComparer.Ordinal).Select(group => group.MaxBy(row => row.ActiveSeconds)!).ToArray();
    }

    internal sealed record Entry(string SourceKey, Guid UserId, Guid ItemId, string ItemType, string Name, DateTimeOffset StartedAtUtc, double ActiveSeconds);
}
