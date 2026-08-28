"""Transfer a Meshy retexture onto the animated Ghostrunner without replacing its rig."""

import os
import sys
from itertools import product

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


rig_source, texture_source, blend, output = sys.argv[sys.argv.index("--") + 1 :]

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=rig_source)

rig_objects = set(bpy.context.scene.objects)
rig_meshes = [obj for obj in rig_objects if obj.type == "MESH"]
if not rig_meshes or not bpy.data.actions:
    raise RuntimeError("Expected an animated Ghostrunner mesh")
rig = max(rig_meshes, key=lambda obj: len(obj.data.polygons))
for helper in rig_meshes:
    if helper is rig:
        continue
    rig_objects.remove(helper)
    bpy.data.objects.remove(helper, do_unlink=True)

bpy.ops.import_scene.gltf(filepath=texture_source)
donor_meshes = [
    obj for obj in bpy.context.scene.objects
    if obj not in rig_objects and obj.type == "MESH"
]
if len(donor_meshes) != 1:
    raise RuntimeError("Expected one Meshy retexture mesh")
donor = donor_meshes[0]
if len(rig.data.polygons) != len(donor.data.polygons):
    raise RuntimeError("Retexture geometry has a different triangle count")


def bounds(obj):
    points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum, (minimum + maximum) / 2


rig_min, rig_max, rig_center = bounds(rig)
donor_min, donor_max, donor_center = bounds(donor)
scale = max(rig_max - rig_min) / max(donor_max - donor_min)
donor_polygons = [tuple(polygon.vertices) for polygon in donor.data.polygons]
rig_centers = [
    sum(
        (rig.matrix_world @ rig.data.vertices[index].co for index in polygon.vertices),
        Vector(),
    ) / len(polygon.vertices)
    for polygon in rig.data.polygons
]
original_matrix = donor.matrix_world.copy()
best_alignment = None
for flip in product((-1, 1), repeat=3):
    signed_scale = Matrix.Diagonal((*[axis * scale for axis in flip], 1))
    candidate = (
        Matrix.Translation(rig_center)
        @ signed_scale
        @ Matrix.Translation(-donor_center)
        @ original_matrix
    )
    vertices = [candidate @ vertex.co for vertex in donor.data.vertices]
    candidate_tree = BVHTree.FromPolygons(vertices, donor_polygons)
    distances = [candidate_tree.find_nearest(center)[3] for center in rig_centers]
    score = sum(distances) / len(distances)
    if best_alignment is None or score < best_alignment[0]:
        best_alignment = (score, flip, candidate, vertices, candidate_tree)

_, alignment_flip, donor.matrix_world, donor_vertices, tree = best_alignment
bpy.context.view_layer.update()
source_uv = donor.data.uv_layers.active
if not source_uv:
    raise RuntimeError("Retexture mesh has no UV map")
target_uv = rig.data.uv_layers.active or rig.data.uv_layers.new(name="UVMap")

max_center_distance = 0
max_corner_distance = 0
for polygon in rig.data.polygons:
    corners = [rig.matrix_world @ rig.data.vertices[index].co for index in polygon.vertices]
    center = sum(corners, Vector()) / len(corners)
    _, _, donor_index, center_distance = tree.find_nearest(center)
    donor_polygon = donor.data.polygons[donor_index]
    max_center_distance = max(max_center_distance, center_distance)
    for loop_index in polygon.loop_indices:
        point = rig.matrix_world @ rig.data.vertices[rig.data.loops[loop_index].vertex_index].co
        donor_loop = min(
            donor_polygon.loop_indices,
            key=lambda index: (
                donor_vertices[donor.data.loops[index].vertex_index] - point
            ).length_squared,
        )
        distance = (
            donor_vertices[donor.data.loops[donor_loop].vertex_index] - point
        ).length
        max_corner_distance = max(max_corner_distance, distance)
        target_uv.data[loop_index].uv = source_uv.data[donor_loop].uv

if max_center_distance > 0.01 or max_corner_distance > 0.02:
    raise RuntimeError(
        f"Retexture geometry mismatch: flip={alignment_flip}, mean={best_alignment[0]:.5f}, "
        f"centers={max_center_distance:.5f}, corners={max_corner_distance:.5f}, "
        f"rig_bounds=({tuple(rig_min)}, {tuple(rig_max)}), "
        f"donor_bounds=({tuple(donor_min)}, {tuple(donor_max)})"
    )

if not donor.data.materials:
    raise RuntimeError("Retexture mesh has no material")
rig.data.materials.clear()
rig.data.materials.append(donor.data.materials[0])

used_images = {
    node.image
    for material in rig.data.materials
    if material and material.use_nodes
    for node in material.node_tree.nodes
    if node.type == "TEX_IMAGE" and node.image
}
for image in used_images:
    if max(image.size) > 1024:
        image.scale(1024, 1024)
    image.pack()

for obj in list(bpy.context.scene.objects):
    if obj not in rig_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
for material in list(bpy.data.materials):
    if material.users == 0:
        bpy.data.materials.remove(material)
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
    f"TRANSFERRED faces={len(rig.data.polygons)} images={len(used_images)} "
    f"flip={alignment_flip} center_error={max_center_distance:.6f} "
    f"corner_error={max_corner_distance:.6f}"
)
print(f"OUTPUT {output} size={os.path.getsize(output)} actions={len(bpy.data.actions)}")
print(f"BLEND {blend}")
