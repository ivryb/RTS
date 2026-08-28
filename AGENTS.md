# Dune77

We are developing a fast, browser-based RTS set in a sun-scorched cyberpunk wasteland. Working name — Dune77. Players establish an orbital-supported base, generate energy, mine metal, deploy buildings from space, and fight over roads, water, resources, and the ruins of abandoned cities.

We are inspired by the combat mechanics of *Age of Empires II: Definitive Edition* and the atmosphere of *Warhammer 40,000: Dawn of War*, *Dune franchise*, and *Cyberpunk 2077*.
Basically, we are creating an easier-to-play, browser-based AoE reskin set in a futuristic cyberpunk world. 
See `draft.md` for descriptions of all the discussed units, buildings, and mechanics.

### Tech
-  Three.js
-  Codex image-generation tool, OpenAI GPT Image, or Google Nano Banana for generating 2D isometric art
-  Meshy.ai for converting 2D images into 3D models, including characters, buildings, and other objects
-  Meshy’s model-rigging and animation library for humanoid character animations
-  Blender, Python or JavaScript scripts, or Three.js for rigging and animating non-humanoid models

### Art
Image-generation tools can produce inconsistent results when used without references, so it is advisable to use existing images and screenshots of buildings, units, and models as references when generating new images.
-  Option 1: Find two or more existing images of objects, characters, or terrain, and ask the image-generation tool to create a coherent scene with a consistent style. Then use this scene to create separate new isometric or A/T-shaped projections of each individual object or character and convert them into 3D models.
-  Option 2: Use an existing image of a character and ask the tool to generate a new object in the same style.
-  Option 3: Use an image of the entire scene and ask the image-generation tool to add a new object or character. Then use the updated scene to create a separate image of the new object.
-  Etc. Choose the option that is most relevant to the situation.

Fix visual problems in source assets first. Do not hide bad tiling, scale, or texture quality with extra runtime shader work unless the asset itself cannot solve it.

### Visual testing
Use the lightweight preview scenes instead of the full game: `pnpm preview:capture` captures terrain, buildings, and units as full-resolution overview, gameplay, and close images; the focused `:terrain`, `:buildings`, and `:units` commands capture one scene. They reuse production terrain and model primitives and write to `art/workbench/renders/previews/`.

Do not use Browser Use for verification; it can make the development machine unusable. Prefer deterministic simulation tests and targeted, quick Playwright or preview scripts. Before starting a dev server, check whether `pnpm run dev` is already running and reuse it; never spawn a second dev server alongside it.

### Meshy
- For now, 3D models are created manually in the Meshy UI for better visual control.
- Use the smart topology model for everything.
- Pipeline: Image → smart topology → 3D model → retexture with the original image → humanoid character? → rig → add the required animations. Suggest relevant animation names when the request does not specify them.

#### Unit texture preparation
- Preserve the source GLB and its geometry. Do not weld or delete mesh islands merely to reduce file size when the asset already uses one mesh and material.
- Remove only unused texture maps after checking the material. Keep base color, normal, and metallic/roughness maps when they contribute visibly.
- For ordinary RTS units, start with 1024 px WebP textures at about 80% quality; retain higher resolution only when the focused unit preview shows a meaningful loss.
- Export a separate runtime GLB, record its source and size in `assets/models/meshy-manifest.json`, and verify overview, gameplay, and close views with `pnpm preview:capture:units`.

### Blender CLI safety
On this Mac, never launch `/Applications/Blender.app/Contents/MacOS/Blender` inside the restricted Codex sandbox. Sandboxed background launches segfault and trigger a misleading “Blender quit unexpectedly” dialog. Run approved background Blender commands outside the sandbox, or use a non-Blender GLB inspector when Blender is unnecessary.

## Agent skills

- Issue tracking and Wayfinding operations: `docs/agents/issue-tracker.md`
- Triage label conventions: `docs/agents/triage-labels.md`
- Domain glossary and ADR locations: `docs/agents/domain.md`
