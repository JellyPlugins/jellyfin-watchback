# Contributing

Use the SDK pinned in `global.json` and Node from `.nvmrc`. Production code, xUnit tests, shipped browser modules, Vitest and Playwright are organized separately.

Write code identifiers, comments, documentation, and test descriptions in English. Keep localized text in translation dictionaries; non-English test data is appropriate for localization and Unicode tests.

## Structure

```text
Jellyfin.Plugin.Watchback.sln
Jellyfin.Plugin.Watchback/          Plugin, API, activity collector and annual reports
  Configuration/                  Display settings and annual date validation
  Services/Activity/              Playback journal, baseline and read-only legacy import
  Services/YearlyRewind/           Aggregation, immutable reports and publication
  Services/WebInjection/          Read-only web-shell response transformation
  PluginPages/                   Composed administration page, CSS and JS modules
  js/                            Personal page, native tabs and client lifecycle
  i18n/                          Eight embedded translation dictionaries
Jellyfin.Plugin.Watchback.Tests/   xUnit tests
test/ui/                        Vitest against the shipped browser source
test/e2e/                       Playwright and a real Jellyfin Docker stack
docs/                           GitHub Pages demo and project documentation
.github/                         Pinned CI actions, release jobs and dependency bots
```

## Build and backend tests

```sh
dotnet restore --locked-mode
dotnet build -c Release --no-restore
dotnet test -c Release -p:RunVitest=false --collect:"XPlat Code Coverage"
```

A normal `dotnet test` also runs the UI coverage suite when its dependencies are installed. CI runs Vitest in a dedicated job. Backend categories `Unit` and `Security` are independently reported to Codecov; authorization tests have the `Security` trait.

The plugin compiles against `Microsoft.Data.Sqlite.Core` but excludes its runtime assets,
using Jellyfin's initialized SQLite provider. Keep the plugin and test SQLite packages
on the host's compatible major version (Jellyfin 12.4 ships 10.0.14). Review the SQLite
`allowedVersions` rule in `.github/renovate.json5` when upgrading Jellyfin, and verify
with the real-server E2E suite: unit tests supply their own SQLite runtime and cannot
establish host compatibility.

## Browser code and UI tests

```sh
npm ci --ignore-scripts --prefix test/ui
npm run test:coverage --prefix test/ui
```

Tests execute the actual classic browser scripts. The coverage gate remains **85% lines and 80% branches**. The loader instruments every shipped module used by the suite; guard-only duplicate-load coverage is excluded explicitly. See [test/ui/README.md](test/ui/README.md).

The administration HTML is generated at build time from `configPage.template.html` and ordered modules. Edit those sources, never the generated `configPage.html`. The personal page scripts are embedded separately and served at `/Watchback/Client/script`.

## E2E and demo

```sh
bash test/e2e/scripts/run.sh
```

This builds the plugin, creates tiny real video files, starts Jellyfin on loopback port 8098, provisions administrator and normal users, and runs both real-server and offline Chromium/WebKit tests. It requires Docker, Compose, Python, Node and the .NET SDK. Use `--keep` to retain the isolated test server. See [test/e2e/README.md](test/e2e/README.md).

```sh
dotnet build -p:SyncDocs=true
python3 -m http.server 8080 --directory docs
```

The real-server suite also stages disabled Playback Reporting installation metadata and seeds its SQLite schema to verify historical imports without a second active collector.

The demo loads the production CSS, translations and browser scripts with an in-memory API adapter. Demo tests route a local HTTPS origin to these files; no external Jellyfin server is needed.

## Review and release

Keep raw observations separate from annual derived reports. Preserve UTC journal timestamps, server-local annual boundaries, frozen snapshots, private caller identity, estimated-data labels and atomic writes. A bad user journal must not prevent recording other users.

Use `scripts/bump-version.ps1` to update version metadata, and `scripts/collect-release-notes.ps1` to collect release notes. Do not add local startup state, auth fixtures, generated assets, build outputs or IDE settings.

