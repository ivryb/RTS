# Assets

## Directory rules

- `art/` contains the current 2D concepts used to guide image generation and 3D work.
- `art/workbench/` contains local WIP, old generations, third-party visual references, preview renders, and rejected assets. Git ignores the entire directory.
- `assets/models/` contains runtime GLBs loaded by the game.
- `assets/textures/` contains runtime terrain textures.
- `assets/ui/` contains runtime portraits and interface images.
- `assets/source/` contains the current editable or original inputs for shipped assets.
- `tools/assets/` contains repeatable inspection and conversion scripts.

Do not move an experiment into `assets/` until the game uses it. Keep previous generations in `art/workbench/`, not beside the accepted asset.

The original Meshy command center and turret are retained as explicit reference archives in `assets/source/meshy/archive/`. Both have been replaced by procedural models. The turret archive includes the exact outgoing production GLB and five reference renders in `turret-reference/`.

## Model workflow

1. Start from an approved image in `art/`.
2. Create the model manually in Meshy with Smart Topology.
3. Retexture it from the approved image.
4. Rig humanoids and add the animations the game needs. Extra near-term clips may stay in the runtime GLB when their size is negligible; record them in the manifest.
5. Preserve the original export under `assets/source/meshy/`. If the runtime GLB is byte-identical, keep one copy under `assets/models/` and record that exception in the manifest.
6. Make repairs in Blender without changing source geometry merely to reduce file size.
7. Export the browser-ready GLB to `assets/models/`.
8. Update `assets/models/meshy-manifest.json`.
9. Run `bun run preview:capture:units` and inspect overview, gameplay, and close views.

For ordinary units, start with 1024 px WebP textures at about 80 percent quality. Keep larger textures only when the focused preview shows a meaningful difference.

## Procedural building materials

[`tools/assets/building_materials/`](../tools/assets/building_materials/README.md) owns the shared **Aged desert** palette and repeatable Blender material generation. It provides aged sand-ivory armor, weathered roof paint, neutral graphite machinery, ochre bronze, joint rubber, smoked glass, and cyan indicators. New procedural buildings should reuse this palette instead of copying material definitions from another model.

The production command center uses the **ivory shoulders** design. The production turret uses **compact foundation revision 09**, the same palette, and a connected rotating bearing. Their generators, runtime format, and regeneration commands are documented in [`tools/assets/PROCEDURAL_BUILDINGS.md`](../tools/assets/PROCEDURAL_BUILDINGS.md); accepted procedural assets are recorded in `assets/models/procedural-manifest.json`.

Generated PBR maps, editable Blender assemblies, and the appendable material library stay under `art/workbench/`. The scripts and palette are the reproducible sources; only accepted GLBs are copied into `assets/models/`.

[`tools/assets/building_parts.py`](../tools/assets/building_parts.py) provides shared authored geometry primitives—plates, solids, profile shells, turned profiles, rods, rings, and panel UVs. [`building_bake.py`](../tools/assets/building_bake.py) bakes these surfaces into a portable PBR atlas. Building-specific assemblies stay with each generator; subsequent buildings reuse this geometry vocabulary and material palette. The [building showcase](../prototypes/procedural-buildings/README.md) displays accepted buildings together and provides optional archived Meshy comparisons. Retired body and shoulder studies stay in the workbench.

## Terrain textures

The source files under `assets/source/polyhaven/` came from Poly Haven under CC0. Their README records the asset pages and authors. Runtime conversions live under `assets/textures/terrain/`. See [`TEXTURES.md`](../TEXTURES.md) for current roles and rejected experiments.

## Licensing

- The project-created concepts, portraits, models, and model textures were generated for Dune77 with AI-assisted tools.
- Code and documentation use AGPL-3.0-or-later under the root [`LICENSE`](../LICENSE).
- Project-created 2D concepts, UI images, textures, 3D models, and model source files use CC BY-SA 4.0 under [`ASSET-LICENSE`](../ASSET-LICENSE), to the extent that copyright applies.
- Poly Haven source images and their derived runtime textures remain CC0.
- The repository-local Meshy agent skills retain the license declared in each skill file.
- The robot-dog rigging prototype names its separately licensed animation reference in its own README. The third-party model is not stored in this repository.

Record the source and license before adding any third-party asset to the public tree.
