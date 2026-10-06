# Terrain generation

`prototypes/terrain-playground/` compares Old terrain and New terrain on Shifting Frontiers maps. The approved New terrain is the main-game default. Generation, shared shaping, environment props and rendering live under `src/`; the page owns reference staging, interaction and diagnostics. The older terrain-topology, terrain-props and ore concept demos have been retired.

## Working on terrain

1. For appearance changes, follow the visual review below before editing. Reproduce the reported seed, player count, camera and quality in the existing hub. The [hub README](../prototypes/terrain-playground/README.md) describes the capture CLI.
2. Change the owner of the behavior: family implementations for strategic layout; generation for heights, smoothing and obstacles; `rockClusters.ts` for embedded outcrops; `terrainRendering/` for shared mesh/material treatment. Keep the hub responsible for controls and diagnostics. This keeps fixes available to every caller without copying demo code into the game.
3. Verify the affected behavior before calling the change complete. Layout/height changes need connected sites, usable entrances, starting pads and alternate routes checked across seeds and supported player counts. Shared rendering changes need checks of both terrain versions and a close view of the affected feature. Keep other generator regression tests when changing shared shaping. Preserve saved reference outputs unless changing the reference is explicitly part of the request.
4. When integrating another family into matches, complete the match-level checks below. The live game currently selects Shifting Frontiers only; other hub families remain experiments.

The visual direction is natural connected landforms with broad, readable fighting areas and deliberate approaches. Preserve smooth buildable floors; concentrate detail at rocky boundaries. Favor embedded rock, irregular deposits and sand-filled contact over detached pebble props or a uniform blurred seam. Wide mountains need shaped interiors rather than flat capped tops. Keep the families strategically distinct as shared appearance evolves.

## Visual review

1. **Baseline.** Identify the user's last approved rendered scene and the selected concept references. Preserve its images, source and exact assets before changing it. `Old terrain` is a different rendering path, not the previous approved `New` version. The [5 October recovery](../art/workbench/renders/terrain-playground/baselines/approved-2026-10-05/README.md) preserves approval evidence and a source checkpoint, but explicitly lists missing historical asset verification; it is not yet a complete runnable baseline. Never substitute current assets silently when reconstructing it.
2. **Experiment.** State one visual defect and change one major factor per comparison: source material, projection/scale, landform shaping, or rendering quality. Capture the reported feature and a representative gameplay view before and after with identical settings. Freeze source/asset writes during captures and review; end stale implementation assignments when the task changes. Preserve candidates separately from approval evidence.
3. **Independent review.** Give a reviewer the matched image pairs, approved scene, concepts and criteria below, without the implementation rationale or a claim that the candidate improved. The reviewer first describes visible differences and chooses which better meets the brief. Technical explanations come afterward. Concept images guide appearance; rendered baselines support controlled comparisons.
4. **Acceptance.** Evaluate the whole result, including qualities the user previously liked. Removing one artifact does not pass a candidate that loses material definition, depth or coherence. Any rejection criterion below blocks a visual-success claim. Keep automated capture status separate from visual verdict; user approval identifies an approved baseline. Preserve an accepted checkpoint's used binary assets as well as source before further edits.

The visual reviewer rejects a candidate when any of these is visible in the relevant gameplay or close views:

- Recognizable repeated stamps or bands dominate the rock, or texture detail stretches/smears over shoulders.
- Caps, faces, ledges and fractures collapse into uniform noise or indistinct rounded masses; the texture implies forms the geometry does not support.
- Sand, exposed rock and debris lose readable material separation, or loose stones and vegetation appear attached without convincing ground contact.
- The scene loses the approved palette, detail hierarchy or fit with the game's buildings and units. Quiet routes and concentrated cliff/vegetation detail must remain readable at gameplay scale.

Record the specific view and visible reason for each verdict. Report visual review, functional tests and performance separately. Connectivity/typechecks do not establish art quality; mesh/texture budgets do not establish FPS. A mechanically successful capture remains unreviewed until its images are assessed.

## Public interface

```ts
import {generateMapLayout, MAP_GENERATORS} from './mapGenerators';
import {createTerrainEnvironment} from './mapGenerators/environment';
import {createMapTerrainGeometry} from './terrainRendering';
import {createEnvironmentMaterial} from './terrainRendering/environmentMaterial';

const environment = createTerrainEnvironment(
  generateMapLayout({generator: 'multiplayer', seed: 56204, players: 6}),
);
const {layout, ground} = environment;
const {geometry, walkGeometry} = createMapTerrainGeometry(layout, ground);
const material = createEnvironmentMaterial(layout.size, layout.seed);
```

