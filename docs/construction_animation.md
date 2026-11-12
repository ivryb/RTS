# Construction animation

How a building looks while Scout Drones construct it. This is the design Ivan approved for D77-5 on 2026-11-12 ("C, go with the scaffold"). It replaces the vertical stretch in `UnitSystem.renderBuilding` (`visualRoot.scale.y = 0.15 + progress * 0.85`). The design is approved; the game does not use it yet. A build task turns the sketch into production code.

The working sketch is `prototypes/construction-animation/options/scaffold.ts` with its helpers in `options/scaffold/`, run through the study harness described in the [study README](../prototypes/construction-animation/README.md). The two looks that lost, a layer-by-layer print with a cyan blueprint and a piece-by-piece assembly, were removed from the tree; they are in this branch's history at commit `a286359`.

## The look

A physical scaffold stands around the site from the moment it is placed. The real building rises inside it from the ground up, and the scaffold drops away when the building is complete. Everything is driven by construction progress from 0 to 1, whether a drone is working, the site's health, and the time since the site completed or was destroyed.

| State | What the player sees |
| --- | --- |
| Just placed, 0%, no drone yet | The scaffold at full size on a dusty plate pad with striped kerbs. Cyan lamps on the posts blink slowly. No sparks, no building. |
| Drone working | The finished model is shown up to a horizontal cut at `progress × height`. The newest band under the cut is bare steel. A dark ribbed deck closes the cut, its rim carries a hot seam, and weld arcs with falling sparks hop around the hull at that height. The drone's beam ends at the cut. The first layer spreads out from under the beam during the first 2% of progress. |
| Paused, no drone working | Arcs, seam and glow go out, the deck turns dark steel, and the lamps blink. Nothing moves except the lamps. |
| Damaged before completion | Rails, braces and planks hang or go missing in proportion to lost health; posts, feet and the pad always stand. The game's health bar still carries the exact value. |
| Destroyed before completion | The scaffold drops into the ground in 0.24 s with a skirt of dust. The building stays cut at the height it had reached, with its deck. D77-6 owns what happens to that stump. |
| Completion | The building is the untouched model from the first frame. The scaffold drops into its pad in 0.5 s and the dust is gone by 0.9 s. One second after completion the frame is pixel-identical to a normal finished building. |

The scaffold is ochre bronze with graphite braces, from the Aged desert palette, so it never reads as part of the ivory building. It casts a shadow. The cut building casts only the shadow of its built part.

## How it fits any building

Nothing is authored per building. Three things are derived from the loaded model:

- **The hull outline.** `measureOutline` slices every triangle once per building kind into 48 height slices and 128 compass directions, giving how far the hull reaches from its vertical axis at each height. It also finds the main roofline: the height up to which a slice keeps at least 10% of the largest slice's area.
- **The scaffold.** Its ground plan is the eight-sided shape that hugs the outline, 0.15 m outside the hull. It is square to the map, not to the building, so every site stands the same way to the fixed camera. It stops at the main roofline, so a dish or a mast stands proud of it. Sides that face the camera stay open down to their kerb, so the building's front reads through. Kit members are fitted to a side by scaling them along their own length only, so tubes keep their thickness on a 3.6 m Turret and an 11 m Command Center alike.
- **The cut.** The model's own material is patched to discard everything above the cut height and to draw the newest band, and every face the finished hull seals inside itself, as bare steel. Sealed faces are found from the contact shading that `tools/assets/building_bake.py` already stores in the red channel of the roughness map; a model without it falls back to the plain band. The deck that closes the cut is a fan whose rim reads its radius from the outline table at the cut height.

The scaffold kit (posts, rails, braces, pad plates, kerbs, lamps) comes from the Blender generator `tools/assets/build_scaffold_kit.py`, as the art rules require. The study keeps a copy of the exported GLB at `prototypes/construction-animation/options/scaffold/scaffold-kit.glb`.

## Picking

The site is picked through what is visible. Each site has a pick object under its root that raycasts the scaffold members as placed, pad included, and the building's own raycast drops hits above the cut. At default zoom a click can hit 3,492 px of a Turret site and 27,936 px of a Command Center site at 0%, against 2,628 px and 24,660 px for the finished buildings. Today's stretch gives 1,872 px for a Turret site at 0%.

