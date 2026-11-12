"""Make small instanced rubble LODs from the two CC0 Namaqualand boulder scans.

Run with unrestricted Blender from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/assets/prepare_oxide_rubble.py

Each mesh has identity transforms and its own centered, ground-level origin.
The original scans and their 2K PBR maps remain untouched.
"""

from pathlib import Path
import json

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "art/workbench/terrain-directions/models/namaqualand_boulders_01/model.gltf"
OUTPUT = ROOT / "art/workbench/terrain-composite/models/oxide-rubble.glb"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
meshes = sorted((obj for obj in bpy.context.scene.objects if obj.type == "MESH"), key=lambda obj: obj.name)
assert len(meshes) == 2, f"Expected the two original boulders; found {len(meshes)}"
metadata = []
for index, obj in enumerate(meshes):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    obj.data.calc_loop_triangles()
    source_triangles = len(obj.data.loop_triangles)
    decimate = obj.modifiers.new("Small rubble LOD", "DECIMATE")
    decimate.ratio = min(1.0, 1000 / source_triangles)
    decimate.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    minimum = Vector(tuple(min(v.co[i] for v in obj.data.vertices) for i in range(3)))
    maximum = Vector(tuple(max(v.co[i] for v in obj.data.vertices) for i in range(3)))
    offset = Vector(((minimum.x + maximum.x) / 2, (minimum.y + maximum.y) / 2, minimum.z))
    for vertex in obj.data.vertices:
        vertex.co -= offset
    obj.name = f"oxide-rubble-{'ab'[index]}"
    obj.data.name = obj.name
    obj.data.calc_loop_triangles()
    extent = maximum - minimum
    metadata.append({"mesh": obj.name, "source_triangles": source_triangles,
                     "triangles": len(obj.data.loop_triangles),
                     "dimensions_glTF_xyz": [extent.x, extent.z, extent.y]})

# One-kilopixel maps retain the scan's visible grain at these sub-meter sizes.
for image in bpy.data.images:
    if image.source == "FILE" and image.size[0] > 1024:
        image.scale(1024, 1024)
        image.pack()
bpy.ops.object.select_all(action="DESELECT")
for obj in meshes:
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format="GLB", use_selection=True,
                          export_yup=True, export_materials="EXPORT", export_image_format="JPEG",
                          export_jpeg_quality=85, export_texcoords=True, export_normals=True)
ledger = {"file": str(OUTPUT.relative_to(ROOT)), "bytes": OUTPUT.stat().st_size,
          "source": str(SOURCE.relative_to(ROOT)), "source_page": "https://polyhaven.com/a/namaqualand_boulders_01",
          "license": "CC0-1.0", "meshes": metadata,
          "usage": "Two separate Y-up meshes centered at x=z=0, y=0 at the base. Instance each geometry independently.",
          "texture_resolution": 1024}
OUTPUT.with_suffix(".json").write_text(json.dumps(ledger, indent=2) + "\n")
print("OXIDE_RUBBLE", json.dumps(ledger))