## GitHub repository setup

The workflows and bot configurations are included, but the following GitHub settings cannot be transferred by copying files. No secrets are stored in this repository.

| Service | Required setup |
| --- | --- |
| GitHub Actions | Enable Actions. Permit workflow-generated pull requests and the scoped `contents`/`pull-requests` permissions used by the badge, preview and release jobs. |
| Pages | Configure deployment from branch `gh-pages`, root directory. The existing Pages workflow and PR preview publisher both publish there. |
| CodeRabbit | Install/authorize the CodeRabbit GitHub App for `JellyPlugins/jellyfin-watchback`; `.coderabbit.yaml` defines its review behavior. |
| Renovate | Use the included self-hosted workflow with `RENOVATE_APP_CLIENT_ID` (or `RENOVATE_APP_ID`) and `RENOVATE_APP_PRIVATE_KEY`, or a `RENOVATE_TOKEN` with access to this repository. Do not run a second bot instance against the same repository. |
| Docker Hub | Optional `DOCKER_HUB_USERNAME` and `DOCKER_HUB_PASSWORD` for Renovate registry lookups. |
| Codecov | Add the repository to Codecov and configure `CODECOV_TOKEN`. Backend, frontend and E2E analytics keep separate flags. |
| SonarCloud | Create project `JellyPlugins_jellyfin-watchback` in organization `jellyplugins`; configure `SONAR_TOKEN`. The analysis step skips when no token is present. |
| CodeQL | Enable code scanning if required by the organization's GitHub plan; the included workflow analyzes C#. |
| Branch protection | Select the new repository's actual PR check names after its first run. No protection rules were copied or changed automatically. |

The release workflow includes security checks, release-note collection, a metadata/checksum update PR, and pinned action revisions. The initial development manifest has empty download/checksum/timestamp fields until the first publication.

The local verification of workflow files cannot prove that external apps, tokens, organization policies, Codecov or SonarCloud have been configured. The first pushed PR must run these jobs in GitHub before enabling required checks.

## Source and test inventory

The documentation drift guard checks that each production and test source file is listed here. Generated files and build outputs are excluded.

### Jellyfin.Plugin.Watchback

