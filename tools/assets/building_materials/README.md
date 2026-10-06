# Shared building materials: Aged desert

The procedural building palette lives here, independently of any particular model. `palette.json` controls the paint colors, metalness, roughness, normal strength, and shared yellow-brown weathering colors. Keep the palette consistent across buildings; use geometry, panel layout, and restrained accents to distinguish their functions.

The paint stays mostly clean, with low broad color variation and restrained normal detail. `paint_variation`, `paint_chip_count`, and `streak_count` control this in the shared weathering settings; metal has separate variation and chip counts. The intent is soft, readable armor with aging at its edges, rather than noisy dirt across every panel.

Creamy panel centers transition into uneven brown aging at the base. `armor_lower_age` and `armor_side_age` control its strength, and `armor_age_depth` controls how far it rises for both tiles. Roof caps sit in full sun, so they age less than walls at the base (`roof_lower_age`, `roof_side_age`) but gain rim grime (`roof_edge_age`) and broader mottling (`roof_variation`); a clean, evenly lit roof reads as plastic beside weathered walls. Orient wall UVs with V=0 at the lower edge so the accumulated aging follows the building's base.

| Role | Intended use |
| --- | --- |
| `armor` | Aged sand ivory, primary walls and footing armor |
| `roof` | Weathered ivory, no lighter than the walls; roof caps, canopy, dish |
| `machinery` | Neutral graphite, doors, vents, bays, service panels |
| `structure` | Worn ochre bronze, hinges, rails, clamps, piston collars |
| `recess` | Dark warm rubber, gaskets and deep joints |
| `indicator` | Small cyan service/faction lights |
| `glass` | Cool, glossy smoked glass for windows, screens, and lamp lenses |

## Use from a Blender generator

```python
import sys
sys.path.insert(0, str(repo_root / 'tools/assets'))
from building_materials import create_materials

materials = create_materials(
    repo_root / 'art/workbench/building-materials/aged-desert',
    texture_python='/path/to/python-with-pillow-and-numpy',
    seed=77,
)
wall.data.materials.append(materials.armor)
vent.data.materials.append(materials.machinery)
```

The function generates deterministic 1024 px color, tangent normal, and roughness maps; builds glTF-compatible Principled materials; packs their textures; and saves `aged-desert-materials.blend` containing the seven materials marked as Blender assets. The material library can also be appended into an independently authored Blender file. Output stays under ignored `art/workbench/` until adopted by the game.

The textured finishes are **panel tiles**, with perimeter seams and edge wear. Panel subdivisions, windows, and machinery layouts belong in geometry; the reusable textures deliberately contain no nested access-panel motifs. Map each authored plate or access panel to the 0–1 UV square; they are not seamless terrain textures. Keep comparable physical panel sizes across buildings rather than stretching one tile over an entire facade. Fit each plate's tile to its own edges, not the world axes, or its seams cut across the part. The untextured recess, indicator, and glass materials do not require UVs.

All buildings use the same default seed and palette. Palette edits affect every subsequent generation; already exported GLBs must be rebuilt. The production command center and turret use this library and appear together in the [building showcase](../../../prototypes/procedural-buildings/README.md). Shared atlas and contact-shading code lives in `../building_bake.py`; geometry stays in each building's generator. See [Procedural buildings](../PROCEDURAL_BUILDINGS.md) for regeneration and verification.

No Meshy texture pixels, generated images, or third-party textures are used. Generated asset outputs follow the repository's CC BY-SA 4.0 asset license; scripts follow AGPL-3.0-or-later.
