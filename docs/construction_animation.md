# Construction animation

How a building looks while Scout Drones construct it. Ivan approved this design for D77-5 on 2026-11-12 ("C, go with the scaffold"), and the game uses it: `src/constructionSites.ts` owns the look, with its parts in `src/construction/`, and `UnitSystem` drives one site per building under construction. It replaced a vertical stretch of the finished model.

The two looks that lost the study, a layer-by-layer print with a cyan blueprint and a piece-by-piece assembly, are in the repository's history: they were removed by the commit "Keep only the approved scaffold option in the construction animation study".

## The look

A physical scaffold stands around the site from the moment it is placed. The real building rises inside it from the ground up, and the scaffold drops away when the building is complete. The Scout Drone that builds it hovers at the edge of the rising building and welds it with two small arms, as [the builder](#the-builder) describes. The site is driven by four values: construction progress from 0 to 1, whether a drone is working, the site's health, and the time since the site completed or was destroyed. A site carries one thing from frame to frame, its weld (how strongly the arcs burn and how hot the steel is), so both can fade when the drone starts and stops.

| State | What the player sees |
| --- | --- |
| Just placed, 0%, no drone yet | The scaffold at full size on a dusty plate pad with striped kerbs. No sparks, no building. |
| Drone working | The finished model is shown up to a horizontal cut at `progress × height`. The newest band under the cut is bare steel. A dark ribbed deck closes the cut, glowing only near its rim, which carries a hot seam, and weld arcs with falling sparks hop around the hull at that height. The drone welds the edge on its own side with its two arms. In the first 0.9 s of work the first layer spreads out as a growing disc. |
| Paused, no drone working | The arcs die in 0.2 s, and the seam and the deck's glow cool to dark steel in 0.8 s. When the drone comes back the arcs strike in 0.2 s and the glow returns in 0.4 s. A drone that stops and resumes sooner than that turns each fade round from where it is, so nothing jumps. Nothing moves on a paused site unless it is damaged and smoking. |
| Damaged before completion | Rails and braces hang or go missing in proportion to lost health, and dark smoke rises where they broke, from more places as health falls. Posts, feet and the pad always stand. The game's health bar still carries the exact value. |
| Destroyed before completion | The scaffold drops into the ground in 0.24 s with a skirt of dust. The building stays cut at the height it had reached, with its deck, and sinks into pale dust over 1 s, leaving a heap of rubble: [destruction and death effects](death_effects.md) stage that. |
| Completion | The building is the untouched model from the first frame. The scaffold's walls and feet drop into the pad, the pad and its kerbs sink after them, all within 0.5 s, and the dust is gone 1 s after completion, when nothing of the site is left. |

The scaffold is ochre bronze with graphite braces, from the Aged desert palette, so it never reads as part of the ivory building. It casts a shadow. The cut building casts only the shadow of its built part.

The cyan lenses of the lamps on the scaffold's posts are lit the same in every state. Until D77-12 they blinked brighter on a site with no drone, and Ivan asked for them to stay as they are. A paused site is told from a working one by what is missing (the drone, its arms, the arcs and the glow) and by the selected site's panel, which reads "paused".

## The builder

Ivan asked for this in D77-13: "drone should also be animated - it should look towards building and do something with a laser like a scanning animation with a matrix laser". Before it, a one-pixel line joined the drone to the cut, and the drone faced wherever it had flown in from. He saw a red beam, then a blue scanning fan, then four sketches side by side (the scanner, welding, hammering, drilling) and chose the welding, with two changes. In the sketch the drone welded with its nose: "it works as if the drones are kissing the building, like they are getting too close to it. I think instead there should be some tools ... some tiny little hands or wrenches ... So some tools are appearing from the drone and the drone constructs the building with these tools, not with its own head."

| Moment | What the player sees |
| --- | --- |
| Flying in | On its last 8 m to the site the drone starts to rise, so it arrives at the height it works at. It stops beside the site and turns its nose to the middle of it. |
| Working | It hovers half a metre above the highest edge of the building it can reach, and climbs with it. It leans in until its nose is 0.7 m from that edge, or backs off by up to 0.8 m where it stands nearer (beside the foot of a wide hull its nose would be over the edge), and stays there. Two thin jointed arms, each 1.36 m long, in the drone's own graphite with ivory joints, come out of its hull to the left and right of its nose, elbows out to the sides. Each ends in a torch with a small pilot flame. An arm holds its torch on a spot of the edge on its own side for about 0.9 s, with an arc and falling sparks, and draws the arc 0.16 m along the edge. Then it lifts 0.3 m off and swings over to its next spot, near and far spots in turn. The two arms work half a spot apart, so one arc is always burning. The drone's nose follows the stretch of edge between the two tools. |
| Stopping, leaving, completion | The arcs go out first, then the arms fold and draw back into the hull, in 0.7 s together, while the drone straightens up. A drone sent away takes its arms along as they fold. It sinks back to its hover height, on its way if it was sent somewhere: about 0.8 s from a Turret, and a glide of about 4.5 m a second from a Command Center. A drone killed at work falls from where it hovers. |
| Sent straight to another site | The arms go in on the first site before they come out over the second. |
| Resuming | The drone flies in, rises and turns as before. Once it faces the site and its nose stands 0.3 m above the edge, the arms grow out of the hull folded and unfold onto the edge, in about 0.5 s. The arcs strike once the tools are down. |

The arms reach only the edge in front of the drone, so the drone works on the highest edge within 2.4 m of where it stands. On a Turret that is the top deck all the way up. On a Command Center it is the top deck until the building grows narrower than the drone's reach; from then on the drone stays at the top edge of the lower hull while the upper tiers rise above it.

All of it is presentation. The simulation knows nothing of the turn, the rise or the tools: `UnitSystem` turns and lifts the model of a drone whose order is to build, and `src/construction/builderWork.ts` puts it to work in a `WorkStyle` from `src/construction/work/`. The game uses `weld`. It asks `ConstructionSite.workPoint` where the edge is from where the drone stands, places its arcs and sparks in the site's `GlowEffects`, and draws its arms through `src/construction/scoutArms.ts`, which solves each arm's elbow from its shoulder and its tip and draws every arm in the world in one instanced mesh. The drone's health bar and click target rise with it, and its selection ring stays on the ground beneath it. Each drone's spots and timing come from its id, so no two on a site work in step.

The first arms were thick and orange, and he asked for these: "id like them to be dark with some white elements/joints (same materials that drone/building models are already using)". They take their two colours from the Aged desert palette.

The arms are plain six-sided prisms built in code, not a model from a Blender generator: a part is one or two pixels thick at the default zoom, and every part has to be placed from the elbow's angle each frame.

### Styles kept for later

Three more styles from the sketches live beside `weld` in `src/construction/work/`, and the game uses none of them. Ivan asked to keep them: "the edge scanner is also a nice animation, maybe we will use it in future for something else", and of the hammering, "Maybe we will even use hammering for like attack animation".

- `scan.ts`, with its look in `src/construction/scanLook.ts` and its sweep in `ConstructionSite.scanLine`: a sheet of blue light fans out from the nose and draws a bright line that sweeps a 1.5 m band of the deck's edge.
- `hammer.ts`: the drone drives its nose into the edge in bursts of 4 to 6 blows, each with a flash, sparks and a recoil.
- `drill.ts`: the drone pushes its nose in and holds for about 1.5 s, shuddering, with sparks spinning off the contact.

The construction preview poses its own drones in one of them with `?work=scan`, `hammer` or `drill` (`CONSTRUCTION_WORK=scan bun run preview:capture:construction` for captures), on every shot but the `builder-` films, which run the game. `hammer` and `drill` time their sparks by solving the spark shader's formula in `glowEffects.ts` for a seed, so a change there needs a look at them.

## How it fits any building

Nothing is authored per building. Three things are derived from the loaded model:

- **The hull outline.** `measureOutline` slices every triangle once per building kind into 48 height slices and 128 compass directions, giving how far the hull reaches from its vertical axis at each height. It also finds the main roofline, the height up to which a slice keeps at least 10% of the largest slice's area, and the open air between separate parts of one section, such as the space between the Turret's two barrels.
- **The scaffold.** Its ground plan is the eight-sided shape that hugs the outline, 0.15 m outside the hull. It is square to the map, not to the building, so every site stands the same way to the fixed camera. It stops at the main roofline, so a dish or a mast stands proud of it. Sides that face the camera stay open down to their kerb, so the building's front reads through. Kit members are fitted to a side by scaling them along their own length only, so tubes keep their thickness on a 3.6 m Turret and an 11 m Command Center alike. The pad and kerbs reach 0.5 m below the ground, so a site on the steepest slope placement allows (0.75 m across the footprint) never hangs in the air.
- **The cut.** The model's own material is patched to discard what is not built yet, and to draw the newest band and every face the finished hull seals inside itself as bare steel. Sealed faces are found from the contact shading that `tools/assets/building_bake.py` already stores in the red channel of the roughness map; a model without it falls back to the plain band. The deck that closes the cut is a fan whose rim reads its radius from the outline table at the cut height, and which leaves the recorded open air open.

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

Measured in the construction preview with 5 Command Centers and 5 Turrets under construction at once, with 7 working drones and their arms, shadow pass included. Draw calls and triangles are exact counts from `renderer.info`. The CPU times are single runs on Boat, which renders in software; they are far below a 16.7 ms frame, so their spread does not change the picture.

| | Stretch (before) | Scaffold |
| --- | --- | --- |
| Draw calls, 10 finished buildings | 175 | 175 |
| Triangles, 10 finished buildings | 5,942,803 | 5,942,803 |
| Draw calls, 10 sites | 196 | 194 |
| Draw calls, 10 sites, in a browser without `WEBGL_multi_draw` | 196 | 232 |
| Triangles, 10 sites | 5,978,671 | 6,037,431 |
| CPU per frame for 10 sites and their drones' work | 0.0017 ms | 0.048 to 0.071 ms |
| Preparing a site | 0 ms | up to 1.3 ms (Command Center), 0.4 ms (Turret) |
| Measuring a building kind, once | none | 15 to 21 ms |

A finished building costs nothing extra. The four extra draw calls are shared by every site, so they do not grow with the number of sites: one for all scaffolds, one for their shadow, one for all decks, and one for all arcs, sparks, dust and smoke. The per-frame CPU cost is spark placement.

The Scaffold column was measured again for D77-13, when the builders' arms replaced a line per drone. Seven lines were seven draw calls. Every arm in the world is drawn in one, and the arcs, sparks and pilot flames at the tools join the call the sites' own already use. The stretch was measured with the lines.

The table below is what more working drones add to a frame of ten welding sites that already have a drone each.

| Added by drones at work | 4 more drones | 40 more drones |
| --- | --- | --- |
| Draw calls | 0 | 0 |
| Triangles | 1,224 | 12,408 |
| CPU per frame | 0.034 ms | 0.19 ms |

A working drone is about 310 triangles (two arms of six prisms, and up to 16 glows) and costs about 5 microseconds a frame to place on Boat: three lookups of the building's edge and two elbows. The arms cast no shadow.

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
- `completion`, `completion-turret`, `completion-command-center`, `drop`, `drop-turret`: the moment of completion and the last frames of the scaffold's drop.
- `destroyed`, `destroyed-turret`, `destroyed-command-center`, `destroyed-unbuilt`, `damage`, `damage-turret`, `damage-command-center`: a site at 40% losing health, and after it is destroyed.
- `first-layer`, `first-layer-turret`, `cuts-turret`, `cuts-command-center`, `shoulders`, `barrels`: the cut at the heights where it once looked wrong.
- `fit`, `slope`: buildings turned 0, 30, 45, 77 and 180 degrees side by side, and a Command Center on the steepest slope placement allows.
- `film`, `film-turret`, `film-command-center`, `film-opening-command-center`, `film-loss`, `film-loss-turret`: a build at real Turret speed with the drone leaving for 1.5 s, 12 s of a Command Center build at its real pace, the first 3 s of one, and a site shot at and destroyed.
- `film-pause`, `film-pause-turret`: the drone leaves for 2 s, long enough for the weld to go cold, then for 0.4 s, which catches the glow half cooled, then for 0.1 s, which catches the arcs half out. `?shot=film-pause-command-center` shows the same close on the Command Center.
- `builder-turret`, `builder-command-center`, `builder-team`: the game's own simulation and `UnitSystem`, given a player's orders. A Scout Drone is told to build, flies in, turns, rises and welds. On the Turret it is stopped and resumed. On the Command Center it is sent away and called back, and the 60 s build is cut twice. In `builder-team` three drones build one Command Center together. Each film shows the default zoom beside a close view. The other shots pose a still drone at each site, at work as in the game.
- `crowd`: six drones on a Command Center and three on a Turret, each with its own arms.
- `perf`: the cost table above, written to `perf.json`.

A new building needs no work here, but look at it in `gameplay` and `fit` once: the outline assumes one main hull around the model's vertical axis.

`tools/verify/specs/construction.spec.ts` builds a Turret and a Command Center in the live game through real clicks: it places the site, stops the drone, selects and resumes the site through its scaffold at 0%, pauses it, and follows it to completion. Nothing in the game can damage a player's site yet (guards and Turrets only target units, and the enemy does not build), so the damaged and destroyed states are covered by the preview scene and by `tests/unitPresentation.test.ts`.

## What stays rough

At 15% a site is still mostly a deck. The approved sketch's deck glowed across its whole grid; it now glows only near the weld, so the eye goes to the rim, the arcs and the scaffold. An open steel frame of the hull's outer walls above the cut was built and removed: on the Command Center it added a thin rim, and on the small, curved Turret it read as torn texture in two reviews of the captures. Doing better needs designed content for a half-built interior, which is a design decision.

## Shared with D77-6, destruction and death effects

- A site destroyed before completion keeps its cut material and deck, so the unbuilt part never pops back in. The death effects sink that stump into the ground, and `ConstructionSite.sinkStump` lowers the cut and the deck with it.
- `ConstructionSites.effects` is one `GlowEffects`: one instanced set of quads for arcs, sparks, dust and smoke, drawn in one call for the whole world. The death effects do not use it: it is rebuilt on the CPU every frame, and a fight's thousands of particles are scheduled once and then need none.
- The scaffold drops on destruction as it always did (`Cage.set`), and the death effects throw their own loose beams around it.

## Not verified

- A real GPU. Every capture, in the preview and in the live game, was rendered in software on Boat, where the live game draws 2 to 3 frames per second. Motion was judged from stepped films and frame sequences.
- Firefox itself. The cost without `WEBGL_multi_draw` was counted by hiding the extension from three.js in Chromium.
- Enemy-owned sites, since the enemy does not build yet.
