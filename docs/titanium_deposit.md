# Titanium Deposit

How a Titanium Deposit looks, and how the game shows it. Ivan approved this design for D77-7 on 2026-11-19 ("agree, let's finish with three knuckles", then "go with 8 MiB, approve the rest").

The design answers two complaints about the three models it replaced, which `tools/assets/build_titanium_ore.py` built: they did not fit the terrain, and the better of them read as an ordinary stone, not as a resource to mine. That generator and six invented designs that lost the study (Seam, Blades, Lode, Pod, Cluster and Split lens) are in the repository's history.

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

Without `--seed` it builds `VARIANTS`, seeds 5, 1 and 3, and writes `seed-<n>/deposit.glb` for each, in about two minutes a seed on Boat. The file holds the meshes `full` and `depleted` on one material, so the atlas is stored and uploaded once. The build is deterministic: the same seed gives the same bytes.

A seed draws each mass's place, size, lean, cracks and corner cuts from hand-set ranges, and which planes keep their crust. Seed 5 has the concept's layout, seed 1 swaps the two small masses, and seed 3 moves the dominant mass's crust to its other end. Pick a new seed by looking at it in the game: in drafts, seeds 6 to 8 came out with ore on 67 to 73% of the rock, which is more than the design wants.

The model is made as a high-poly source of about a million triangles, cut down to the triangle budget, and baked with Cycles into one atlas per seed that both states share. Faces that show ore are baked twice, once for each state; every other face has the same texels in both.

Two facts about the game shaped the ore, and hold for any metal in it. The camera and the sun never turn, so the sun's highlight can only fall on surfaces that face one fixed direction (`GLINT` in the generator), about 30 degrees off vertical; ore on tops and shoulders lies near it, and steeper ore carries its sheen in the base color. And there is no environment map, so metal has only the sun to reflect: metalness near 0.45 with a dark base color reads as metal, while pale grey reads as ice or concrete.

## Budget

Measured from the shipped files, `assets/models/titanium-deposit-<seed>.glb`.

| Seed | Triangles, each state | File size, both states | Height | Ore on camera | Mining directions that reach ore first |
| --- | --- | --- | --- | --- | --- |
| 5 | 8,598 | 0.79 MB | 3.03 m | 55% | 90% |
| 1 | 8,600 | 0.76 MB | 2.93 m | 53% | 88% |
| 3 | 8,599 | 0.78 MB | 3.09 m | 60% | 75% |

- A deposit is one mesh with one material: one draw call, and one more in the sun's shadow pass. Only the state it shows is in the scene.
- Texture memory is 8 MiB per variant and 24 MiB for the three, however many deposits a map holds: one 1024 px and two 512 px maps, uncompressed with mipmaps, shared by both states.
- The mining figures come from the generator's own survey: rays from 72 directions, cast by the game's contact rule from 0.7 m outside the footprint. From every direction the ray reaches the model.
- Frame rate was never measured, because Boat has no GPU.

Against the three models this design replaced:

| | Replaced models | This design |
| --- | --- | --- |
| Draw calls per deposit | 1, and 1 in the shadow pass | the same |
| Triangles per deposit | 8,892, 9,030 or 10,044 | 8,598 to 8,600 |
| Texture memory, three variants | 48 MiB | 24 MiB |
| Download, three variants | 2.59 MB | 2.33 MB, with the depleted state included |

Measured in the mining preview scene (`/tools/preview/?scene=mining&mining=0&deposit=N`) on deposits 0, 1 and 2, one of each variant: a frame draws the same 21, 26 and 18 calls as with the replaced models, and 294, 430 and 1,445 fewer triangles, which is exactly the difference between the models.

## In the game

`src/orePresentation.ts` loads the three files once a match. Every deposit shows a clone that shares its variant's geometry, material and textures, so the three variants exist once on the GPU however many deposits a map holds. A deposit's variant is its index modulo three, in the order seeds 5, 1, 3.

The model is scaled so the full mesh's widest reach equals the deposit's radius, set 0.05 m into the ground and never rotated. Nothing in the simulation reads it: the blocked footprint and the mining positions come from the deposit's radius alone.

When a deposit's amount reaches zero, its `full` mesh is taken out of the scene and its `depleted` mesh put in its place, at the same scale. The swap costs one comparison per deposit on each simulation frame and allocates nothing.

## Rebuilding a variant

1. Run the generator on Boat and pull `art/workbench/titanium-three-knuckles/` back.
2. Look at the candidate in the game before installing it: `bun tools/verify/capture-ore.mjs --model <seed-n/deposit.glb> --out <dir> --mine 0` serves it in place of all three variants and captures deposits on sand, among scree rocks and in dry grass at gameplay and close zoom, and a Scout mining. For the depleted state, run it again with `--titanium 0` and without `--mine`: an empty deposit takes no gather order.
3. Copy it to `assets/models/titanium-deposit-<seed>.glb` and copy its entry from the generator's `export.json` into `assets/models/titanium-manifest.json`, with `path` set to the installed file.

`tools/verify/specs/deposit-depletion.spec.ts` mines a deposit out in a live match and checks the swap.

Captures of the approved look in the game, beside the concept and the replaced models, are kept locally in `art/workbench/verify/d77-7/sheets/` (git-ignored).
