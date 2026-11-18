using System;
using System.Collections.Generic;
using Jellyfin.Plugin.Watchback.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.Watchback;

/// <summary>Independent annual playback rewind plugin.</summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    /// <summary>Initializes a new instance of the <see cref="Plugin"/> class.</summary>
    /// <param name="paths">Jellyfin application paths.</param>
    /// <param name="serializer">Jellyfin configuration serializer.</param>
    public Plugin(IApplicationPaths paths, IXmlSerializer serializer) : base(paths, serializer) => Instance = this;

    /// <summary>Gets the current plugin instance.</summary>
    public static Plugin? Instance { get; private set; }

    /// <inheritdoc />
    public override string Name => "jellyfin-watchback";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("16f5f0be-353b-48c4-a5f1-d41d9b08b264");

    /// <inheritdoc />
    public override string Description => "Your personal annual Jellyfin playback rewind.";

    /// <inheritdoc />
    public IEnumerable<PluginPageInfo> GetPages() =>
    [
        new PluginPageInfo
        {
            Name = Name,
            DisplayName = "Jellyfin Watchback",
            EnableInMainMenu = true,
            MenuIcon = "history",
            EmbeddedResourcePath = GetType().Namespace + ".PluginPages.configPage.html"
        }
    ];
}
