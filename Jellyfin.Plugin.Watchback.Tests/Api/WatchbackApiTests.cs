using System.Security.Claims;
using Jellyfin.Plugin.Watchback.Api;
using Jellyfin.Plugin.Watchback.Configuration;
using Jellyfin.Plugin.Watchback.Services;
using Jellyfin.Plugin.Watchback.Services.ConfigAccess;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using Xunit;

namespace Jellyfin.Plugin.Watchback.Tests.Api;

[Trait("Category", "Security")]
public sealed class WatchbackApiTests
{
    [Fact]
    public void Settings_UpdateMutatesOnlySpecifiedFields()
    {
        var config = new PluginConfiguration { Language = "de" };
        var service = new Mock<IPluginConfigurationService>();
        service.Setup(value => value.GetConfiguration()).Returns(config);
        service.Setup(value => value.ReadAndMutate(It.IsAny<Action<PluginConfiguration>>())).Callback<Action<PluginConfiguration>>(mutate => mutate(config));
        var controller = new ConfigurationController(service.Object);
        Assert.IsType<OkObjectResult>(controller.UpdateConfiguration(new ConfigurationUpdateRequest { YearlyRewindEnabled = true }));
        Assert.True(config.YearlyRewindEnabled);
        Assert.Equal("de", config.Language);
        Assert.Equal("12-15", config.YearlyRewindStartDate);
        Assert.IsType<OkObjectResult>(controller.GetConfiguration());
    }

    [Theory]
    [InlineData("02-29")]
    [InlineData("13-01")]
    [InlineData("")]
    public void Settings_InvalidUpdateNeverPersists(string date)
    {
        var service = new Mock<IPluginConfigurationService>();
        var controller = new ConfigurationController(service.Object);
        Assert.IsType<BadRequestObjectResult>(controller.UpdateConfiguration(new ConfigurationUpdateRequest { YearlyRewindEnabled = true, YearlyRewindStartDate = date }));
        service.Verify(value => value.ReadAndMutate(It.IsAny<Action<PluginConfiguration>>()), Times.Never);
    }

    [Fact]
    public void Settings_UnsupportedLanguageIsRejected()
    {
        Assert.NotNull(ConfigurationRequestValidator.Validate(new ConfigurationUpdateRequest { Language = "../../etc/passwd" }));
    }

    [Theory]
    [InlineData("en")]
    [InlineData("de")]
    [InlineData("fr")]
    [InlineData("es")]
    [InlineData("pt")]
    [InlineData("zh")]
    [InlineData("tr")]
    [InlineData("sv")]
    public void Translations_AllSupportedLanguagesContainRewindAndSettings(string language)
    {
        var dictionary = I18NService.GetTranslations(language);
        Assert.True(dictionary.ContainsKey("rewind.title"));
        Assert.True(dictionary.ContainsKey("rewind.settingsTitle"));
        Assert.True(dictionary.ContainsKey("saveSettings"));
        Assert.IsType<OkObjectResult>(new ClientController().GetTranslations(language));
    }

    [Theory]
    [InlineData("../../etc/passwd")]
    [InlineData("this-language-is-too-long")]
    public void Translations_UnsafeNamesAreRejected(string language)
    {
        Assert.IsType<BadRequestResult>(new ClientController().GetTranslations(language));
    }

    [Fact]
    public void BrowserBundle_ContainsOnlyIndependentWatchbackGlobals()
    {
        var controller = new ClientController { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        var result = Assert.IsType<FileStreamResult>(controller.GetScript());
        using var reader = new StreamReader(result.FileStream);
        var script = reader.ReadToEnd();
        Assert.Contains("window.WatchbackTabs", script, StringComparison.Ordinal);
        Assert.Contains("window.WatchbackRewind", script, StringComparison.Ordinal);
        Assert.DoesNotContain("JellyfinHelper", script, StringComparison.Ordinal);
        Assert.DoesNotContain("discovery-sidebar", script, StringComparison.Ordinal);
    }

    [Fact]
    public void Claims_FallbackIdentityAndInvalidIdentity()
    {
        var id = Guid.NewGuid();
        Assert.Equal(id, CallerIdentity.GetCurrentUserId(new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, id.ToString())]))));
        Assert.Null(CallerIdentity.GetCurrentUserId(new ClaimsPrincipal(new ClaimsIdentity([new Claim("Jellyfin-UserId", "invalid")]))));
        Assert.Null(CallerIdentity.GetCurrentUserId(null));
    }
}