Generation is a pure deterministic function with no Three.js/browser dependency. `MapLayout` carries sampled heights, blocked terrain, a rock-contact field, sites with ownership, and entrance metadata. Typed arrays contain `(cells + 1)²` row-major samples, spanning `-size/2` to `+size/2` in X and Z. `sampleMapField` provides bilinear sampling. Output can cross a worker boundary.

`MAP_GENERATORS` in `src/mapGenerators/index.ts` is the source of truth for generator names, descriptions and supported player counts. `MapGeneratorId` and `MapRequest` live in `types.ts`; the source dispatch lives beside the registry. Other families remain available to source callers and regression tests. The hub deliberately exposes only Old terrain and New terrain for the `multiplayer` family, supporting two, four or six players. This family currently describes free-for-all layouts, not team placement.

The terrain selector uses `variant=old` or `variant=new`; previous `variant=oxide-wilds` links normalize to `new`. The `procedural` generator remains an internal saved reference for regression fixtures. Reference fixtures in `tests/mapGenerators/` preserve selected height fields and landmarks, not frozen screenshots: shared materials may evolve. The six-player optimization hashes specifically exercise the reference mountain profile.

## Generation and shared appearance

Each family owns its strategic layout. Shifting frontiers samples territories, connects neighbors, places bases and expansions, assigns elevations and blocked mountain regions, and selects ramps. Warped borders, smooth cliff shoulders and rounded mountain ridges turn that structure into a height field. Its reference profile remains pinned to saved outputs. The live profile uses a bounded summit envelope below 36 units including outcrops, plus small embedded outcrops; massif width adds neither summit height nor face width. A narrow, steep main face sits between a small talus foot and rounded shoulder so blocked mountains read as obstacles, even beside elevated terraces. Each mountain territory contributes one prominent asymmetric ridge aligned with its landform; joined territories form saddles. Keep shoulders lower than those summits. Avoid both dense raised blocks (organic folds) and low-amplitude global noise (flat-looking lids). Sediment fills low areas between ridges instead of carving stamped basins. Small wind drifts and embedded fragments give that fill surface relief; the material adds crushed parent-rock detail near its edges. Use the hub’s sediment capture to inspect this at close range. Its rock-contact field exposes sand where the deposited surface covers bedrock, while the blocked mask remains intact. They are not ground-unit routes or implemented flying-unit destinations.

Shared outcrop generation in `src/mapGenerators/rockClusters.ts` embeds rocks into the same surface, including buried shoulders, exposed material and obstacle footprints. Families share that treatment without sharing the same strategic layout. Keep gameplay-affecting smoothing in generation: moving visible vertices after navigation sampling would make the two surfaces disagree.

`src/terrainRendering/` builds the visible surface from `MapLayout` and applies the production sand/dirt material with continuous triplanar rock contact. A shared distance-from-rock field confines dusty deposits and textured fragments to irregular aprons near exposed rock. Summit sand masks must remain continuous across depth transitions; hard gates expose the sampling grid. Triplanar projection weights and material masks use continuous, unperturbed object-space normals. Fragment-derived face normals expose triangle boundaries in those blends; derivatives are used only for texture filtering and tangent frames. This material treatment leaves collision and heights unchanged. It owns the shared render treatment, independently of camera, labels and demo controls. `patchWeights.ts` is also used by the existing live terrain renderer. Geometry creation returns a walkability overlay for diagnostics; callers own and must dispose both geometries and their material. The material's base texture also needs disposal; its secondary textures are disposed by the material's existing lifecycle hook.

## Validation

`bun run test:terrain` runs tests in `tests/mapGenerators/`. They cover seed variation, flat starting pads, connected sites and ramp interiors, alternate routes around the center, and saved reference outputs. Procedural acceptance uses three world units of clearance on the complete surface.

`bun run preview:capture:terrain-hub` captures Old/New terrain for two, four and six players, checks controls and reports browser errors. Focused cliff and summit capture scripts live beside the hub. Normal TypeScript checks include the page as well as `src`. `tests/terrainRendering.test.ts` covers the shared contact-distance calculation and runs in the main test suite; `test:terrain` alone covers generator tests. Use `package.json` for the current command definitions.

For performance changes, measure generation separately from mesh construction/page load using the hub benchmark. Reuse validated fields and precomputed region data; keep bypass-test masks separate from the returned collision mask.

## Live game integration

`src/map.ts` requests Shifting Frontiers (`multiplayer`), then runs the pure `createTerrainEnvironment` pipeline used by the hub's New terrain. That pipeline applies biome shaping, deterministic props and alluvial ground cover, then adds tree trunks to the final obstacle mask. The game adapts this final layout into its surface and placement grid. `src/environmentProps.ts` and `src/terrainRendering/environmentMaterial.ts` provide the same approved models/material to both callers. The main encounter uses six-player terrain, but `combatProofEncounter.ts` deliberately puts the enemy at the nearest expansion rather than a remote player start. Preserve that short combat-testing trip when changing layouts. A family-selection UI is not implemented.

