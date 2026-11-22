# Ground markers

Every marker on the ground (unit, building and Titanium Deposit selection, and the building placement cursor) speaks one language: the **Reticle**. Ivan chose it on 2026-11-21 (D77-16) over a soft halo, a dark ground plate and an octagon.

## The language

- **Selection** is a ring broken into four bracket arcs. The gaps face screen-up, screen-down, screen-left and screen-right, whichever way the unit or building faces, so every marker matches on screen. It is the round cousin of the attack-target brackets in `src/orderMarker.ts`.
- **A unit shows only the two near brackets**, the ones on the camera's side, on its body radius. The far two hide behind its body, and in a tight squad four brackets per unit join into a chain-link net.
- **One stroke** on every marker, never scaled by the radius, with a thin dark keyline under it so off-white holds on bright sand. On a building or deposit the brackets sit a fixed 0.1 m outside the footprint.
- **Buildings are marked at their real footprint** (`radius`, Command Center 5.58 m, Turret 1.8 m), not their attack radius, so the selection marker and the placement cursor outline the same ground.
- **Colour means owner:** off-white (`UI_SELECTION_COLOR`) for the local player and for resources, red (`UI_ATTACK_COLOR`) for the enemy and for blocked placement.
- **Placement** shows a translucent ghost of the real building, a fine ring on the footprint with a tick every 15 degrees, the four ticks on the screen axes running out through the bracket gaps as a crosshair, and the four brackets framing it 0.3 m outside. The ghost keeps the model's panels and windows as light and dark, lit from where the match's sun stands.
- **Blocked placement** turns everything red, replaces the ticks with diagonal hatching across the footprint and darkens it, so the state differs in pattern and brightness as well as hue. The ghost turns pale red and more solid, so the building still reads over the hatching.
- Health bars and rally flags are unchanged.

`src/groundMarkers.ts` owns all of it: `createSelectionMarker` for units, buildings and deposits, and `PlacementCursor` for placement. `tools/verify/specs/ground-markers.spec.ts` captures states 1 to 6 below to `art/workbench/verify/ground-markers/`; run it after any change to the markers and compare with the last accepted set. State 7 has no capture; a test in `tests/unitPresentation.test.ts` checks that the cursor stays flat over ridges.

Ivan approved the look from a sketch of four brackets on everything. Three things were decided while building it and wait for his review: units show two brackets instead of four, their brackets sit on the body radius with no pad, and the ghost's shading.

## States

1. Placement, valid: Command Center and Turret.
2. Placement, blocked: Command Center and Turret.
3. Selection of one of the player's buildings.
4. Selection of a Titanium Deposit.
5. Selection of one unit, of a close squad (three Ghostrunners and a Scout Drone), of 24 units in their tightest formation, and of an army with every unit size.
6. Selection of an enemy unit and building (red).
7. Placement over a slope or rock edge.

## Padding

There are two distances, and each has a reason:

- 0.1 m from a selected footprint to its brackets, so they clear the model's walls. Units have none: at 0.1 m the brackets of Ghostrunners standing 1.2 m apart meet and read as one wavy line.
- 0.3 m from the placement cursor's footprint ring to its brackets. At 0.1 m the two lines are two pixels apart at the default camera and merge into one uneven ring.

## Motion

None. Markers appear and vanish at once, and placement switches between valid and blocked at once. Ivan saw recordings of a bracket close-in on selection and a hatching sweep on blocked (2026-11-22) and turned both down: the building close-in looked too wide, a 20 to 30 unit selection would look dirty, and the sweep added nothing. Keep it simple.
