# Contributing

Use the SDK pinned in `global.json` and Node from `.nvmrc`. Production code, xUnit tests, shipped browser modules, Vitest and Playwright are organized separately.

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

The demo loads the production CSS, translations and browser scripts with an in-memory API adapter. Demo tests route a local HTTPS origin to these files; no external Jellyfin server is needed.

## Review and release

Keep raw observations separate from annual derived reports. Preserve UTC journal timestamps, server-local annual boundaries, frozen snapshots, private caller identity, estimated-data labels and atomic writes. A bad user journal must not prevent recording other users.

Use `scripts/bump-version.ps1` to update version metadata, and `scripts/collect-release-notes.ps1` to collect release notes. Do not add local startup state, auth fixtures, generated assets, build outputs or IDE settings. External GitHub setup is documented in [docs/repository-setup.md](docs/repository-setup.md).

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
- `Services/YearlyRewind/YearlyRewindWindow.cs`
- `js/client-lifecycle.js`
- `js/native-tabs.js`
- `js/yearly-rewind.js`

### Jellyfin.Plugin.Watchback.Tests

- `Api/WatchbackApiTests.cs`
- `Configuration/YearlyRewindConfigurationTests.cs`
- `ContributingDocCoverageTests.cs`
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
