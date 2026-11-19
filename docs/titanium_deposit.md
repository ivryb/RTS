# Titanium Deposit

How a Titanium Deposit looks. Ivan approved this design for D77-7 on 2026-11-19 ("agree, let's finish with three knuckles", then "go with 8 MiB, approve the rest"). The game does not use it yet: it still shows the three models from `tools/assets/build_titanium_ore.py`. [What the build has to do](#what-the-build-has-to-do) lists the steps that put it in.

The design answers two complaints about the shipped models: they did not fit the terrain, and the better of them read as an ordinary stone, not as a resource to mine. Six invented designs lost the study (Seam, Blades, Lode, Pod, Cluster and Split lens). Their generators are in the repository's history, removed by the commit "Remove the six rejected Titanium Deposit sketches".

## The look

Every deposit is a **Three knuckles** outcrop, after the concept image `art/workbench/terrain-composite/ore-designs-v2/three-knuckles.png` (local, git-ignored): three rock masses that touch, a long low dominant one behind, a half-size and a quarter-size one in front of its ends. A player can count the three at gameplay zoom. They are the broken top of one ore bed with a sandstone skin:

- The **crust** is the terrain's own tan sandstone, built from the cliff and scree textures, with hairline cracks and chipped edges. It holds on part of each top, on corners, in a hem under the tops it covers, and in a low band at the feet, where sand is banked against it.
- The **ore** is the rock itself where the crust has broken away: dark graphite faces with bright silver veins along the main cracks, silver chip edges, and real sun highlights on the tops and shoulders. It covers a little over half of what the camera sees. Ore sits a few centimetres behind the crust's rim, so the two are plainly one rock.

| State | What the player sees |
| --- | --- |
| Full | The three masses with tan crust and dark, silver-veined ore, about 3 m tall. The grey ore is what sets it apart from every other rock on the map. |
| Being mined | The same model. A Scout Drone stands 0.3 m outside the blocked circle and its laser ends on the nearest rock, on ore from most directions. The rock does not change while it is mined. |
| Depleted | The same three masses in the same place, all tan. Where each ore face was, the rock is stepped back block by block along its joints, dusty and a shade greyer than the crust, with sand on the ledges. No grey, no sheen. At gameplay zoom it reads as ordinary terrain rock. The game swaps to this model when the deposit's amount reaches zero. |
| Among ordinary rocks | Scree rocks are brown and rounded; a full deposit is larger, angular, and the only grey thing among them. A depleted one blends in with them, which is the point. |

Decisions Ivan made:

1. Three knuckles is the one composition. Split lens and eroded window are dropped.
2. Three variants, which are three seeds of the one generator. A deposit's variant stays `index % 3`.
3. Two states, full and depleted, with no steps in between.
4. Color at 1024 px, normal and roughness-metallic maps at 512 px.

Accepted at approval, and worth another pass if the look is tuned later: the masses are blockier and flatter-faced than the concept's rounded knuckles; the crust comes in larger pieces, and in seed 1 sits above the ore in a band; the ore is darker and more line-drawn than the concept's broad silvery facets; the concept banks more sand at the feet.

## How the variants are generated

`tools/assets/build_titanium_three_knuckles.py` builds everything, and its docstring describes each stage:

```sh
box 'blender --background --threads 8 --python-exit-code 1 --python tools/assets/build_titanium_three_knuckles.py -- --out art/workbench/titanium-three-knuckles'
```

Without `--seed` it builds `VARIANTS`, seeds 5, 1 and 3, and writes `seed-<n>/full.glb` and `seed-<n>/depleted.glb` for each, in about two minutes a seed on Boat. The build is deterministic: the same seed gives the same bytes.

A seed draws each mass's place, size, lean, cracks and corner cuts from hand-set ranges, and which planes keep their crust. Seed 5 has the concept's layout, seed 1 swaps the two small masses, and seed 3 moves the dominant mass's crust to its other end. Pick a new seed by looking at it in the game: in drafts, seeds 6 to 8 came out with ore on 67 to 73% of the rock, which is more than the design wants.

The model is made as a high-poly source of about a million triangles, cut down to the triangle budget, and baked with Cycles into one atlas per seed that both states share. Faces that show ore exist twice, once for each state; every other face is shared.

Two facts about the game shaped the ore, and hold for any metal in it. The camera and the sun never turn, so the sun's highlight can only fall on surfaces that face one fixed direction (`GLINT` in the generator), about 30 degrees off vertical; ore on tops and shoulders lies near it, and steeper ore carries its sheen in the base color. And there is no environment map, so metal has only the sun to reflect: metalness near 0.45 with a dark base color reads as metal, while pale grey reads as ice or concrete.

## Budget

Measured from the exported files.

| Seed | Triangles, each state | File size, full / depleted | Height | Ore on camera | Mining directions that reach ore first |
| --- | --- | --- | --- | --- | --- |
| 5 | 8,598 | 0.48 / 0.50 MB | 3.03 m | 55% | 90% |
| 1 | 8,600 | 0.47 / 0.48 MB | 2.93 m | 53% | 88% |
| 3 | 8,599 | 0.48 / 0.49 MB | 3.09 m | 60% | 75% |

- One mesh, one material and one draw call per deposit.
- Texture memory is 8 MiB per variant and 24 MiB for the three, however many deposits a map holds: one 1024 px and two 512 px maps, uncompressed with mipmaps. The shipped models take 16 MiB each, 48 MiB together, at 8,892 to 10,044 triangles.
- The mining figures come from the generator's own survey: rays from 72 directions, cast by the game's contact rule from 0.7 m outside the footprint. From every direction the ray reaches the model.
- Frame rate was never measured, because Boat has no GPU.

## What the build has to do

Nothing in the simulation changes: the blocked footprint and the mining positions stay as they are, and the model is still scaled so its widest reach equals the deposit's radius, unrotated.

1. Load a variant's two states with one atlas. As exported, `full.glb` and `depleted.glb` each embed their own copy of the same textures, which doubles the download and, loaded as two files, the texture memory. Export both states into one GLB per variant, or share the textures at load.
2. In `src/orePresentation.ts`, show a deposit's depleted mesh once its amount reaches zero.
3. Copy the accepted GLBs to `assets/models/`, replace `titanium-manifest.json`, and retire `build_titanium_ore.py` with the three old models and their source maps under `assets/source/polyhaven/titanium/`.
4. Update the "Titanium outcrops" section of [assets](assets.md).
5. Check it in the game with `bun tools/verify/capture-ore.mjs --out <dir> --mine 0`, which captures deposits on sand, among scree rocks and in dry grass at gameplay and close zoom, and a Scout mining.

Captures of the approved look in the game, beside the concept and the shipped models, are kept locally in `art/workbench/verify/d77-7/sheets/` (git-ignored).
