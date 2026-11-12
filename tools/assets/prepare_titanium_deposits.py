"""Build three compact titanium outcrops from the existing CC0 boulder scans.

Run from the repository root with unrestricted Blender:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/assets/prepare_titanium_deposits.py

The authored mineral atlas keeps the original photographed UV layout and normal
map. Joined, buried scan pieces form connected seams, rather than crystal spikes.
Each output has one mesh/material, a centered Y-up origin and a 14 m long axis.
"""

import hashlib
import json
import math
from pathlib import Path
import random
import subprocess

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "art/workbench/terrain-composite"
SOURCE = ROOT / "art/workbench/terrain-directions/models/namaqualand_boulders_01/model.gltf"
ATLAS = ROOT / "art/workbench/terrain-directions/textures/titanium-atlas.png"
TEXTURES = WORK / "textures/titanium"
MODELS = WORK / "models"
RENDERS = WORK / "titanium-renders"
for directory in (TEXTURES, MODELS, RENDERS):
    directory.mkdir(parents=True, exist_ok=True)


def prepare_maps():
    subprocess.run(["python3", "-c", """
import sys
from PIL import Image, ImageChops, ImageFilter, ImageOps
from pathlib import Path
atlas, source, output = map(Path,sys.argv[1:])
photo = Image.open(source/'textures/namaqualand_boulders_01_diff_2k.jpg').convert('RGB').resize((1024,1024), Image.Resampling.LANCZOS)
# Use the photographed mineral grain and iron stains as the host rock. The old
# silver atlas is only a sparse seam mask; covering the scan with it read as foil.
luma = photo.convert('L')
luma = Image.blend(luma,luma.filter(ImageFilter.GaussianBlur(.55)),.35)
host = ImageOps.colorize(luma,(20,19,18),(116,111,103))
iron = ImageChops.subtract(photo.getchannel('R'),photo.getchannel('B')).point(lambda value:min(170,value*3))
rust = photo.point(lambda value:round(value*.58))
host = Image.composite(rust,host,iron)
mineral_luma = Image.open(atlas).convert('L').resize((1024,1024),Image.Resampling.LANCZOS)
mineral = [max(0,min(1,(value/255-.68)/.25)) for value in range(256)]
seams = mineral_luma.point([round(value*.34*255) for value in mineral])
Image.composite(Image.new('RGB',host.size,(113,114,109)),host,seams).save(output/'color.png')
roughness = mineral_luma.point([round((.94-value*.10)*255) for value in mineral])
metallic = mineral_luma.point([round((.01+value*.08)*255) for value in mineral])
original = Image.open(source/'textures/namaqualand_boulders_01_arm_2k.jpg').convert('RGB').resize((1024,1024),Image.Resampling.LANCZOS)
Image.merge('RGB',(original.getchannel('R'),roughness,metallic)).save(output/'arm.png')
Image.open(source/'textures/namaqualand_boulders_01_nor_gl_2k.jpg').convert('RGB').resize((1024,1024),Image.Resampling.LANCZOS).save(output/'normal.png')
""", str(ATLAS), str(SOURCE.parent), str(TEXTURES)], check=True)


def principled_material():
    material = bpy.data.materials.new("titanium-bearing-stone")
    material.use_nodes = True
    material.use_backface_culling = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
    shader.inputs["Specular IOR Level"].default_value = .5
    for filename, socket, color_space in (("color.png", "Base Color", "sRGB"),
                                           ("normal.png", None, "Non-Color"),
                                           ("arm.png", None, "Non-Color")):
        node = nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(str(TEXTURES / filename))
        node.image.colorspace_settings.name = color_space
        if socket:
            links.new(node.outputs["Color"], shader.inputs[socket])
        elif filename == "normal.png":
            normal = nodes.new("ShaderNodeNormalMap")
            normal.inputs["Strength"].default_value = .55
            links.new(node.outputs["Color"], normal.inputs["Color"])
            links.new(normal.outputs["Normal"], shader.inputs["Normal"])
        else:
            separate = nodes.new("ShaderNodeSeparateColor")
            links.new(node.outputs["Color"], separate.inputs["Color"])
            links.new(separate.outputs["Green"], shader.inputs["Roughness"])
            links.new(separate.outputs["Blue"], shader.inputs["Metallic"])
    # Vertex color keeps each buried piece warm without another material/draw.
    texture = shader.inputs["Base Color"].links[0].from_node
    vertex = nodes.new("ShaderNodeVertexColor")
    vertex.layer_name = "Dust"
    multiply = nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs[0].default_value = 1
    links.new(texture.outputs["Color"], multiply.inputs[1])
    links.new(vertex.outputs["Color"], multiply.inputs[2])
    links.new(multiply.outputs[0], shader.inputs["Base Color"])
    return material


