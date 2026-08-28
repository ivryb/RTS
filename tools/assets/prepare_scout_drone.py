"""Clean a manual Meshy Scout Drone export for the Dune77 runtime."""

import os
import sys

import bpy
from mathutils import Vector


source, blend, output, preview = sys.argv[sys.argv.index("--") + 1 :]
texture_size = 1024


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if len(meshes) != 1:
    raise RuntimeError(f"Expected one Scout Drone mesh, found {len(meshes)}")

body = meshes[0]
body.name = "ScoutDroneBody"
body.data.name = "ScoutDroneBodyMesh"
root = bpy.data.objects.new("ScoutDroneRoot", None)
bpy.context.scene.collection.objects.link(root)
body.parent = root

for material in body.data.materials:
    if not material or not material.use_nodes:
        continue
    for node in list(material.node_tree.nodes):
        if node.type == "TEX_IMAGE" and node.image and "emissive" in node.image.name.lower():
            material.node_tree.nodes.remove(node)
    shader = material.node_tree.nodes.get("Principled BSDF")
    if shader:
        shader.inputs["Emission Color"].default_value = (0, 0, 0, 1)

used_images = {
    node.image
    for material in body.data.materials
    if material and material.use_nodes
    for node in material.node_tree.nodes
    if node.type == "TEX_IMAGE" and node.image
}
for image in used_images:
    if max(image.size) > texture_size:
        image.scale(texture_size, texture_size)
    image.pack()
for image in list(bpy.data.images):
    if image not in used_images:
        bpy.data.images.remove(image)

os.makedirs(os.path.dirname(blend), exist_ok=True)
os.makedirs(os.path.dirname(output), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=blend)

bpy.ops.object.select_all(action="DESELECT")
root.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = root
bpy.ops.export_scene.gltf(
    filepath=output,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_image_format="WEBP",
    export_image_quality=80,
)

corners = [body.matrix_world @ Vector(corner) for corner in body.bound_box]
minimum = Vector(tuple(min(point[index] for point in corners) for index in range(3)))
maximum = Vector(tuple(max(point[index] for point in corners) for index in range(3)))
center = (minimum + maximum) / 2
extent = max(maximum - minimum)

bpy.ops.mesh.primitive_plane_add(size=extent * 6, location=(center.x, center.y, minimum.z - extent * 0.015))
floor = bpy.context.object
floor.data.materials.append(bpy.data.materials.new("InspectionFloor"))
floor.active_material.diffuse_color = (0.12, 0.13, 0.14, 1)

for energy, offset, size in (
    (1000, (extent, -extent, extent * 1.8), extent * 2),
    (500, (-extent, extent, extent), extent * 1.5),
):
    bpy.ops.object.light_add(type="AREA", location=center + Vector(offset))
    bpy.context.object.data.energy = energy
    bpy.context.object.data.shape = "DISK"
    bpy.context.object.data.size = size

bpy.ops.object.camera_add(location=center + Vector((extent * 1.7, -extent * 2, extent * 1.35)))
camera = bpy.context.object
camera.data.type = "ORTHO"
camera.data.ortho_scale = extent * 1.65
camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()

scene = bpy.context.scene
scene.camera = camera
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = preview
scene.world.color = (0.025, 0.03, 0.04)
scene.view_settings.look = "AgX - Medium High Contrast"
os.makedirs(os.path.dirname(preview), exist_ok=True)
bpy.ops.render.render(write_still=True)

print(
    f"OPTIMIZED vertices={len(body.data.vertices)} "
    f"polygons={len(body.data.polygons)} images={len(used_images)}"
)
print(f"OUTPUT {output} size={os.path.getsize(output)}")
print(f"BLEND {blend}")
print(f"PREVIEW {preview}")
