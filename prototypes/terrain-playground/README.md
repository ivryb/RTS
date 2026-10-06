# Terrain hub

Compare **Old terrain** with **New terrain** on the same Shifting Frontiers seed and player count. New terrain is now the main game's terrain, including the user-approved v10 grass and unit-scale treatment. The [approved checkpoint](../../art/workbench/renders/terrain-playground/reviews/2026-10-06-grass-units/checkpoint/manifest.json) preserves its source and assets. Extracting shared production presentation preserved all seven comparison views [pixel for pixel](../../art/workbench/renders/terrain-playground/reviews/2026-10-06-production-integration/approved-comparison.json). Old terrain remains here for comparison; the rejected ore galleries and props remain removed.

- [Old terrain](http://localhost:5173/prototypes/terrain-playground/?variant=old&players=4&seed=56204)
- [New terrain](http://localhost:5173/prototypes/terrain-playground/?variant=new&players=4&seed=56204)

Reuse the existing Vite server. This page is a visual study, not a live match. Its New terrain uses the same generation, models and material as production; only reference staging and inspection controls belong to the hub. Read the [terrain generation guide](../../docs/terrain_generation.md) for code ownership and production integration, and [COMPOSITE.md](COMPOSITE.md) for the terrain assets.

## Controls and checks

The default **In-game** camera reuses `MapCamera`: WASD or arrow keys move, middle-drag pans, and the wheel zooms from **0.60× to 3.00×**, starting at **1.00×**. Reset view returns to the first base. In New terrain, **Units in grass** frames a Behemoth, Ghostrunner, Hornet and Scout Drone among the existing grass at production scale and hover height. **Closer view** toggles a nearer view; the wheel retains the normal zoom range. **Buildings & units** hides the references for an unobstructed comparison. Old/New switching preserves focus and zoom. Choose **Free** for orbiting and detailed inspection (`?camera=inspect`); top-down inspection is available there.

`bun prototypes/terrain-playground/check-camera.mjs` checks real keyboard/mouse input, zoom limits, terrain switching and idle rendering with one temporary Playwright browser. It reuses the running Vite server and saves the three in-game zoom captures under `art/workbench/renders/terrain-playground/camera-checks/`.

Both versions support two, four and six players. Keep the seed, player count, camera and quality identical when comparing. Routes shows the central and alternate approaches. Clicking the ground probes a route from the first base. Walkability shows steep or blocked terrain. These diagnostics use the height-field probe rather than production Recast.

## Capturing a comparison

Use `bun run preview:capture:mountains --help` for the capture options. The command reuses Vite and owns one temporary headless browser, which closes at completion. It explicitly uses the Free perspective camera to preserve existing comparison framing, and captures overview, gameplay, close, low and opposite views at one fixed quality. Every run has a unique folder under `art/workbench/renders/terrain-playground/runs/`; images are saved at device resolution, with actual renderer dimensions recorded separately.

```sh
bun run preview:capture:mountains --variant both --seed 56204 --players 4 --quality high
bun run preview:capture:mountains --view '{"position":[-160,49,96],"target":[-130,22,61]}'
bun run preview:capture:mountains --baseline art/workbench/renders/terrain-playground/runs/<run>/manifest.json
```

`--view` also accepts a camera JSON file. Use the reported defect's seed, player count and view; the default cameras are sample coverage, not a reproduction of every report. `--baseline` reuses the saved cameras, quality and viewport and rejects conflicting settings. It captures the current source with those settings; it does not restore the earlier implementation. Old/New share initial lighting and exact camera coordinates.

Each manifest records capture hashes, source snapshots, asset hashes, browser/renderer diagnostics and an **unreviewed** verdict. Source snapshots preserve local edits, but binary hashes alone cannot recreate overwritten assets. Preserve the exact used binaries when promoting a user-approved checkpoint. Keep approved evidence separate from experimental runs; retain useful comparison evidence and remove disposable captures after validation.

Follow the [visual review contract](../../docs/terrain_generation.md#visual-review) before accepting a candidate. The [5 October recovery](../../art/workbench/renders/terrain-playground/baselines/approved-2026-10-05/README.md) holds original approved-scene evidence and recovered source, with explicit gaps that prevent calling it a complete runnable baseline.

`bun run preview:capture:terrain-hub` adds route plans, supported player counts and mobile/control checks. The older `capture-contact.mjs`, `capture-cliffs.mjs`, `capture-sediment.mjs` and `capture-summits.mjs` explicitly inspect **Old terrain** and overwrite exploratory files; they are not New-terrain acceptance evidence. Other map-family generators remain in source and regression tests, not as extra hub choices.

## Rendering and profiling

Balanced bounds render resolution. High uses up to 1.5× pixel ratio with the same models and textures. Static shadows refresh when the scene changes. Inspect both modes when investigating softness; use a fixed mode for material comparisons.

`terrainProfiler.inspect()` reports the renderer, projection, zoom and camera. Use Free camera mode for the saved inspection coordinates and profiling sweeps below. Save its `view` and restore it with `terrainProfiler.setView(view)`, using `{position:[x,y,z],target:[x,y,z]}`. `body.dataset.ready === 'true'` follows model and texture loading plus a completed render; New also reports `body.dataset.environmentAssets === 'ready'`. The CLI checks readiness, network idle and shader/browser errors before accepting capture completion.

`await terrainProfiler.run({frames:45})` performs a repeatable camera sweep with GPU timer queries and synchronous pixel readback. It measures render throughput, not displayed FPS. Options include `pixelRatio`, `vegetation`, `shadows`, `refreshShadows`, `flatTerrain`, and `view`. Use `pacing:'animation-frame'` only with normal foreground animation delivery. Run one profile at a time while conversion and tests are idle.

[PERFORMANCE.md](PERFORMANCE.md) preserves historical measurements and their limits. They are not performance guarantees for the current scene or a full match.
