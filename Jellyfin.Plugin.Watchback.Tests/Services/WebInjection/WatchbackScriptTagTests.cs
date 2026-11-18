using Jellyfin.Plugin.Watchback.Services.WebInjection;
using Xunit;

namespace Jellyfin.Plugin.Watchback.Tests.Services.WebInjection;

/// <summary>
///     Tests for the script tag contract shared by the request-time injector and the legacy cleanup.
/// </summary>
public class WatchbackScriptTagTests
{
    [Fact]
    public void Build_EmitsTagWithPluginMarkerVersionAndDefer()
    {
        var tag = WatchbackScriptTag.Build("1.2.3");

        Assert.Contains("plugin=\"Jellyfin Watchback\"", tag, StringComparison.Ordinal);
        Assert.Contains("version=\"1.2.3\"", tag, StringComparison.Ordinal);
        Assert.Contains("src=\"../Watchback/Client/script?v=1.2.3\"", tag, StringComparison.Ordinal);
        Assert.EndsWith("defer></script>", tag, StringComparison.Ordinal);
    }

    [Fact]
    public void Build_EscapesTheVersionInAttributeAndQuery()
    {
        // The version ends up in an attribute and in a query string, so a value with
        // quotes, spaces or slashes must not be able to break the tag or the URL.
        var tag = WatchbackScriptTag.Build("1.0 beta/2\"x");

        Assert.DoesNotContain("1.0 beta/2\"x", tag, StringComparison.Ordinal);
        Assert.Contains("version=\"1.0%20beta%2F2%22x\"", tag, StringComparison.Ordinal);
        Assert.Contains("?v=1.0%20beta%2F2%22x", tag, StringComparison.Ordinal);
    }

    [Fact]
    public void Build_NullVersionProducesEmptyValues()
    {
        var tag = WatchbackScriptTag.Build(null!);

        Assert.Contains("version=\"\"", tag, StringComparison.Ordinal);
        Assert.Contains("?v=", tag, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("<script plugin=\"Jellyfin Watchback\" src=\"a\"></script>")]
    [InlineData("<script plugin='Jellyfin Watchback' src='a'></script>")]
    [InlineData("<script defer plugin=\"Jellyfin Watchback\" version=\"2\" src=\"a\"></script>")]
    public void RemovalRegex_MatchesOurTagInEveryAttributeOrderAndQuoteStyle(string html)
    {
        Assert.Matches(WatchbackScriptTag.RemovalRegex, html);
    }

    [Fact]
    public void RemovalRegex_ConsumesTheTrailingNewline()
    {
        var html = "before\n<script plugin=\"Jellyfin Watchback\" src=\"a\"></script>\nafter";

        var cleaned = WatchbackScriptTag.RemovalRegex.Replace(html, string.Empty);

        Assert.Equal("before\nafter", cleaned);
    }

    [Theory]
    [InlineData("<script plugin=\"Other Plugin\" src=\"a\"></script>")]
    [InlineData("<script src=\"../Watchback/Client/script\"></script>")]
    [InlineData("<script plugin=\"Jellyfin Watchback Extended\" src=\"a\"></script>")]
    public void RemovalRegex_LeavesForeignTagsAlone(string html)
    {
        Assert.DoesNotMatch(WatchbackScriptTag.RemovalRegex, html);
    }
}
