using System;
using System.Security.Claims;

namespace Jellyfin.Plugin.Watchback.Api;

/// <summary>Resolves Jellyfin authentication claims.</summary>
internal static class CallerIdentity
{
    internal static Guid? GetCurrentUserId(ClaimsPrincipal? user)
    {
        var claim = user?.FindFirst("Jellyfin-UserId")
            ?? user?.FindFirst(ClaimTypes.NameIdentifier);
        if (claim != null && Guid.TryParse(claim.Value, out var parsedUserId))
        {
            return parsedUserId;
        }

        return null;
    }
}
