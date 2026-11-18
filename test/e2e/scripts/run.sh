#!/usr/bin/env bash
# Build, stage and test the standalone plugin in real Jellyfin.
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
e2e_dir="$(cd "$script_dir/.." && pwd)"
repo_root="$(cd "$e2e_dir/../.." && pwd)"
cd "$repo_root"
plugin_version="$(sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' Directory.Build.props | head -1)"
if ! [[ "$plugin_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid Watchback plugin version" >&2
  exit 1
fi
runtime_dir="$e2e_dir/runtime"
keep=false
if [[ "${1:-}" == "--keep" ]]; then keep=true; fi
cleanup() { if [[ "$keep" == false ]]; then docker compose -f "$e2e_dir/compose.yml" down; fi; }
trap cleanup EXIT
# A warm run must stop the host before replacing its loaded plugin assembly.
docker compose -f "$e2e_dir/compose.yml" stop jellyfin
rm -rf -- "$runtime_dir/publish"
"${DOTNET:-dotnet}" publish Jellyfin.Plugin.Watchback -c Release -p:SyncDocs=true -o "$runtime_dir/publish"
plugin_dir="$runtime_dir/config/plugins/jellyfin-watchback_$plugin_version"
rm -rf -- "$plugin_dir"
mkdir -p "$plugin_dir" "$runtime_dir/cache" "$runtime_dir/media"
cp "$runtime_dir/publish/"* "$plugin_dir/"
python3 - "$plugin_dir" "$plugin_version" <<'META'
import json,sys,pathlib,shutil
p=pathlib.Path(sys.argv[1]);(p/'meta.json').write_text(json.dumps({'guid':'16f5f0be-353b-48c4-a5f1-d41d9b08b264','name':'jellyfin-watchback','version':sys.argv[2],'targetAbi':'12.4.0.0','status':'Active','autoUpdate':False,'assemblies':[]}))
# A disabled installation with retained data exercises optional detection without
# running another collector or downloading an external plugin during E2E tests.
fixture=p.parent/'playback-reporting-history-fixture_1.0.0.0'
fixture.mkdir(exist_ok=True)
# Jellyfin discovers only plugin folders containing an assembly. The disabled
# fixture never loads or executes this marker assembly.
shutil.copy2(p/'Jellyfin.Plugin.Watchback.dll',fixture/'marker.dll')
(fixture/'meta.json').write_text(json.dumps({'guid':'5c534381-91a3-43cb-907a-35aa02eb9d2c','name':'Playback Reporting history fixture','version':'1.0.0.0','targetAbi':'12.4.0.0','status':'Disabled','autoUpdate':False,'assemblies':[]}))
META
docker run --rm --entrypoint bash -v "$runtime_dir/media:/media" -v "$e2e_dir/fixtures:/fixtures:ro" jellyfin/jellyfin:12.4 /fixtures/gen-media.sh /media
docker compose -f "$e2e_dir/compose.yml" up -d --wait --wait-timeout 240
npm ci --ignore-scripts --no-audit --no-fund --prefix "$e2e_dir"
export JELLYFIN_URL="${JELLYFIN_URL:-http://localhost:${JELLYFIN_PORT:-8098}}"
export E2E_REQUIRE_NORMAL_USER=1
# Browser image version must match the pinned @playwright/test dependency.
docker run --rm --ipc host --network host -v "$repo_root:/work" -w /work -e CI -e JELLYFIN_URL -e E2E_REQUIRE_NORMAL_USER mcr.microsoft.com/playwright:v1.65.1-noble node test/e2e/node_modules/@playwright/test/cli.js test --config test/e2e/playwright.config.ts
docker run --rm --ipc host -v "$repo_root:/work" -w /work mcr.microsoft.com/playwright:v1.65.1-noble node test/e2e/node_modules/@playwright/test/cli.js test --config test/e2e/playwright.ui-fixtures.config.ts
