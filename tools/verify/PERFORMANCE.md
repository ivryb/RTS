# Combat performance check

With the existing `bun run dev` server running:

```sh
node tools/verify/profile-combat.mjs combat
PROFILE_CPU=1 node tools/verify/profile-combat.mjs combat-cpu
```

The script opens a fresh headless Chromium, selects the three starting Ghostrunners
in seed 77 through mouse input, and sends them into the enemy defenses. It records
an idle interval plus ten seconds of approach/combat, verifies that damage occurred,
and closes its browser. It launches Chromium with the shared args in `tools/chromium.ts`,
which select Metal on macOS and Mesa's llvmpipe on Boat, and it always renders at full
quality. `VERIFY_BASE_URL` can select another existing server.

Reports, screenshots, and optional DevTools CPU profiles are written under
`art/workbench/performance/`. The JSON summary includes the GPU, frame intervals,
long tasks, shader compilation/linking calls, shader-program waits, and buffer
uploads. Use the same viewport, machine, and profiling setting for comparisons;
run without other benchmarks or tests to reduce interference. CPU sampling adds
overhead, so use it for attribution rather than headline frame timings.

The first-combat regression came from muzzle flashes changing the number of point
lights in Three.js shader variants. Startup now compiles and draws all nine supported
flash-light counts (zero through eight), including effect and death-fade materials.
Inactive flash lights are hidden, so they do not add per-pixel lighting work during
play. Eight flashes may illuminate surfaces simultaneously; all projectiles and
flash sprites still render. Preparing these variants costs startup time and shader
memory instead of interrupting combat. Prepared pooled effects regain their normal
frustum culling after warmup.

Artillery buffers upload only active or changed portions; empty particle systems
and unused scorch slots have zero draw ranges. Regression tests cover simultaneous
shots beyond the lighting budget, light reuse, and uploads stopping after effects
expire. This benchmark covers the current opening encounter, not a large-army FPS
or multiplayer capacity guarantee.

## Local findings (2026-09-27)

Seed 77, 1440 × 900, Chromium/ANGLE Metal on Apple M2; no CPU sampling:

| Metric | Original code | Always-visible eight-light pool | Prewarmed light counts |
| --- | ---: | ---: | ---: |
| Median frame interval | 16.7 ms | 16.7 ms | 16.7 ms |
| 95th-percentile frame interval | 17.7 ms | 33.4 ms | 17.6 ms |
| Longest frame | 1,100 ms | 50.1 ms | 17.7 ms |
| New shader programs during capture | 38 | 0 | 0 |
| Main-thread tasks over 50 ms | 4 | 0 | 0 |
| Buffer uploads per captured frame | 10.2 | 2.2 | 2.3 |

These are individual local captures, not hardware-independent thresholds. The final
approach was measured twice: p95 was 17.4–17.6 ms and the longest frame was
17.7–17.8 ms. Total navigation-to-ready time was 2.52 seconds in the confirming run;
this includes loading and is not a measurement of added shader-preparation time.
The user explicitly preferred startup work over ongoing realtime cost.

The original source was served from an ignored snapshot through Playwright request
routing, using the same dev server. Raw captures are `comparison-original.json`,
`ready-optimized.json`, `light-variants.json`, and `light-variants-confirmed.json` in
the output directory. The profiler now waits for the read-only `ready()` hook so
loading work is measured separately from the playable encounter.

Validation: production build passed; all 144 tests passed with
`bun run test --timeout 20000` (the longer timeout accommodates terrain-heavy
simulation tests). Browser checks cover selection/movement, Scout training, the
unit preview, and artillery effects. The 400-unit local Worker prototype benchmark
also ran after fixing its missing spawn-factory return; simulation ticks had a
6.145 ms 95th percentile in that run.
