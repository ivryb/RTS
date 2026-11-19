# Destruction and death effects

How a unit dies and a building is destroyed. Ivan approved this design for D77-6 on 2026-11-19 ("wreck animation is the best so far, let's implement and merge it"), and the game uses it: `src/deathEffects.ts` stages every death, with its pooled parts in `src/death/`, and `UnitSystem` hands it each casualty on the frame the simulation reports it.

It replaced what the game did before: Scout Drones, Hornets and Behemoths vanished on the frame they died, a Ghostrunner played its fall clip and faded out after 4 s, and a building or construction site squashed flat and faded in 0.8 s. Nothing was left behind.

Two other looks lost the study: one staged explosion that leaves only a scorch mark, and a shatter into the model's own pieces. Their sketches were on this task's branch and were removed before it merged.

## The look

A death is a short staged sequence, sized to what died, and it leaves a dark wreck on a scorch mark. A dead unit never reads as a living one: wrecks are charred, and the living are sand-ivory.

| Case | What the player sees |
| --- | --- |
| Scout Drone | A flash, then it loses lift and falls for 0.42 to 0.58 s, tipping and spinning with a smoke trail. A drone killed while moving carries on about 2.8 m along its path. It bursts on the ground in a 1.25 m fireball and its wreck skids for 0.42 s. |
| Hornet | The same fall, 0.57 to 0.79 s from its greater height, ending in a 2.3 m fireball. |
| Behemoth | A hit flash and a lurch (a moving one slides about 1.4 m). Its rocket pods burn from the first frame and cook off: three pops and the main blast at 0.95 to 1.2 s, or five pops and the blast at 1.45 to 1.85 s, picked per unit, with one or two rockets corkscrewing away. A 3.3 m fireball covers the swap to a burnt hull. |
| Ghostrunner | A flash and cyan sparks, then its fall clip, on the sand 0.8 s after the kill. The body smoulders and darkens over the next 1.1 s, its power cell gives out in a last burst of sparks and smoke, and a charred husk lies in its place. |
| Command Center | Eight blasts walk across it over 1.05 to 1.3 s. After a beat it sinks into its own dust over 1.9 s, and once its walls are well down a burnt-out ruin rises in its place. The whole fall takes 3.2 to 3.6 s and stays inside the footprint. |
| Turret | The first blast throws the head off its bearing and it comes down across the base. Two more blasts follow, and the base sinks into dust over 1.05 s, leaving a small ruin. |
| Construction site | Smaller and drier than a finished building. The scaffold drops into the ground, four dust pops throw loose beams, and what was built sinks into pale dust over 1 s with its cut and deck. Nothing burns. A heap of fallen scaffold and unfinished wall slabs is left, lower the less was built. |

Variants and beat times are picked from the casualty's own id, so thirty deaths in one fight do not move in step, and the same unit always dies the same way.

A unit killed by a Behemoth barrage dies when the rockets land, not on the earlier frame the simulation reports it: `UnitSystem` holds the death back until the impact, as it did before.

## What is left behind

Leftovers go through fixed phases: flames, smoke, cold, then sinking into the sand. The scorch mark under them outlives them and fades.

| Leftover | Flames until | Smoke until | Starts sinking | Gone | Scorch gone |
| --- | --- | --- | --- | --- | --- |
| Scout Drone wreck | 2.5 s | 12 s | 24 s | 27 s | 61 s |
| Ghostrunner husk | none | 7 s | 24 s | 27.5 s | 54 s |
| Hornet wreck | 7 s | 18 s | 30 s | 34 s | 61 s |
| Behemoth hull | 12 s | 28 s | 40 s | 45 s | 68 s |
| Turret ruin | 10 s | 30 s | 55 s | 61 s | 122 s |
| Command Center ruin | 24 s | 58 s | 90 s | 100 s | 203 s |
| Turret site rubble | none | none | 45 s | 51 s | pale stain, 95 s |
| Command Center site rubble | none | none | 60 s | 68 s | pale stain, 95 s |

Each kind of leftover has a fixed number of slots: 24 Scout Drone wrecks, 24 Ghostrunner husks, 12 Hornet wrecks, 10 Behemoth hulls, 8 Turret ruins, 4 Command Center ruins, 8 small and 4 large heaps of site rubble. When a kind has fewer than three slots free (two for the pools of four), its oldest wreck sinks early, in 0.4 of its usual time, so a long fight never grows the scene. A burst of more than about two deaths a second of one kind, kept up past the pool's size, replaces a wreck that is still on its way down; the `wreck-cap` scene shows that case. Scorch marks have 96 slots and reuse the oldest; the marks wider than 7.5 m, those of Command Centers and their sites, have 16 slots of their own, so a long fight's many small marks cannot push out one that lasts three minutes.

