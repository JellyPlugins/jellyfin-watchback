# E2E coverage

| Specification | Coverage |
| --- | --- |
| `playback-reporting.api.spec.ts` | Retained Playback Reporting installation metadata and real SQLite data; caller-bound one-time import, durable completion, read-only source, ignored later source changes and immutable reports |
| `configuration.api.spec.ts` | Plugin registration; administrator-only settings; rejected invalid dates; public translations |
| `yearly-rewind.api.spec.ts` | Caller-bound frozen report, retained data outside the season and when disabled, anonymous rejection, new measured playback with display disabled |
| `yearly-rewind-native-tab.ui.spec.ts` | Modern and desktop-legacy native Home tab; actual rendered metrics; tab removal after disabling |
| `yearly-rewind.fixture.spec.ts` | Localized personal charts, accessibility, narrow/wide layouts, measured-versus-estimated data |
| `demo.fixture.spec.ts` | Eight languages in Chromium/WebKit at 320/1440px; rewind-only demo with music totals, top 5 tracks, full-time genre counts with information toggles and inline month selectors, media mix, combined/video/music streaks and listening chart; separate settings fixture; always-visible settings, responsive dates and validation feedback |

The server suite runs against a real Jellyfin container; the fixture suite routes local production assets and does not require a server. Unit aggregation/scheduling tests complement E2E without modifying the real server clock.

`coverage-doc.api.spec.ts` guards this inventory against undocumented and removed specs.
