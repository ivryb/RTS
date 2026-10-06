"""Check the exported turret's bearing through a full yaw sweep, including low sightlines."""
import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('model',type=Path)
parser.add_argument('--lift-head',type=float,default=0,help='inject the floating-head regression in memory')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
if args.model.suffix == '.blend':
    bpy.ops.wm.open_mainfile(filepath=str(args.model.resolve()))
else:
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(args.model.resolve()))
head,muzzle = bpy.data.objects['TurretHead'],bpy.data.objects['TurretMuzzle']
assert muzzle.parent == head, 'Muzzle must turn with the head'
head.location.z += args.lift_head
bpy.context.view_layer.update()
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
moving_parts = set(head.children_recursive)
base_meshes = [obj for obj in meshes if obj not in moving_parts]
initial_base_matrices = [obj.matrix_world.copy() for obj in base_meshes]
minimum_z = min((obj.matrix_world @ v.co).z for obj in meshes for v in obj.data.vertices)
assert abs(minimum_z) < .001, f'Foundation must rest on the ground: {minimum_z}'
failures = []
samples = 0
for degrees in range(0,360,45):
    head.rotation_euler.z = math.radians(degrees)
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    assert all(obj.matrix_world == matrix for obj,matrix in zip(base_meshes,initial_base_matrices)), 'Base moved with head'
    # A bounding-box overlap can hide a real gap. These horizontal rays require a
    # surface in the near half of every bearing cross-section, all the way around.
    for layer in range(45):
        z = .90+layer*.01
        for direction in range(12):
            angle = direction*math.tau/12
            outward = Vector((math.cos(angle),math.sin(angle),0))
            origin = outward*1.8+Vector((0,0,z))
            hit,point,_,_,_,_ = bpy.context.scene.ray_cast(deps,origin,-outward,distance=1.75)
            samples += 1
            if not hit or point.dot(outward) < .10:
                failures.append({'head_yaw':degrees,'height':round(z,3),'view_angle':direction*30})
    forward = head.matrix_world.to_quaternion() @ Vector((-1,0,0))
    hit,*_ = bpy.context.scene.ray_cast(deps,muzzle.matrix_world.translation,forward,distance=.1)
    assert not hit, f'Muzzle is inside the gun at yaw {degrees}'

report = {'model':str(args.model),'injected_lift':args.lift_head,'bearing_samples':samples,
          'clear_gaps':len(failures),'first_gaps':failures[:12],'ground_contact':minimum_z,
          'stationary_base':True,'muzzle_turns_with_head':True}
output = ROOT/'art/workbench/procedural-turret'/('assembly-checks-lifted.json' if args.lift_head else 'assembly-checks.json')
output.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
assert not failures, f'{len(failures)} open sightlines through the bearing'
