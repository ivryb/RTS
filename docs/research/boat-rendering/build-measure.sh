#!/usr/bin/env bash
# D77-11 build measurement on Boat: renderer, preview suite time, live-game frame rate, verify suite time.
# Usage: bash docs/research/boat-rendering/build-measure.sh <label> [bench query...]
set -u
label=$1; shift
out=art/workbench/d77-11/$label
mkdir -p "$out"
bun run dev >/tmp/vite.log 2>&1 &
until curl -sf -o /dev/null http://localhost:5173; do sleep 1; done
node tools/verify/doctor.mjs http://localhost:5173
echo "== preview renderer"
node --input-type=module -e '
import { chromium } from "@playwright/test";
const config = (await import(process.cwd() + "/tools/preview/playwright.config.ts")).default;
const browser = await chromium.launch(config.use.launchOptions);
const page = await browser.newPage();
await page.goto("http://localhost:5173/tools/preview/?scene=units&seed=77");
console.log(JSON.stringify(config.use.launchOptions?.args), await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  return gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL);
}));
await browser.close();' 2>&1 | grep -v Warning
echo "== preview suite"
start=$(date +%s)
bunx playwright test --config tools/preview/playwright.config.ts --reporter=list 2>&1 | grep -E '✓|✘|passed|failed' | sed 's/^ *//'
echo "== preview total $(( $(date +%s) - start )) s"
rm -rf "$out/previews"; cp -r art/workbench/renders/previews "$out/previews"
for query in "$@"; do
  for run in 1 2; do
    echo "== bench $query run $run"
    QUERY="$query" LABEL="$label-$run" node docs/research/boat-rendering/bench.mjs 2>&1 | tail -1 | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify({gpu:s.gpu,samples:s.samples,fps:s.fps,frameMs:s.frameMs,triangles:s.triangles,drawCalls:s.drawCalls,readyMs:s.startup.readyMs,cpu:s.cpuCoresByThread,errors:s.errors}))'
  done
done
for run in 1 2; do
  echo "== verify run $run $(date +%T)"
  start=$(date +%s)
  CAPTURE_LABEL="$label" bunx playwright test --config tools/verify/playwright.config.ts --reporter=list 2>&1 | grep -E '✓|✘|passed|failed|Error' | head -30
  echo "== verify run $run total $(( $(date +%s) - start )) s"
done
rm -rf "$out/building-models"; cp -r art/workbench/verify/building-models "$out/building-models"
for spec in hud select-and-move train-scout-drone construction; do rm -rf "$out/$spec"; cp -r "art/workbench/verify/$spec" "$out/$spec"; done
