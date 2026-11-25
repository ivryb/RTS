# Ground markers

Every marker on the ground (unit, building and Titanium Deposit selection, and the building placement cursor) speaks one language: the **Reticle**. Ivan chose it on 2026-11-21 (D77-16) over a soft halo, a dark ground plate and an octagon.

## The language

- **Selection** is a ring broken into four bracket arcs. The gaps face screen-up, screen-down, screen-left and screen-right, whichever way the unit or building faces, so every marker matches on screen. It is the round cousin of the attack-target brackets in `src/orderMarker.ts`.
- **A unit shows the same four brackets**, on its body radius. In a crowd at its tightest (Ghostrunners 1.2 m apart) neighbours' markers all but touch. Ivan chose that on 2026-11-25 over a near pair cut short of the unit's sides, which looked cropped, so keep crowds the same as lone units.
- **A unit's marker is wider than its hull**, or the hull covers it. The radius is `selectionRing.radius` in `src/modelAssets.ts`: a ground vehicle's clears the longer half of its hull (Behemoth 1.9 m for a 3.5 m hull), a hovering unit's is the ground it holds in formation (Hornet 1.3 m). The same radius sets the unit's health bar width and the patch of ground a vehicle tilts to.
- **One stroke** on every marker, never scaled by the radius, with a thin dark keyline under it so off-white holds on bright sand. On a building or deposit the brackets sit a fixed 0.1 m outside the footprint. The tilted camera draws the 0.09 m stroke about 2 px wide where a bracket runs up the screen and 1.6 px where it runs across, on every marker alike.
- **Buildings are marked at their real footprint** (`radius`, Command Center 5.58 m, Turret 1.8 m), not their attack radius, so the selection marker and the placement cursor outline the same ground.
- **Colour means owner:** off-white (`UI_SELECTION_COLOR`) for the local player and for resources, red (`UI_ATTACK_COLOR`) for the enemy and for blocked placement.
- **Placement** shows a translucent ghost of the real building, a fine ring on the footprint with a tick every 15 degrees, the four ticks on the screen axes running out through the bracket gaps as a crosshair, and the four brackets framing it 0.3 m outside. On a Turret the crosshair ticks overshoot by a third as much, or its small footprint reads as a gunsight. The ghost keeps the model's panels and windows as light and dark, lit from where the match's sun stands.
- **Blocked placement** turns everything red, replaces the ticks with diagonal hatching across the footprint (0.62 m apart, 0.45 m on a Turret, which would otherwise get five lines) and darkens it, so the state differs in pattern and brightness as well as hue. The ghost turns pale red and more solid, so the building still reads over the hatching.
- Health bars and rally flags are unchanged.

`src/groundMarkers.ts` owns all of it: `createSelectionMarker` for units, buildings and deposits, and `PlacementCursor` for placement. `tools/verify/specs/ground-markers.spec.ts` captures states 1 to 6 below to `art/workbench/verify/ground-markers/`; after any change to the markers, run it on `main` and on your branch and compare the two sets. State 7 has no capture; a test in `tests/unitPresentation.test.ts` checks that the cursor stays flat over ridges.

Ivan approved the look from a sketch of four brackets on everything. Three things were decided while building it and wait for his review: a unit's brackets sit on its body radius with no pad, the Behemoth's and the Hornet's wider markers (and with them wider health bars), and the ghost's shading.

## States

1. Placement, valid: Command Center and Turret.
2. Placement, blocked: Command Center and Turret.
3. Selection of one of the player's buildings.
4. Selection of a Titanium Deposit.
5. Selection of one unit, of a close squad (three Ghostrunners and a Scout Drone), of 24 units in their tightest formation, of a Behemoth and a Hornet each alone, and of an army with every unit size.
6. Selection of an enemy unit and building (red).
7. Placement over a slope or rock edge.

## Padding

There are two distances, and each has a reason:

- 0.1 m from a selected footprint to its brackets, so they clear the model's walls. Units have none: Ghostrunners stand 1.2 m apart and their markers are 1.12 m across, so 0.1 m more would overlap them.
- 0.3 m from the placement cursor's footprint ring to its brackets. At 0.1 m the two lines are two pixels apart at the default camera and merge into one uneven ring.

## Motion

None. Markers appear and vanish at once, and placement switches between valid and blocked at once. Ivan saw recordings of a bracket close-in on selection and a hatching sweep on blocked (2026-11-22) and turned both down: the building close-in looked too wide, a 20 to 30 unit selection would look dirty, and the sweep added nothing. Keep it simple.
