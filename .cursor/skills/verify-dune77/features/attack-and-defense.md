# Attack and defense

Combat: units and Turrets deal damage to hostile entities. The user orders
attacks on targets or ground, and the enemy Turrets return fire at anything in
range. Health drops, units die, buildings collapse — and victory hinges on the
enemy Command Center.

## Sub-features

- `attack-target` the Attack button / `A` orders selected units to attack a
  clicked enemy entity.
- `attack-ground` the Attack ground button orders fire at a ground point.
- `attack-right-click` right-clicking an enemy entity with combat units
  selected attacks it.
- `turret-defense` enemy Turrets fire at friendly units entering their range.
- `damage-death` entities lose health when attacked and die at zero.
- `guard-hold` enemy guards hold position instead of chasing.

## How to get to it (user POV)

- Select combat units, press `A` (or click `Attack`), then click an enemy.
- Select units, click `Attack ground`, then click a ground point.
- Right-click an enemy entity with combat units selected.
- Walk a friendly unit into an enemy Turret's range — it fires on its own.

## Driving it with the tools/verify Playwright harness

Preconditions:

- Doctor reports `{"ok":true,"units":6,"buildings":4}` on seed 77.
- Enemy entities: `enemy-command-center`, `enemy-turret-left/right`,
  `enemy-ghostrunner-1/2`, `enemy-hornet-1` (guards, `guardMode` set).
- A friendly Ghostrunner selected via `clickEntity` / `dragSelectUnits`.

- **Turret defense (safest first proof, no orders needed).** Move one
  Ghostrunner (`clickWorld` right-click) to a point just inside
  `enemy-turret-left`'s attack range (turret position ± ~15 world units), then
  `waitForSnapshot` for that unit's `health` to drop below its `maxHealth`, or
  `attacking: false` on the turret side but unit `health` decreasing. The unit
  should die (`health <= 0`, removed from `units[]`) if left in range.
  Screenshot before and during the firefight.
- **Attack order.** Select the three Ghostrunners, press `page.keyboard.press("A")`
  or `page.click('[data-action="attack"]')`, then
  `clickEntity`-style click on `enemy-ghostrunner-1`'s projected position —
  wait for the selected units to report `attacking: true` /
  `attackTargetId: "enemy-ghostrunner-1"` and the target's `health` to fall.
- **Attack ground.** Select a Hornet (train one, ~20 s), click
  `[data-action="attack-ground"]`, then
  `clickWorld(page, enemyCC.x, enemyCC.z, { button: "left" })` from outside
  turret range — wait for `enemy-command-center.health` to drop.
- **Right-click attack.** Select combat units and
  `await clickWorld(page, enemy.x, enemy.z, { y: 2, button: "right" })` on an
  enemy unit's position — units engage without arming a target mode.
- **Death proof.** After any engagement, the killed entity disappears from
  `inspect().units` / `.buildings` while a death effect plays.
- **Guard hold.** Move a friendly unit near `enemy-ghostrunner-1` and back out
  of its range — enemy guards keep `moving: false` throughout; they never
  chase beyond their post.

## Gotchas

- `Attack ground` uses a left-click to confirm (targeting mode), while plain
  right-click is move/attack — mixing these up issues a move instead.
- Enemy Turrets (range 18) outrange early Ghostrunners: a direct siege without
  Behemoths loses units. For deterministic combat proofs, sacrifice one unit
  rather than the whole force, and keep the player Command Center out of
  turret line-of-sight by staying near the player start.
- Health changes lag the order by attack-interval ticks (~1 s); poll with
  `waitForSnapshot`, don't assert immediately after the click.
- Match resolution is terminal — after victory/defeat no orders are accepted
  (see [match-outcome-restart](./match-outcome-restart.md)).
- Guard enemies do not pursue; a proof that expects chasing will time out.
