# Select and move

Selection and movement are the base gesture of the game: the user selects
friendly units and tells them where to go. Everything else (build, attack,
train) sits on top of a selection.

## Sub-features

- `select-click` left-click selects a single unit and opens the unit panel.
- `select-drag` drag-box selects multiple units at once.
- `select-shift` Shift-click adds or removes one unit from the selection.
- `select-empty` clicking empty ground clears the selection.
- `order-move` right-click on ground moves selected units to the point.
- `order-move-button` the Move button then a left-click does the same.
- `order-stop` the Stop button (or `S`) halts moving units.
- `select-keyboard` the panel roster and `A`/`M`/`S` hotkeys mirror mouse flows.

## How to get to it (user POV)

- Left-click a unit on the canvas.
- Left-press, drag, release to box-select.
- Right-click anywhere on ground while units are selected.
- Buttons `Move` / `Stop` (with `M` / `S` keys) in the unit panel.

## Driving it with the tools/verify Playwright harness

Preconditions:

- Doctor reports `{"ok":true,"units":6,"buildings":4}` on seed 77.
- Friendly Ghostrunners `ghostrunner-1..3` idle near the player start.

- **Click select.** `await clickEntity(page, "ghostrunner-1")` then wait for
  `selected.unitIds` to equal `["ghostrunner-1"]`. The unit panel becomes
  visible and `#unit-roster` lists `Ghostrunner`.
- **Drag select.** `await dragSelectUnits(page, ["ghostrunner-1", "ghostrunner-2", "ghostrunner-3"])`
  then wait for `selected.unitIds.length === 3`. Proven in
  `tools/verify/specs/select-and-move.spec.ts`.
- **Shift add.** Click `ghostrunner-1`, then
  `await page.keyboard.down("Shift")` + `clickEntity(ghostrunner-2)` + up —
  selection grows to both ids.
- **Empty click clears.** `await clickWorld(page, playerStart.x + 20, playerStart.z + 20)`
  (a ground point away from entities) — `selected` empties and the panel hides.
- **Move order.** Select the three Ghostrunners, then
  `await clickWorld(page, dest.x, dest.z, { button: "right" })`. Units first
  show `moving: true`, then `moving: false` with `x,z` within 2 of `dest`.
  Screenshot the arrival.
- **Move via button.** Select units, `page.click('[data-action="move"]')`
  (button shows `aria-pressed="true"`), then `clickWorld` left-click the
  destination — same observable result.
- **Stop.** Issue a move to a far point, wait for `moving: true`, then
  `page.click('[data-action="stop"]')` — every selected unit reports
  `moving: false` and `order: "idle"` near its current position.

## Gotchas

- Drag boxes must be computed in screen space (`dragSelectUnits`); a box built
  from world-axis corners projects to a zero-width line under this camera.
- Single clicks can pick a neighboring unit when models are close; assert the
  exact `selected` ids, and use box selection for groups.
- Right-click is also "cancel placement/targeting": issuing it while a build or
  target mode is armed cancels the mode instead of moving.
- A right-click that lands on an enemy entity becomes an attack order, not a
  move — keep move destinations away from the enemy node.
- After match resolution input is ignored until restart; do not attempt move
  proofs in a resolved match.
