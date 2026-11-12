# Construction animation

How a building looks while Scout Drones construct it. Ivan approved this design for D77-5 on 2026-11-12 ("C, go with the scaffold"), and the game uses it: `src/constructionSites.ts` owns the look, with its parts in `src/construction/`, and `UnitSystem` drives one site per building under construction. It replaced a vertical stretch of the finished model.

The two looks that lost the study, a layer-by-layer print with a cyan blueprint and a piece-by-piece assembly, are in the repository's history: they were removed by the commit "Keep only the approved scaffold option in the construction animation study".

## The look

A physical scaffold stands around the site from the moment it is placed. The real building rises inside it from the ground up, and the scaffold drops away when the building is complete. Everything is driven by four values: construction progress from 0 to 1, whether a drone is working, the site's health, and the time since the site completed or was destroyed.

| State | What the player sees |
| --- | --- |
| Just placed, 0%, no drone yet | The scaffold at full size on a dusty plate pad with striped kerbs. Cyan lamps on the posts blink slowly. No sparks, no building. |
| Drone working | The finished model is shown up to a horizontal cut at `progress × height`. The newest band under the cut is bare steel. A dark deck of girders and joists closes the cut, its rim carries a hot seam, and weld arcs with falling sparks hop around the hull at that height. For up to 0.7 m above the cut the hull stands as an open ochre steel frame, so the next course shows its shape before it is clad. The drone's beam ends at the cut. In the first 0.9 s of work the first layer spreads out from under the beam as a growing disc. |
| Paused, no drone working | Arcs, seam and glow go out, the deck turns dark steel, and the lamps blink. Nothing moves except the lamps. |
| Damaged before completion | Rails and braces hang or go missing in proportion to lost health, and dark smoke rises where they broke, from more places as health falls. Posts, feet and the pad always stand. The game's health bar still carries the exact value. |
| Destroyed before completion | The scaffold drops into the ground in 0.24 s with a skirt of dust. The building stays cut at the height it had reached, with its deck and frame, and fades out over the 0.8 s every destroyed building takes. D77-6 owns what happens to that stump. |
| Completion | The building is the untouched model from the first frame. The scaffold's walls drop into the pad, the pad sinks after them, all within 0.5 s, and the dust is gone by 0.9 s. One second after completion nothing of the site is left. |

The scaffold is ochre bronze with graphite braces, from the Aged desert palette, so it never reads as part of the ivory building. It casts a shadow. The cut building casts only the shadow of its built part and its frame.

## How it fits any building

Nothing is authored per building. Three things are derived from the loaded model:

- **The hull outline.** `measureOutline` slices every triangle once per building kind into 48 height slices and 128 compass directions, giving how far the hull reaches from its vertical axis at each height. It also finds the main roofline, the height up to which a slice keeps at least 10% of the largest slice's area, and the open air between separate parts of one section, such as the space between the Turret's two barrels.
- **The scaffold.** Its ground plan is the eight-sided shape that hugs the outline, 0.15 m outside the hull. It is square to the map, not to the building, so every site stands the same way to the fixed camera. It stops at the main roofline, so a dish or a mast stands proud of it. Sides that face the camera stay open down to their kerb, so the building's front reads through. Kit members are fitted to a side by scaling them along their own length only, so tubes keep their thickness on a 3.6 m Turret and an 11 m Command Center alike. The pad and kerbs reach 0.5 m below the ground, so a site on the steepest slope placement allows (0.75 m across the footprint) never hangs in the air.
- **The cut.** The model's own material is patched to discard what is not built yet, to draw the open frame above the cut, and to draw the newest band and every face the finished hull seals inside itself as bare steel. Sealed faces are found from the contact shading that `tools/assets/building_bake.py` already stores in the red channel of the roughness map; a model without it falls back to the plain band. The deck that closes the cut is a fan whose rim reads its radius from the outline table at the cut height, and which leaves the recorded open air open.

The scaffold kit (posts, rails, braces, feet, pad plates, kerbs, lamps) comes from the Blender generator `tools/assets/build_scaffold_kit.py`; the game loads `assets/models/scaffold-kit.glb`. After changing the generator, rebuild and copy it, then update `assets/models/procedural-manifest.json`:

```sh
box blender --background --python-exit-code 1 --python tools/assets/build_scaffold_kit.py
box pull art/workbench/procedural-scaffold-kit/
cp art/workbench/procedural-scaffold-kit/scaffold-kit.glb assets/models/
```

A model that failed to load is shown as its translucent placeholder and is never shown being built.

## Picking

The site is picked through what is visible. Each site has a pick object under its root that answers click rays for the scaffold as it currently stands, pad included, and the building's own raycast drops hits above the cut. At default zoom a click can hit 4,068 px of a Turret site and 29,304 px of a Command Center site at 0%, against 2,628 px and 24,660 px for the finished buildings. The stretch gave 1,872 px for a Turret site at 0%.

## Cost

