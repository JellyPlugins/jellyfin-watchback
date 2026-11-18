using System;
using Jellyfin.Plugin.Watchback.Configuration;

namespace Jellyfin.Plugin.Watchback.Api;

/// <summary>Validates unnormalized input before changing persistent settings.</summary>
internal static class ConfigurationRequestValidator
{
    internal static string? Validate(ConfigurationUpdateRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.YearlyRewindStartDate is not null && !YearlyRewindSettings.IsValidDate(request.YearlyRewindStartDate))
        {
            return "YearlyRewindStartDate must be a valid MM-dd date; February 29 is not supported.";
        }

        if (request.YearlyRewindEndDate is not null && !YearlyRewindSettings.IsValidDate(request.YearlyRewindEndDate))
        {
            return "YearlyRewindEndDate must be a valid MM-dd date; February 29 is not supported.";
        }

        if (request.Language is not null && request.Language is not ("en" or "de" or "fr" or "es" or "pt" or "zh" or "tr" or "sv"))
        {
            return "Unsupported administration language.";
        }

        return null;
    }
}