A new match starts with none of this: restarting disposes the whole presentation.

## How it works

`UnitSystem` reports a casualty with `unitDied` or `buildingDestroyed`, passing the entity's root and model. From then on the death effects pose that root. Once the wreck is laid they hide it and call `released`, and `UnitSystem` lets go of a destroyed building's model. The simulation is not involved, and an entity leaves it exactly when it did before. Until the wreck kit has loaded, or if it failed to load, a casualty is hidden and released at once.

Every flash, fireball, puff, spark, piece of scrap and scorch mark of a death is scheduled in the call that reports it, with a delay. After that the only work per frame is posing the casualties still falling (48 at most), moving scrap that is still in the air, and feeding the smoke of wrecks that are still burning.

- **Sprites** (`src/death/sprites.ts`): three pools of camera-facing particles, animated entirely on the GPU from the values written when they were emitted: flashes and sparks, fire, and smoke with dust.
- **Scorch marks** (`src/death/groundMarks.ts`): each mark is a patch of the terrain's own grid, so it follows slopes instead of cutting into them, and takes one of four outlines. It fades on the GPU.
- **Wrecks** (`src/death/wrecks.ts`): one instanced mesh per wreck model.
- **Scrap** (`src/death/debris.ts`): two instanced meshes of thrown pieces that bounce once, rest, and sink.

No effect has a light. Every pool has a fixed size, the casualties being posed are fixed slots too, and the staging allocates nothing per frame. A pool is not drawn while it is empty. `UnitSystem.prepareRendering` shows one of everything below the terrain while the match loads, so no death stops to compile a shader (see `tools/verify/PERFORMANCE.md`).

The Ghostrunner's body darkens on eight shared copies of its material, made the first time one dies. They use the shader its own material compiled.

A site destroyed before completion keeps its scaffold site: `ConstructionSite.sinkStump` lowers the cut and its deck as the death effects sink the building.

`ConstructionSites.effects`, the construction sites' shared glow list, is not used here. It is rebuilt on the CPU every frame, which suits a few dozen welding sparks; a fight emits a few thousand particles that then need no CPU at all.

## Models

Every wreck, ruin and piece of scrap comes from a Blender generator, and the game loads the accepted GLBs from `assets/models/wrecks/`, recorded in `assets/models/procedural-manifest.json`.

- `tools/assets/build_death_wreck_units.py` crushes, tilts and burns each production unit model into its wreck. The Ghostrunner's husk is the last pose of its Dead clip.
- `tools/assets/build_death_wreck_ruins.py` builds the two ruins, the two heaps of site rubble and the two scrap pieces from the shared building parts and the Aged desert palette.

After changing a generator, rebuild, look at the result in the preview below, then copy the GLB and update its manifest entry:

```sh
box blender --background --python-exit-code 1 --python tools/assets/build_death_wreck_ruins.py -- --only turret-ruin
box pull art/workbench/death-wreck/
cp art/workbench/death-wreck/turret-ruin.glb assets/models/wrecks/
```

A new unit kind needs a wreck model, a profile in `WRECKS` and a death in `unitDeaths`. A new building kind needs a ruin, a rubble heap and an entry in `DEMOLITIONS`. The compiler asks for both entries.

## Cost

Measured in the preview's `mass-fight` scene: 30 units of all four kinds die within 2 seconds, half of them moving. Boat renders in software, so these are counts and main-thread time, not frame rate. Draw calls and triangles are exact counts from `renderer.info` for the game's default view, shadow pass included.

`measure` runs the scene three times, each in a fresh browser, at 60 steps a second for 6 s, and times `UnitSystem.update` alone. A round is three such runs, and each figure below is a round's median. Main is the same scene on the presentation code this change started from; its two rounds alternated with the first rounds of this code in one session.

| | Main, before | With these effects |
| --- | --- | --- |
| Draw calls before any death | 165 | 165 |
| Draw calls at the peak | 165 | 171 |
| Draw calls 6 s in | 125 | 100 |
| Triangles before any death | 4,325,341 | 4,325,341 |
| Triangles added at the peak | 93 | 7,052 |
| Update per frame, mean | 0.33 and 0.45 ms | 0.31, 0.33 and 0.53 ms |
| Update per frame, 95th percentile | 0.6 and 1.0 ms | 0.7, 0.8 and 1.6 ms |
| Update, slowest frame | 4.6 and 5.7 ms | 5.1, 5.8 and 5.2 ms |

The timer resolves 0.1 ms. The counts are exact and the same in every run.