Rendering and Recast consume the same final heights, fixed triangle diagonals and obstacle mask. Mountains, substantial rubble and tree trunks block navigation and construction; grass and low shrubs remain walkable. Navigation uses actual elevation and slope constraints. Scout Drones and Hornets share the ground navigation used by other units. Buildings update that navigation; construction also checks terrain variation and entity overlap.

`tests/frontiersIntegration.test.ts` checks production Recast routes to sites, building footprints, nearby combat access, Scout/Hornet movement, trunk and rubble obstacles, and walkable grass. `tests/navigation.test.ts` covers cliff ramps, large-unit clearance and dynamic building obstacles. Generation checks in the hub supplement these production checks; they do not replace them.

The user approved the v10 grass and unit-scale scene for production. Its [source/asset checkpoint](../art/workbench/renders/terrain-playground/reviews/2026-10-06-grass-units/checkpoint/manifest.json) is preserved; the shared presentation extraction matches all seven saved views [pixel for pixel](../art/workbench/renders/terrain-playground/reviews/2026-10-06-production-integration/approved-comparison.json). The [production asset manifest](../assets/models/terrain/manifest.json) records the six GLBs and nine surface maps copied without reprocessing. Static Vite URLs bundle these assets; production imports no prototype or workbench files.

The previous `generatedTerrain.ts` / `graphTerrain.ts` pipeline remains for legacy studies/tests but is no longer selected by the game. New integration work should use `MapLayout` rather than adding legacy graph metadata.

Connectivity checks do not establish competitive balance. Travel distances, resource fairness, team placement and room for a full base still need broader playtesting. For another family, verify its actual building footprints and largest-unit Recast routes before enabling it in matches.

## Approved environment

`MapLayout.regions` exposes the existing strategic territories and adjacency; `regionIds` follows their contour-warped boundaries at every terrain sample. Families without that region structure return empty metadata and IDs of -1. Heights and the existing obstacle/rock-contact fields are unchanged by exposing this data.

New terrain uses `createTerrainBiomes` to assign neighboring floor territories to sheltered oasis habitat. Seeded dry-valley spacing preserves the established oasis territories; additional separated floor territories distribute groves across the map without filling central lanes. Basalt and rejected ore props remain absent. `createBiomeTerrain` copies the generated layout and sculpts fractured oxide ledges and connected talus fans while preserving construction pads, ramps and primary/bypass corridors. Rendering, production navigation and construction consume the same revised heightfield and final obstacle mask.

The approved mountains use Cliff Side at 12 m on steep faces and matched Rock Face 03 color/normal maps at 7 m on upward-facing bedrock. Continuous projection weights join the materials. The 5.5 m ledge profile retains bounded lateral contour weathering inside the protected mountain mask, without adding vertices. Summit drainage-cut depth is 3.2 m; it softens cap separation without eliminating close-up texture repetition. The [earlier vegetation checkpoint](../art/workbench/renders/terrain-playground/baselines/approved-2026-10-06-vegetation/README.md) and [mountain comparison](../art/workbench/renders/terrain-playground/reviews/2026-10-06-mountains.md) preserve the preceding approval evidence. Source processing lives in `prepare_biome_scree.py`; the production manifest records the shipped maps.

Talus and buttress influence must fade the entire height contribution, including the parent cliff's floor. Fading only the added relief lets a high foot stamp a straight-sided raised slab onto a lower terrace. The focused biome-terrain regression preserves the curved terrace near Base C in seed 56204.

`createBiomeFeatures` places loose rock before sheltered groves and understory. Grass follows the continuous oasis moisture field across open alluvial ground as well as beneath trees. Preserve this connected coverage outside canopies. The approved v10 asset uses low, fine, muted blades with varied widths and bearings, mapped inside padded photographic leaf interiors; opaque geometry avoids internal alpha holes. Beds follow the local ground normal because center-height placement alone leaves downhill roots floating. The hub's **Units in grass** view checks the approved cover against production-scale units. Remove disconnected fragments at dry and rocky edges before placing shrubs into supported grass. Dry-edge blades shorten with moisture while preserving their horizontal root spread. Palm-like aloes remain omitted. Every planting pass checks its root footprint against exposed rock and rubble, and plant presentation preserves authored root origins. `createBiomeGround` derives alluvial soil from the same moisture field. `createTerrainEnvironment` combines the rock and trunk masks for both production navigation and construction; grass and low shrubs remain walkable.

The hub omits ore and match simulation. See [COMPOSITE.md](../prototypes/terrain-playground/COMPOSITE.md) for shared appearance and reference staging.
