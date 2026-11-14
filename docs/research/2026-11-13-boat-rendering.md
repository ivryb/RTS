# Rendering the game faster on Boat (D77-11)

Measured on 2026-11-13 on this worktree's Boat machine. Ivan asked for the options to speed up the game's rendering on Boat, where it runs at 2 to 3 frames per second. This note gives the measured limit, each option with its numbers and cost, and a recommendation. Nothing here changes game code or shared tooling. The scripts are in [boat-rendering/](boat-rendering/), and the raw JSON, logs and screenshots are in `art/workbench/performance/boat-rendering/` in the main checkout.

## Recommendation

Two free changes cover most of what faster rendering can buy on Boat. Renting a GPU is not worth it yet.

1. **Point every Linux capture at llvmpipe.** The preview captures, the UI review, `profile-combat.mjs`, `capture-ore.mjs` and the terrain hub launch Chromium without the flags the verify specs use. On Boat they therefore render through Chromium's built-in SwiftShader, which is 10 times slower than Mesa's llvmpipe on the game. Adding `--use-angle=gl --ignore-gpu-blocklist` made the 13 preview captures take 40 to 44 s instead of 94 to 100 s, and the images look the same.
2. **Add a light render mode for behavioral specs only.** Turning off shadows, rocks, vegetation and antialiasing raises the live game from 2.5 to about 14 frames per second, and the six verify specs take 118 to 124 s instead of 157 to 158 s. The building-models spec and every visual capture must keep full quality.

A GPU machine would mainly buy smooth films of time-based effects and real performance numbers. It would not make specs much faster than the light mode does, because most spec time is startup and in-game waiting, not drawing. The cheapest fit is an AWS T4 machine at $0.53 an hour (about $16 a month at 30 hours), plus a second runner beside `box` to build and maintain. Until films or real performance numbers are needed regularly, use Ivan's Mac for the occasional real-GPU check.

## What limits the frame rate today

The machine is Boat's `large` type: an AMD Ryzen 7 9700X with 8 vCPU and 16 GB, no GPU and no `/dev/dri`. It runs Mesa 25.2.8 with llvmpipe on LLVM 20, and Playwright's Chromium headless shell. The scene is the live game at seed 77 at 1280 × 720, Playwright's default viewport, which the verify specs use. The camera holds the opening view, and each recording window lasts 10 to 15 s. The bench script ([bench.mjs](boat-rendering/bench.mjs)) measures frame intervals and main-thread time inside the page. It reads per-thread CPU time from `/proc`, and it changes the scene through Three.js's devtools hook, so the game code stays untouched.

| Measure | Value | How I know |
| --- | --- | --- |
| Frame rate | 2.5 frames per second (median of 6 runs, range 2.2 to 2.8), 383 to 450 ms per frame | measured |
| Main-thread JavaScript per frame | 2.7 to 3.7 ms, which is the whole animation callback including `renderer.render` | measured |
| Work per frame | 108 draw calls and 4.38 million triangles | measured with `renderer.info` |
| Shadow pass share | 2.88 million triangles; the main pass draws 1.50 million | measured, as the drop when shadows are off |
| Vegetation | 4.41 million triangles in the scene, 4.37 million of which cast shadows | measured by adding up instanced meshes |
| CPU while rendering | The GPU process's main thread uses 0.8 cores, the 8 llvmpipe threads 2.7 cores together, and the page itself almost nothing | measured from `/proc` |

JavaScript and the simulation are not the limit: they take under 1% of each frame. The frame time is spent in Mesa's software rasterizer, in Chromium's GPU process, and it grows with triangles, not pixels:

- Rendering a quarter of the pixels (pixel ratio 0.5) raises the rate only from 2.5 to 3.3 frames per second, and turning off antialiasing raises it to 3.3.
- Turning off shadows raises it to 6.9 frames per second, and hiding all rocks and vegetation raises it to 5.4.
- Raising llvmpipe's thread count barely helps. One thread gives 1.2 frames per second, four give 2.3, eight (the default) give 2.6, and sixteen give 2.3 to 2.8 over 3 runs.

Why it isn't twice as fast: Mesa shades vertices and bins triangles on one thread, the GPU process's main thread, before the eight rasterizer threads can fill pixels. A `perf` profile of the GPU process over 8 s backs this up. 41% of its samples fall on that main thread, split between Mesa's vertex and binning code, vertex shaders compiled at run time, and kernel memory work. The other 59% is spread thinly over the eight rasterizer threads. Mesa's library has no symbols, so the profile names the thread and the library, not the function. At 4.4 million triangles per frame, that serial stage sets the pace. That is why more threads, fewer pixels or a different Chromium mode change little, while fewer triangles change a lot.