def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def bounds(obj):
    coordinates = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    return (Vector(tuple(min(v[i] for v in coordinates) for i in range(3))),
            Vector(tuple(max(v[i] for v in coordinates) for i in range(3))))


def scan_piece(source, location, size, rotation, triangles, material):
    obj = source.copy()
    obj.data = source.data.copy()
    bpy.context.collection.objects.link(obj)
    obj.hide_render = False
    obj.hide_viewport = False
    activate(obj)
    obj.data.calc_loop_triangles()
    reduction = obj.modifiers.new("Scanned outcrop LOD", "DECIMATE")
    reduction.ratio = min(1, triangles / len(obj.data.loop_triangles))
    reduction.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=reduction.name)
    minimum, maximum = bounds(obj)
    extent = maximum - minimum
    center = Vector(((minimum.x+maximum.x)/2, (minimum.y+maximum.y)/2, minimum.z))
    for vertex in obj.data.vertices:
        vertex.co = Vector(((vertex.co[i]-center[i])*size[i]/extent[i] for i in range(3)))
    obj.location = location
    obj.rotation_euler = tuple(math.radians(angle) for angle in rotation)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Rotation moves each scan's underside differently. Set its burial depth
    # after rotation so normalizing the joined mesh cannot lift loose fragments.
    base_offset = location[2]-min(vertex.co.z for vertex in obj.data.vertices)
    for vertex in obj.data.vertices:
        vertex.co.z += base_offset
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for face in obj.data.polygons:
        face.use_smooth = True
    for attribute in list(obj.data.color_attributes):
        obj.data.color_attributes.remove(attribute)
    dust = obj.data.color_attributes.new(name="Dust", type="FLOAT_COLOR", domain="POINT")
    for vertex, color in zip(obj.data.vertices, dust.data):
        stain_height = 1.35+.20*math.sin(vertex.co.x*1.7)+.16*math.sin(vertex.co.y*2.3)
        amount = max(0, min(1, (stain_height-vertex.co.z)/1.7))
        amount = amount*amount*(3-2*amount)
        color.color = (1, 1-amount*.27, 1-amount*.48, 1)
    return obj


def build_deposit(index, sources, material):
    # Broad tilted blocks share a geological strike. Their low overlapping feet
    # read as exposed bedrock instead of a row of upright mineral fins.
    shapes = [
        [(-1.0, .6, -.65, 7.8, 4.4, 3.8, -10, 30, 19),
         ( 3.2, .4, -.75, 4.5, 3.6, 2.5,  21,-24,108),
         (-4.5,-.2, -.60, 3.8, 3.2, 1.9,  20, 12, 65),
         ( 4.5,-.6, -.40, 3.4, 2.5, 1.8,  17, 20, 24),
         (  .0,-1.7,-.70, 5.1, 2.6, 1.8, -12, 19, -8),
         (-2.8,-2.0,-.35, 3.4, 2.6, 1.2,   3, 14,  9)],
        [(-3.0, .4, -.60, 4.7, 3.6, 2.8,  24,-18,-86),
         (  .6, .7, -.70, 7.8, 4.1, 3.9,  18,-21,  7),
         ( 4.5,-.1, -.55, 3.8, 3.1, 1.9,  26,-16,-38),
         (-4.7,-.8, -.35, 3.1, 2.7, 1.7,  -8,-12,-18),
         ( 1.8,-1.8,-.60, 4.8, 2.6, 1.9, -18, -9,-13),
         (-1.6,-2.1,-.40, 3.8, 2.5, 1.3,   9,-10,-25)],
        [(-3.8, .2, -.60, 4.3, 3.8, 2.4,  13,-27,106),
         (- .2, .5, -.70, 8.0, 4.2, 3.8,  19, 28, 25),
         ( 4.0, .6, -.65, 3.9, 3.0, 2.1,  -8, 22, 68),
         ( 4.7,-1.0,-.35, 3.6, 2.7, 1.6, -15, 17,  6),
         (-1.5,-1.9,-.40, 4.1, 2.5, 1.6,   3,  7, 14),
         (-4.9,-1.5,-.30, 3.4, 2.9, 1.2,   0, 12,  3)],
    ][index]
    pieces = []
    for position, spec in enumerate(shapes):
        x,y,z,w,d,h,rx,ry,rz = spec
        pieces.append(scan_piece(sources[0 if position in (3,5) else 1], (x,y,z), (w,d,h), (rx,ry,rz),
                                 1600 if position < 3 else 650, material))
    rng = random.Random(9826+index)
    for chip in range(11):
        angle = math.tau*(chip+rng.uniform(-.28,.35))/11
        x = math.cos(angle)*rng.uniform(4.9,5.8)
        y = math.sin(angle)*rng.uniform(2.3,3.0)
        size = rng.uniform(.7,1.5)
        pieces.append(scan_piece(sources[chip%2], (x,y,-size*.13),
                                 (size,size*rng.uniform(.55,.85),size*rng.uniform(.4,.72)),
                                 (rng.uniform(-12,12),rng.uniform(-10,10),rng.uniform(-180,180)),
                                 95,material))
    activate(pieces[0])
    for obj in pieces:
        obj.select_set(True)
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = f"titanium-deposit-{index+1:02d}"
    obj.data.name = obj.name
    minimum, maximum = bounds(obj)
    center = Vector(((minimum.x+maximum.x)/2,(minimum.y+maximum.y)/2,minimum.z))
    scale = 14/max(maximum.x-minimum.x,maximum.y-minimum.y)
    for vertex in obj.data.vertices:
        vertex.co = (vertex.co-center)*scale
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    return obj


