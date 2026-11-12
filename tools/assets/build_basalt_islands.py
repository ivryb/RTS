"""Create fractured basalt ridges and scree with embedded CC0 scanned PBR maps.

Run from the repository root with unrestricted Blender:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/assets/build_basalt_islands.py

The outputs are experimental, Y-up glTF assets with a ground-level origin. No
runtime displacement or custom shader is needed. Reruns use cached source maps.
"""

from pathlib import Path
import json
import math
import random
import subprocess

import bpy
import bmesh
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "art/workbench/terrain-composite"
SOURCE = WORK / "basalt-source"
MODELS = WORK / "models"
RENDERS = WORK / "basalt-renders"
for directory in (SOURCE, MODELS, RENDERS):
    directory.mkdir(parents=True, exist_ok=True)


def source_maps():
    maps = []
    for suffix in ("diff", "nor_gl", "rough"):
        filename = f"rock_face_03_{suffix}_2k.jpg"
        url = f"https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/rock_face_03/{filename}"
        target = SOURCE / filename
        if not target.exists():
            subprocess.run(["curl", "-LsSf", url, "-o", str(target)], check=True)
        maps.append({"map": suffix, "file": filename, "url": url})
    (SOURCE / "basalt-texture-sources.json").write_text(json.dumps({
        "asset": "Rock Face 03", "authors": {"Dario Barresi":"Photography","Rico Cilliers":"Processing"}, "license": "CC0-1.0",
        "page": "https://polyhaven.com/a/rock_face_03", "maps": maps,
        "derived_diffuse": ["basalt-charcoal-walls.png", "basalt-dusted-crowns.png", "basalt-dusty-footing.png", "basalt-bedrock-color.png"],
        "grading": "Charcoal-graded granular rock scan. Wall atlases carry baked lower-wall dust; terrain bedrock maps remain tileable without that vertical gradient. Previous Dark Rock originals are preserved.",
        "geometry": "Original Dune77 procedural basalt studies; CC BY-SA 4.0",
    }, indent=2) + "\n")


def make_material(name, kind="wall"):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = nodes.get("Principled BSDF")
    shader.inputs["Metallic"].default_value = 0
    shader.inputs["Specular IOR Level"].default_value = 0.25
    for suffix, socket in (("diff", "Base Color"), ("rough", "Roughness")):
        node = nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(str(SOURCE / f"rock_face_03_{suffix}_2k.jpg"), check_existing=True)
        if suffix == "rough":
            node.image.colorspace_settings.name = "Non-Color"
        if suffix == "diff":
            # Grade the source once to restrained charcoal; exposed crowns and
            # lower walls carry small amounts of pale windblown dust.
            image_name = {"wall":"basalt-charcoal-walls", "crown":"basalt-dusted-crowns", "foot":"basalt-dusty-footing", "bedrock":"basalt-bedrock-color"}[kind]
            graded = bpy.data.images.get(image_name)
            if graded is None:
                import numpy as np
                graded = node.image.copy()
                graded.name = image_name
                pixels = np.array(graded.pixels[:], dtype=np.float32).reshape((-1, 4))
                rgb = pixels[:, :3]
                luminance = rgb @ np.array((0.2126, 0.7152, 0.0722))
                level = {"wall":0.29, "crown":0.315, "foot":0.285, "bedrock":0.29}[kind]
                # Preserve granular weathering instead of the previous scan's
                # bright crack web, which read as polished marble.
                gray = np.clip(level+(luminance-luminance.mean())*.70, .12, .49)
                tint = {"wall":(1.04,1.0,0.95), "crown":(1.05,1.015,0.96), "foot":(1.08,1.015,0.94), "bedrock":(1.04,1.0,0.95)}[kind]
                pixels[:, :3] = np.clip(gray[:, None] * tint + (rgb - luminance[:, None]) * 0.18, 0, 1)
                if kind=="wall":
                    height,width=graded.size[1],graded.size[0]
                    atlas=pixels.reshape((height,width,4))
                    atlas=atlas[(np.arange(height)*3)%height].copy()
                    dust=(np.maximum(0,1-np.linspace(0,1,height)/.52)**1.4)[:,None,None]*.68
                    dusty=atlas[:,:,:3]*np.array((.92,.77,.57))+np.array((.12,.095,.065))
                    atlas[:,:,:3]=atlas[:,:,:3]*(1-dust)+dusty*dust
                    pixels=atlas.reshape((-1,4))
                graded.pixels[:] = pixels.ravel()
                graded.filepath_raw = str(SOURCE / f"{image_name}.png")
                graded.file_format = "PNG"
                graded.save()
            node.image = graded
        if kind=="wall" and suffix=="rough":
            node.image=wall_atlas(node.image)
        links.new(node.outputs["Color"], shader.inputs[socket])
    normal_texture = nodes.new("ShaderNodeTexImage")
    normal_texture.image = bpy.data.images.load(str(SOURCE / "rock_face_03_nor_gl_2k.jpg"), check_existing=True)
    normal_texture.image.colorspace_settings.name = "Non-Color"
    if kind=="wall":
        normal_texture.image=wall_atlas(normal_texture.image)
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 0.42
    links.new(normal_texture.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], shader.inputs["Normal"])
    return material


