# Mine Titanium

Scout Drones harvest Titanium Deposits and carry the ore to a friendly Command
Center. While a Scout extracts, it fires a laser from its nose whose contact
point sweeps up and down the rock; while it hauls, it carries a cargo bin.

## Sub-features

- `mine-order` right-clicking a deposit with a Scout selected starts a gather
  order.
- `mine-laser` the laser is on while the Scout extracts and ends on the rock.
- `mine-haul` a full Scout leaves for the Command Center with no laser.
- `mine-deliver` delivered cargo raises the Titanium counter.
- `mine-interrupt` any new order switches the laser off.

## How to get to it (user POV)

- Left-click the Scout Drone, then right-click a Titanium Deposit (the dark
  rock outcrop near the player base).

## Driving it with the tools/verify Playwright harness

Proven in `tools/verify/specs/scout-mining.spec.ts`.

- **Order.** `clickEntity(page, "scout-drone-1")`, then
  `clickWorld(page, deposit.x, deposit.z, { y, button: "right" })` with the
  deposit taken from `inspect().titaniumDeposits`. Wait for the Scout's
  `order === "gather"`; the order comes back from the simulation worker a few
  frames after the click.
- **Laser.** Wait for the Scout's `miningLaser`: `from` is its nose, `to` the
  point on the rock. `harvest.phase` is `"extracting"` then.
- **Haul.** Wait for `harvest.phase === "to-dropoff"`; `miningLaser` is gone
  and `cargoTitanium` is above zero.
- **Interrupt.** Right-click open ground while the laser is on; `order`
  becomes `"move"` and `miningLaser` is gone.

## Gotchas

- The right-click has to hit the rock's model, and some deposits have a gap at
  their centre. Try a few click heights, as the spec does.
- One load takes about 5 s of extraction, and Boat draws 2 to 3 frames a second,
  so screenshot the laser as soon as `miningLaser` appears.
- The game clamps a frame's time step to 0.05 s, so on Boat the sweep plays at
  about an eighth of its real speed. Judge the motion from the mining preview
  scene (`/tools/preview/?scene=mining&drones=3`), which steps time exactly;
  `bun run preview:capture --grep mining` captures it.
- Rules such as depletion and a destroyed Scout are covered by
  `tests/unitPresentation.test.ts` and `tests/harvesting.test.ts`, not here.
