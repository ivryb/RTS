#!/usr/bin/env bash
# Alternates the old tree and the new tree on one Boat machine. First write the patch that undoes
# the build: git diff 0522dc1 -- src tools prototypes package.json scripts > .agent/revert.patch
set -u
here=$PWD
echo "== image diffs, previews (SwiftShader before, llvmpipe after)"
python3 docs/research/boat-rendering/image-diff.py art/workbench/d77-11/before/previews art/workbench/d77-11/after/previews
echo "== image diffs, building-models (full render, both llvmpipe)"
python3 docs/research/boat-rendering/image-diff.py art/workbench/d77-11/before/building-models art/workbench/d77-11/after/building-models
rm -rf /tmp/before && rsync -a --exclude node_modules --exclude art --exclude .agent ./ /tmp/before/
ln -s "$here/node_modules" /tmp/before/node_modules
(cd /tmp/before && patch -s -R -p1 < "$here/.agent/revert.patch") || { echo patch failed; exit 1; }
grep -c "render" /tmp/before/tools/verify/helpers.ts
bun run dev --port 5173 >/tmp/vite-after.log 2>&1 &
(cd /tmp/before && bun run dev --port 5174 >/tmp/vite-before.log 2>&1 &)
until curl -sf -o /dev/null http://localhost:5173 && curl -sf -o /dev/null http://localhost:5174; do sleep 1; done
node tools/verify/doctor.mjs http://localhost:5173; node tools/verify/doctor.mjs http://localhost:5174
for round in 1 2 3; do
  for side in before after; do
    if [ $side = before ]; then dir=/tmp/before port=5174; else dir=$here port=5173; fi
    start=$(date +%s)
    (cd $dir && VERIFY_BASE_URL=http://localhost:$port bunx playwright test --config tools/verify/playwright.config.ts --reporter=list \
      --grep-invert "buildings look the same|inside a scaffold|Turret site" 2>&1 | grep -E '✓|✘|passed|failed' | sed 's/^ *//')
    echo "== round $round $side light-eligible specs $(( $(date +%s) - start )) s"
    VERIFY_BASE_URL=http://localhost:$port QUERY="seed=77&verify=1" LABEL="alt-$side-$round" node docs/research/boat-rendering/bench.mjs 2>&1 | tail -1 \
      | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log("== round", process.argv[1], "full fps", s.fps, "triangles", s.triangles)' "$round $side"
  done
done
