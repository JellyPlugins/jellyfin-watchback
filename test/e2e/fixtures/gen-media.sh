#!/usr/bin/env bash
set -euo pipefail
media_root="${1:-/media}"
mkdir -p "$media_root/Movies/Watchback Fixture (2026)" "$media_root/Shows/Watchback Show/Season 01"
ffmpeg_path="$(command -v ffmpeg || echo /usr/lib/jellyfin-ffmpeg/ffmpeg)"
"$ffmpeg_path" -nostdin -loglevel error -y -f lavfi -i testsrc=size=160x90:rate=24:duration=1 -f lavfi -i sine=frequency=440:duration=1 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$media_root/Movies/Watchback Fixture (2026)/Watchback Fixture (2026).mp4"
cp "$media_root/Movies/Watchback Fixture (2026)/Watchback Fixture (2026).mp4" "$media_root/Shows/Watchback Show/Season 01/Watchback Show S01E01.mp4"
