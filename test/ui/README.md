# UI tests

Vitest/jsdom executes the actual shipped browser modules through `src/loader.ts`; no production bundle is copied into the tests. Dependencies and Node version are pinned.

```sh
npm ci --ignore-scripts --prefix test/ui
npm run test:coverage --prefix test/ui
```

Coverage must reach 85% of lines and 80% of branches. `JFW_UI_NO_COVERAGE=1` is available for fast local behavioral runs; CI always uses the coverage command.

| Test file | Scope |
| --- | --- |
| `tests/yearly-rewind.test.ts` | Frozen reports, localization, charts, estimates, server identity, annual and auth races |
| `tests/native-tabs.test.ts` | Modern/legacy Home navigation, selection, duplicate loads, foreign tab coexistence |
| `tests/client-lifecycle.test.ts` | Authentication and navigation lifecycle, hook ownership and disposal |
| `tests/ui-primitives.test.ts` | Accessible panel animation, reversals, resizing and reduced motion |
| `tests/csproj-order.test.ts` | Compose order, demo bootstrap and fatal MSBuild test failures |
| `tests/settings.test.ts` | Partial updates, date feedback, visible controls, retries, Jellyfin user languages and edits during saves |

Settings and the personal page use separate dictionaries selected from the active Jellyfin client language. The API is stubbed in unit tests. Real authentication and access control belong to the [Docker E2E suite](../e2e/README.md).
