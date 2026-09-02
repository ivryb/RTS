# Train units

The Command Center trains units. Training consumes the building's queue over
real time and spawns the unit next to the Command Center (or at its rally
point). This is the game's economy loop.

## Sub-features

- `train-select-cc` clicking the player Command Center shows production
  buttons.
- `train-queue` a trained kind enters the production queue and ticks down.
- `train-spawn` a finished queue item spawns a new friendly unit.
- `train-serial` a second unit queues only after the first finishes (one at a
  time per Command Center).
- `train-rally` the rally point places spawned units at the chosen spot.
- `train-enemy-cc` the enemy Command Center is not selectable/trainable.

## How to get to it (user POV)

- Left-click the player Command Center (large friendly building at the player
  start).
- Click a unit card in the unit panel: `Scout Drone` (8 s), `Ghostrunner`
  (12 s), `Hornet` (20 s), `Behemoth` (35 s).
- Click `Set rally point`, then left-click a ground spot.

## Driving it with the tools/verify Playwright harness

Preconditions:

- Doctor reports `{"ok":true,"units":6,"buildings":4}` on seed 77.
- `local-command-center` present in `inspect().buildings` with
  `lifecycle: "active"` and empty `productionQueue`.

- **Select the CC.** `await clickEntity(page, "local-command-center")` —
  `selected.buildingIds` contains it and `#production-queue` becomes visible.
  Proven in `tools/verify/specs/train-scout-drone.spec.ts`.
- **Queue.** `page.click('[data-train-kind="scout-drone"]')` — wait until
  `inspect().buildings[].productionQueue` contains `{ kind: "scout-drone" }`
  and `#production-queue` renders the entry. Screenshot the queue.
- **Spawn.** Keep waiting on the same snapshot predicate for a new
  `units[]` entry with `ownerId: "local-player"`, `kind: "scout-drone"` —
  about 8 s wall clock. Screenshot the spawn (unit near the CC).
- **Serial queue.** Click Scout Drone twice quickly — the queue holds two
  entries, and only one Scout Drone exists until the first completes.
- **Rally.** Select the CC, `page.click('[data-set-rally]')`, then
  `clickWorld(rallyPoint, { button: "left" })` (targeting mode uses left
  click); queue a Scout Drone and wait for it to appear near `rallyPoint`.
- **Enemy CC.** `clickEntity(page, "enemy-command-center")` — it may be picked
  as a target but never appears in `selected.buildingIds` and the train buttons
  stay hidden.

## Gotchas

- Train buttons live in the unit panel, which is `hidden` until the CC is
  selected — clicking them blindly fails the click.
- `trainSelected` silently returns false when the queue is full (5 items) or
  the CC is under construction — assert the queue length rather than trusting
  the click.
- The spawn point is beside the CC (or at the rally point), not inside it;
  allow a tolerance of a few world units around the expected position.
- Training runs in real time; use generous `waitForSnapshot` timeouts (15 s for
  a Scout Drone, 40 s for a Behemoth).
- The verify hook's `productionQueue` is only present on Command Centers.
