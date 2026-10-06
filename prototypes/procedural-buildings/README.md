# Procedural buildings

One showcase for the command center, turret, and future buildings using the shared **Aged desert** materials. It loads the actual production GLBs through the production model loader, at game scale, on the game's terrain and lighting.

Reuse the running Vite server and open `/prototypes/procedural-buildings/`.

- **All buildings** shows the current production lineup. Select a building for a closer inspection.
- **Meshy references** adds the archived originals beside the selected buildings.
- **Rear view**, **Low angle**, **Form only**, and **Wireframe** help inspect construction and materials.
- **Head rotation** turns the turret head through a full circle. **Frame buildings** restores the camera after orbiting or zooming.

The selection and controls are saved in the URL, for example:

```text
/prototypes/procedural-buildings/?building=turret&references=1&low=1&yaw=180
/prototypes/procedural-buildings/?building=command-center&surface=form
```

The scene renders on interaction and stays idle between changes. It does not require generated files from `art/workbench/`. Use the T3 collaborative preview for inspection and saved screenshots; `window.__previewReady` marks loading completion. The maintained `tools/preview/` capture scenes remain the broader production rendering check.

## Adding a building

Add its accepted model to the production `demoAssets` catalog in `src/modelAssets.ts` with a `building` entry. It appears in this showcase automatically, with spacing and camera framing calculated from its loaded geometry. If an older Meshy reference exists, add its URL to `archives` in `preview.ts`; references are optional.

Build and material instructions live in [Procedural buildings](../../tools/assets/PROCEDURAL_BUILDINGS.md); visual guidance lives in [Building style](../../tools/assets/BUILDING_STYLE.md). The generators and geometry checks live under `tools/assets/`, independently of this viewer.

The old command-center variation demo and its capture script were retired after accepting ivory shoulders and turret revision 09. Its source snapshot and generated studies remain in ignored `art/workbench/procedural-command-center/reviews/demo-before-consolidation-2026-10-06/` and the existing workbench variant folders. Original Meshy assets and reference images remain in the [repository archive](../../assets/source/meshy/archive/README.md).

Asset license: CC BY-SA 4.0. Code license: AGPL-3.0-or-later.