def wall_atlas(source):
    """Match the three vertical scan repeats baked into the wall-color atlas."""
    import numpy as np
    name=source.name+"-wall-atlas"
    existing=bpy.data.images.get(name)
    if existing:
        return existing
    image=source.copy()
    image.name=name
    width,height=image.size
    pixels=np.array(image.pixels[:],dtype=np.float32).reshape((height,width,4))
    image.pixels[:]=pixels[(np.arange(height)*3)%height].ravel()
    image.filepath_raw=str(SOURCE/f"{name}.png")
    image.file_format="PNG"
    image.save()
    return image


def column(name, location, radius, height, rng, wall, crown, lean=(0,0)):
    """A cooling-joint prism: true planar faces, narrow chamfers, chipped top."""
    angle=rng.uniform(-.025,.025)
    corners=[]
    for index in range(6):
        theta=angle+index*math.tau/6
        reach=radius*rng.uniform(.94,1.06)
        corners.append(Vector((math.cos(theta)*reach,math.sin(theta)*reach)))
    outline=[]
    for index in range(6):
        a,b=corners[index],corners[(index+1)%6]
        outline.extend((a.lerp(b,.028),a.lerp(b,.35),a.lerp(b,.65),a.lerp(b,.972),b*.987))
    count=len(outline)
    tilt=Vector(lean)*height
    fracture_angle=rng.random()*math.tau
    crown_tilt=Vector((math.cos(fracture_angle),math.sin(fracture_angle)))*rng.uniform(.025,.13)
    chip_direction=Vector((math.cos(fracture_angle+.8),math.sin(fracture_angle+.8)))
    chip_depth=rng.uniform(.20,.38)
    def crown_height(point):
        return height+crown_tilt.dot(point)-max(0,point.dot(chip_direction)-radius*.55)*chip_depth
    fractions=(0,.20,.43,.68,.88,.99,1)
    vertices=[]
    faces=[]
    uv_faces=[]
    material_indices=[]
    offset=rng.random()
    distances=[0.0]
    for i in range(count):
        distances.append(distances[-1]+(outline[(i+1)%count]-outline[i]).length)
    for fraction in fractions:
        for point in outline:
            z=-.30+(crown_height(point)+.30)*fraction
            rim_chip=max(0,point.dot(chip_direction)/radius-.55)*.10 if fraction>.88 else 0
            xy=point*((.98 if fraction==1 else 1)-rim_chip)+tilt*fraction
            vertices.append((xy.x,xy.y,z))
    for ring in range(len(fractions)-1):
        for i in range(count):
            j=(i+1)%count
            face=(ring*count+i,ring*count+j,(ring+1)*count+j,(ring+1)*count+i)
            faces.append(face)
            uv_faces.append([(offset+distances[i]/3.2,fractions[ring]),(offset+distances[i+1]/3.2,fractions[ring]),
                             (offset+distances[i+1]/3.2,fractions[ring+1]),(offset+distances[i]/3.2,fractions[ring+1])])
            material_indices.append(0)
    # A clipped fracture plane stays flat in its interior. Only one edge loses
    # a small wedge; concentric noisy cap rings were making rounded fingertips.
    outer=(len(fractions)-1)*count
    center=len(vertices)
    vertices.append((tilt.x,tilt.y,height))
    for i in range(count):
        face=(outer+i,outer+(i+1)%count,center)
        faces.append(face)
        uv_faces.append([(vertices[v][0]/3.2+offset,vertices[v][1]/3.2+.37) for v in face])
        material_indices.append(1)
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata(vertices,[],faces)
    mesh.materials.append(wall)
    mesh.materials.append(crown)
    uv_layer=mesh.uv_layers.new(name="UVMap")
    for polygon,uvs,material in zip(mesh.polygons,uv_faces,material_indices):
        # Split face normals are the distinguishing shape of columnar basalt.
        polygon.use_smooth=False
        polygon.material_index=material
        for loop_index,uv in zip(polygon.loop_indices,uvs):
            uv_layer.data[loop_index].uv=uv
    mesh.update()
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    obj.location=location
    return obj


