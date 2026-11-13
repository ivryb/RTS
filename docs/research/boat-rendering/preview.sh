#!/usr/bin/env bash
# Times the preview capture suite once per Chromium args set given as arguments.
cd "$(dirname "$0")/../../.."
bun run dev >/tmp/vite.log 2>&1 &
until curl -sf -o /dev/null http://localhost:5173; do sleep 1; done
node docs/research/boat-rendering/gl.mjs '[]'; node docs/research/boat-rendering/gl.mjs '["--use-angle=gl","--ignore-gpu-blocklist"]'
for args in "$@"; do
  start=$(date +%s)
  PREVIEW_ARGS="$args" bunx playwright test --config docs/research/boat-rendering/preview.config.ts --reporter=list 2>&1 | grep -E '✓|✘|passed|failed' | sed 's/^ *//' 
  echo "== args $args total $(( $(date +%s) - start )) s"
done