prepare_maps()
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
sources = sorted((obj for obj in bpy.context.scene.objects if obj.type=="MESH"), key=lambda obj:obj.name)
for obj in sources:
    activate(obj)
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    obj.hide_render = True
material = principled_material()
deposits = [build_deposit(index,sources,material) for index in range(3)]
metadata = []
for obj in deposits:
    activate(obj)
    path = MODELS / f"{obj.name}.glb"
    bpy.ops.export_scene.gltf(filepath=str(path),export_format="GLB",use_selection=True,
                              export_yup=True,export_materials="EXPORT",export_image_format="JPEG",
                              export_jpeg_quality=87,export_texcoords=True,export_normals=True,
                              export_vertex_color="NAME",export_vertex_color_name="Dust",
                              export_all_vertex_colors=False)
    minimum,maximum = bounds(obj)
    extent=maximum-minimum
    obj.data.calc_loop_triangles()
    metadata.append({"file":str(path.relative_to(ROOT)),"bytes":path.stat().st_size,
                     "triangles":len(obj.data.loop_triangles),"meshes":1,"materials":1,
                     "footprint_radius":max(math.hypot(v.co.x,v.co.y) for v in obj.data.vertices),
                     "dimensions_gltf_xyz":[extent.x,extent.z,extent.y],
                     "bounds_gltf_min":[minimum.x,minimum.z,-maximum.y],
                     "bounds_gltf_max":[maximum.x,maximum.z,-minimum.y]})
bpy.ops.object.select_all(action="DESELECT")
for obj in deposits:
    obj.select_set(True)
library = MODELS / "titanium-deposits.glb"
bpy.ops.export_scene.gltf(filepath=str(library),export_format="GLB",use_selection=True,
                          export_yup=True,export_materials="EXPORT",export_image_format="JPEG",
                          export_jpeg_quality=87,export_texcoords=True,export_normals=True,
                          export_vertex_color="NAME",export_vertex_color_name="Dust",
                          export_all_vertex_colors=False)