def bedrock_wedge(spine, material):
    """Continuous parent rock behind the exposed columns; rear embeds in terrain."""
    sections=[(spine[0][0]-1.0,spine[0][1],spine[0][2]*.48),*spine,
              (spine[-1][0]+1.0,spine[-1][1],spine[-1][2]*.48)]
    vertices=[]
    profile_count=6
    for x,y,height in sections:
        for lateral,z in ((.35,-.30),(.35,height*.77),(1.25,height*.97),
                          (2.5,height*.92),(3.7,height*.44),(4.0,-.30)):
            vertices.append((x,y+lateral,z))
    faces=[]
    for section in range(len(sections)-1):
        for j in range(profile_count):
            following=(j+1)%profile_count
            faces.append((section*profile_count+j,(section+1)*profile_count+j,
                          (section+1)*profile_count+following,section*profile_count+following))
    faces.append(tuple(range(profile_count)))
    faces.append(tuple((len(sections)-1)*profile_count+i for i in range(profile_count-1,-1,-1)))
    mesh=bpy.data.meshes.new("continuous-bedrock")
    mesh.from_pydata(vertices,[],faces)
    mesh.materials.append(material)
    mesh.update()
    uv=mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        n=polygon.normal
        axes=(0,1) if abs(n.z)>.5 else ((0,2) if abs(n.y)>abs(n.x) else (1,2))
        for loop in polygon.loop_indices:
            p=mesh.vertices[mesh.loops[loop].vertex_index].co
            uv.data[loop].uv=(p[axes[0]]/3.2,p[axes[1]]/3.2)
    obj=bpy.data.objects.new("continuous-bedrock",mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def rubble(name, location, size, rng, material, slab=False):
    """Irregular radial wedges; broad cuboid slabs read as constructed plinths."""
    bm=bmesh.new()
    scale=Vector((size*rng.uniform(1.0,1.50),size*rng.uniform(.62,1.0),size*rng.uniform(.24,.44) if slab else size*rng.uniform(.58,.90)))
    controls=[Vector((rng.uniform(.64,1),rng.uniform(.60,1),rng.uniform(.65,1))) for _ in range(8)]
    sides=5+int(controls[0].z*11)%4
    reach_scale=.76 if slab and size>.6 else .88
    for ring in (-1,1):
        for i in range(sides):
            control=controls[(i+(3 if ring<0 else 0))%8]
            angle=(i+(control.x-.82)*.45)*math.tau/sides
            reach=(.68+control.y*.26)*reach_scale
            z=(.40+(control.z-.65)*1.5+.27*math.cos(angle+.6))*scale.z if ring>0 else -scale.z*(.45+control.x*.42)
            bm.verts.new((math.cos(angle)*reach*scale.x,math.sin(angle)*reach*scale.y,z))
    # Scattered radial fracture points split the upper surface into pitched
    # planes. Keep the random draw sequence stable to preserve ridge placements.
    for _ in range(16):
        p=Vector(tuple(rng.uniform(-1,1) for _ in range(3)))
        axis=rng.randrange(3)
        p[axis]=rng.choice((-1,1))*rng.uniform(.86,1.08)
        angle=math.atan2(p.y,p.x)
        reach=(.48+.31*min(1,math.hypot(p.x,p.y)))*reach_scale
        bm.verts.new((math.cos(angle)*reach*scale.x,math.sin(angle)*reach*scale.y,p.z*scale.z*.85))
    bmesh.ops.convex_hull(bm,input=list(bm.verts))
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bmesh.ops.bevel(bm,geom=list(bm.edges),offset=size*.065,segments=2 if size>.6 else 1,affect="EDGES",clamp_overlap=True)
    mesh=bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    obj.location=location
    obj.rotation_euler=(rng.uniform(-.23,.23),rng.uniform(-.25,.25),rng.random()*math.tau)
    mesh.materials.append(material)
    uv_layer=mesh.uv_layers.new(name="UVMap")
    uv_offset=Vector((rng.random(),rng.random()))
    for polygon in mesh.polygons:
        normal=polygon.normal
        axes=(0,1) if abs(normal.z)>.5 else ((0,2) if abs(normal.y)>abs(normal.x) else (1,2))
        for loop_index in polygon.loop_indices:
            vertex=mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv_layer.data[loop_index].uv=(vertex[axes[0]]/2.4+uv_offset.x,vertex[axes[1]]/2.4+uv_offset.y)
    return obj


RIDGES = (
    ((-5.9,.0,1.9),(-4.2,-.15,3.8),(-2.5,-.2,5.1),(-.8,.0,5.4),(.9,.3,4.8),(2.6,.6,3.8),(4.3,.7,3.1),(6,.8,2.0)),
    ((-5.9,1.6,2.5),(-4.2,.8,4.2),(-2.5,.0,5.6),(-.8,-.6,5.9),(.9,-.8,5.7),(2.6,-.7,4.9),(4.3,-.2,3.5),(6,.6,2.3)),
    ((-5.9,.4,1.4),(-4.2,.4,2.3),(-2.5,.2,2.3),(-.8,.0,3.4),(.9,-.3,3.4),(2.6,-.6,4.8),(4.3,-.6,4.8),(6,-.8,3.6)),
)


def build_island(name, seed, variant, wall, crown, foot, bedrock):
    rng = random.Random(seed)
    spine=RIDGES[variant]
    objects = [bedrock_wedge(spine,bedrock)]
    lean=((.012,0),(-.012,.01),(.01,.015))[variant]
    for i,(x,y,height) in enumerate(spine):
        # A near-parallel colonnade exposes the edge of one parent-rock bench.
        # Coherent tiers supply variety without independently bending each joint.
        for course,side,multiplier in (("front-joint",0,1),("rear-joint",1.34,1.07),("broken-foot",-.90,.22)):
            xx=x+rng.uniform(-.055,.055)+(.62 if side>0 else 0)
            yy=y+side+rng.uniform(-.045,.045)
            h=max(.60,height*multiplier+rng.uniform(-.16,.16))
            objects.append(column(f"{course}-{i:02}",(xx,yy,-.08),rng.uniform(.95,1.07),h,rng,wall,crown,lean))
    # Broad collapsed footings break the vertical joint line and tie it into sand.
    for i,(x,y,height) in enumerate(spine):
        for side in (-1,1):
            size=rng.uniform(.83,1.32)
            yy=y+side*rng.uniform(1.28,1.72)
            objects.append(rubble(f"breccia-{i}-{side}",(x+rng.uniform(-.4,.4),yy,size*.4-.12),size,rng,foot,side>0))
    # The main debris fan runs off one side, rather than outlining a circular rim.
    for i in range(25):
        x,y,_=rng.choice(spine)
        x+=rng.uniform(-.7,.9)
        y-=rng.uniform(1.7,3.8)
        size=rng.uniform(.35,.87)
        objects.append(rubble(f"collapsed-slab-{i:02}",(x,y,size*.18-.10),size,rng,foot,True))
    for i in range(7):
        x,y,_=spine[rng.randrange(len(spine))]
        stone=column(f"fallen-joint-{i:02}",(x+rng.uniform(-.6,.6),y-rng.uniform(1.2,2.1),.10),rng.uniform(.30,.46),rng.uniform(1.45,2.3),rng,wall,crown,lean)
        stone.rotation_euler=(rng.uniform(.78,1.18),rng.uniform(-.38,.38),rng.uniform(-.35,.35))
        objects.append(stone)
    for i in range(65):
        x,y,_=rng.choice(spine)
        x+=rng.uniform(-2.4,2.4)
        y+=rng.uniform(-5.0,3.2)
        size=rng.uniform(.08,.29)
        objects.append(rubble(f"scree-{i:02}",(x,y,size*.12-.035),size,rng,foot,True))
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    island = bpy.context.object
    island.name = name
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    # Export convention: local glTF -Z is the visible face, +Z is rear bedrock.
    island.rotation_euler.z=math.pi
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=False)
    return island


