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

## Model workflow

1. Start from an approved image in `art/`.
2. Create the model manually in Meshy with Smart Topology.
3. Retexture it from the approved image.
4. Rig humanoids and add the animations the game needs. Extra near-term clips may stay in the runtime GLB when their size is negligible; record them in the manifest.
5. Preserve the original export under `assets/source/meshy/`. If the runtime GLB is byte-identical, keep one copy under `assets/models/` and record that exception in the manifest.
6. Make repairs in Blender without changing source geometry merely to reduce file size.
7. Export the browser-ready GLB to `assets/models/`.
8. Update `assets/models/meshy-manifest.json`.
9. Run `pnpm preview:capture:units` and inspect overview, gameplay, and close views.

For ordinary units, start with 1024 px WebP textures at about 80 percent quality. Keep larger textures only when the focused preview shows a meaningful difference.

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
