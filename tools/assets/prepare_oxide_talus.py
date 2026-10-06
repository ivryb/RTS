"""Prepare medium foothill talus and small pebble LODs from CC0 boulder scans.

Run with unrestricted Blender from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/assets/prepare_oxide_talus.py

The source scans and small oxide-rubble LOD remain untouched. Each output mesh
is independently centered, ground-level, and two meters across its long axis.
"""

import hashlib
import json
from pathlib import Path
import subprocess

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "art/workbench/terrain-directions/models/namaqualand_boulders_01/model.gltf"
WORK = ROOT / "art/workbench/terrain-composite"
OUTPUT = WORK / "models/oxide-talus.glb"
GRADE = WORK / "oxide-talus-source/oxide-talus-color.png"
CLIFF = WORK / "textures/oxide-cliff-color.webp"
GRADE.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
meshes = sorted((obj for obj in bpy.context.scene.objects if obj.type == "MESH"), key=lambda obj: obj.name)
assert len(meshes) == 2, f"Expected two original scan meshes; found {len(meshes)}"

# UV coverage excludes the scan atlas's extruded padding from color matching.
uv_faces = []
for obj in meshes:
    uvs = obj.data.uv_layers.active.data
    uv_faces.extend([[list(uvs[i].uv) for i in face.loop_indices] for face in obj.data.polygons])
source_color = SOURCE.parent / "textures/namaqualand_boulders_01_diff_2k.jpg"
result = subprocess.run(["python3", "-c", """
import json, sys
from PIL import Image, ImageDraw, ImageStat
source, destination, cliff = sys.argv[1:]
image = Image.open(source).convert('RGB')
mask = Image.new('L', image.size)
draw = ImageDraw.Draw(mask)
width, height = image.size
for face in json.load(sys.stdin):
    draw.polygon([(u*(width-1), (1-v)*(height-1)) for u,v in face], fill=255)
mean = ImageStat.Stat(image, mask).mean
target = ImageStat.Stat(Image.open(cliff).convert('RGB')).mean
weights = (.2126,.7152,.0722)
luminance = sum(a*b for a,b in zip(mean,weights))
contrast, chroma = .82, .42
matrix = []
for channel in range(3):
    matrix.extend((contrast-chroma)*weights[i]+(chroma if i==channel else 0) for i in range(3))
    matrix.append(target[channel]-contrast*luminance-chroma*(mean[channel]-luminance))
graded = image.convert('RGB', tuple(matrix))
graded.save(destination)
print(json.dumps({'source_valid_uv_mean_srgb':mean,'cliff_mean_srgb':target,
                  'graded_valid_uv_mean_srgb':ImageStat.Stat(graded,mask).mean,
                  'luminance_contrast':contrast,'retained_chroma':chroma}))
""", str(source_color), str(GRADE), str(CLIFF)], input=json.dumps(uv_faces), text=True,
    check=True, capture_output=True)
grade_metadata = json.loads(result.stdout)

original_material = meshes[0].active_material
talus_material = original_material.copy()
talus_material.name = "oxide-talus-scanned-rust"
shader = next(node for node in talus_material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
color_node = shader.inputs["Base Color"].links[0].from_node
color_node.image = bpy.data.images.load(str(GRADE), check_existing=True)
color_node.image.colorspace_settings.name = "sRGB"
shader.inputs["Metallic"].default_value = 0
shader.inputs["Specular IOR Level"].default_value = .25

metadata = []
for index, obj in enumerate(meshes):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    obj.data.calc_loop_triangles()
    source_triangles = len(obj.data.loop_triangles)
    decimate = obj.modifiers.new("Medium talus scan LOD", "DECIMATE")
    decimate.ratio = min(1.0, 5000/source_triangles)
    decimate.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    minimum = Vector(tuple(min(v.co[i] for v in obj.data.vertices) for i in range(3)))
    maximum = Vector(tuple(max(v.co[i] for v in obj.data.vertices) for i in range(3)))
    offset = Vector(((minimum.x+maximum.x)/2, (minimum.y+maximum.y)/2, minimum.z))
    scale = 2/max(maximum.x-minimum.x, maximum.y-minimum.y)
    for vertex in obj.data.vertices:
        vertex.co = (vertex.co-offset)*scale
    obj.name = f"oxide-talus-{'ab'[index]}"
    obj.data.name = obj.name
    obj.data.materials.clear()
    obj.data.materials.append(talus_material)
    obj.data.calc_loop_triangles()
    extent = (maximum-minimum)*scale
    metadata.append({"mesh":obj.name,"source_triangles":source_triangles,
                     "triangles":len(obj.data.loop_triangles),
                     "dimensions_glTF_xyz":[extent.x,extent.z,extent.y]})

bpy.ops.object.select_all(action="DESELECT")
for obj in meshes:
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format="GLB", use_selection=True,
                          export_yup=True, export_materials="EXPORT", export_image_format="JPEG",
                          export_jpeg_quality=92, export_texcoords=True, export_normals=True)
