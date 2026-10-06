# New terrain

Open `/prototypes/terrain-playground/?variant=new&players=4&seed=56204`. This is the terrain previously called Oxide wilds. Its ore props and ore demonstrations have been removed. The current comparison has only Old terrain and New terrain.

The user approved the current mountain, vegetation and v10 grass treatment at production unit scale and requested its use in the main game. The [approved checkpoint](../../art/workbench/renders/terrain-playground/reviews/2026-10-06-grass-units/checkpoint/manifest.json) preserves source and exact assets. New terrain now uses shared production modules; the [extraction comparison](../../art/workbench/renders/terrain-playground/reviews/2026-10-06-production-integration/approved-comparison.json) is pixel-identical in all seven captured views. Follow the [visual review contract](../../docs/terrain_generation.md#visual-review) before further appearance changes.

## Appearance and ownership

The selected references guide the terrain: fractured oxide ledges and rubble fans, olive umbrella crowns, sage scrub, straw understory, and local cracked alluvial ground. Loose blocks remain at low mountain feet rather than scattered across summits. Open sand connects the groves and landforms.

- `src/mapGenerators/biomeRegions.ts` assigns habitat to existing warped territories.
- `src/mapGenerators/biomeTerrain.ts` copies the heightfield and adds oxide ledges and talus, preserving construction pads, ramps and primary/bypass routes.
- `src/mapGenerators/biomeFeatures.ts` places rubble, groves and washes. Large loose stones contribute navigation obstacles.
- `src/mapGenerators/biomeGround.ts` derives local surface cover from the same habitat fields.
- `src/mapGenerators/environment.ts` composes these pure stages and adds tree trunks to the final navigation/construction obstacle mask. Grass and low shrubs remain walkable.
- `src/terrainRendering/` owns shared indexed geometry; `environmentMaterial.ts` selects the approved scanned surfaces.
- `src/environmentProps.ts` loads and instances the six production environment models.
- `compositeScene.ts` adds reference buildings, units and inspection views to the shared environment.

The revised heights and final obstacle mask drive both the game and the hub's diagnostics. Production Recast and construction placement use the same trunk and rubble obstacles; the hub's route probes remain lightweight height-field diagnostics.

The approved material pairs Cliff Side at 12 m on steep faces with Rock Face 03 at 7 m on upward-facing bedrock, using matched 2K color/normal maps. The 5.5 m ledges and bounded lateral contour weathering live in the shared heightfield. The terrain retains its vertex count and protected routes/pads.

Continuous projection weights join the two surfaces and prevent triangle-shaped material patches. Caprock replaces the cliff's upward-facing texture samples; it does not add a second all-surface detail layer. Its normal adds one resident 2K texture. Rendering budgets alone do not establish frame rate.

## Assets

The six approved models live in `assets/models/terrain/` and the nine terrain maps in `assets/textures/terrain/`. The [production manifest](../../assets/models/terrain/manifest.json) records their byte-identical promotion, recipes and provenance. Static asset imports include them in production builds. Work files and rejected assets remain under ignored `art/workbench/terrain-composite/`. The detailed model recipes remain in `tools/assets/terrain_runtime.sources.json` and `tools/assets/oasis_grass.sources.json`.

`prepare_oxide_cliff.py`, `prepare_biome_scree.py` and `prepare_biome_ground.py` prepare terrain textures. `prepare_oxide_talus.py`, `fetch_terrain_composite_vegetation.py`, `grade_terrain_biome_vegetation.py`, `prepare_savanna_vegetation.py`, `prepare_terrain_runtime.py` and `prepare_oasis_grass.py` prepare environment models. `prepare-directions.mjs` remains only as a source-fetch recipe required by existing rock and vegetation preparation, not as a runnable demo.

The [source note](../../assets/source/polyhaven/terrain/README.md) records original photographs, licenses and the single-runtime-copy model exceptions. No workbench file is needed to load the production environment.

## Verification

Use `bun run build`, `bun run test:terrain` when changing landforms, and `bun test ./tests/terrainRendering.test.ts` for shared geometry/contact regressions. Compare gameplay, close, low and opposite views with the same camera and resolution. Material fixes must preserve continuous projection weights; face-derived weights previously exposed triangle boundaries.

The repaired curved terrace beside Base C, seed 56204, has a terrain regression test. Historical captures and performance evidence remain under `art/workbench/terrain-composite/`; see [PERFORMANCE.md](PERFORMANCE.md) for measurement scope. Old ore captures are historical evidence, not current selectable demos.

## Vegetation refinement

The approved 6 October vegetation treatment retains the approved mountain materials with slightly shallower summit joints. Oasis habitat now includes separated floor territories, with tree budgets of 24/30/36 for two/four/six players. Visible alluvial soil and planting share the moisture field. Roots avoid the complete loose-rock scatter and exposed rock; plants use authored root origins, so canopy asymmetry no longer shifts trunks off their validated ground. Tree leaf roughness is baked into the runtime asset; colors, geometry, alpha and normals are preserved. See the [matched comparisons](../../art/workbench/renders/terrain-playground/reviews/2026-10-06-vegetation/README.md) and [approved checkpoint](../../art/workbench/renders/terrain-playground/baselines/approved-2026-10-06-vegetation/README.md).

Grass follows the shared moisture field independently of tree positions. Irregular overlapping beds have distributed roots, varied blade height and the muted photographic material approved beside units. They reserve their wider base against rock and uneven ground. A local neighbor check and minimum connected-bed size remove detached fragments before shrubs are placed within supported cover. Dry-edge grass tapers in height using the existing moisture field; its root spread stays fixed. Grass casts cached static shadows and its beds follow the local ground normal, avoiding floating downhill roots. The asset uses smooth tapered geometry with varied width, bend and direction; UVs stay inside padded photographic leaf interiors. Geometry supplies the silhouette instead of alpha cutouts that broke scanned ribbons into disconnected pieces. The prior palm-like aloes remain absent. Trees, oasis soil, mountains and rubble retain the approved appearance. The grass source asset is a separate derivative; the original scan, earlier runtime model and candidate comparisons remain preserved.

**Units in grass** stages the four production unit types in an existing clear grass patch. Production dimensions, hover offsets and terrain alignment are retained, with one static idle pose for animated models. It remains a scale and visibility reference rather than a match simulation.
