# Build buildings

Scout Drones construct Turrets and Command Centers. The user arms a build kind,
sees a placement preview following the pointer, confirms with a click, and the
building rises from a construction site to `active` over time. This extends the
base and adds defenses.

## Sub-features

- `build-arm` the Build button opens the kind menu (Turret / Command Center).
- `build-preview` a placement ghost follows the pointer and turns invalid on
  bad ground.
- `build-place` a left-click commits the site and the drone walks to it.
- `build-progress` the site shows construction progress, then becomes `active`.
- `build-cancel` right-click cancels arming/preview without placing.
- `build-resume` right-clicking a paused site resumes construction.

## How to get to it (user POV)

- Select a Scout Drone (train one first — see
  [train-units](./train-units.md)).
- Press `B` or click `Build` in the unit panel, then click `Turret` or
  `Command Center`.
- Move the pointer over the ground and left-click to place, right-click to
  cancel.

## Driving it with the tools/verify Playwright harness

Preconditions:

- A friendly Scout Drone exists (`units[]` entry with
  `kind: "scout-drone"`, `ownerId: "local-player"`). Train one (~8 s) or use a
  seed where one exists.
- Doctor reports the match healthy on seed 77.

- **Arm build.** `await clickEntity(page, "<scout drone id>")`, then
  `page.click('[data-action="build"]')` and
  `page.click('[data-build-kind="turret"]')`. The canvas gains the
  `is-targeting` class.
- **Preview.** `await clickWorld(page, spot.x, spot.z)` without confirming?
  No — preview follows the *pointer*, so instead
  `await page.mouse.move(screenPoint(spot))` and screenshot: a turret ghost is
  visible at that spot. Use `screenPoint` from the helpers for the move.
- **Place.** `await clickWorld(page, spot.x, spot.z)` (left button) — wait for
  a new `buildings[]` entry with `lifecycle: "constructing"`, then poll until
  `lifecycle: "active"` (a Turret takes ~10 s, a Command Center ~60 s). The
  drone shows `constructionTargetId` while building. Screenshot the site
  mid-build and the finished turret.
- **Progress proof.** Capture the same building twice: `health` /
  `constructionProgress` (reflected in `lifecycle`) must advance between
  captures.
- **Cancel.** Arm Turret again, then
  `await clickWorld(page, other.x, other.z, { button: "right" })` — no new
  building appears and the canvas loses `is-targeting`.
- **Invalid ground.** Aim the preview at a mountain slope (a spot far from the
  base near blocked terrain) — the placement is rejected and no building entry
  appears after the click.

## Gotchas

- Only Scout Drones can build; arming Build with combat units selected does
  nothing.
- Placement legality is evaluated by the simulation; the click on illegal
  ground is silently ignored. Always confirm a placement by the new
  `buildings[]` entry, never by the click alone.
- The drone must walk to the site — construction progress only starts when it
  arrives; a site far away stays `constructing` for many seconds.
- The enemy Turrets outrange early probes; keep placement spots near the player
  start for peaceful proofs (see [attack-and-defense](./attack-and-defense.md)).
- The `data-build-kind` buttons stay hidden until the Build menu is armed; a
  blind click on them fails.
- Command Center construction takes ~60 s of build time; budget the
  `waitForSnapshot` timeout accordingly.