## Cost

Measured in the study harness with 5 Command Centers and 5 Turrets under construction at once, with 7 working drones and their beams, shadow pass included. Draw calls and triangles are exact counts from `renderer.info`. The CPU times are single runs on Boat, which renders in software; they are far below a 16.7 ms frame, so their spread does not change the decision.

| | Today's stretch | Scaffold |
| --- | --- | --- |
| Draw calls, 10 finished buildings | 175 | 175 |
| Triangles, 10 finished buildings | 5,942,803 | 5,942,803 |
| Draw calls, 10 sites | 196 | 200 |
| Triangles, 10 sites | 5,978,671 | 6,037,951 |
| CPU per frame for 10 sites | 0.0008 ms | 0.031 ms |
| Shader programs at rest | 13 | 17 |
| Shader programs added by the first site | 2 | 5 |
| Preparing a site | 0 ms | up to 1 ms (Command Center), 0.3 ms (Turret) |
| Measuring a building kind, once | none | 10 to 13 ms (Command Center), 6 to 9 ms (Turret) |

A finished building costs nothing extra. The four extra draw calls are shared by every site, so they do not grow with the number of sites: one for all scaffolds, one for their shadow, one for all decks, one for all sparks, lamps and dust. The extra 59,280 triangles are scaffold members. The per-frame CPU cost is spark placement.

Not measured, because Boat has no GPU: the hitch when a shader program first compiles, and GPU fill cost.

## For the build

These follow from the sketch and from two independent reviews of its captures. The reviewer's reports are not in the repository; the points that matter are here.

Integration:
- Replace the stretch in `UnitSystem.renderBuilding`, and the squash in `updateBuildingDestruction` for a site destroyed before completion, with this presentation. The simulation is untouched.
- "Working" is true while any Scout Drone has the site as `constructionTargetId`, has the `build` order, and is not moving; this is the same test that shows the construction beam.
- Progress arrives per simulation tick. Interpolate it per frame, or the cut rises in steps on a 60 s build.
- In the game a site's health grows with progress, so pass damage as health relative to what the built part should have.
- Point the drone beam at the cut height (`beamTargetY` in the sketch); today it ends 0.8 m above the ground.
- Measure a building kind's outline when its model loads, not when the first site is placed, and compile the shader programs with the others at startup (see `tools/verify/PERFORMANCE.md`).
- The sketch draws every scaffold through one `BatchedMesh`. Without the `WEBGL_multi_draw` extension three.js falls back to one draw call per member. Check support on the browsers we care about, or build one merged mesh per site, which costs one draw call per site instead.
- Copy the accepted kit GLB to `assets/models/` and record it in `assets/models/procedural-manifest.json`.

Rough edges the reviews found, to fix before it ships:
- At 15% both buildings are mostly a flat grid deck; the early build needs more to look at than a plate.
- The first layer spreads from a ragged blob in 3 to 4 frames at the start of work.
- Faint grid patches lie on the Command Center's ivory shoulders at 39 to 41% and look like z-fighting.
- Paused is weak on the Command Center at default zoom, where the lamps are 2 to 3 px dots.
- Damage is nearly invisible at default zoom.
- Four dark dots outlive the posts for one frame as the scaffold drops.
- The Turret head's deck fills the gap between its barrels, and cut pad plates show faint seams at the closest zoom.

Not yet verified:
- A real GPU and the live game. Every capture was rendered in software in the preview harness.
- Building rotations other than 0 and 45 degrees, sites on slopes (placement allows 0.75 m of height variation), sites next to other buildings, and enemy-owned sites.
- The films were judged from frames, not watched in motion.

States to verify in the build, at default and closest zoom, on the Turret and the Command Center: just placed with no drone; drone working at several progress values; paused; damaged; destroyed before completion; the moment of completion and the finished building after it. The harness has a shot for each.

## Shared with D77-6, destruction and death effects

- A site destroyed before completion must keep the cut material and its deck, or the unbuilt part pops back in before the destruction effect starts.
- The effects set in `options/scaffold/effects.ts` (one instanced set of quads for sparks, lamp glows and dust, drawn in one call for every site) and its dust can serve destruction too.
- The scaffold's drop takes one 0-to-1 value and could become falling debris on destruction.
