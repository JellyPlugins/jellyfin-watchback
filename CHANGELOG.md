# Changelog

## [1.0.1.0] - 2026-11-27

Corrections to the annual rewind and to how imported history is classified.

### Changed

- Frozen annual reports are served straight from storage, so an open rewind no longer depends on a live database round trip. A failed report lookup is handled instead of leaving the tab empty.

### Fixed

- The annual rewind follows the signed-in Jellyfin user's display language instead of falling back to English.
- Genre information toggles render as vector icons that scale with the surrounding text.
- The longest run of active days no longer lists music with zero days when a report contains no music. A single breakdown now spans the full width.
- Durations imported from Playback Reporting count as recorded data, so imported history is no longer labelled estimated.

## [1.0.0.0] - 2026-11-26

Initial release.

### Annual rewind

- Personal annual playback reports for films, episodes, series and music, integrated into Jellyfin's native Home tabs.
- Viewing hours, film and episode counts, series totals, active days, monthly activity, viewing times and weekday patterns.
- Listening hours, track and play counts, top five tracks by listening time and monthly listening charts. Music statistics appear when qualifying music activity is available.
- Film, series and music distribution, plus annual and monthly genre charts. Each assigned genre receives the title's full playback time, with an explanation of the resulting percentages.
- Combined video and music activity streaks, separate video and music streaks, and comparisons with the previous annual report when available.
- Configurable annual display period, defaulting to 15 December through 15 January inclusive. The rewind is disabled by default; activity collection runs independently.
- Annual reports use server-local calendar boundaries, are frozen at the start of the display period and are replaced by the following year's report. Hiding the tab retains the stored report; changing display settings does not rewrite an existing report.

### Activity history and imports

- Continuous per-user recording of video and music playback, with persistent measured activity and conservative reconstruction from available Jellyfin playback state.
- Optional initial import of retained Playback Reporting history, including repeated plays and recorded durations. A disabled Playback Reporting installation with retained data is supported; the source database is opened read-only.
- Separate, durable import completion markers and recording boundaries for video and music, with duplicate suppression and retries after import or persistence failures.
- Visible distinction between measured and reconstructed activity. Precise viewing patterns, active days and streaks use measured playback intervals.
- Atomic journal and report writes, recovery of pending annual publications after restart, isolation of individual user journal failures and cleanup of stored activity and reports for deleted users.

### Interface and access

- Responsive personal reports and administration settings, with accessible chart descriptions, genre explanations and date validation.
- English, German, French, Spanish, Portuguese, Chinese, Turkish and Swedish translations. Both interfaces follow the active Jellyfin user's display language, with English fallback.
- Authenticated, caller-bound report access with current library visibility checks and administrator-only settings. Disabling the rewind blocks report access while preserving the stored data.
- An interactive GitHub Pages demo using production browser assets and sample data, without requiring a Jellyfin server.

### Compatibility and validation

- Targets Jellyfin 12.4 and .NET 10.
- Backend unit and security tests, browser-module tests and 60 Playwright test cases across the real Jellyfin Docker suite and Chromium/WebKit fixtures, including documentation checks.
- GitHub automation for builds, tests, security analysis, dependency updates, demo deployment and release packages with checksums and a catalog metadata update PR.