Measured in the construction preview with 5 Command Centers and 5 Turrets under construction at once, with 7 working drones and their beams, shadow pass included. Draw calls and triangles are exact counts from `renderer.info`. The CPU times are single runs on Boat, which renders in software; they are far below a 16.7 ms frame, so their spread does not change the picture.

| | Stretch (before) | Scaffold |
| --- | --- | --- |
| Draw calls, 10 finished buildings | 175 | 175 |
| Triangles, 10 finished buildings | 5,942,803 | 5,942,803 |
| Draw calls, 10 sites | 196 | 200 |
| Draw calls, 10 sites, in a browser without `WEBGL_multi_draw` | 196 | 238 |
| Triangles, 10 sites | 5,978,671 | 6,035,351 |
| CPU per frame for 10 sites | 0.0017 ms | 0.025 ms |
| Preparing a site | 0 ms | up to 2.1 ms (Command Center), 0.4 ms (Turret) |
| Measuring a building kind, once | none | 19 to 21 ms |

A finished building costs nothing extra. The four extra draw calls are shared by every site, so they do not grow with the number of sites: one for all scaffolds, one for their shadow, one for all decks, and one for all sparks, lamps, dust and smoke. The per-frame CPU cost is spark placement.

Chrome, Edge and Safari 15 or newer draw all scaffolds in one call through `WEBGL_multi_draw`. Firefox does not have the extension, and three.js then draws a `BatchedMesh` one entry at a time. Each site's scaffold is therefore welded into two entries, its walls and its pad, so a site costs two draws and two shadow draws there, instead of one per scaffold member (about 450 for a Command Center).

Every shader a site needs is compiled at startup with the others, by `UnitSystem.prepareRendering` (see `tools/verify/PERFORMANCE.md`), and each building kind's hull is measured when its model loads.

Not measured, because Boat has no GPU: GPU fill cost, and frame times on real hardware.

## Preview scene and checks

`tools/preview/construction/` renders the production module on the game's terrain, lighting and camera angle, with nothing but progress and site state driving it. Open `/tools/preview/construction/?shot=<shot>` on the dev server, or capture every shot to `art/workbench/renders/previews/construction/`:

```sh
box 'bun run dev >/tmp/vite.log 2>&1 &
  until curl -sf -o /dev/null http://localhost:5173; do sleep 1; done
  bun run preview:capture:construction'
box pull art/workbench/renders/previews/construction/
```

`CONSTRUCTION_SHOTS=gameplay,perf` narrows a run to the named shots. Boat has no GPU, so films are stepped frame by frame and encoded at 30 frames per second.

- `gameplay`, `turret-close`, `command-center-close`: both buildings at 0, 15, 50, 85 and 100%, at the game's default zoom (43.1 m view height) and its closest (14.4 m).
- `states`, `states-turret`, `states-command-center`: just placed, drone working, paused, damaged, destroyed before completion.
- `completion`, `completion-turret`, `drop`, `drop-turret`: the moment of completion and the last frames of the scaffold's drop.
- `destroyed`, `destroyed-turret`, `damage`, `damage-turret`: a site at 40% losing health, and after it is destroyed.
- `first-layer`, `first-layer-turret`, `cuts-turret`, `cuts-command-center`, `shoulders`, `barrels`: the cut at the heights where it once looked wrong.
- `fit`, `slope`: buildings turned 0, 30, 45, 77 and 180 degrees side by side, and a Command Center on the steepest slope placement allows.
- `film`, `film-turret`, `film-command-center`, `film-loss`, `film-loss-turret`: a build at real Turret speed with the drone leaving for 1.5 s, 12 s of a Command Center build at its real pace, and a site shot at and destroyed.
- `perf`: the cost table above, written to `perf.json`.

A new building needs no work here, but look at it in `gameplay` and `fit` once: the outline assumes one main hull around the model's vertical axis.

`tools/verify/specs/construction.spec.ts` builds a Turret and a Command Center in the live game through real clicks: it places the site, stops the drone, selects and resumes the site through its scaffold at 0%, pauses it, and follows it to completion. Nothing in the game can damage a player's site yet (guards and Turrets only target units, and the enemy does not build), so the damaged and destroyed states are covered by the preview scene and by `tests/unitPresentation.test.ts`.

## Shared with D77-6, destruction and death effects

- A site destroyed before completion keeps its cut material, frame and deck, so the unbuilt part never pops back in. `ConstructionSite.fadeStump` is the stand-in for what D77-6 does with that stump.
- `ConstructionSites.effects` is one `GlowEffects`: one instanced set of quads for sparks, lamp glows, dust and smoke, drawn in one call for the whole world. Any owner can ask it for its own list of glows, so destruction effects can add dust and smoke without another draw call.
- The scaffold's drop takes one 0-to-1 value (`Cage.set`) and could become falling debris on destruction.

## Not verified

- A real GPU. Every capture, in the preview and in the live game, was rendered in software on Boat, where the live game draws 2 to 3 frames per second. Motion was judged from stepped films and frame sequences.
- Firefox itself. The cost without `WEBGL_multi_draw` was counted by hiding the extension from three.js in Chromium.
- Enemy-owned sites, since the enemy does not build yet.
