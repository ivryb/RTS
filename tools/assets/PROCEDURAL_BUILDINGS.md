# Procedural buildings

The accepted production buildings are command center `field-ivory` and turret **compact foundation revision 09**. Both use the shared Aged desert materials. `assets/models/turret.glb` contains the procedural turret with a connected bearing and named muzzle anchor. The outgoing Meshy runtime and five original reference renders are preserved in [`assets/source/meshy/archive/`](../../assets/source/meshy/archive/README.md).

## Source and regeneration

- `build_command_center.py`: named command-center assemblies and design variations.
- `build_turret.py`: fixed base, overlapping rotating bearing, head, and muzzle anchor.
- `building_parts.py`: shared plates, solids, shells, turned profiles, rods, rings, and surface UVs.
- `building_materials/`: the seeded palette and authored PBR panel finishes.
- `building_bake.py`: shared atlas baking, preserving source colors, normals, roughness, metalness, emission, and contact shading.

Run Blender unrestricted on this Mac. Build sequentially because both generators write the same material library:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --threads 6 \
  --python-exit-code 1 --python tools/assets/build_command_center.py -- \
  --design field-ivory \
  --texture-python /Users/rybnikov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3

/Applications/Blender.app/Contents/MacOS/Blender --background --threads 6 \
  --python-exit-code 1 --python tools/assets/build_turret.py -- \
  --texture-python /Users/rybnikov/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
```

Editable named-part `.blend` files and baked GLBs are written to `art/workbench/procedural-command-center/variants/field-ivory/` and `art/workbench/procedural-turret/`. `--draft` skips baking; it is for geometry inspection. Final exports use WebP textures at quality 85: a 2048 px command-center atlas and a 1024 px turret atlas. The generators and shared palette are the editable source of truth; generated Blender files need not be duplicated in Git.

The [building showcase](../../prototypes/procedural-buildings/README.md) displays all production buildings together, with optional archived Meshy comparisons. It reads the production asset catalog, so adding a building there also adds it to the showcase. Inspect generated exports before accepting them; then copy the accepted GLBs to their runtime paths and update `assets/models/procedural-manifest.json`. The original Meshy models are explicitly archived in `assets/source/meshy/archive/` and described in `assets/models/meshy-manifest.json`. See [Building style](BUILDING_STYLE.md) for the shared visual direction.

## Turret movement

`TurretRoot` contains fixed `TurretBase` and rotating `TurretHead`. The head contains `TurretHeadMesh` and `TurretMuzzle`. The gun points along local -X; glTF uses Y-up. Game code rotates the head and takes the firing origin from `TurretMuzzle`, rather than guessing coordinates for a particular mesh.

Revision 09 makes the foundation more compact while retaining four rectangular feet and four rounded pods. Shorter, narrower feet have taller shoulders and softened corners; their window assemblies follow the authored face slope. The pods sit closer to the bearing and have taller upright fronts, reducing the broad sloping apron. Each module retains its recessed gasket and plain ivory band without a metal insert. Keep each foot's width constant through its height. The feet extend inward under the bearing so the pods meet their straight sides before the clipped rear corners. `pod_span` fits the curved pods and ivory bands to those planes with a narrow dark joint. Do not derive foot width from the pod's changing radius: that pinched the feet in revision 07. The roof cover has clipped forward corners and sits flush in its opening.

The central spindle overlaps the fixed socket and the lower head plate, filling the original gap while preserving the larger shapes. Circular overlap keeps it connected at every yaw. The atlas is baked with the complete assembly, then split using authored part ownership. Do not bisect the finished mesh at a height: that can remove the connecting bearing or shift the head.

## Checks

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --threads 2 \
  --python-exit-code 1 --python tools/assets/check_command_center.py -- field-ivory

/Applications/Blender.app/Contents/MacOS/Blender --background --threads 2 \
  --python-exit-code 1 --python tools/assets/check_turret.py -- art/workbench/procedural-turret/turret.glb
```

The turret check sends horizontal rays through 45 bearing heights at 12 viewing angles and eight head rotations. It also checks ground contact, a stationary base, and an unobstructed muzzle that turns with the head. Adding `--lift-head .30` deliberately reproduces the levitation defect and must fail. Check the baked model in low-angle and gameplay views as well; passing geometry checks is not visual acceptance.

For runtime behavior, run `await (await import('/tools/preview/turretBehaviorCheck.ts')).checkTurretBehavior()` in the local preview browser. It loads the production GLB through `loadBuildingModel` and drives `UnitSystem` through idle scanning, eight target directions at three building rotations, muzzle launches, and return to idle. It checks that the foundation stays fixed and that projectile travel matches the barrel direction.

Use the production `tools/preview/?scene=buildings&seed=77` scene for overview, gameplay, and close views. Presentation tests verify aim and projectile alignment with the authored muzzle.

Code: AGPL-3.0-or-later. Generated geometry and textures: CC BY-SA 4.0.