ledger = {"file":str(OUTPUT.relative_to(ROOT)),"bytes":OUTPUT.stat().st_size,
          "source":str(SOURCE.relative_to(ROOT)),
          "source_page":"https://polyhaven.com/a/namaqualand_boulders_01","license":"CC0-1.0",
          "source_color_sha256":hashlib.sha256(source_color.read_bytes()).hexdigest(),
          "palette_reference":str(CLIFF.relative_to(ROOT)),
          "palette_sha256":hashlib.sha256(CLIFF.read_bytes()).hexdigest(),
          "grade":grade_metadata,"texture_resolution":2048,"meshes":metadata,
          "processing":"Original scanned silhouettes and UVs, 5k triangles per variant, original 2K normal and ARM maps; diffuse graded to current oxide cliff mean while retaining photographed grain and mineral bands.",
          "usage":"Two independent identity-transform meshes; Y-up, centered at x=z=0, base y=0, longest horizontal axis 2m. Intended placement width 1–3m at mountain feet; bury 6–12% of width for terrain contact."}
OUTPUT.with_suffix(".json").write_text(json.dumps(ledger,indent=2)+"\n")

# Dense fields use these smaller silhouettes; both LODs share the same PBR maps.
pebbles = []
pebble_metadata = []
for index,source in enumerate(meshes):
    obj = source.copy()
    obj.data = source.data.copy()
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    obj.data.calc_loop_triangles()
    decimate = obj.modifiers.new("Small oxide pebble LOD", "DECIMATE")
    decimate.ratio = 1000/len(obj.data.loop_triangles)
    decimate.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    minimum = Vector(tuple(min(v.co[i] for v in obj.data.vertices) for i in range(3)))
    maximum = Vector(tuple(max(v.co[i] for v in obj.data.vertices) for i in range(3)))
    offset = Vector(((minimum.x+maximum.x)/2, (minimum.y+maximum.y)/2, minimum.z))
    scale = 2/max(maximum.x-minimum.x, maximum.y-minimum.y)
    for vertex in obj.data.vertices:
        vertex.co = (vertex.co-offset)*scale
    obj.name = f"oxide-pebbles-{'ab'[index]}"
    obj.data.name = obj.name
    obj.data.calc_loop_triangles()
    extent = (maximum-minimum)*scale
    pebble_metadata.append({"mesh":obj.name,"triangles":len(obj.data.loop_triangles),
                            "dimensions_glTF_xyz":[extent.x,extent.z,extent.y]})
    pebbles.append(obj)
bpy.ops.object.select_all(action="DESELECT")
for obj in pebbles:
    obj.select_set(True)
pebble_output = OUTPUT.with_name("oxide-pebbles.glb")
bpy.ops.export_scene.gltf(filepath=str(pebble_output), export_format="GLB", use_selection=True,
                          export_yup=True, export_materials="EXPORT", export_image_format="JPEG",
                          export_jpeg_quality=92, export_texcoords=True, export_normals=True)
pebble_ledger = {**ledger, "file":str(pebble_output.relative_to(ROOT)),
                 "bytes":pebble_output.stat().st_size,"meshes":pebble_metadata,
                 "processing":"1k-triangle LOD of each scanned talus variant; exactly the same matched 2K color, normal and ARM maps as oxide-talus.glb.",
                 "usage":"Two independent identity-transform meshes; Y-up, centered at x=z=0, base y=0, longest horizontal axis 2m. Scale to placement widths below 1.2m; bury 6–12% of width."}
pebble_output.with_suffix(".json").write_text(json.dumps(pebble_ledger,indent=2)+"\n")
for obj in pebbles:
    bpy.data.objects.remove(obj,do_unlink=True)
print("OXIDE_PEBBLES",json.dumps(pebble_ledger))

# Side-by-side source review: original photo palette left, matched talus right.
for index,obj in enumerate(meshes):
    original = obj.copy()
    original.data = obj.data.copy()
    bpy.context.collection.objects.link(original)
    original.data.materials.clear()
    original.data.materials.append(original_material)
    original.location = (-1.8, (index-.5)*2.8, 0)
    obj.location = (1.8, (index-.5)*2.8, 0)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x = 1200
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (.54,.64,.8,1)
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = .35
bpy.ops.mesh.primitive_plane_add(size=200)
ground = bpy.context.object
ground.location.z = -.015
material = bpy.data.materials.new("preview-sand")
material.diffuse_color = (.35,.215,.105,1)
ground.data.materials.append(material)
bpy.ops.object.light_add(type="SUN", location=(-6,-9,14))
sun = bpy.context.object
sun.data.energy = 3
sun.data.angle = .15
sun.rotation_euler = (Vector((0,0,0))-sun.location).to_track_quat("-Z","Y").to_euler()
bpy.ops.object.camera_add(location=(0,-10,10))
camera = bpy.context.object
camera.rotation_euler = (Vector((0,0,.3))-camera.location).to_track_quat("-Z","Y").to_euler()
camera.data.type = "ORTHO"
camera.data.ortho_scale = 8
scene.camera = camera
scene.render.filepath = str(WORK / "oxide-talus-source/comparison.png")
bpy.ops.render.render(write_still=True)
print("OXIDE_TALUS",json.dumps(ledger))