ledger = {
    "library":str(library.relative_to(ROOT)),"library_bytes":library.stat().st_size,
    "library_usage":"Preferred runtime import: 3 independent centered meshes sharing one material and the same 3 embedded textures. Instance variants separately.",
    "source":str(SOURCE.relative_to(ROOT)),"source_page":"https://polyhaven.com/a/namaqualand_boulders_01",
    "source_license":"CC0-1.0","authored_assembly_license":"CC-BY-SA-4.0","authors":{"Greg Zaal":"Photography","Jenelle van Heerden":"modeling"},
    "source_sha256":hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    "host_color_source":str((SOURCE.parent / "textures/namaqualand_boulders_01_diff_2k.jpg").relative_to(ROOT)),
    "host_color_sha256":hashlib.sha256((SOURCE.parent / "textures/namaqualand_boulders_01_diff_2k.jpg").read_bytes()).hexdigest(),
    "authored_color_source":str(ATLAS.relative_to(ROOT)),
    "authored_color_sha256":hashlib.sha256(ATLAS.read_bytes()).hexdigest(),
    "color_prompt_record":"art/workbench/terrain-directions/concepts/prompts.md",
    "texture_resolution":1024,"texture_maps":["color","normal","roughness-metallic"],
    "processing":"Decimated source scans joined into 3 broad tilted outcrops with fractured exposed cores and low edge rubble. Original photographed diffuse map graded warm graphite with retained iron staining; authored titanium atlas used only as a sparse muted seam mask. Original UVs/normal grain retained, irregular dusty vertex-colored feet; localized metallic .01–.09 and roughness .84–.94, no emission.",
    "usage":"One centered identity-transform mesh per GLB. Y up, base at y=0, longest horizontal dimension 14m. Face local +Z toward the approach. Bury about .7–1.0m when using native scale, with smaller host-rock rubble around the seam. No transforms or runtime custom shader required.",
    "variants":metadata,
}
(MODELS / "titanium-deposits.json").write_text(json.dumps(ledger,indent=2)+"\n")
print("TITANIUM_DEPOSITS",json.dumps(ledger))

# Source review includes the accepted production turret, normalized to game scale.
for obj in [*sources,*deposits]:
    bpy.data.objects.remove(obj,do_unlink=True)
deposits=[]
for variant in metadata:
    before=set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/variant["file"]))
    deposits.append(next(obj for obj in set(bpy.context.scene.objects)-before if obj.type=="MESH"))
for index,obj in enumerate(deposits):
    obj.location = ((index-1)*20,2,-.7)
before = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=str(ROOT/"assets/models/turret.glb"))
turret_objects = set(bpy.context.scene.objects)-before
turret_meshes=[obj for obj in turret_objects if obj.type=="MESH"]
points=[obj.matrix_world @ Vector(corner) for obj in turret_meshes for corner in obj.bound_box]
minimum=Vector(tuple(min(point[i] for point in points) for i in range(3)))
maximum=Vector(tuple(max(point[i] for point in points) for i in range(3)))
scale=6/max(maximum.x-minimum.x,maximum.y-minimum.y)
center=Vector(((minimum.x+maximum.x)/2,(minimum.y+maximum.y)/2,minimum.z))
for obj in turret_objects:
    if obj.parent is None:
        obj.scale *= scale
        obj.location = (obj.location-center)*scale+Vector((0,-11,0))

scene=bpy.context.scene
scene.render.engine="CYCLES"
scene.cycles.samples=40
scene.cycles.use_denoising=True
scene.render.resolution_x=1700
scene.render.resolution_y=1000
scene.render.resolution_percentage=100
scene.view_settings.view_transform="AgX"
scene.view_settings.look="AgX - Medium High Contrast"
scene.world.use_nodes=True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value=(.62,.68,.78,1)
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value=.45
bpy.ops.mesh.primitive_plane_add(size=200)
floor=bpy.context.object
floor.location.z=-.03
sand=bpy.data.materials.new("review-sand")
sand.use_nodes=True
shader=next(node for node in sand.node_tree.nodes if node.type=="BSDF_PRINCIPLED")
shader.inputs["Base Color"].default_value=(.32,.17,.073,1)
shader.inputs["Roughness"].default_value=.93
floor.data.materials.append(sand)
bpy.ops.object.light_add(type="SUN",location=(-20,-30,45))
sun=bpy.context.object
sun.data.energy=2.7
sun.data.angle=.12
sun.rotation_euler=(Vector((0,0,0))-sun.location).to_track_quat("-Z","Y").to_euler()
bpy.ops.object.camera_add(location=(16,-54,47))
camera=bpy.context.object
camera.rotation_euler=(Vector((0,-2,1))-camera.location).to_track_quat("-Z","Y").to_euler()
camera.data.type="ORTHO"
camera.data.ortho_scale=66
scene.camera=camera
scene.render.filepath=str(RENDERS/"lineup.png")
bpy.ops.render.render(write_still=True)
deposits[0].hide_render=True
deposits[2].hide_render=True
camera.location=(16,-26,23)
camera.rotation_euler=(Vector((0,-3,1))-camera.location).to_track_quat("-Z","Y").to_euler()
camera.data.ortho_scale=26
scene.render.resolution_x=1200
scene.render.resolution_y=1000
scene.render.filepath=str(RENDERS/"close.png")
bpy.ops.render.render(write_still=True)
