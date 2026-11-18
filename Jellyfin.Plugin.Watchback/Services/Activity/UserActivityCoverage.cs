using System;
using System.Collections.ObjectModel;

namespace Jellyfin.Plugin.Watchback.Services.Activity;

internal sealed class UserActivityCoverage
{
    public DateTimeOffset StartUtc { get; init; }

    public DateTimeOffset EndUtc { get; set; }
}