Startup isn't limited by rendering either. From navigation to `ready()` takes 8.7 to 12 s warm, about the same with SwiftShader (9.7 s) and with one llvmpipe thread (10.2 s), where frames are 2 to 10 times slower. The first page load on a fresh machine took 29 s, with the match clock at 00:24, which matches the "00:25 before the first click" in the brief. I didn't profile what startup spends its time on.

## Options

Each speedup is measured on the same scene unless the row says "guess". Prices are from the providers' own pages, read on 2026-11-13; the sources are listed below the table.

| Option | Live game frame rate (today 2.5) | What it speeds up | Money | Upkeep | Main risk |
| --- | --- | --- | --- | --- | --- |
| A. llvmpipe flags for every Linux capture | unchanged for verify specs, which already use them | preview captures 94–100 s → 40–44 s, 2 runs each; other capture scripts likewise (not timed) | $0 | one shared Chromium args constant | pixel baselines saved under SwiftShader shift slightly: mean difference 1.7 to 5 out of 255 |
| B. Light render mode for behavioral specs (no shadows, rocks, vegetation or antialiasing) | 13.7–16.2 (4 runs); 25 at half resolution; 14.9 in combat | verify suite 157–158 s → 118–124 s, 2 runs each (−23%) | $0 | a verify-only URL flag in the game and a default in `openGame` | a visual check run in light mode shows a different scene than players see |
| C. Vegetation stops casting shadows, or gets simpler geometry | 3.7–4.9 (4 runs) | every render, on Boat and on players' GPUs | $0 | an asset or game change | changes how the game looks, so it's an art decision, outside this task |
| D. 16-vCPU Boat machine (`xlarge`) | about +10% (estimate from the thread scaling above) | everything slightly | $0.20/h, and needs Boat's $100+ plan instead of $20 | none | pays $80 a month more for almost nothing |
| E. Other software renderers or settings: SwiftShader, Mesa's Vulkan driver (lavapipe), Chromium's new headless mode, llvmpipe thread counts | 0.25, 2.5, 2.5–2.7, and 2.3–2.8 | nothing | $0 | none | rejected, none is faster |
| F. GPU cloud machine for captures and films (AWS g4dn.xlarge T4) | about 60 (guess: the game holds 60 at 1440 × 900 on an Apple M2 per `tools/verify/PERFORMANCE.md`, and this scene is light work for any GPU) | smooth films, real performance numbers; specs only down to about light-mode times (guess) | $0.526/h on demand, $0.22/h spot: about $16 (spot $7) at 30 h a month, $53 (spot $22) at 100 h, plus disk while stopped | a second runner beside `box`: machine image with the NVIDIA driver, start and stop, file sync, Chromium GPU flags | Chromium's GPU path on headless NVIDIA servers is fiddly (sources below); not tried, since renting costs money |
| G. Hosted browser services (BrowserStack, LambdaTest, Sauce Labs, Browserbase, Hyperbrowser, Steel) | unknown | — | $20–$199 a month | low | none documents hardware WebGL; Kernel had no WebGL at all in D77-2 |
| H. Ivan's MacBook Air for occasional real-GPU checks | 60 on an M2 (measured 2026-09-27, `tools/verify/PERFORMANCE.md`) | real performance numbers and smooth films, on request | $0 | none | linked to T3 but asleep most of the time (unreachable today), and it breaks the rule that runs go through `box` |

