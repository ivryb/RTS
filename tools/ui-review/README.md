# UI review workbench

Open `/tools/ui-review/` on the existing Vite dev server. Select a state in the sidebar; choose a viewport size to check compact layouts. URLs preserve the selected state so reviews can link directly to it. Only one fixture runs at a time. No game simulation, WebGL renderer, or 3D asset download is required.

The page loads the **production** `index.html`, `src/style.css`, `UnitInput`, `UnitSystem`, catalogs, and tactical map. Fixture frames are frozen and commands do not alter simulation state; targeting/build menu buttons still change the HUD normally. It is a visual review utility, not an interaction/gameplay test. Outcomes currently use fixture text inside the production overlay. Terrain settings are intentionally unpopulated; verify actual settings behavior in the game.

## Capture

Check for an existing dev server before starting one. Reuse it; do not launch a second server.

```sh
VERIFY_BASE_URL=http://127.0.0.1:5173 bun run ui:review:capture
# Focus one state while iterating:
VERIFY_BASE_URL=http://127.0.0.1:5173 bun run ui:review:capture --grep command-center
```

Snapshots and a contact sheet are written to `art/workbench/renders/ui-review/`. Open `index.html` after a full capture to scan all states. Screenshots are current evidence, not automatically approved golden images. Review them before accepting visual changes.

## Coverage and maintenance

`states.ts` is the state inventory. `scene.ts` supplies deterministic game frames to the real renderer. Add a fixture when adding a new HUD state; never reproduce the HUD markup or CSS in the workbench.

- Empty selection; each unit kind; grouped/mixed selection; damaged units; enemy inspection.
- Command Center and Turret; enemy building; partial/full production queues; active/paused construction.
- Move, direct attack, ground attack, rally targeting, and Scout build menu.
- Settings, controls, victory, defeat.
- Top bar, objective, minimap and portrait presentation in every preset.

For actual game input, picking, minimap commands, ownership guards, and responsive layout, run `tools/verify/specs/tactical-hud.spec.ts` and `select-and-move.spec.ts`.

For **world-space indicators**, use `bun run preview:capture --grep feedback` and deterministic tests in `orderMarker.test.ts` and `unitPresentation.test.ts`. Ground indicators use `prepareGroundOverlay` and `placeGroundGeometry` in `src/groundOverlay.ts`: keep geometry flat at its anchor height, draw after terrain and before models. Do not drape vertices over terrain; this distorts circles on mountains. Keep parent groups at default render order. Verify `orders-mountain` for Scout selection and pulses, `range-terrain` for ranges, and `attack-target` for model occlusion. Exercise repeated placement and size changes.
