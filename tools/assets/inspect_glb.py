import math
import os
import sys

import bpy
from mathutils import Vector


source, output = sys.argv[sys.argv.index("--") + 1 :]

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
minimum = Vector(tuple(min(point[i] for point in corners) for i in range(3)))
maximum = Vector(tuple(max(point[i] for point in corners) for i in range(3)))
center = (minimum + maximum) / 2
extent = max(maximum - minimum)

print(f"INSPECT meshes={len(meshes)} bounds_min={tuple(minimum)} bounds_max={tuple(maximum)}")
for obj in meshes:
    print(f"MESH name={obj.name} vertices={len(obj.data.vertices)} polygons={len(obj.data.polygons)}")

floor_z = minimum.z - extent * 0.015
bpy.ops.mesh.primitive_plane_add(size=extent * 6, location=(center.x, center.y, floor_z))
floor = bpy.context.object
floor.data.materials.append(bpy.data.materials.new("InspectionFloor"))
floor.active_material.diffuse_color = (0.12, 0.13, 0.14, 1)

bpy.ops.object.light_add(type="AREA", location=center + Vector((extent, -extent, extent * 1.8)))
bpy.context.object.data.energy = 1000
bpy.context.object.data.shape = "DISK"
bpy.context.object.data.size = extent * 2

bpy.ops.object.light_add(type="AREA", location=center + Vector((-extent, extent, extent)))
bpy.context.object.data.energy = 500
bpy.context.object.data.size = extent * 1.5

bpy.ops.object.camera_add(location=center + Vector((extent * 1.7, -extent * 2.0, extent * 1.35)))
camera = bpy.context.object
camera.data.type = "ORTHO"
camera.data.ortho_scale = extent * 1.65
camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = output
scene.render.film_transparent = False
scene.world.color = (0.025, 0.03, 0.04)
scene.view_settings.look = "AgX - Medium High Contrast"

os.makedirs(os.path.dirname(output), exist_ok=True)
bpy.ops.render.render(write_still=True)
print(f"RENDERED {output}")
