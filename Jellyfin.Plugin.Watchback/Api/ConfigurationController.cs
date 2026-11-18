using Jellyfin.Plugin.Watchback.Services.ConfigAccess;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Watchback.Api;

/// <summary>Administrative Watchback configuration.</summary>
[ApiController]
[Authorize(Policy = "RequiresElevation")]
[Route("Watchback/Configuration")]
public sealed class ConfigurationController : ControllerBase
{
    private readonly IPluginConfigurationService _configuration;

    /// <summary>Initializes a new instance of the <see cref="ConfigurationController"/> class.</summary>
    /// <param name="configuration">Configuration access.</param>
    public ConfigurationController(IPluginConfigurationService configuration) => _configuration = configuration;

    /// <summary>Gets the display settings.</summary>
    /// <returns>The current configuration.</returns>
    [HttpGet]
    public ActionResult GetConfiguration() => Ok(_configuration.GetConfiguration());

    /// <summary>Validates and saves a partial settings update.</summary>
    /// <param name="request">Unnormalized settings.</param>
    /// <returns>The saved settings or a validation error.</returns>
    [HttpPut]
    public ActionResult UpdateConfiguration(ConfigurationUpdateRequest request)
    {
        var error = ConfigurationRequestValidator.Validate(request);
        if (error is not null)
        {
            return BadRequest(new { Message = error });
        }

        _configuration.ReadAndMutate(config =>
        {
            if (request.YearlyRewindEnabled.HasValue)
            {
                config.YearlyRewindEnabled = request.YearlyRewindEnabled.Value;
            }

            if (request.YearlyRewindStartDate is not null)
            {
                config.YearlyRewindStartDate = request.YearlyRewindStartDate;
            }

            if (request.YearlyRewindEndDate is not null)
            {
                config.YearlyRewindEndDate = request.YearlyRewindEndDate;
            }

            if (request.Language is not null)
            {
                config.Language = request.Language;
            }
        });
        return Ok(_configuration.GetConfiguration());
    }
}
