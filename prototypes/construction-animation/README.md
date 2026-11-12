# Construction animation study

The design study behind D77-5: how a building looks while Scout Drones construct it. Ivan approved the scaffold; [Construction animation](../../docs/construction_animation.md) records the design, its cost and what the build still has to do. Each look is one file in `options/` that implements the `ConstructionSketch` contract in `sketch.ts`. The harness loads the production Turret and Command Center through `loadBuildingModel`, on the game's terrain, lighting, and camera angle, and drives a candidate with nothing but construction progress and site state.

`options/current.ts` is the shipped vertical stretch, kept as the "before" reference. The two looks that lost, `print` and `assembly`, are in this branch's history at commit `a286359`.

`options/scaffold.ts` stands a scaffold around the site and raises the building inside it. It measures each building kind's outline once (`scaffold/outline.ts`) and lays everything out from that: an eight-sided scaffold that hugs the main hull, stops at its roofline and stays open towards the camera, the deck that closes the rising cut, and the welding points. Its kit of posts, rails, braces, pad plates and lamps comes from `tools/assets/build_scaffold_kit.py`; the study keeps a copy of the exported GLB in `options/scaffold/`, so after changing the generator, rebuild and copy it:

```sh
box blender --background --python-exit-code 1 --python tools/assets/build_scaffold_kit.py
box pull art/workbench/procedural-scaffold-kit/
cp art/workbench/procedural-scaffold-kit/scaffold-kit.glb prototypes/construction-animation/options/scaffold/
```

## Shots

Open `/prototypes/construction-animation/?option=<file name>&shot=<shot>` on the dev server.

- `gameplay`: both buildings at 0, 15, 50, 85 and 100% at the game's default zoom (43.1 m view height).
- `turret-close`, `command-center-close`: the same five values at the game's closest zoom (14.4 m).
- `states`, `states-turret`: just placed, drone working, paused with no drone, damaged, destroyed before completion.
- `completion`, `completion-turret`: 99%, then 0, 0.15, 0.4 and 1 s after completion.
- `destroyed`, `destroyed-turret`: a site at 40%, then 0.1, 0.2, 0.3 and 0.6 s after it is destroyed.
- `film`, `film-turret`: one build at real Turret speed (10 s of work), with the drone leaving for 1.5 s at 40%.
- `film-command-center`: 12 s of a Command Center build at its real pace (30 to 50% of its 60 s), since `film` builds it six times too fast.
- `perf`: five Command Centers and five Turrets under construction at once.

## Capture

Boat has no GPU, so the film is stepped frame by frame and encoded at 30 frames per second.

```sh
box 'bun run dev >/tmp/vite.log 2>&1 &
  until curl -sf -o /dev/null http://localhost:5173; do sleep 1; done
  SKETCH_OPTION=current bunx playwright test --config prototypes/construction-animation/playwright.config.ts --reporter=line'
box pull art/workbench/construction-animation/
```

`SKETCH_SHOTS=gameplay,perf` narrows a run to the named shots. Output lands in `art/workbench/construction-animation/<option>/`. `perf.json` holds draw calls and triangles for an empty scene, ten finished buildings, and ten sites under construction (shadow pass included), the milliseconds per frame spent updating ten sites, the shader programs construction adds, and how many screen pixels of a site a click can hit at 0, 15, 50 and 100%.