- `Api/CallerIdentity.cs`
- `Api/ClientController.cs`
- `Api/ConfigurationController.cs`
- `Api/ConfigurationRequestValidator.cs`
- `Api/ConfigurationUpdateRequest.cs`
- `Api/UserYearlyRewindController.cs`
- `BuildTasks/ComposeConfigPage.cs`
- `Configuration/PluginConfiguration.cs`
- `Configuration/YearlyRewindSettings.cs`
- `Plugin.cs`
- `PluginPages/configPage.template.html`
- `PluginPages/css/Settings.css`
- `PluginPages/css/Shared.css`
- `PluginPages/js/Main.js`
- `PluginPages/js/Settings.js`
- `PluginPages/js/Shared.js`
- `PluginPages/js/UiPrimitives.js`
- `PluginServiceRegistrator.cs`
- `Services/Activity/IUserActivityCacheService.cs`
- `Services/Activity/IUserActivityHistoryConsumer.cs`
- `Services/Activity/IUserActivityHistoryRecorder.cs`
- `Services/Activity/IUserActivityInsightsService.cs`
- `Services/Activity/ImportedPlayback.cs`
- `Services/Activity/PlaybackReportingReader.cs`
- `Services/Activity/LegacyDataImportService.cs`
- `Services/Activity/UserActivityCacheService.cs`
- `Services/Activity/UserActivityCoverage.cs`
- `Services/Activity/UserActivityHistory.cs`
- `Services/Activity/UserActivityHistoryService.cs`
- `Services/Activity/UserActivityHistoryStore.cs`
- `Services/Activity/UserActivityInsightsService.cs`
- `Services/Activity/UserActivityResult.cs`
- `Services/Activity/UserActivitySummary.cs`
- `Services/Activity/UserItemActivity.cs`
- `Services/Activity/UserPlaybackInterval.cs`
- `Services/Activity/UserPlaybackItem.cs`
- `Services/Activity/UserPlaybackObservation.cs`
- `Services/Activity/UserPlaybackSession.cs`
- `Services/Activity/UserPlaybackTracker.cs`
- `Services/Common/AtomicFile.cs`
- `Services/Common/BatchFallbackHelper.cs`
- `Services/Common/ExceptionExtensions.cs`
- `Services/Common/LimitedStream.cs`
- `Services/Common/ResponseTooLargeException.cs`
- `Services/ConfigAccess/IPluginConfigurationService.cs`
- `Services/ConfigAccess/PluginConfigurationService.cs`
- `Services/DateTimeNormalization.cs`
- `Services/I18nService.cs`
- `Services/JsonDefaults.cs`
- `Services/PluginLog/IPluginLogService.cs`
- `Services/PluginLog/PluginLogEntry.cs`
- `Services/PluginLog/PluginLogService.cs`
- `Services/VirtualItemDetector.cs`
- `Services/WebInjection/IndexHtmlTransformer.cs`
- `Services/WebInjection/ScriptInjectionStartupFilter.cs`
- `Services/WebInjection/WatchbackScriptTag.cs`
- `Services/YearlyRewind/YearlyRewindAggregator.cs`
- `Services/YearlyRewind/YearlyRewindComparison.cs`
- `Services/YearlyRewind/YearlyRewindGenre.cs`
- `Services/YearlyRewind/YearlyRewindInsights.cs`
- `Services/YearlyRewind/YearlyRewindItem.cs`
- `Services/YearlyRewind/YearlyRewindMonth.cs`
- `Services/YearlyRewind/YearlyRewindPendingStore.cs`
- `Services/YearlyRewind/YearlyRewindService.cs`
- `Services/YearlyRewind/YearlyRewindSnapshot.cs`
- `Services/YearlyRewind/YearlyRewindStore.cs`
- `Services/YearlyRewind/YearlyRewindStreak.cs`
- `Services/YearlyRewind/YearlyRewindWindow.cs`
- `js/client-lifecycle.js`
- `js/native-tabs.js`
- `js/yearly-rewind.js`

### Jellyfin.Plugin.Watchback.Tests

- `Api/WatchbackApiTests.cs`
- `Configuration/YearlyRewindConfigurationTests.cs`
- `ContributingDocCoverageTests.cs`
- `Services/Activity/PlaybackReportingImportTests.cs`
- `Services/Activity/LegacyDataImportTests.cs`
- `Services/Activity/UserActivityCacheServiceTests.cs`
- `Services/Activity/UserActivityDtoTests.cs`
- `Services/Activity/UserActivityHistoryTests.cs`
- `Services/Activity/UserActivityInsightsServiceTests.cs`
- `Services/Common/AtomicFileTests.cs`
- `Services/Common/BatchFallbackHelperTests.cs`
- `Services/Common/ExceptionExtensionsTests.cs`
- `Services/Common/LimitedStreamTests.cs`
- `Services/ConfigAccess/PluginConfigurationServiceTests.cs`
- `Services/DateTimeNormalizationTests.cs`
- `Services/PluginLog/PluginLogEntryTests.cs`
- `Services/PluginLog/PluginLogServiceTests.cs`
- `Services/VirtualItemDetectorTests.cs`
- `Services/WebInjection/IndexHtmlTransformerTests.cs`
- `Services/WebInjection/ScriptInjectionStaticFileTests.cs`
- `Services/WebInjection/WatchbackScriptTagTests.cs`
- `Services/YearlyRewind/YearlyRewindInsightTests.cs`
- `Services/YearlyRewind/YearlyRewindPlaybackTests.cs`
- `Services/YearlyRewind/YearlyRewindServiceTests.cs`
- `Services/YearlyRewind/YearlyRewindStoreTests.cs`
- `Services/YearlyRewind/YearlyRewindWindowTests.cs`
- `TestFixtures/TestMockFactory.cs`
