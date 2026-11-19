using System;
using Jellyfin.Plugin.Watchback.Services;
using Jellyfin.Plugin.Watchback.Services.Activity;
using Jellyfin.Plugin.Watchback.Services.ConfigAccess;
using Jellyfin.Plugin.Watchback.Services.PluginLog;
using Jellyfin.Plugin.Watchback.Services.WebInjection;
using Jellyfin.Plugin.Watchback.Services.YearlyRewind;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Jellyfin.Plugin.Watchback;

/// <summary>Registers only the dependencies required for Watchback.</summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton(TimeProvider.System);
        serviceCollection.AddSingleton<IPluginConfigurationService, PluginConfigurationService>();
        serviceCollection.AddSingleton<IPluginLogService, PluginLogService>();
        serviceCollection.AddSingleton<VirtualItemDetector>();
        serviceCollection.AddSingleton<IUserActivityInsightsService, UserActivityInsightsService>();
        serviceCollection.AddSingleton<IUserActivityCacheService, UserActivityCacheService>();
        serviceCollection.AddSingleton<YearlyRewindService>();
        serviceCollection.AddSingleton<IUserActivityHistoryConsumer>(services => services.GetRequiredService<YearlyRewindService>());
        serviceCollection.AddHostedService<LegacyDataImportService>();
        serviceCollection.AddSingleton<PlaybackReportingReader>();
        serviceCollection.AddSingleton<UserActivityHistoryService>();
        serviceCollection.AddSingleton<IUserActivityHistoryRecorder>(services => services.GetRequiredService<UserActivityHistoryService>());
        serviceCollection.AddSingleton<IHostedService>(services => services.GetRequiredService<UserActivityHistoryService>());
        serviceCollection.AddSingleton<IStartupFilter, ScriptInjectionStartupFilter>();
    }
}
