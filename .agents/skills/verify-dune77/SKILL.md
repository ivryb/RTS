---
name: verify-dune77
description: >
  Drive the live Dune77 game on Boat with Playwright for behavioral evidence:
  UI flows, combat, economy, match outcome, or a scripted repro of something
  broken in the game. Simulation rules belong in bun tests, model visuals in the
  preview captures.
---

# Verifying Dune77

Dune77 is a browser RTS. The user-facing surface is the live game at the vite
dev server root (`/`): a full-screen WebGL canvas driven by mouse and keyboard,
plus a DOM HUD (unit panel, ground controls, match outcome). Two other surfaces
already have their own harnesses — see "Other surfaces" below. This skill covers
the live game.

## Launch

The game, its dev server, and the browser all run on Boat through `box`. A dev
server lives only as long as its `box` command, so one command starts it, waits
for it, and runs the doctor and the drive; evidence comes back with `box pull`:

```sh
box 'bun run dev >/tmp/vite.log 2>&1 &
  until curl -sf -o /dev/null http://localhost:5173; do sleep 1; done
  node tools/verify/doctor.mjs http://localhost:5173 &&
  bunx playwright test --config tools/verify/playwright.config.ts --reporter=line --grep "<name>"'
box pull art/workbench/verify/<feature>/
```

No env vars, auth, or seed data are required. Match setup is deterministic per
seed via the URL: `/?seed=77`. Seed 77 is the reference seed used by the unit
tests and feature proofs.

## Doctor

The launch command runs it before driving — it answers "is this instance worth
driving?" without changing anything.

It loads `/?seed=77&verify=1` in headless Chromium, waits for the match to boot,
and prints JSON: `{"ok":true,"seed":"Seed 77 · ...","units":7,"buildings":4,"tick":3}`.
Non-zero exit or `"ok":false` means: wrong server, stale build, or a runtime
error on the page — fix that first. `units: 7, buildings: 4` is the expected
opening of the combat-proof encounter (1 Scout Drone, 3 friendly Ghostrunners,
2 enemy Ghostrunners, 1 enemy Hornet; two Command Centers, two enemy Turrets).

## Drive

Harness: Playwright specs in `tools/verify/specs/` against the shared helpers in
`tools/verify/helpers.ts`, run by the launch command above.

Write one-off feature drives as a new spec file there (they double as
regression proofs and are cheap to keep). The helpers encode everything that
broke the first time — use them instead of raw Playwright calls:

- `openGame(page, seed?, { render? })` — opens `/?seed=N&verify=1`, waits for
  sim frames **and** model GLB fetches (`networkidle`). Skipping the model wait
  makes raycast picking silently miss buildings. It opens the light render mode
  unless the spec passes `{ render: "full" }`; see "Render modes" below.
- `snapshot(page)` / `waitForSnapshot(page, predicate, timeout?)` — read-only
  match state from the `?verify=1` hook: `tick`, `outcome`, `units[]`
  (`id, kind, ownerId, x, z, health, order, moving, attacking`),
  `buildings[]` (`id, kind, ownerId, lifecycle, constructionProgress, health,
  productionQueue`),
  `selected.unitIds/buildingIds`. Poll, never sleep.
- `clickEntity(page, id)` — selects an entity by left-clicking its projected
  position through the real canvas raycast path. Click height varies per model,
  so it retries low→tall and confirms via `selected`. 
- `dragSelectUnits(page, ids)` — box-selects units in **screen space**. The
  camera's screen-right axis is a world diagonal; a world-aligned rectangle
  projects to a zero-width line and selects nothing.
- `clickWorld(page, x, z, { y?, button? })` — ground clicks (right button =
  move/attack order, left = place building / cancel). `y` is height above
  terrain; the default projects onto terrain elevation, not y=0.
- `screenPoint(page, x, z, y?)` — raw projection for custom gestures.
- `minimapPoint(page, x, z)` — page pixels of a world point on `#minimap`,
  from the minimap's own mapping and the map's real size. Click it with
  `page.mouse`; never recompute the mapping from `mapSizeForPlayerCount`.

HUD interaction uses plain `page.click` with the stable handles from
`index.html`: buttons `[data-action="move|stop|attack|attack-ground|build"]`,
`[data-build-kind="turret|command-center"]`,
`[data-train-kind="scout-drone|ghostrunner|hornet|behemoth"]`,
`[data-set-rally]`; readouts `#unit-roster`, `#unit-status`,
`#production-queue`, `#match-outcome-title`, `#seed`, `#zoom-level`.

