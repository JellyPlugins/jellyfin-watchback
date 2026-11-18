# Implementation plan: jellyfin-watchback

## Goal

Personal annual playback rewinds for Jellyfin, with continuous activity recording, immutable annual reports, eight languages, and automated tests.

## Implementation

1. [x] Create the solution with production and xUnit test projects, pinned .NET/Node versions, analyzers, and lockfiles.
2. [x] Configure the plugin ID, API, service registration, and `<DataPath>/jellyfin-watchback/` data directory.
3. [x] Observe playback events and import existing Jellyfin activity at startup and hourly.
4. [x] Atomically store per-user observations, metadata, and measured playback intervals.
5. [x] Implement annual aggregation, calendar windows, and publication that recovers after a restart.
6. [x] Provide an authenticated personal API and administrator settings with date validation.
7. [x] Integrate the rewind into Jellyfin's native navigation and keep settings visible without expanding a section.
8. [x] Load labels in eight languages based on the active Jellyfin user's display language.
9. [x] Display monthly bars, pie charts, viewing habits, streaks, and comparisons with the previous report.
10. [x] Provide a GitHub Pages demo with sample data.
11. [x] Set up backend, UI, browser, real Jellyfin E2E tests, and documentation checks.
12. [x] Configure PR, E2E, release, nightly, Pages, CodeQL, and Renovate workflows, plus CodeRabbit.

## Behavior and acceptance criteria

- Activity recording is always enabled; rewind display is disabled by default.
- The default display window is December 15 through January 15, including the end date.
- At 00:00 server time on the first day, generate one report per user for the preceding annual period and replace it the following year.
- After the display window ends, hide the tab and retain the report.
- Published reports remain unchanged.
- Keep measured and reconstructed playback distinguishable.
- Each user can access only their own report.
- Build, backend and UI tests, responsive browser checks, E2E tests, and workflow validation must pass.

## GitHub setup

Configure GitHub Apps, secrets, Pages, and branch rules for the repository. See [repository-setup.md](repository-setup.md) for the checklist.
