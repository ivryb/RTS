# Archived building models

Preserved at Ivan's request during the procedural building migration on 2026-10-05–06. These source snapshots are retained for history and comparison.

- `command-center.glb`: the unchanged Meshy export previously shipped as `assets/models/command-center.glb` (9,579,832 bytes).
- `turret.glb`: the original split Meshy turret, including the gap under its rotating head (9,002,220 bytes). The comparison scene loads this unchanged snapshot. The unsplit export remains in `../manual-exports/turret-textured.glb`.
- `turret-runtime-2026-10-06.glb`: the exact outgoing production turret (9,002,276 bytes), including its named muzzle anchor. Replaced by procedural revision 09 on 2026-10-06; SHA-256 `657344815c210fa007f3a897419fed67d13fe2a3fa45de56a946eaaf2d443c27`.
- [`turret-reference/`](turret-reference/): isometric, front, side, top, and foundation renders of the original Meshy model. The front and side views preserve the old floating-head defect for comparison. These images use the same scale and camera setup as the procedural review renders.
- [`production-comparison-2026-10-06.png`](turret-reference/production-comparison-2026-10-06.png): in-game comparison of accepted procedural revision 09 with the archived Meshy turret, captured when the production asset was replaced.

The procedural building comparison loads these archived files explicitly. Their original provenance is recorded in `assets/models/meshy-manifest.json`.

Asset license: CC BY-SA 4.0 under the repository's `ASSET-LICENSE`.
