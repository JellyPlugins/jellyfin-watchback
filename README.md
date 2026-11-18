# jellyfin-watchback

[![Build and tests](https://github.com/JellyPlugins/jellyfin-watchback/actions/workflows/pr.yml/badge.svg)](https://github.com/JellyPlugins/jellyfin-watchback/actions/workflows/pr.yml)
[![E2E](https://img.shields.io/badge/e2e%20tests-10-blue)](test/e2e/COVERAGE.md)
[![Jellyfin](https://img.shields.io/badge/Jellyfin-12.4-blueviolet)](https://jellyfin.org/)

Your personal annual Jellyfin playback rewind.

## Features

- Viewing hours, films, episodes, series and active days.
- Monthly viewing chart, film/episode and genre pie charts, with monthly genre selection.
- Viewing times, weekdays, longest active-day streak and comparison with the previous report.
- Eight languages: English, German, French, Spanish, Portuguese, Chinese, Turkish and Swedish. Both the personal page and administration settings follow the active Jellyfin user’s display language, with English fallback for unsupported languages.
- Authenticated personal reports and administrator-only settings.

Activity is recorded whenever the plugin runs, independently of whether the annual page is enabled. The page is **disabled by default**. Available Jellyfin state can reconstruct a known playback per title; old session history, exact viewing times and repeated plays cannot be recovered from lifetime totals. Estimates remain visibly separate from measured playback.

Enable **Yearly Rewind** in the plugin settings and choose its annual display period (default **15 December–15 January**, inclusive). At 00:00 server time on the first day, the preceding annual period is frozen into one report per user. The report is replaced the next year. Hiding the tab after the configured end date keeps the report on disk. Changing the display settings never finalizes or rewrites an existing annual report.

The current collector covers video playback. Music and books are not included.

## Optional Playback Reporting history

Watchback checks for retained Playback Reporting history once for each available user, when it first starts collecting that user's activity. When Playback Reporting is installed, its existing `playback_reporting.db` supplies the initial historical data. A disabled installation with retained data also works. No additional switch, API key, or Playback Reporting dependency is required for normal Watchback operation.

Historical films and episodes are imported into each user's existing Watchback journal, including repeated plays and recorded durations. The boundary is the start of Watchback's own recording for that user and survives restarts; later Playback Reporting entries are excluded. The imported data and completion marker are saved together. After completion, Watchback records activity itself and never reimports or updates that user's history from Playback Reporting, including after restarts or before annual reports. Matching Jellyfin baseline estimates are suppressed to avoid counting a playback twice. Known media metadata is enriched from the current library; deleted titles can retain their recorded names and durations without inventing missing genres or series information.

Playback Reporting stores a session start and total duration, not individual pause intervals. Historical time is assigned to the start month, conservatively capped at Watchback's collection boundary and the report cutoff, and displayed as reconstructed activity. It contributes to totals, charts, and play counts; precise viewing patterns, active days, and streaks still use Watchback's measured intervals only. Offset-free timestamps use the server's current time zone, so past server time-zone changes cannot be recovered exactly.

The source database is opened read-only. Invalid rows and unknown or disabled users are ignored. Failed initial imports or journal saves are retried after one minute without stopping Watchback's collector; relevant new reports wait for the initial import to complete, while existing reports remain available and unchanged. A confirmed missing plugin or database completes the initial check with no imported rows; installing Playback Reporting afterward does not trigger another import for that user. Newly available users receive their own initial check. Existing journals without a completion marker receive one final initial import using their original recording boundary. Only history still retained by Playback Reporting can be imported, and importing later never rewrites a frozen annual report.


## Installation and demo

This repository starts with an unreleased `1.0.0.0` development version. Build from source until the first release is published. Release automation fills the catalog download URL, timestamp and checksum; the development manifest is not yet an installable catalog entry.

```sh
dotnet publish Jellyfin.Plugin.Watchback -c Release -o publish
```

Copy the publish output into its own folder under Jellyfin's `plugins` directory and restart Jellyfin. Open **Dashboard → Plugins → jellyfin-watchback** to configure it. The plugin injects its own lightweight web client script without editing Jellyfin's web files. The personal tab appears during the configured period.

The [GitHub Pages demo](https://jellyplugins.github.io/jellyfin-watchback/) is deployed by the Pages workflow once this repository has been pushed and Pages has been enabled. Its sample data deliberately shows the 2026 rewind throughout the year. The demo follows the browser's preferred supported language and falls back to English. Use `?lang=en` (or another supported language code) to override it.

## Data storage

Watchback owns `<Jellyfin DataPath>/jellyfin-watchback/`:

```text
activity-history/<user-id>.json       Measured playback, observed state and imported history
yearly-rewind/reports/<user-id>.json  One frozen report per user
yearly-rewind/pending/<user-id>.json  Crash-safe pending annual publication
jellyfin-watchback-useractivity-latest.json  Latest Jellyfin baseline
```

Settings use Jellyfin's normal per-plugin XML configuration. Deleting a Jellyfin user removes that user's Watchback journal and reports.

See [CONTRIBUTING.md](CONTRIBUTING.md) for builds and tests, [implementation-plan.md](docs/implementation-plan.md) for the implementation checklist, and [repository-setup.md](docs/repository-setup.md) for GitHub repository setup.

## License

[GPL-3.0](LICENSE).