- **The effects are cheap next to a frame, and the rounds cannot say more than that.** Rounds of the same code differ from each other (0.31 to 0.53 ms mean) by more than the two codes differed when measured back to back (0.31 against 0.33 ms mean, 0.7 against 0.6 ms at the 95th percentile). The dearest round's 1.6 ms is a tenth of a 60 fps frame on Boat's CPU.
- **A frame on which deaths start costs more.** The simulation reports deaths ten times a second, so several can start on one rendered frame. Listing every frame of one run, the dearest such frames took 1.4 to 1.9 ms against 0.2 to 0.3 ms for a quiet one: about half a millisecond for each death that starts, spent scheduling its particles and scrap.
- **The slowest frame is there without the effects.** Main has a 4 to 6 ms frame of its own. It was not traced.
- **One round was thrown out.** It measured this code at 1.0 ms mean and 3.5 ms at the 95th percentile, with the frames before any death slower by the same factor, so the machine was busy with something else.
- **Fewer draw calls after a fight than before.** Dead Ghostrunners used to stay as skinned models for 6 s; their husks are instances of one mesh.

The effects add at most 15 draw calls of their own when every pool is in use at once: 3 for sprites, 2 for scorch marks, 2 for scrap and 8 for wrecks, plus a shadow draw for each of the six wreck pools and the one scrap pool that cast shadows. The peak in this scene is lower because the dying units' own draw calls leave as the effects arrive.

Not measured, because Boat has no GPU: fill cost of smoke and fire on real hardware, and frame times there.

## Preview scene and checks

`tools/preview/death-effects/` plays scripted deaths through the game's own `UnitSystem`, on the game's terrain, lighting and camera, at the default zoom on the left and close on the right. Time only moves when the page is stepped, so every capture is repeatable. Open `/tools/preview/death-effects/?scenario=<name>` on the dev server and call `__stage.advanceTo(seconds)`, or capture clips, frame strips, later stills and cost to `art/workbench/renders/previews/death-effects/`:

```sh
box 'bun run dev >/tmp/vite.log 2>&1 &
  until curl -sf -o /dev/null http://localhost:5173; do sleep 1; done
  bun run preview:capture:death-effects clips behemoth,turret
  bun run preview:capture:death-effects measure mass-fight'
box pull art/workbench/renders/previews/death-effects/
```

One scene takes two to four minutes on Boat.

- `scout-drone`, `hornet`, `behemoth`, `ghostrunner`: one unit killed standing and one killed while moving at its real speed.
- `command-center`, `turret`: a finished building destroyed.
- `construction-site`, `turret-site`: a Command Center site destroyed at 50% and a Turret site at 40%.
- `mass-fight`: 30 units die within 2 seconds; the scene the cost is measured in.
- `skirmish`: the same fight with nine survivors among the dead, two of them walking through.
- `slope`: one of each unit and a Turret on the steepest ground near the base.
- `wreck-cap`: 32 Scout Drones die one after another with 24 wreck slots.
- `base-assault`: a Command Center and its Turret fall among dying and surviving units.

`tests/unitPresentation.test.ts` covers the hand-over: a destroyed building and a destroyed site sink, leave their ruin and give their shared model back untouched, a Ghostrunner falls, chars and leaves a husk that later sinks, a Hornet killed on the move lands ahead of where it died, a barrage death waits for the impact, and a death before the kit has loaded hides the unit at once.

`tools/verify/specs/death-effects.spec.ts` sends the three starting Ghostrunners into the enemy defenses in the live game, waits for the first death, and checks that no shader program was compiled after the match was ready.

## What stays rough

- The ash under the two ruins fades to the colour of the default sand. On darker ground it will show as a pale fringe, and on broken ground part of its edge can show as a flat patch. A ruin lies along the average slope under its footprint, not along every dip.
- The ruins are charcoal and soot-stained ivory, lighter than the near-black unit wrecks beside them. Near-black ruins read as flat slabs in the game's light, which is why they were lightened.
- The Command Center ruin is composed for the quarter turn the game stands a Command Center at: its tall walls are at the back. A Command Center turned another way would hide part of the ruin behind them.
- The husk that replaces a Ghostrunner's charred body is a different mesh, with a shorter blade. The swap happens behind a burst of smoke.
- Unit wrecks are laid upright, turned only about the vertical, so on a steep slope a wreck can rest with one end in the air. Ruins lie along the slope.
- Thrown scrap is near-black, because its baked metal has no sky to reflect. It is small and gone in 20 s.
- The barrage's scorch marks (`src/behemothBarrage.ts`) and these use two implementations of the same idea. Moving the barrage onto `GroundMarks` would change its look, so it was left.

## Not verified

- A real GPU. Every capture was rendered in software on Boat. Motion was judged from stepped clips and frame strips.
- Buildings destroyed in a live match. Nothing but a full siege destroys a building in the current encounter, so building and site destruction are covered by the preview scene and the presentation tests.
