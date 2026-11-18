using System;
using System.IO;
using System.Reflection;
using Jellyfin.Plugin.Watchback.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Watchback.Api;

/// <summary>Public resources required before Jellyfin establishes the browser session.</summary>
[ApiController]
[AllowAnonymous]
[Route("Watchback")]
public sealed class ClientController : ControllerBase
{
    /// <summary>Gets the standalone browser bundle.</summary>
    /// <returns>Lifecycle, tab registry and annual rewind scripts.</returns>
    [HttpGet("Client/script")]
    public ActionResult GetScript()
    {
        var buffer = new MemoryStream();
        foreach (var name in new[] { "ui-primitives.js", "client-lifecycle.js", "native-tabs.js", "yearly-rewind.js" })
        {
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream($"Jellyfin.Plugin.Watchback.js.{name}");
            if (stream is null)
            {
                buffer.Dispose();
                return NotFound();
            }

            stream.CopyTo(buffer);
            buffer.WriteByte((byte)'\n');
        }

        buffer.Position = 0;
        Response.Headers.CacheControl = "no-cache";
        return new FileStreamResult(buffer, "text/javascript");
    }

    /// <summary>Gets a public translation dictionary without user data.</summary>
    /// <param name="lang">Requested supported language.</param>
    /// <returns>Translated strings with English fallback.</returns>
    [HttpGet("Translations")]
    public ActionResult GetTranslations([FromQuery] string? lang = null)
    {
        if (lang is { Length: > 10 } || (lang is not null && Array.Exists(lang.ToCharArray(), value => !char.IsAsciiLetter(value) && value != '-')))
        {
            return BadRequest();
        }

        return Ok(I18NService.GetTranslations(lang ?? "en"));
    }
}
