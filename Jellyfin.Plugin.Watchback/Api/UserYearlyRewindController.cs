using System;
using System.Net.Mime;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.Watchback.Services.Common;
using Jellyfin.Plugin.Watchback.Services.ConfigAccess;
using Jellyfin.Plugin.Watchback.Services.YearlyRewind;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Watchback.Api;

/// <summary>Provides the caller's single stored rewind; display visibility does not delete or restrict it.</summary>
[ApiController]
[Authorize]
[Route("Watchback/YearlyRewind/My")]
[Produces(MediaTypeNames.Application.Json)]
public sealed class UserYearlyRewindController : ControllerBase
{
    private readonly YearlyRewindService _rewind;
    private readonly IPluginConfigurationService _configuration;
    private readonly IUserManager _users;
    private readonly TimeProvider _clock;
    private readonly ILogger<UserYearlyRewindController> _logger;

    /// <summary>Initializes a new instance of the <see cref="UserYearlyRewindController"/> class.</summary>
    /// <param name="rewind">Persistent rewind service.</param>
    /// <param name="configuration">Feature configuration.</param>
    /// <param name="users">User directory.</param>
    /// <param name="clock">Server clock.</param>
    /// <param name="logger">Diagnostic logger.</param>
    public UserYearlyRewindController(
        YearlyRewindService rewind,
        IPluginConfigurationService configuration,
        IUserManager users,
        TimeProvider clock,
        ILogger<UserYearlyRewindController> logger)
    {
        _rewind = rewind;
        _configuration = configuration;
        _users = users;
        _clock = clock;
        _logger = logger;
    }

    /// <summary>Gets seasonal UI visibility without opening or inspecting a report.</summary>
    /// <returns>The current status for the authenticated user.</returns>
    [HttpGet("Status")]
    public ActionResult GetStatus()
    {
        Response.Headers.CacheControl = "private, no-store";
        var userId = CurrentUser();
        if (!userId.HasValue)
        {
            return Unauthorized();
        }

        var now = _clock.GetUtcNow();
        var config = _configuration.IsInitialized ? _configuration.GetConfiguration() : null;
        var enabled = config?.YearlyRewindEnabled == true;
        var visible = enabled && YearlyRewindWindow.IsTabVisible(now, config!.YearlyRewindStartDate, config.YearlyRewindEndDate, TimeZoneInfo.Local);
        // Discovery depends only on configuration and the calendar, never on report contents.
        return Ok(new
        {
            Enabled = enabled,
            TabVisible = visible,
            ServerTimeUtc = now,
            TimeZoneId = YearlyRewindWindow.ClientTimeZoneId(TimeZoneInfo.Local),
            NextCheckAtUtc = enabled
                ? YearlyRewindWindow.NextVisibilityChange(now, config!.YearlyRewindStartDate, config.YearlyRewindEndDate, TimeZoneInfo.Local)
                : (DateTimeOffset?)null
        });
    }

    /// <summary>Gets the existing report, including outside the seasonal UI window.</summary>
    /// <returns>The caller’s stored report or the corresponding access/error result.</returns>
    [HttpGet]
    public ActionResult GetMyRewind()
    {
        Response.Headers.CacheControl = "private, no-store";
        var userId = CurrentUser();
        if (!userId.HasValue)
        {
            return Unauthorized();
        }

        if (!_configuration.IsInitialized || !_configuration.GetConfiguration().YearlyRewindEnabled)
        {
            return Forbid();
        }

        try
        {
            var report = _rewind.OpenReport(userId.Value);
            if (report is null)
            {
                return NotFound();
            }

            // Stream the published JSON unchanged. All report computation and validation
            // belongs to publication; current library state cannot change a frozen rewind.
            return new FileStreamResult(report, MediaTypeNames.Application.Json);
        }
        catch (Exception ex) when (!ex.IsFatal())
        {
            _logger.LogWarning(ex, "Could not read YearlyRewind for user {UserId}.", userId.Value);
            return StatusCode(StatusCodes.Status503ServiceUnavailable);
        }
    }

    private Guid? CurrentUser()
    {
        var id = CallerIdentity.GetCurrentUserId(User);
        if (id is null || id == Guid.Empty)
        {
            return null;
        }

        var user = _users.GetUserById(id.Value);
        return user is not null && !user.HasPermission(PermissionKind.IsDisabled) ? id : null;
    }
}
