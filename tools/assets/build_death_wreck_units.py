"""Charred unit wrecks for the death effects (docs/death_effects.md).

Each wreck is the production unit model, crushed, tilted, reduced and burnt, so it still reads as
the thing that died. Two frames are used:
- `ground`: metres, origin on the ground under the unit, +Z of the game (-Y here) forward. The
  hovering units fall and are swapped for their wreck wherever they land.
- `visual`: the source model's own frame, so the wreck overlays the live model exactly. The
  Behemoth burns out in place and the Ghostrunner's husk matches the last frame of its Dead clip.

  box blender --background --python-exit-code 1 --python tools/assets/build_death_wreck_units.py
  box pull art/workbench/death-wreck/
"""
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).parent))
from death_wreck_common import (ROOT, activate, bake_color, burn, decimate, dent, export, positions, preview,
                                set_positions)

# `height` and `facing` repeat src/modelAssets.ts; `pitch` and `roll` are the resting tilt the
# fall animation in src/deathEffects.ts ends on (nose down, right side down).
UNITS = {
    'scout-drone': {'frame': 'ground', 'height': .6615, 'facing': math.pi/2, 'pitch': 24, 'roll': 16,
                    'bury': .16, 'squash': .78, 'dents': .035, 'triangles': 900, 'soot': .47, 'atlas': 256},
    'hornet': {'frame': 'ground', 'height': 1.1088, 'facing': math.pi/2, 'pitch': 15, 'roll': -19,
               'bury': .14, 'squash': .8, 'dents': .045, 'triangles': 1700, 'soot': .47, 'atlas': 512},
    'behemoth': {'frame': 'visual', 'squash': .8, 'dents': .05, 'triangles': 2600, 'soot': .45, 'atlas': 512},
    'ghostrunner': {'frame': 'visual', 'clip': 'Dead', 'size': 1.39, 'dust': .04, 'triangles': 1500, 'soot': .6,
                    'paint': .52,
                    'atlas': 256},
}


def frozen_pose(meshes, clip):
    """Copies of the skinned meshes as they stand on the clip's last frame."""
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
    action = bpy.data.actions[clip]
    animation = armature.animation_data or armature.animation_data_create()
    for track in animation.nla_tracks:
        track.mute = True
    animation.action = action
    if action.slots:
        animation.action_slot = action.slots[0]
    bpy.context.scene.frame_set(int(action.frame_range[1]))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    copies = []
    for obj in meshes:
        data = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), preserve_all_data_layers=True,
                                               depsgraph=depsgraph)
        copy = bpy.data.objects.new(obj.name+' / posed', data)
        copy.matrix_world = obj.matrix_world.copy()
        bpy.context.collection.objects.link(copy)
        copies.append(copy)
    return copies


def load(name, spec):
    """The unit as one mesh with its transforms applied."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/f'assets/models/{name}.glb'), merge_vertices=True)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and obj.data.materials]
    if 'clip' in spec:
        meshes = frozen_pose(meshes, spec['clip'])
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Anything left in the scene, such as the skinned original under a posed copy, would shade the bake.
    for other in [other for other in bpy.context.scene.objects if other != obj]:
        bpy.data.objects.remove(other)
    return obj


def crash_on_ground(obj, spec):
    """Game scale and facing, tipped onto the sand with the underside flattened by the impact."""
    points = positions(obj).astype(np.float64)
    turn = np.array(Matrix.Rotation(spec['facing'], 3, 'Z'))
    points = points @ turn.T
    points *= spec['height']/np.ptp(points[:, 2])
    points -= (points.max(axis=0) + points.min(axis=0))/2
    tilt = np.array(Matrix.Rotation(math.radians(spec['pitch']), 3, 'X')
                    @ Matrix.Rotation(-math.radians(spec['roll']), 3, 'Y'))
    points = points @ tilt.T
    points[:, 2] -= points[:, 2].min() + spec['bury']*spec['height']
    below = points[:, 2] < 0
    points[below, 2] *= .12
    points[:, 2] *= spec['squash']
    set_positions(obj, points)
    return spec['height']


def burn_out_in_place(obj, spec):
    """The hull sags onto its tracks and leans; the top, where the rocket pods were, caves most."""
    points = positions(obj).astype(np.float64)
    floor = points[:, 2].min()
    size = np.ptp(points[:, 2])
    level = (points[:, 2] - floor)/size
    points[:, 2] = floor + size*level*(1 - (1 - spec['squash'])*level)
    lean = np.array(Matrix.Rotation(math.radians(3.5), 3, 'Y'))
    points[:, 2] -= floor
    points = points @ lean.T
    points[:, 2] = np.maximum(points[:, 2], -.02*size) + floor
    set_positions(obj, points)
    return size


report = []
for name, spec in UNITS.items():
    wreck = load(name, spec)
    if spec['frame'] == 'ground':
        size = crash_on_ground(wreck, spec)
    elif 'squash' in spec:
        size = burn_out_in_place(wreck, spec)
    else:
        size = spec['size']
    if 'dents' in spec:
        level = positions(wreck)[:, 2]
        level = (level - level.min())/np.ptp(level)
        dent(wreck, spec['dents']*size, .3*size, .35 + .65*level)
    decimate(wreck, spec['triangles'])
    wreck.name = ''.join(part.title() for part in name.split('-'))+'Wreck'
    for index, material in enumerate(wreck.data.materials):
        # Emissive lights and scrolling track texture are dead; only the base colour is burnt.
        burn(material, size, spec['soot'], seed=index*7.3, floor=float(positions(wreck)[:, 2].min()),
             dust=spec.get('dust', .16), paint=spec.get('paint', .42))
    activate(wreck)
    bake_color(wreck, spec['atlas'], wreck.name)
    low, high = positions(wreck).min(axis=0), positions(wreck).max(axis=0)
    report.append({**export([wreck], f'{name}-wreck'), 'frame': spec['frame'],
                   'bounds': [[round(float(v), 3) for v in low], [round(float(v), 3) for v in high]]})
    preview([wreck], f'{name}-wreck', 0 if spec['frame'] == 'ground' else None)
print('WRECKS '+json.dumps(report), flush=True)
