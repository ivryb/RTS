# Terrain textures

This file records textures we have already tested so rejected downloads do not return to the selector later.

Flat-ground runtime textures are grayscale detail maps normalized to an average luminance of 128/255. Original colored diffuse files remain under `assets/source/`; the in-game tint control owns the base terrain hue and overall brightness. Authored cliff materials retain their source color so they remain distinct from sand.

## Active roles

Texture roles are chosen manually rather than randomized by seed. **Aerial Beach 01** is the only base. **Coast Sand 05** and **Dirt Aerial 03** are the only broad patch options.

| Texture                        | Base |   Patches    | Notes                                                                                                    |
| ------------------------------ | :--: | :----------: | -------------------------------------------------------------------------------------------------------- |
| Aerial Beach 01                | Yes  |      No      | The single base texture.                                                                                 |
| Coast Sand 05                  |  No  |     Yes      | Patch only; its 17.5 m catalog scale makes the pattern 30% smaller without resizing the image.           |
| Dirt Aerial 03                 |  No  |     Yes      | Patch texture only.                                                                                      |

Steep generated faces use **Marble Cliff 02**. It is projected in world space from orientation-corrected sides, then shifts back to the ungraded sand material across a broad smoothed slope range. Alternating terrain diagonals and the continuous blend avoid directional side artifacts, vertical texture streaks, bright ridge seams, and triangle-shaped material crops.

## Reserved for authored terrain

Keep these names for future map work, but do not expose them as interchangeable base or patch options:

| Texture              | Potential authored role                                  |
| -------------------- | -------------------------------------------------------- |
| Stone Embedded Tiles | Intentional paved areas around buildings or structures.  |
| Hexagonal Concrete   | Flat structure aprons, industrial sites, or city ground. |
| Mud Cracked Dry 03   | Local dried basins, roadside damage, or authored decals. |

Adaptive texture smoothing is enabled by default for both layers. At every zoom level it blends two continuously randomized offsets, so maximum zoom no longer falls back to the visibly repeating source texture. Disabling smoothing restores one sharp sample for each layer.

Ground textures render at 60% of their catalogued world-space size. This changes only UV scale; source image dimensions and quality are untouched.

The procedural patch mask uses a wide `0.44–0.72` noise band and blends it linearly, producing a longer, more gradual transition into the base. After sampling, the broad patch layer receives an `RGB × (0.88, 0.78, 0.66)` grade before its 50% maximum blend. This makes patch regions darker and browner without baking color into texture assets or adding texture lookups.

## Import pipeline

Keep the original colored diffuse image under `assets/source/`, then generate the runtime asset with:

```sh
python3 tools/assets/grade_ground_texture.py assets/source/polyhaven/example-diffuse-1k.jpg assets/textures/terrain/ground-example.webp
```

The defaults remove all chroma, normalize average luminance to 128/255, and export WebP at quality 90. This preserves surface contrast while making the game tint the only source of terrain color. Use `--target-mean`, `--gamma`, `--chroma`, or `--quality` only for deliberate experiments.

After conversion, add flat-ground WebPs to the appropriate Base/Patches selector roles and record the decision in this file. Cliff textures retain color and use a direct 1024 px WebP conversion instead.

## Removed

| Texture                         | Reason                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Aerial Beach 01 — Seamless Test | Edge repair did not hide the repeated large-scale features visible at zoom-out. |
| Aerial Beach 01 — Original JPG  | Removed from the game; the normalized runtime texture is the useful version.     |
| Gravel Floor 04                 | Too smooth.                                                                     |
| Red Sand                        | Too smooth.                                                                     |
| Worn Rock Natural 01            | No clear application for it right now.                                          |
| Gravelly Sand                   | Repetition is too visible.                                                      |
| Moon 01                         | Too smooth.                                                                     |
| Moon 02                         | Too smooth.                                                                     |
| Sandy Gravel 02                 | Tile borders are too strong.                                                    |
| Dirt                            | Not useful.                                                                     |
| Grey Plaster 03                 | Not useful.                                                                     |
| Ground 0016                     | Too smooth.                                                                     |
| Ground 0024                     | Not useful.                                                                     |
| Ground 0043                     | Not useful.                                                                     |
| Sand (JPG)                      | Not useful.                                                                     |
| Sand (PBR)                      | Not useful.                                                                     |
| FS Cliff Rocks 06               | FreeStylized art direction is a bad fit for the game.                            |
| FS Cliff Rocks 07               | FreeStylized art direction is a bad fit for the game.                            |
| FS Desert Ground 01             | FreeStylized art direction is a bad fit for the game.                            |
| FS Ground 01                    | FreeStylized art direction is a bad fit for the game.                            |
| FS Ground 02                    | FreeStylized art direction is a bad fit for the game.                            |
| FS Ground 03                    | FreeStylized art direction is a bad fit for the game.                            |
| FS Ground 08                    | FreeStylized art direction is a bad fit for the game.                            |
| FS Rock 01                      | FreeStylized art direction is a bad fit for the game.                            |
| FS Sand 04                      | FreeStylized art direction is a bad fit for the game.                            |
