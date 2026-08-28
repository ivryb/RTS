"""Prepare the manual Meshy Hornet export for the Dune77 runtime."""

import os
import sys

import bpy


source, blend, output = sys.argv[sys.argv.index("--") + 1 :]

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if len(meshes) != 1:
    raise RuntimeError(f"Expected one Hornet mesh, found {len(meshes)}")

body = meshes[0]
body.name = "HornetBody"
body.data.name = "HornetBodyMesh"
root = bpy.data.objects.new("HornetRoot", None)
bpy.context.scene.collection.objects.link(root)
body.parent = root

used_images = {
    node.image
    for material in body.data.materials
    if material and material.use_nodes
    for node in material.node_tree.nodes
    if node.type == "TEX_IMAGE" and node.image
}
for image in used_images:
    if max(image.size) > 1024:
        image.scale(1024, 1024)

base_color = next(
    (image for image in used_images if "base_color" in image.name.lower()),
    None,
)
if not base_color:
    raise RuntimeError("Missing Hornet base-color texture")

pixels = list(base_color.pixels)
for index in range(0, len(pixels), 4):
    red, green, blue = pixels[index : index + 3]
    warmth = min(1, max(0, (red - green) * 8))
    light = min(1, max(0, ((red + green + blue) / 3 - 0.15) * 3))
    correction = warmth * light
    pixels[index] -= (red - blue) * 0.16 * correction
    pixels[index + 2] += (green - blue) * 0.05 * correction
    lift = 0.08 * correction
    for channel in range(3):
        pixels[index + channel] += (1 - pixels[index + channel]) * lift
base_color.pixels.foreach_set(pixels)
base_color.update()

for image in used_images:
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

print(
    f"OPTIMIZED vertices={len(body.data.vertices)} "
    f"polygons={len(body.data.polygons)} images={len(used_images)}"
)
print(f"OUTPUT {output} size={os.path.getsize(output)}")
print(f"BLEND {blend}")