The `?verify=1` hook (`window.__dune77.inspect/project` in `src/main.ts`) is
read-only diagnostics and inert without the URL param — keep it that way; never
drive gameplay through it. Orders go through real pointer/keyboard input, state
assertions go through `inspect()`.

Keyboard shortcuts on `page.keyboard`: `A` attack, `B` build, `M` move, `S`
stop, `R` restart match, wheel zoom, middle-drag pan, WASD/arrow pan.

## Render modes

Boat has no GPU, so Chromium draws the game in software (AGENTS.md, Visual
testing). Each spec picks one of two modes through `openGame`.

- **Light** (`openGame`'s default, URL `&render=light`): no shadows, rocks,
  vegetation or antialiasing. About 13 frames per second at 1280 × 720 instead
  of 2 to 3. A "Light render" tag under the match bar shows the mode in every
  full-page screenshot. The game honours the flag only together with
  `verify=1`, so players never get it.
- **Full** (`openGame(page, seed, { render: "full" })`): what players see, at
  2 to 3 frames per second on Boat.

A spec passes `{ render: "full" }` when an assertion or a capture depends on
how the 3D world looks: shadows, shadow shaders, rocks, vegetation or edge
smoothing, as in `building-models` and `construction`. The DOM HUD, the
minimap, units and buildings are the same in both modes, and picking is too:
clicks hit unit cylinders, building models and the terrain, which light mode
keeps.

Look-only checks belong in the preview captures, which always render at full
quality and never read the flag.

## Evidence

Proofs go to `art/workbench/verify/<feature>/` (gitignored, survives cleanup —
never delete it during teardown). Standards:

- Exercise the real user path: pointer events on the canvas and clicks on HUD
  buttons. `inspect()` is for *asserting state*, not for issuing orders.
- Capture the action **and** the result: e.g. the roster/queue screenshot right
  after the order plus the screenshot after arrival/spawn, plus the
  `inspect()` values that prove it (position delta, unit count, queue contents).
- Verify side effects in state, not just pixels: a "move" proof shows
  `moving: false` with `x,z` within tolerance of the destination; a "train"
  proof shows the new unit in `units[]` with `ownerId: "local-player"`.
- Prefer assertions over screenshots for numbers; screenshots prove layout and
  rendering, snapshots prove behavior. Include both for UI features.

## Cleanup

- The dev server stops with its `box` command. Run `box stop` after a burst of
  checks.
- Delete `test-results/` if a failed run created it.
- Keep `art/workbench/verify/` — evidence survives teardown. Keep spec files:
  they are regression proofs, not scratch.

## Other surfaces (reuse, do not duplicate)

- **Simulation logic** (combat math, production, construction, victory): headless
  and fast — `bun run test:unit` (`bun test tests/*.test.ts`, ~50 s). Prefer this
  for rule changes; it drives `UnitSystem` directly without a browser.
- **Terrain/building/unit visuals**: `bun run preview:capture` (or `:terrain`,
  `:buildings`, `:units`) renders production assets via
  `tools/preview/` and writes to `art/workbench/renders/previews/`. It needs a
  dev server on port 5173 in the same `box` command; the Playwright specs poll
  `window.__previewReady`.
- **Determinism**: the map, encounter, and simulation are seed-deterministic.
  Use seed 77 to match unit-test expectations; use other seeds only when
  testing map variety itself.

## Gotchas

- Full-render specs are slow on Boat (see "Render modes"), so the verify
  config allows 5 minutes per spec. Give `page.screenshot` a longer timeout
  than Playwright's 30 s default in those.
- Clicking before models load selects nothing and reports no error — always go
  through `openGame` (waits `networkidle`).
- A drag box in world coordinates selects nothing (screen axes are world
  diagonals) — use `dragSelectUnits`.
- The simulation runs in real time inside a Web Worker; there is no time-scale
  control. Training times: Scout Drone 8 s, Ghostrunner 12 s, Hornet 20 s,
  Behemoth 35 s wall clock; a full siege victory takes ~3.5 minutes. Budget
  waits accordingly (`waitForSnapshot` timeouts).
- Match resolution is terminal: after victory/defeat the input system ignores
  orders until `R` restarts the match.
- `loadMap` rewrites the URL to `?seed=N`, dropping extra params — anything
  reading `location.search` at init must run before it (the verify hook does).
