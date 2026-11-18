# End-to-end tests

`bash test/e2e/scripts/run.sh` builds Watchback, generates two tiny video files using the Jellyfin image's ffmpeg, starts real Jellyfin 12.4 on `127.0.0.1:8098`, provisions two users, and runs Playwright.

Requirements: the pinned .NET SDK and Node version, Docker with Compose, and Python 3. The Playwright Docker image is pinned to the same version as `@playwright/test`. `JELLYFIN_PORT` changes the host port; `DOTNET` selects an explicit SDK executable. The runner cleans up the container unless `--keep` is supplied. Runtime config, media, auth tokens and reports are ignored by Git.

```sh
bash test/e2e/scripts/run.sh --keep
docker compose -f test/e2e/compose.yml down
```

Offline fixtures can run independently after syncing the production demo assets:

```sh
dotnet build -p:SyncDocs=true
npm ci --ignore-scripts --prefix test/e2e
npx --prefix test/e2e playwright install chromium webkit
npm run test:fixtures --prefix test/e2e
```

For Docker-based browsers, use the same `docker run` commands in `scripts/run.sh`. Re-running against a warm test server must create and verify new playback intervals, rather than passing because old journal data exists.

The global setup fails if the non-admin user cannot be provisioned or the Watchback plugin is not Active. [COVERAGE.md](COVERAGE.md) lists the covered behaviors.
