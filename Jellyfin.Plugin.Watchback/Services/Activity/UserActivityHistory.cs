using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Jellyfin.Plugin.Watchback.Services.Activity;

/// <summary>Shared per-user observations, measured intervals and versioned metadata, independent of consumers.</summary>
internal sealed class UserActivityHistory
{
    private Dictionary<Guid, List<UserPlaybackObservation>>? _byItem;
    private Dictionary<string, int>? _importsByKey;

    public int SchemaVersion { get; init; } = 2;

    public Dictionary<string, UserPlaybackItem> Metadata { get; init; } = new(StringComparer.Ordinal);

    public Collection<UserActivityCoverage> Coverage { get; init; } = [];

    public Collection<UserPlaybackSession> Sessions { get; init; } = [];

    public Collection<UserPlaybackObservation> Observations { get; init; } = [];

    // Additive schema-2 fields keep existing journals readable. This boundary never advances
    // on restart, even if the Playback Reporting plugin is installed later.
    public DateTimeOffset? PlaybackReportingBeforeUtc { get; set; }

    // Old video-only coverage must not suppress music baseline reconstruction.
    public DateTimeOffset? MusicRecordingStartedAtUtc { get; set; }

    public bool PlaybackReportingImportCompleted { get; set; }

    public Collection<ImportedPlayback> ImportedPlayback { get; init; } = [];

    internal bool Import(PlaybackReportingReader.Entry entry, UserPlaybackItem item, DateTimeOffset now)
    {
        var boundary = PlaybackReportingBeforeUtc ?? Coverage.Select(period => (DateTimeOffset?)period.StartUtc).Min() ?? now;
        if (PlaybackReportingImportCompleted || entry.StartedAtUtc >= boundary)
        {
            return false;
        }

        var duration = Math.Min(entry.ActiveSeconds, (boundary - entry.StartedAtUtc).TotalSeconds);
        var key = Remember(item);
        _importsByKey ??= ImportedPlayback.Select((row, index) => (row.SourceKey, Index: index))
            .ToDictionary(row => row.SourceKey, row => row.Index, StringComparer.Ordinal);
        var found = _importsByKey.TryGetValue(entry.SourceKey, out var index);
        var previous = found ? ImportedPlayback[index] : null;
        if (previous is not null && previous.ActiveSeconds == duration && previous.MetadataKey == key)
        {
            return false;
        }

        var imported = new ImportedPlayback
        {
            SourceKey = entry.SourceKey, MetadataKey = key, Item = Metadata[key],
            StartedAtUtc = entry.StartedAtUtc, ImportedAtUtc = now, ActiveSeconds = duration
        };
        if (previous is null)
        {
            _importsByKey[entry.SourceKey] = ImportedPlayback.Count;
            ImportedPlayback.Add(imported);
        }
        else
        {
            ImportedPlayback[index] = imported;
        }

        return true;
    }

    internal string Remember(UserPlaybackItem item)
    {
        item = item with
        {
            SeriesId = item.SeriesId == Guid.Empty ? null : item.SeriesId,
            Genres = new Collection<string>(item.Genres.Where(name => !string.IsNullOrWhiteSpace(name))
                .Select(name => name.Trim()).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray())
        };
        var key = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(item, JsonDefaults.Options))));
        Metadata.TryAdd(key, item);
        return key;
    }

    internal bool Record(UserPlaybackItem item, UserItemActivity state, DateTimeOffset observed, DateTimeOffset source)
    {
        var key = Remember(item);
        var playedAt = state.LastPlayedDate.HasValue ? new DateTimeOffset(state.LastPlayedDate.Value).ToUniversalTime() : (DateTimeOffset?)null;
        if (playedAt > observed)
        {
            playedAt = null;
        }

        var count = Math.Max(0, state.PlayCount);
        var position = Math.Max(0, state.PlaybackPositionTicks);
        _byItem ??= Observations.GroupBy(row => row.Item.ItemId).ToDictionary(group => group.Key, group => group.ToList());
        if (!_byItem.TryGetValue(item.ItemId, out var records))
        {
            records = [];
            _byItem[item.ItemId] = records;
        }

        var previous = records.OrderBy(row => row.SourceGeneratedAtUtc).ThenBy(row => row.ObservedAtUtc).LastOrDefault();

        bool Same(UserPlaybackObservation row) => row.MetadataKey == key && row.LastPlayedAtUtc == playedAt
            && row.PlayCount == count && row.PlaybackPositionTicks == position && row.Played == state.Played;
        if (previous is not null && (Same(previous)
            || (source <= previous.SourceGeneratedAtUtc && records.Any(Same))))
        {
            return false;
        }

        int? delta = null;
        if (previous is not null && source >= previous.SourceGeneratedAtUtc && count >= previous.PlayCount)
        {
            delta = count - previous.PlayCount;
        }

        var observation = new UserPlaybackObservation
        {
            MetadataKey = key,
            Item = Metadata[key],
            ObservedAtUtc = observed,
            SourceGeneratedAtUtc = source,
            LastPlayedAtUtc = playedAt,
            PlayCount = count,
            PlaybackPositionTicks = position,
            Played = state.Played,
            PlayCountDelta = delta
        };
        Observations.Add(observation);
        records.Add(observation);
        return true;
    }
}
