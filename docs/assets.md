# Assets

## Directory rules

- `art/` contains the original 2D concepts of the existing units and buildings, kept as style references.
- `art/workbench/` contains local WIP, old generations, third-party visual references, preview renders, and rejected assets. Git ignores the entire directory.
- `assets/models/` contains runtime GLBs loaded by the game.
- `assets/textures/` contains runtime terrain textures.
- `assets/ui/` contains runtime portraits and interface images.
- `assets/source/` contains the current editable or original inputs for shipped assets.
- `tools/assets/` contains repeatable inspection and conversion scripts.

Do not move an experiment into `assets/` until the game uses it. Keep previous generations in `art/workbench/`, not beside the accepted asset.

The original Meshy command center and turret are retained as explicit reference archives in `assets/source/meshy/archive/`. Both have been replaced by procedural models. The turret archive includes the exact outgoing production GLB and five reference renders in `turret-reference/`.

## Model workflow

Every new unit, building, prop, and resource is a Blender Python generator in `tools/assets/`. It builds named geometry, source materials, and any rig or animation clips, bakes one PBR atlas through [`building_bake.py`](../tools/assets/building_bake.py), and exports a runtime GLB with a ground pivot. Editable `.blend` files and renders stay in `art/workbench/`; the generator is the reproducible source.

1. Write or extend a generator, reusing the shared geometry parts and palette described below.
2. Run it on Boat, where `scripts/box-setup.sh` installs the Mac's Blender with the Pillow and NumPy its texture step needs. `--draft` skips baking for a quick shape pass. Outputs land on the Boat machine, so pull the candidate back:
   ```sh
   box blender --background --python-exit-code 1 --python tools/assets/build_turret.py
   box pull art/workbench/procedural-turret/
   ```
3. Load the candidate in the real game or a preview scene and compare it at gameplay and close range with the existing units, buildings, and terrain. For Titanium Deposits, `bun tools/verify/capture-ore.mjs --model <glb> --out <dir>` serves the candidate in place of every production ore model and captures gameplay and close views.
4. Change the generator to fix what reads wrong, such as scale, silhouette, palette, or detail density, and repeat from step 2 until the model sits naturally beside them.
5. Copy the accepted GLB to `assets/models/` and record its generator, size, hash, and triangle count in the matching manifest.

Boat syncs only files git sees, so generators that read ignored inputs from `art/workbench/`, such as the Poly Haven scans behind the terrain and titanium preparation scripts, still run only where those folders exist.

Terrain models and vegetation follow the same rule from a different start: CC0 Poly Haven scans reshaped by repeatable scripts, recorded in the [terrain manifest](../assets/models/terrain/manifest.json).

### Existing units

The Scout Drone, Ghostrunner, Hornet, and Behemoth predate the generators: they were made in Meshy, and `assets/models/meshy-manifest.json` records their source exports under `assets/source/meshy/`. A replacement follows the model workflow above. HUD portraits are generated images; `assets/source/ui/portraits/generation.json` records each prompt and reference.

## Procedural building materials

[`tools/assets/building_materials/`](../tools/assets/building_materials/README.md) owns the shared **Aged desert** palette and repeatable Blender material generation. It provides aged sand-ivory armor, weathered roof paint, neutral graphite machinery, ochre bronze, joint rubber, smoked glass, and cyan indicators. New procedural buildings should reuse this palette instead of copying material definitions from another model.

The production command center uses the **ivory shoulders** design. The production turret uses **compact foundation revision 09**, the same palette, and a connected rotating bearing. Their generators, runtime format, and regeneration commands are documented in [`tools/assets/PROCEDURAL_BUILDINGS.md`](../tools/assets/PROCEDURAL_BUILDINGS.md); accepted procedural assets are recorded in `assets/models/procedural-manifest.json`.

Generated PBR maps, editable Blender assemblies, and the appendable material library stay under `art/workbench/`. The scripts and palette are the reproducible sources; only accepted GLBs are copied into `assets/models/`.

[`tools/assets/building_parts.py`](../tools/assets/building_parts.py) provides shared authored geometry primitives—plates, solids, profile shells, turned profiles, rods, rings, and panel UVs. [`building_bake.py`](../tools/assets/building_bake.py) bakes these surfaces into a portable PBR atlas. Building-specific assemblies stay with each generator; subsequent buildings reuse this geometry vocabulary and material palette. The [building showcase](../prototypes/procedural-buildings/README.md) displays accepted buildings together and provides optional archived Meshy comparisons. Retired body and shoulder studies stay in the workbench.

## Titanium outcrops

The main game uses three locally authored compositions: **three knuckles**, **split lens**, and **eroded window**. `tools/assets/build_titanium_ore.py` builds their fractured shapes and bakes one PBR material per asset. The source Cliff Side color, normal, and roughness maps and CC0 provenance live under `assets/source/polyhaven/titanium/`; exported model details are recorded in `assets/models/titanium-manifest.json`. Workbench renders compare source and reimported GLBs, while the main game verifies their scale beside Scout Drones and Command Centers.

## Terrain textures

The source files under `assets/source/polyhaven/` came from Poly Haven under CC0. Their README records the asset pages and authors. Runtime conversions live under `assets/textures/terrain/`. See [`TEXTURES.md`](../TEXTURES.md) for current roles and rejected experiments.

The approved New terrain is used by both the main game and terrain hub. Its six environment GLBs live in `assets/models/terrain/`; its nine scanned surface maps live in `assets/textures/terrain/`. The [production manifest](../assets/models/terrain/manifest.json) records exact approved bytes, source URLs, licenses and recipe hashes. The [source note](../assets/source/polyhaven/terrain/README.md) records retained original maps and the explicit single-runtime-copy exception for models with embedded geometry and textures. The grass bed's authored geometry follows CC BY-SA 4.0; its photographic maps and the other scanned assets remain CC0. Runtime imports are static Vite asset URLs, so production builds include the files without serving the ignored workbench.

## Licensing

- The project-created concepts, portraits, models, and model textures were generated for Dune77 with AI-assisted tools.
- Code and documentation use AGPL-3.0-or-later under the root [`LICENSE`](../LICENSE).
- Project-created 2D concepts, UI images, textures, 3D models, and model source files use CC BY-SA 4.0 under [`ASSET-LICENSE`](../ASSET-LICENSE), to the extent that copyright applies.
- Poly Haven source images and their derived runtime textures remain CC0.
- The robot-dog rigging prototype names its separately licensed animation reference in its own README. The third-party model is not stored in this repository.

Record the source and license before adding any third-party asset to the public tree.
