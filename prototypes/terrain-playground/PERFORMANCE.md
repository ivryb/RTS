# Titanium landscape performance pass

Historical measurements. The hub now compares Old terrain and New terrain; rejected ore studies and their controls have been removed. These records describe the exact scenes listed below, not the current ore-free scene or a full match.

Measured on 2026-10-05 on a MacBook Air M2, 16 GB, using ANGLE Metal on the Apple M2 GPU. The existing Vite server and native T3 preview rendered the actual terrain hub. Asset conversion and tests were idle during final measurements.

| Scene / setting | Render buffer | GPU mean | GPU p95 | CPU + GPU readback mean | Submitted triangles |
| --- | --- | ---: | ---: | ---: | ---: |
| Original 4-player landscape | 1920 × 1200 | 53.50 ms | 53.92 ms | 55.90 ms | 33.94 M |
| Updated 4-player, High | 1920 × 1200 | 15.74 ms | 16.24 ms | 17.68 ms | 3.88 M |
| Updated 4-player, Balanced | 1280 × 800 | 10.92 ms | 11.77 ms | 12.70 ms | 3.88 M |
| Updated 6-player landscape, Balanced | 1600 × 900 | 11.59 ms | 16.07 ms | 13.23 ms | 3.05 M |
| Updated 6-player full overview, Balanced | 1600 × 900 | 10.85 ms | 11.08 ms | 12.93 ms | 4.05 M |

The four-player viewport is 1280 × 800 CSS pixels. High retains the original 1.5 pixel ratio. Six-player measurements use a 1920 × 1080 viewport; Balanced caps the render buffer at 1.44 million pixels. Models, textures and vegetation populations are identical between quality settings.

These are GPU render timings, **not measured display FPS**. The native preview throttles animation callbacks even while reporting a visible document. The profiler therefore uses GPU timer queries and a synchronous one-pixel readback for each frame. Readback adds overhead and is only enabled during profiling. The final runs use 45 sampled frames after eight warmup frames; the original uses 25. This tests the terrain study, not the full RTS simulation or a range of laptop GPUs.

The baseline and final default landscape views have the same camera offset and viewport, but their target shifts when titanium replaces basalt. The original exact target was not recorded, so the overall before/after is a scene-level comparison, not an identical-view benchmark. Final records include explicit camera positions and targets for future reproduction.

An additional controlled shader A/B holds the final assets, camera and resolution constant: skipping unused material samples reduced GPU time from **21.46 to 15.74 ms (27%)**. Mean image-channel difference in matching 640 × 400 JPEG captures was under 0.36 / 255, with no visible terrain regression. Original and optimized source-asset renders separately checked silhouettes, scan seams and material quality.

Changes:

- Separate runtime GLBs retain the approved tree locations and leaf islands, with lighter grass, shrubs and rocks. Boundary-locked rock simplification preserves original positions, UVs and normals.
- The seven retained environment asset families shrink from 59.65 MB to 8.53 MB. New titanium adds 1.33 MB. Those totals exclude buildings and terrain texture files.
- Static shadows are cached during orbit/pan/zoom and invalidated after terrain, light-view, asset or visibility changes. Small grass, shrubs and pebbles receive shadows without casting individually.
- Indexed terrain shares grid vertices rather than submitting six copies. Heights, triangle diagonals and navigation remain aligned.
- Removed inactive basalt material paths and duplicate legacy cliff shading. Texture layers with zero contribution skip sampling; explicit derivatives preserve mip selection at their borders.
- Balanced limits render pixels on Retina/larger screens. High remains available; no automatic vegetation thinning or lower-detail model switch is applied.

Reproduce through `terrainProfiler.run({frames:45})` in the terrain hub console. Pass a saved `view`, `pixelRatio`, `refreshShadows`, `vegetation` or `flatTerrain` to isolate costs. The current hub is ready when `body.dataset.ready === 'true'`; historical captures used `resourceAssets`. Run one profile at a time; failed WebGL rendering rejects the measurement. Inspect shader diagnostics with `terrainProfiler.inspect()`.

Raw JSON, the original screenshot, shader A/B images and titanium detail capture live in `art/workbench/terrain-composite/performance/`. The source/runtime ledger is `tools/assets/terrain_runtime.sources.json`. Verification: production build, 42 terrain tests, two shared rendering tests, live checks of all four map families, four/six-player ore placement, and deposit inspection highlighting its future mine clearing.

## Close-angle refinement — 2026-10-06

Continuous object-space projection weights fix triangular mountain patches. A new matched-camera A/B holds the final dark ore assets, lighting, camera and resolution constant: High GPU mean changes from **17.00 to 17.42 ms** (+0.42 ms), with p95 from 18.33 to 19.22 ms. Submitted triangles (3.88 M), draw calls (312 mean), geometries (29) and textures (54) are unchanged. Balanced measures **11.34 ms mean / 12.41 ms p95** at 1280 × 800. These are 35-frame GPU measurements on the same M2, not presented FPS or a full-game benchmark; compare within this A/B rather than against the earlier session's timings.

The revised ore library is 1.18 MB, with the same 7,782 triangles per variant. Raw follow-up profiles and fixed camera views are in `art/workbench/terrain-composite/captures/close-refinement/`. Production build, the two shared terrain tests, source-recipe syntax, and live shader/navigation checks of all four families pass. Actual close views verify the source asset and material fixes.

## Angular ore studies and terrace repair — 2026-10-06

The later six-option study replaces the rounded ore with 16,226–18,344 triangle scan assemblies and 2K PBR maps. Only one option loads at a time. Previous ore meshes, GPU textures and decoded ImageBitmaps are disposed when switching; cycling all six in a fixed close view keeps renderer memory counts constant. Regenerating while a choice loads also preserves the new scene's selected option.

With Fractured ilmenite selected, Balanced renders the saved four-player landscape camera at **11.83 ms GPU mean / 12.50 ms p95**, with 4.16 M submitted triangles and 324 draw calls on average. This is a 35-frame render-throughput measurement on the same M2, with asset generation and tests idle, not display FPS. The hill repair also changes nearby vegetation placement, so this is a final scene measurement rather than an isolated asset A/B. Each local study GLB is approximately 15 MB; lossless 2K normal/packed material maps are retained for visual review. They have not been promoted to production assets.

Measurements and fixed-view comparisons live in `art/workbench/terrain-composite/titanium-options/captures/`. Validation: 43 terrain tests, two shared rendering tests, production build, six live asset swaps and the map-regeneration/loading interaction.
