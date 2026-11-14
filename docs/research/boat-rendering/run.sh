#!/usr/bin/env bash
# Starts the dev server once, then runs each benchmark line given on stdin as "LABEL ENV=... ENV=...".
cd "$(dirname "$0")/../../.."
bun run dev >/tmp/vite.log 2>&1 &
until curl -sf -o /dev/null http://localhost:5173; do sleep 1; done
node tools/verify/doctor.mjs http://localhost:5173 >/dev/null || { echo doctor failed; tail /tmp/vite.log; }
while read -r label rest; do
  [[ -z "$label" || "$label" == \#* ]] && continue
  echo "== $label $(uptime | sed 's/.*load/load/')"
  env LABEL="$label" $rest node docs/research/boat-rendering/bench.mjs 2>&1 | tail -3
done
