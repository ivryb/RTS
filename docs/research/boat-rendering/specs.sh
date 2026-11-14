#!/usr/bin/env bash
# Runs the verify specs once per mode given as arguments (base or fast), on one dev server.
cd "$(dirname "$0")/../../.."
bun run dev >/tmp/vite.log 2>&1 &
until curl -sf -o /dev/null http://localhost:5173; do sleep 1; done
node tools/verify/doctor.mjs http://localhost:5173
for mode in "$@"; do
  echo "== mode $mode $(date +%T)"
  start=$(date +%s)
  RENDER_TWEAKS=$mode bunx playwright test --config tools/verify/playwright.config.ts --reporter=list 2>&1 | grep -E '✓|✘|passed|failed|Error' | head -20
  echo "== mode $mode total $(( $(date +%s) - start )) s"
done
