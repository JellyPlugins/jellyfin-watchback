using Jellyfin.Plugin.Watchback.Configuration;
using Jellyfin.Plugin.Watchback.Services.ConfigAccess;
using Jellyfin.Plugin.Watchback.Services.PluginLog;
using Microsoft.Extensions.Logging;
using Moq;

namespace Jellyfin.Plugin.Watchback.Tests.TestFixtures;

internal static class TestMockFactory
{
    internal static PluginLogService CreatePluginLogService(PluginConfiguration? config = null)
    {
        var service = new Mock<IPluginConfigurationService>();
        service.SetupGet(value => value.IsInitialized).Returns(true);
        service.Setup(value => value.GetConfiguration()).Returns(config ?? new PluginConfiguration());
        return new PluginLogService(service.Object);
    }

    internal static Mock<ILogger> CreateLogger()
    {
        var logger = new Mock<ILogger>();
        logger.Setup(value => value.IsEnabled(It.IsAny<LogLevel>())).Returns(true);
        return logger;
    }
}
