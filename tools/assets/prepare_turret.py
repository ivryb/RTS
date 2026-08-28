"""Split the Meshy turret at its mechanical seam and export a yawing head."""

import math
import os
import sys

import bpy
from mathutils import Vector


source, output, preview = sys.argv[sys.argv.index("--") + 1:]
split_height = 0.065

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)

base = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH")
before = set(bpy.context.scene.objects)
bpy.context.view_layer.objects.active = base
base.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.bisect(
    plane_co=(0, 0, split_height),
    plane_no=(0, 0, 1),
    use_fill=False,
    clear_inner=False,
    clear_outer=False,
    threshold=0.00001,
)
bpy.ops.mesh.select_all(action="DESELECT")
bpy.ops.object.mode_set(mode="OBJECT")

for polygon in base.data.polygons:
    polygon.select = all(base.data.vertices[index].co.z >= split_height - 0.00002 for index in polygon.vertices)

bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.separate(type="SELECTED")
bpy.ops.object.mode_set(mode="OBJECT")

head = next(obj for obj in bpy.context.scene.objects if obj not in before)
base.name = "TurretBase"
head.name = "TurretHeadMesh"

root = bpy.data.objects.new("TurretRoot", None)
pivot = bpy.data.objects.new("TurretHead", None)
bpy.context.scene.collection.objects.link(root)
bpy.context.scene.collection.objects.link(pivot)
pivot.location = (0, 0, split_height)
pivot.parent = root
base.parent = root
head.parent = pivot
head.matrix_parent_inverse = pivot.matrix_world.inverted()

os.makedirs(os.path.dirname(output), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
for obj in (root, pivot, base, head):
    obj.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(
    filepath=output,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
)

# Render the split with an exaggerated head angle so the seam is easy to inspect.
pivot.rotation_euler.z = math.radians(52)
bounds = [obj.matrix_world @ Vector(corner) for obj in (base, head) for corner in obj.bound_box]
min_z = min(point.z for point in bounds)

bpy.ops.object.select_all(action="DESELECT")
bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, min_z - 0.006))
floor = bpy.context.object
floor.data.materials.append(bpy.data.materials.new("Sand"))
floor.data.materials[0].diffuse_color = (0.55, 0.43, 0.29, 1)

world = bpy.context.scene.world
world.color = (0.025, 0.025, 0.025)
for name, energy, location, size in (
    ("Key", 900, (-2.5, -3.5, 4.5), 4.0),
    ("Fill", 500, (3.5, 1.5, 2.8), 3.0),
):
    light_data = bpy.data.lights.new(name, "AREA")
    light_data.energy = energy
    light_data.shape = "DISK"
    light_data.size = size
    light = bpy.data.objects.new(name, light_data)
    light.location = location
    bpy.context.scene.collection.objects.link(light)

camera_data = bpy.data.cameras.new("Camera")
camera = bpy.data.objects.new("Camera", camera_data)
camera.location = (1.8, -2.7, 1.55)
direction = Vector((0, 0, -0.02)) - camera.location
camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
camera_data.type = "ORTHO"
camera_data.ortho_scale = 1.35
bpy.context.scene.collection.objects.link(camera)

scene = bpy.context.scene
scene.camera = camera
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = preview
scene.render.film_transparent = False
scene.view_settings.look = "AgX - Medium High Contrast"
os.makedirs(os.path.dirname(preview), exist_ok=True)
bpy.ops.render.render(write_still=True)

print(f"PREPARED source={source}")
print(f"OUTPUT {output}")
print(f"PREVIEW {preview}")
print(f"SPLIT height={split_height} base_faces={len(base.data.polygons)} head_faces={len(head.data.polygons)}")
