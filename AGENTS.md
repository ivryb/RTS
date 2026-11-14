# Dune77

We are developing a fast, browser-based RTS set in a sun-scorched futuristic wasteland. Working name: Dune77. Players use Scout Drones to build bases, produce units, and fight over terrain and resources.

We are inspired by the combat mechanics of *Age of Empires II: Definitive Edition* and the atmosphere of *Warhammer 40,000: Dawn of War*, the *Dune* franchise, and *Cyberpunk 2077*.
The goal is an approachable browser RTS with familiar strategic depth and its own futuristic wasteland setting.
See `draft.md` for descriptions of all the discussed units, buildings, and mechanics.

### Tech
-  Three.js
-  Blender Python generators for units, buildings, props, and resources, including rigs and animation
-  Poly Haven CC0 scans, reshaped by repeatable scripts, for terrain and vegetation

### Art
Build every new model as a Blender Python generator under `tools/assets/`: it authors the geometry, materials, and any rig, bakes one PBR atlas, and exports the runtime GLB, so rerunning it regenerates the asset. Reuse the shared geometry parts, Aged desert palette, and baker described in [procedural buildings](tools/assets/PROCEDURAL_BUILDINGS.md) and [building style](tools/assets/BUILDING_STYLE.md).

Iterate in the real game until the model is ready: load each candidate in the game or a preview scene, compare it at gameplay and close range with the existing units, buildings, and terrain, fix what reads wrong in the generator, and repeat. The model is ready when it matches their scale, palette, and level of detail. Then copy only the accepted GLB to `assets/models/` and record it in a manifest. [Assets](docs/assets.md) has the steps and commands.

Fix visual problems in source assets first. Do not hide bad tiling, scale, or texture quality with extra runtime shader work unless the asset itself cannot solve it.

Run 3D model work (models, rigs, animation, and in-world effects) on Claude Fable 5.2 (`claude-fable-5-2`) at high reasoning effort: launch its threads and subagents with that model.

### Visual testing
Blender, the dev server, previews, and Playwright run on Boat through `box`. A dev server lives only as long as its `box` command, so start it and the capture in one command, then pull the images back:

```sh
box 'bun run dev >/tmp/vite.log 2>&1 & sleep 5; bun run preview:capture:units'
box pull art/workbench/renders/previews/
```

For terrain experiments, use the existing [terrain hub](prototypes/terrain-playground/README.md). For production rendering, use the lightweight preview scenes instead of the full game: `bun run preview:capture` captures terrain, buildings, and units as full-resolution overview, gameplay, and close images; the focused `:terrain`, `:buildings`, and `:units` commands capture one scene, and `preview:capture:construction` captures buildings under construction, as [construction animation](docs/construction_animation.md) describes. They reuse production terrain and model primitives and write to `art/workbench/renders/previews/`. The `verify-dune77` skill drives the live game.

Boat has no GPU. Every Playwright launch takes its Chromium args from `tools/chromium.ts`, which select Mesa's software renderer there. Previews, the UI review, the terrain hub and the capture scripts always render at full quality. Only behavioral verify specs run in the faster light render mode, and the `verify-dune77` skill says when a spec needs full quality.

Verify with deterministic simulation tests and targeted Playwright or preview scripts, not Browser Use.

## Agent skills

- Architecture and repository boundaries: `docs/architecture.md`
- Asset organization and licensing: `docs/assets.md`
- Terrain: before generation, appearance or match-integration changes, read [terrain generation and visual review](docs/terrain_generation.md). Preserve the approved baseline and use the existing terrain hub's capture CLI.
- Domain language: `CONTEXT.md`
- Game design: `draft.md`
