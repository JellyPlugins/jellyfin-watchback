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

## Dependency scanning

The repository-wide OSV audit includes the UI test dependencies. `osv-scanner.toml` temporarily excludes only [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) in this directory, until 2026-12-18. As of 2026-11-18, picomatch 4.0.7 is the latest release and no patched version is available.

The advisory concerns excessive backtracking in attacker-supplied glob patterns. Here picomatch is a development dependency of Vitest/Vite and test discovery, using repository-controlled globs. These tools already execute repository-controlled JavaScript during PR tests, and their Node dependencies are not included in the plugin package. This exception does not apply to other advisories or lockfiles outside `test/ui`; scanning remains enabled.

Remove the exception and update the lockfile when a patched release becomes available. If no fix is available by the expiry date, reassess this usage before renewing it; the audit will fail again after expiry.
