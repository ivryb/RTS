# Ground markers

Every marker on the ground (unit, building and Titanium Deposit selection, and the building placement cursor) speaks one language: the **Reticle**. Ivan chose it on 2026-11-21 (D77-16) over a soft halo, a dark ground plate and an octagon.

## The language

- **Selection** is a ring broken into four bracket arcs. The gaps face screen-up, screen-down, screen-left and screen-right, whichever way the unit or building faces, so every marker matches on screen. It is the round cousin of the attack-target brackets in `src/orderMarker.ts`.
- **One stroke** on every marker, never scaled by the radius, with a thin dark keyline under it so off-white holds on bright sand. The brackets sit a fixed 0.1 m outside the radius they mark.
- **Buildings are marked at their real footprint** (`radius`, Command Center 5.58 m, Turret 1.8 m), not their attack radius, so the selection marker and the placement cursor outline the same ground.
- **Colour means owner:** off-white (`UI_SELECTION_COLOR`) for the local player and for resources, red (`UI_ATTACK_COLOR`) for the enemy and for blocked placement.
- **Placement** shows a translucent ghost of the real building, a fine ring on the footprint with a tick every 15 degrees, the four ticks on the screen axes running out through the bracket gaps as a crosshair, and the four brackets framing it 0.3 m outside.
- **Blocked placement** turns everything red, replaces the ticks with diagonal hatching across the footprint and darkens it, so the state differs in pattern and brightness as well as hue.
- Health bars and rally flags are unchanged.

The sketch that Ivan approved is `src/markerSketch/optionB.ts` on branch `D77-16-selection-markers` (shader, constants and ghost). Its captures come from `MARKERS=b` with `tools/verify/specs/marker-sketch.spec.ts`.

## States

1. Placement, valid: Command Center and Turret.
2. Placement, blocked: Command Center and Turret.
3. Selection of one of the player's buildings.
4. Selection of a Titanium Deposit.
5. Selection of one unit, and of a close squad (three Ghostrunners and a Scout Drone).
6. Selection of an enemy unit and building (red).
7. Placement over a slope or rock edge.

## To fix while building

These come from two design reviews of the sketch:

- The valid ghost is a flat grey silhouette with banding. Give it the model's shading and detail, still clearly translucent, as the octagon sketch's fixed ghost does (sample the model's colour texture as light and dark, shade with a fixed sun, multiply by the state colour). In the blocked state the ghost nearly disappears; keep it readable under the red.
- At unit size the four brackets read as a broken ring and a tight squad's brackets tangle. Make them read as deliberate at the smallest radius (about 0.47 m).
- Padding is two numbers (0.1 m on selection, 0.3 m between the footprint ring and the placement brackets). Keep that only if the placement cursor needs it.
- Once shipped, delete the sketch switch: `src/markerSketch/` options A, C and D, the stub, the `?markers=` parameter, the old ring code paths, and the sketch spec.

## Open

- **Motion.** Proposed: on selection the brackets start about 15% wider and close in over about 120 ms with an ease-out and no bounce; when placement turns blocked the hatching wipes in over about 100 ms. Waits for Ivan.
