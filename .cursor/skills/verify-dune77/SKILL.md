---
name: verify-dune77
description: >
  Drive the real Dune77 browser RTS end to end: launch the dev server, run the
  doctor check, exercise user-facing features through the live game (canvas
  input plus HUD), capture proof artifacts, and clean up. Use whenever a task
  needs behavioral evidence from the running game — UI flows, combat, economy,
  or match outcome — or when something "looks broken in the game" and needs a
  scripted reproduction. For pure simulation rules use the headless bun tests;
  for art/model visuals use the preview capture harness.
---

# Verifying Dune77

Dune77 is a browser RTS. The user-facing surface is the live game at the vite
dev server root (`/`): a full-screen WebGL canvas driven by mouse and keyboard,
plus a DOM HUD (unit panel, ground controls, match outcome). Two other surfaces
already have their own harnesses — see "Other surfaces" below. This skill covers
the live game.

## Launch

1. Check whether a dev server is already running and **reuse it; never spawn a
   second dev server alongside the user's**:
   ```sh
   curl -sf -o /dev/null http://localhost:5173 && echo RUNNING
   ```
2. If none is running (or you need isolation from the user's session), start one
   on a dedicated verification port with strictPort so it cannot silently drift:
   ```sh
   (nohup pnpm run dev --port 5175 --strictPort < /dev/null > /tmp/dune77-verify-dev.log 2>&1 &)
   ```
3. Ready when the log shows `VITE ... ready` **and** the port answers:
   ```sh
   curl -sf -o /dev/null http://localhost:5175
   ```
4. Always use `http://localhost:<port>` — **never `127.0.0.1`**. Vite 8 binds
   the IPv6 loopback only, and IPv4-only URLs time out with no error.
5. No env vars, auth, or seed data are required. Match setup is deterministic
   per seed via the URL: `/?seed=77`. Seed 77 is the reference seed used by the
   unit tests and feature proofs.

## Doctor

Run before driving whenever anything looks off — it answers "is this instance
worth driving?" without changing anything:

```sh
node tools/verify/doctor.mjs http://localhost:5175
```

It loads `/?seed=77&verify=1` in headless Chromium, waits for the match to boot,
and prints JSON: `{"ok":true,"seed":"Seed 77 · ...","units":6,"buildings":4,"tick":3}`.
Non-zero exit or `"ok":false` means: wrong server, stale build, or a runtime
error on the page — fix that first. `units: 6, buildings: 4` is the expected
opening of the combat-proof encounter (3 friendly Ghostrunners, 2 enemy
Ghostrunners, 1 enemy Hornet; two Command Centers, two enemy Turrets).

## Drive

Harness: Playwright specs in `tools/verify/specs/` against the shared helpers in
`tools/verify/helpers.ts`. Run:

```sh
VERIFY_BASE_URL=http://localhost:5175 pnpm exec playwright test \
  --config tools/verify/playwright.config.ts --reporter=line --grep "<name>"
```

Write one-off feature drives as a new spec file there (they double as
regression proofs and are cheap to keep). The helpers encode everything that
broke the first time — use them instead of raw Playwright calls:

- `openGame(page, seed?)` — opens `/?seed=N&verify=1`, waits for sim frames
  **and** model GLB fetches (`networkidle`). Skipping the model wait makes
  raycast picking silently miss buildings.
- `snapshot(page)` / `waitForSnapshot(page, predicate, timeout?)` — read-only
  match state from the `?verify=1` hook: `tick`, `outcome`, `units[]`
  (`id, kind, ownerId, x, z, health, order, moving, attacking`),
  `buildings[]` (`id, kind, ownerId, lifecycle, health, productionQueue`),
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

- Kill only the server process you started: `kill <PID>` (the PID from your own
  launch, or `lsof -nP -iTCP:5175 -sTCP:LISTEN` restricted to the port you
  chose). **Never `pkill node` / kill by process name** — that can kill the
  user's own dev server and tooling. Confirm the port is free afterwards.
- Delete `test-results/` if a failed run created it.
- Keep `art/workbench/verify/` — evidence survives teardown. Keep spec files:
  they are regression proofs, not scratch.

## Other surfaces (reuse, do not duplicate)

- **Simulation logic** (combat math, production, construction, victory): headless
  and fast — `pnpm test:unit` (`bun test tests/*.test.ts`, ~50 s). Prefer this
  for rule changes; it drives `UnitSystem` directly without a browser.
- **Terrain/building/unit visuals**: `pnpm preview:capture` (or `:terrain`,
  `:buildings`, `:units`) renders production assets via
  `tools/preview/` and writes to `art/workbench/renders/previews/`. Requires a
  dev server on port 5173; the Playwright specs poll `window.__previewReady`.
- **Determinism**: the map, encounter, and simulation are seed-deterministic.
  Use seed 77 to match unit-test expectations; use other seeds only when
  testing map variety itself.

## Gotchas

- `127.0.0.1` URLs hang forever against vite 8 (IPv6-only binding). Use
  `localhost`.
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
