# Dune77

We are developing a fast, browser-based RTS set in a sun-scorched futuristic wasteland. Working name: Dune77. Players use Scout Drones to build bases, produce units, and fight over terrain and resources.

We are inspired by the combat mechanics of *Age of Empires II: Definitive Edition* and the atmosphere of *Warhammer 40,000: Dawn of War*, the *Dune* franchise, and *Cyberpunk 2077*.
The goal is an approachable browser RTS with familiar strategic depth and its own futuristic wasteland setting.
See `draft.md` for descriptions of all the discussed units, buildings, and mechanics.

### Tech
-  Three.js
-  Blender Python generators for buildings, props, and resources
-  Poly Haven CC0 scans, reshaped by repeatable scripts, for terrain and vegetation
-  Meshy.ai, with its rigging and animation library, for units and humanoid characters
-  Blender, Python or JavaScript scripts, or Three.js for rigging and animating non-humanoid models
-  Optional image generation (OpenAI GPT Image, Google Nano Banana) for 2D concepts and portraits

### Art
Build new models procedurally by default: a Blender Python generator under `tools/assets/` authors the geometry and materials, bakes one PBR atlas, and exports the runtime GLB, so rerunning it regenerates the asset. Reuse the shared geometry parts, Aged desert palette, and baker described in [procedural buildings](tools/assets/PROCEDURAL_BUILDINGS.md) and [building style](tools/assets/BUILDING_STYLE.md). Terrain models and vegetation start from Poly Haven CC0 scans, and the scripts recorded in the terrain manifest reshape them. The generator is the source of truth; copy only the accepted GLB to `assets/models/` and record it in a manifest. See `docs/assets.md` for each workflow.

When a new look needs a direction first, compare quick generated variants in the real game, or generate concept images using existing screenshots and renders as references; generations without references drift from the game's style.

Fix visual problems in source assets first. Do not hide bad tiling, scale, or texture quality with extra runtime shader work unless the asset itself cannot solve it.

### Visual testing
For terrain experiments, use the existing [terrain hub](prototypes/terrain-playground/README.md). For production rendering, use the lightweight preview scenes instead of the full game: `bun run preview:capture` captures terrain, buildings, and units as full-resolution overview, gameplay, and close images; the focused `:terrain`, `:buildings`, and `:units` commands capture one scene. They reuse production terrain and model primitives and write to `art/workbench/renders/previews/`.

Do not use Browser Use for verification; it can make the development machine unusable. Prefer deterministic simulation tests and targeted, quick Playwright or preview scripts. Before starting a dev server, check whether `bun run dev` is already running and reuse it; never spawn a second dev server alongside it.

### Meshy
- The current units come from Meshy. Use it for organic and humanoid models that need rigs, which procedural generators do not cover. By default, work in the Meshy UI for visual control. An explicit request to use the API selects the API workflow in [dune77-meshy](.agents/skills/dune77-meshy/SKILL.md).
- Use the smart topology model for everything.
- Pipeline: Image → smart topology → 3D model → retexture with the original image → humanoid character? → rig → add the required animations. Suggest relevant animation names when the request does not specify them.

#### Unit texture preparation
- Preserve the source GLB and its geometry. Do not weld or delete mesh islands merely to reduce file size when the asset already uses one mesh and material.
- Remove only unused texture maps after checking the material. Keep base color, normal, and metallic/roughness maps when they contribute visibly.
- For ordinary RTS units, start with 1024 px WebP textures at about 80% quality; retain higher resolution only when the focused unit preview shows a meaningful loss.
- Export a separate runtime GLB, record its source and size in `assets/models/meshy-manifest.json`, and verify overview, gameplay, and close views with `bun run preview:capture:units`.

### Blender CLI safety
On this Mac, never launch `/Applications/Blender.app/Contents/MacOS/Blender` inside the restricted Codex sandbox. Sandboxed background launches segfault and trigger a misleading “Blender quit unexpectedly” dialog. Run approved background Blender commands outside the sandbox, or use a non-Blender GLB inspector when Blender is unnecessary.

## Agent skills

- Architecture and repository boundaries: `docs/architecture.md`
- Asset organization and licensing: `docs/assets.md`
- Terrain: before generation, appearance or match-integration changes, read [terrain generation and visual review](docs/terrain_generation.md). Preserve the approved baseline and use the existing terrain hub's capture CLI.
- Domain language: `CONTEXT.md`
- Game design: `draft.md`