Other GPU machines priced for comparison, all per hour on demand: Google Cloud g2-standard-4 (L4) $0.707, Azure NV6ads A10 v5 (a sixth of an A10) $0.454, RunPod A5000 $0.27, Vast.ai RTX 3090 about $0.22, DigitalOcean RTX 4000 Ada $0.76 with powered-off machines still billed, and Hetzner GEX45 at €214 a month plus a €209 setup fee. Boat itself offers no GPU size ([docs.boat.dev/pricing](https://docs.boat.dev/pricing)). Fly.io shut down its GPUs after 2026-08-01.

Sources: AWS prices come from AWS's price list API and spot feed. Google's are on [cloud.google.com/products/compute/pricing/accelerator-optimized](https://cloud.google.com/products/compute/pricing/accelerator-optimized), Azure's come from its retail prices API, and RunPod's are on [runpod.io/pricing](https://www.runpod.io/pricing). Hetzner's are on [hetzner.com/dedicated-rootserver/gex45](https://www.hetzner.com/dedicated-rootserver/gex45), DigitalOcean's on [digitalocean.com/pricing/gpu-droplets](https://www.digitalocean.com/pricing/gpu-droplets), and Vast.ai's come from its public offers API. Google's tested flags for headless Chrome on an NVIDIA T4 are `--headless=new --use-angle=vulkan --enable-features=Vulkan --disable-vulkan-surface` ([developer.chrome.com/blog/supercharge-web-ai-testing](https://developer.chrome.com/blog/supercharge-web-ai-testing)). Docker containers also need `NVIDIA_DRIVER_CAPABILITIES` to include `graphics`. Without that, Chrome silently falls back to software, so a setup must check the WebGL renderer string.

## How the options fit the two kinds of runs

Behavioral specs only need the game to run. Their time goes mostly to the 9 to 12 s startup per test, real-time game timers (a Scout Drone trains in 8 s), and fixed waits in the specs. At 14 frames per second, the light mode already makes frames short next to those waits, so a GPU would save little more on specs (guess, not measured). Option B is the cheap way to get that saving.

Visual review captures must look like what players see, so B must never touch them. For still captures, Option A removes the largest avoidable cost at full quality. Two things stay slow without a GPU: films of time-based effects (the mining laser, construction, deaths) in the full game, which run at 2.5 frames per second, and any real performance number. A wide capture at 3240 × 900 renders the full game at 1.1 frames per second.

## What I tried, with the numbers

All runs: Boat `large`, seed 77, 1280 × 720 unless noted, one run each unless a range is given. The fast combination means no shadows, no rocks or vegetation, and no antialiasing.

| Run | Frames per second | Triangles per frame |
| --- | --- | --- |
| Today's settings | 2.2–2.8 (6 runs) | 4.38 M |
| No antialiasing | 3.25 | 4.38 M |
| Half pixel ratio (a quarter of the pixels) | 3.33 | 4.38 M |
| Shadow map 1024 instead of 2048 | 2.75 | 4.38 M |
| No terrain mesh | 3.25 | 3.68 M |
| Vegetation casts no shadows | 3.7–4.9 (4 runs) | 2.33 M |
| Rocks and vegetation cast no shadows | 4.33 | 2.18 M |
| Vegetation hidden | 4.99 | 1.45 M |
| Rocks and vegetation hidden | 5.41 | 1.13 M |
| No shadows | 6.9 | 1.50 M |
| No shadows, no antialiasing | 12.1 | 1.50 M |
| Fast combination | 13.7–16.2 (4 runs) | 0.46 M |
| Fast combination at half pixel ratio | 24.9 | 0.46 M |
| Combat, today's settings | 2.6 | 4.38 M |
| Combat, fast combination | 14.9 | 0.46 M |
| Empty scene | 60 | 0 |
| 3240 × 900, today's settings | 1.08 | 5.49 M |
| llvmpipe threads: 1 / 4 / 16 | 1.17 / 2.33 / 2.3–2.8 (3 runs) | 4.38 M |
| SwiftShader (`--use-angle=swiftshader`) | 0.25 | 4.38 M |
| lavapipe (`--use-angle=vulkan`) | 2.5 | 4.38 M |
| Chromium new headless mode | 2.5–2.7 (3 runs) | 4.38 M |

End to end:

- **Verify specs, all six:** today's settings took 158 and 157 s, and the fast combination 124 and 118 s, alternating on one dev server. The fast mode was applied through [helpers-fast.patch](boat-rendering/helpers-fast.patch), which I reverted afterwards. Small specs went from 9.8–16.5 s to 8.9–12.0 s, and building-models from 90 s to 66–72 s.
- **Preview captures, all 13 at 3240 × 900:** today's default took 100 and 94 s on SwiftShader. With `--use-angle=gl --ignore-gpu-blocklist` they took 44 and 40 s, alternating.
- **SwiftShader against llvmpipe images:** for the units, buildings and terrain previews, the mean per-pixel difference was 5.0, 3.9 and 1.7 out of 255. By eye the two are the same, and the differences are texture grain in vegetation and ground.
- **Flags:** `--use-angle=gl` without `--ignore-gpu-blocklist` gives no WebGL2 at all, and `--use-angle=metal` on Linux falls back to SwiftShader.

What these numbers don't cover: no GPU machine was tried, because that costs money, so every GPU frame rate above is a guess. The preview pages render only when something changes, so their frame rate isn't comparable to the live game's. The Boat CPU is shared, and the run-to-run spread above (2.2 to 2.8 for the same settings) is the noise floor.

## Decisions for Ivan

1. Build options A and B together, as one small change: Chromium args in the capture configs and scripts, and a verify-only light render flag that specs opt into. Recommended: yes.
2. Rent a GPU machine (option F). Recommended: not now; revisit when a thread needs smooth films or real performance numbers more than occasionally.
3. Whether vegetation should keep casting shadows, or get simpler geometry (option C), is an art and player-performance question. I recommend leaving it out of this task.

## Approved design (2026-11-14)

Ivan approved A and B, and C for behavioral specs only. The build does three things:

1. **Captures use llvmpipe.** Every Chromium launch for captures on Linux passes `--use-angle=gl --ignore-gpu-blocklist`, from one shared constant. That covers the preview config, the UI review config, `profile-combat.mjs`, `capture-ore.mjs`, `doctor.mjs`, and the terrain-hub scripts. Those scripts now pass `--use-angle=metal` on Linux too, where it falls back to SwiftShader. Captures keep full quality.
2. **A light render mode for behavioral specs.** A render flag that works only with `?verify=1` turns off shadows, rocks and vegetation, and antialiasing. That includes option C, since hidden vegetation casts no shadows. `openGame` turns it on by default. A spec that checks what players see opts out, and today that's `building-models.spec.ts`. Captures and the preview scenes never use it.
3. **Docs follow.** The verify-dune77 skill, `tools/verify/playwright.config.ts`, `scripts/box-setup.sh`, and AGENTS.md's visual-testing section stop saying the game renders at 2 to 3 frames per second. They state which runs are light and which are full quality.

Option F, the GPU machine, is not part of this build. Ivan didn't answer that question, so the recommendation stands: not now.

The build is done when these checks pass:

- The preview captures report llvmpipe as their renderer, and the suite runs in about 40 s instead of about 95 s.
- In light mode the live game runs at about 14 frames per second at 1280 × 720, and the six verify specs take about 120 s instead of about 157 s.
- `building-models.spec.ts` still renders shadows and vegetation.
- Without `?verify=1` the game is unchanged.

Nothing a player sees changes.

## Build results (2026-11-14)

Measured on this worktree's Boat machine, the same `large` type as above, seed 77. The scripts are `build-measure.sh`, `build-alternate.sh` and `image-diff.py` in [boat-rendering/](boat-rendering/), and the raw logs and images are in `art/workbench/d77-11/` in the main checkout.

| Measure | Before | After | How |
| --- | --- | --- | --- |
| Preview captures' renderer | SwiftShader | llvmpipe | WebGL renderer string under the preview config's args |
| Preview suite, 14 captures at 3240 × 900 | 92 s | 53 s | one run each |
| Live game at 1280 × 720, full render | 2.46, 2.33 fps | 2.0, 2.06 fps | sequential runs |
| Same, alternating old and new code | 2.4, 2.4, 1.8 fps | 2.13, 2.13, 2.0 fps | three rounds on one machine |
| Live game, light render | — | 12.85, 12.77 fps; 0.46 M triangles and 11 draw calls instead of 4.38 M and 108 | two runs |
| The five light-mode tests, alternating old and new | 107, 114, 122 s | 46, 45, 48 s | three rounds |
| Whole verify suite, 9 tests | 496, 506 s | 530, 566 s | sequential runs |
| Full-render captures, before against after | — | mean difference 0.01 to 0.54 out of 255 | building-models' 9 captures |
| Preview images, SwiftShader against llvmpipe | — | mean difference 1.8 to 4.4 out of 255 | all 17 images |

The full-render frame rate didn't change: its code path is the same, and the alternating rounds overlap. The whole suite didn't get faster, because the two full-render specs take about 7.5 of its 8.5 to 9.5 minutes. `building-models` and the three `construction` tests run at full quality on purpose, and they varied by up to 50 s between runs, more than light mode saves on the other five tests (about 60 s). Light mode cuts the five behavioral tests by 58%.

What limits each kind of run now:

- **Light tests** take 7 to 12 s each, and most of that is startup: the bench's navigation-to-`ready()` time is 7.5 to 24 s in light mode, about the same as at full quality. In light mode the GPU process's main thread uses 0.46 cores and the llvmpipe threads 5 cores, so drawing is now limited by filling pixels rather than by the serial vertex stage. Frames land on 83 ms, which is five refresh intervals of headless Chromium's 60 Hz loop.
- **Full-render specs** still draw at about 2 frames per second, limited by the serial stage this note describes above. Only a GPU would change that.

`construction.spec.ts`, which merged after this study, also needs full rendering. Its startup check expects the "Construction cut shadow" shader program, which compiles only with shadow maps on, and its frames are judged by eye.