def preview(island, name):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 40
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.54, 0.64, 0.8, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.05))
    ground = bpy.context.object
    mat = bpy.data.materials.new("Preview sand")
    mat.diffuse_color = (0.36, 0.205, 0.085, 1)
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.36, 0.205, 0.085, 1)
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.92
    ground.data.materials.append(mat)
    bpy.ops.object.light_add(type="SUN", location=(-6, -9, 14))
    sun = bpy.context.object
    sun.rotation_euler = (0.44, -0.62, math.pi-0.30)
    sun.data.energy = 3.1
    sun.data.angle = math.radians(5)
    sun.data.color = (1, 0.88, 0.71)
    bpy.ops.object.camera_add(location=(-14, 20, 17))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((0, 0, 2)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 20
    scene.camera = camera
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(RENDERS / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    for obj in (ground, sun, camera):
        bpy.data.objects.remove(obj, do_unlink=True)


source_maps()
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
wall = make_material("Weathered charcoal basalt")
crown = make_material("Dust on fractured crowns", "crown")
foot = make_material("Warm dust on fractured footing", "foot")
bedrock = make_material("Continuous basalt bedrock", "bedrock")
terrain_textures=WORK/"textures"
terrain_textures.mkdir(parents=True,exist_ok=True)
subprocess.run(["python3","-c", """
from pathlib import Path
from PIL import Image
import sys
source,output=map(Path,sys.argv[1:])
for filename,role in [('basalt-bedrock-color.png','color'),('rock_face_03_nor_gl_2k.jpg','normal'),('rock_face_03_rough_2k.jpg','roughness')]:
    Image.open(source/filename).convert('RGB').save(output/f'basalt-bedrock-{role}.webp','WEBP',quality=96,method=6)
""",str(SOURCE),str(terrain_textures)],check=True)
(terrain_textures/"basalt-bedrock-source.json").write_text(json.dumps({
    "page":"https://polyhaven.com/a/rock_face_03","authors":{"Dario Barresi":"Photography","Rico Cilliers":"Processing"},"license":"CC0-1.0",
    "color":"basalt-bedrock-color.webp","normal":"basalt-bedrock-normal.webp","roughness":"basalt-bedrock-roughness.webp",
    "meters":3.2,"tint":"#ffffff","normalStrength":.42,
    "processing":"Tileable 2K granular scanned PBR graded charcoal; no vertical atlas or dust gradient.",
},indent=2)+"\n")
metadata = []
for name, seed, variant in (("basalt-island-01",7183,0),("basalt-island-02",9021,1),("basalt-island-03",11213,2)):
    island = build_island(name, seed, variant, wall, crown, foot, bedrock)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    island.select_set(True)
    bpy.context.view_layer.objects.active = island
    destination = MODELS / f"{name}.glb"
    bpy.ops.export_scene.gltf(filepath=str(destination), export_format="GLB", use_selection=True,
                              export_yup=True, export_materials="EXPORT", export_image_format="JPEG",
                              export_jpeg_quality=87, export_texcoords=True, export_normals=True)
    island.data.calc_loop_triangles()
    corners = [island.matrix_world @ Vector(corner) for corner in island.bound_box]
    minimum = [min(v[i] for v in corners) for i in range(3)]
    maximum = [max(v[i] for v in corners) for i in range(3)]
    footprint=max(island.dimensions.x,island.dimensions.y)
    core_radius=max(math.hypot(v.co.x,v.co.y) for v in island.data.vertices if v.co.z>1)
    metadata.append({"file": str(destination.relative_to(ROOT)), "bytes": destination.stat().st_size,
                     "triangles": len(island.data.loop_triangles), "dimensions_glTF_xyz": [island.dimensions.x, island.dimensions.z, island.dimensions.y],
                     "ground_y": 0, "blender_bounds": [minimum, maximum], "seed": seed,
                     "front_axis_glTF":"-Z", "rear_axis_glTF":"+Z",
                     "burial_fraction_of_width":-minimum[2]/footprint,"solid_core_radius_fraction":core_radius/footprint})
    preview(island, name)
    bpy.data.objects.remove(island, do_unlink=True)

# Standalone pieces let the map continue a ridge's talus beyond the main model.
scree=[]
for index in range(2):
    piece=rubble(f"basalt-scree-{'ab'[index]}",(0,0,0),1,random.Random(2304+index),foot,index==0)
    bpy.context.view_layer.update()
    world=[piece.matrix_world@vertex.co for vertex in piece.data.vertices]
    minimum=Vector(tuple(min(v[i] for v in world) for i in range(3)))
    maximum=Vector(tuple(max(v[i] for v in world) for i in range(3)))
    center=Vector(((minimum.x+maximum.x)/2,(minimum.y+maximum.y)/2,minimum.z))
    for vertex,position in zip(piece.data.vertices,world):
        vertex.co=position-center
    piece.location=(0,0,0)
    piece.rotation_euler=(0,0,0)
    piece.data.calc_loop_triangles()
    scree.append(piece)
bpy.ops.object.select_all(action="DESELECT")
for piece in scree:
    piece.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(MODELS/"basalt-scree.glb"),export_format="GLB",use_selection=True,export_yup=True,
                          export_materials="EXPORT",export_image_format="JPEG",export_jpeg_quality=87,export_texcoords=True,export_normals=True)
metadata.append({"file":str((MODELS/"basalt-scree.glb").relative_to(ROOT)),"bytes":(MODELS/"basalt-scree.glb").stat().st_size,
                 "meshes":[{"name":p.name,"triangles":len(p.data.loop_triangles),"dimensions_glTF_xyz":[p.dimensions.x,p.dimensions.z,p.dimensions.y]} for p in scree],"ground_y":0})
(WORK / "basalt-models.json").write_text(json.dumps(metadata, indent=2) + "\n")
print("BASALT_ASSETS", json.dumps(metadata))
