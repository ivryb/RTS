"""Prepare a regenerated animated Ghostrunner for the Dune77 runtime."""

import os
import sys

import bpy


source, blend, output = sys.argv[sys.argv.index("--") + 1 :]

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if not meshes or not bpy.data.actions:
    raise RuntimeError("Expected a rigged Ghostrunner with animations")

body = max(meshes, key=lambda obj: len(obj.data.polygons))
for helper in meshes:
    if helper is not body:
        bpy.data.objects.remove(helper, do_unlink=True)

if not body.find_armature():
    raise RuntimeError("Ghostrunner mesh is not skinned")

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
    image.pack()
for image in list(bpy.data.images):
    if image not in used_images and image.users == 0:
        bpy.data.images.remove(image)

os.makedirs(os.path.dirname(blend), exist_ok=True)
os.makedirs(os.path.dirname(output), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=blend)
bpy.ops.export_scene.gltf(
    filepath=output,
    export_format="GLB",
    export_animations=True,
    export_skins=True,
    export_morph=True,
    export_yup=True,
    export_image_format="WEBP",
    export_image_quality=80,
)

print(
    f"OPTIMIZED vertices={len(body.data.vertices)} polygons={len(body.data.polygons)} "
    f"images={len(used_images)} actions={len(bpy.data.actions)}"
)
print(f"OUTPUT {output} size={os.path.getsize(output)}")
print(f"BLEND {blend}")
