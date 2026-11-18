using System.Text.Json;
using System.Xml.Serialization;
using Jellyfin.Plugin.Watchback.Api;
using Jellyfin.Plugin.Watchback.Configuration;
using Xunit;

namespace Jellyfin.Plugin.Watchback.Tests.Configuration;

public sealed class YearlyRewindConfigurationTests
{
    [Fact]
    public void LegacyXml_DefaultsToDisabledWithDefaultWindow()
    {
        var serializer = new XmlSerializer(typeof(PluginConfiguration));
        using var reader = new StringReader("<PluginConfiguration />");
        var config = (PluginConfiguration)serializer.Deserialize(reader)!;
        Assert.False(config.YearlyRewindEnabled);
        Assert.Equal("12-15", config.YearlyRewindStartDate);
        Assert.Equal("01-15", config.YearlyRewindEndDate);
    }

    [Fact]
    public void XmlRoundtrip_PreservesOptInAndCustomWindow()
    {
        var config = new PluginConfiguration { YearlyRewindEnabled = true, YearlyRewindStartDate = "11-01", YearlyRewindEndDate = "11-30" };
        var serializer = new XmlSerializer(typeof(PluginConfiguration));
        using var writer = new StringWriter();
        serializer.Serialize(writer, config);
        using var reader = new StringReader(writer.ToString());
        var restored = (PluginConfiguration)serializer.Deserialize(reader)!;
        Assert.True(restored.YearlyRewindEnabled);
        Assert.Equal("11-01", restored.YearlyRewindStartDate);
        Assert.Equal("11-30", restored.YearlyRewindEndDate);
    }

    [Theory]
    [InlineData("")]
    [InlineData("02-29")]
    [InlineData("13-01")]
    [InlineData("01-32")]
    [InlineData("2026-12-15")]
    public void ApiValidation_RejectsInvalidDatesBeforeConfigurationNormalization(string value)
    {
        Assert.Contains("YearlyRewindStartDate", ConfigurationRequestValidator.Validate(new ConfigurationUpdateRequest { YearlyRewindStartDate = value })!);
        Assert.Contains("YearlyRewindEndDate", ConfigurationRequestValidator.Validate(new ConfigurationUpdateRequest { YearlyRewindEndDate = value })!);
        var config = new PluginConfiguration { YearlyRewindStartDate = value, YearlyRewindEndDate = value };
        Assert.Equal("12-15", config.YearlyRewindStartDate);
        Assert.Equal("01-15", config.YearlyRewindEndDate);
    }

}
