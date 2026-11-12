"""Six titanium-outcrop studies made from angular photographed stone.

Run in unrestricted Blender from the repository root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/assets/prepare_titanium_options.py

Poly Haven Boulder 01 (Rico Cilliers, CC0) supplies the fractured geometry and
registered 2K PBR atlas. Preserve its proportions and scan UVs. Different assemblies
and mineral exposures are art directions, not geological mineral specimens.
The previous titanium library remains untouched. Outputs are local WIP only.
"""
import hashlib
import json
import math
from pathlib import Path
import random
import subprocess

import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'art/workbench/terrain-composite/titanium-options'
SOURCE = WORK / 'source/boulder_01/model.gltf'
IDS = ['01-fractured-ilmenite', '02-slate-seam', '03-split-vein',
       '04-ironstone-reef', '05-silver-breccia', '06-bedded-lode']
DESCRIPTIONS = [
    'A tall angular graphite outcrop, broken silver-gray faces and sparse iron staining.',
    'A narrow strike of overlapping slate-gray slabs, with dark fissures and muted mineral flecks.',
    'Two split gray shoulders with an exposed pale mineral face between them.',
    'An asymmetric rugged reef: iron-stained rind and cool freshly fractured interiors.',
    'A broad breccia bed of many angular silver-gray fragments and dark mineral inclusions.',
    'Low parallel beds of dark ore, with pale bands across their tilted broken faces.',
]
for directory in [WORK, WORK/'textures', WORK/'renders']:
    directory.mkdir(parents=True, exist_ok=True)


def prepare_maps():
    subprocess.run(['uv', 'run', '--with', 'numpy', '--with', 'pillow', 'python', '-c', r'''
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
p=Path(sys.argv[1]); source=p/'source/boulder_01/textures'
photo=np.asarray(Image.open(source/'boulder_01_diff_2k.jpg').convert('RGB'),dtype=np.float32)/255
luma=photo[:,:,0]*.2126+photo[:,:,1]*.7152+photo[:,:,2]*.0722
# Keep scan relief and pore-scale contrast. Neutral mineral faces prevent the
# warm scene light turning the whole deposit into muddy brown clay.
luma=np.clip((luma-.35)*1.12+.35,0,1)
original_arm=np.asarray(Image.open(source/'boulder_01_arm_2k.jpg').convert('RGB'),dtype=np.float32)/255
rust=np.clip((photo[:,:,0]-photo[:,:,2]-.035)*6,0,1)
neutral=np.clip(1-rust*1.9,0,1)
bright=np.clip((luma-.42)*3.2,0,1)
facies=[(.83,(.96,1.,1.04),.07,.85),(.64,(.91,.99,1.07),.02,.80),
        (.99,(.99,1.,1.015),.03,.77),(.82,(1.,1.,1.015),.36,.85),
        (.97,(.99,1.,1.025),.05,.82),(.77,(.96,1.,1.025),.06,.84)]
ids=sys.argv[2:]
for idx,(name,(gain,tint,iron,rough)) in enumerate(zip(ids,facies)):
 out=p/'textures'/name;out.mkdir(parents=True,exist_ok=True)
 color=luma[:,:,None]*np.asarray(tint)*gain
 # Photo-derived inclusions carry detail at exactly the same places as normals.
 if idx==2: color*= (1-neutral*.10)[:,:,None]
 if idx==4: color*= (.84+neutral*.24)[:,:,None]
 color+=rust[:,:,None]*np.asarray([.15,.048,-.012])*iron
 # Highest-grain mineral flakes receive a restrained mineral glint, never foil.
 metal=.018+neutral*bright*.13
 roughness=np.clip(rough+(original_arm[:,:,1]-.65)*.18-neutral*bright*.11,.64,.96)
 Image.fromarray(np.uint8(np.clip(color,0,1)*255)).save(out/'color.jpg', quality=94)
 Image.fromarray(np.uint8(np.stack((original_arm[:,:,0],roughness,metal),axis=2)*255)).save(out/'arm.png')
 Image.open(source/'boulder_01_nor_gl_2k.jpg').save(out/'normal.png')
''', str(WORK), *IDS], check=True)


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj


def material_for(index):
    material=bpy.data.materials.new(IDS[index]);material.use_nodes=True
    material.use_backface_culling=True
    nodes,links=material.node_tree.nodes,material.node_tree.links
    shader=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
    for filename in ['color','normal','arm']:
        tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(WORK/'textures'/IDS[index]/(filename+('.jpg' if filename=='color' else '.png'))))
        if filename!='color':tex.image.colorspace_settings.name='Non-Color'
        if filename=='color':
            attr=nodes.new('ShaderNodeVertexColor');attr.layer_name='Exposure'
            multiply=nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs[0].default_value=1
            links.new(tex.outputs['Color'],multiply.inputs[1]);links.new(attr.outputs['Color'],multiply.inputs[2]);links.new(multiply.outputs[0],shader.inputs['Base Color'])
        elif filename=='normal':
            normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.9
            links.new(tex.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],shader.inputs['Normal'])
        else:
            sep=nodes.new('ShaderNodeSeparateColor');links.new(tex.outputs['Color'],sep.inputs['Color'])
            links.new(sep.outputs['Green'],shader.inputs['Roughness']);links.new(sep.outputs['Blue'],shader.inputs['Metallic'])
            group=bpy.data.node_groups.get('glTF Material Output')
            if group is None:
                group=bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
                group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
            output=nodes.new('ShaderNodeGroup');output.node_tree=group
            links.new(sep.outputs['Red'],output.inputs['Occlusion'])
    return material


def make_piece(source, material, x, y, length, angle, tip, roll, lod, index, role=0):
    obj=source.copy();obj.data=source.data.copy();bpy.context.collection.objects.link(obj)
    obj.hide_render=False;obj.hide_viewport=False;activate(obj)
    obj.data.calc_loop_triangles()
    reduce=obj.modifiers.new('Preserve fractured outline','DECIMATE');reduce.ratio=min(1,lod/len(obj.data.loop_triangles));reduce.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=reduce.name)
    minimum=Vector(tuple(min(v.co[i] for v in obj.data.vertices) for i in range(3)))
    maximum=Vector(tuple(max(v.co[i] for v in obj.data.vertices) for i in range(3)))
    center=Vector(((minimum.x+maximum.x)/2,(minimum.y+maximum.y)/2,(minimum.z+maximum.z)/2))
    scale=length/max(maximum.x-minimum.x,maximum.y-minimum.y)
    for v in obj.data.vertices: v.co=(v.co-center)*scale
    obj.location=(x,y,0);obj.rotation_mode='XYZ';obj.rotation_euler=tuple(math.radians(a) for a in (tip,roll,angle))
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    # Ground every transformed piece individually, including edge chips.
    floor=min(v.co.z for v in obj.data.vertices)
    for v in obj.data.vertices:v.co.z-=floor
    # Tilted scan undersides can perch on one vertex. Trim the buried portion
    # in source geometry, so the visible face meets soil across a broad base.
    burial=max(v.co.z for v in obj.data.vertices)*((.27 if index==2 else .19) if length>2 else .10)
    for v in obj.data.vertices:v.co.z-=burial
    bm=bmesh.new();bm.from_mesh(obj.data)
    cut=bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
        dist=.00001,plane_co=(0,0,0),plane_no=(0,0,1),clear_inner=True,clear_outer=False)
    rim=[e for e in cut['geom_cut'] if isinstance(e,bmesh.types.BMEdge) and e.is_boundary]
    if rim:bmesh.ops.holes_fill(bm,edges=rim,sides=0)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(obj.data);bm.free()
    obj.data.materials.clear();obj.data.materials.append(material)
    for attr in list(obj.data.color_attributes):obj.data.color_attributes.remove(attr)
    colors=obj.data.color_attributes.new(name='Exposure',type='FLOAT_COLOR',domain='POINT')
    for v,color in zip(obj.data.vertices,colors.data):
        dust=max(0,min(1,(.7-v.co.z)/.7))
        exposure=1
        if index==2:
            # Alternating mineral-bearing shoulders frame the cleft.
            exposure=.57 if role in (0,3) else 1.03
        elif index==5:
            # Mineral beds follow the same strike through several stone faces.
            band=math.sin(v.co.z*3.3+v.co.x*.27+math.sin(v.co.y*.8)*.3)
            exposure=.58 if band<-.15 else .95
        elif index==4:
            exposure=.64 if role%4==0 else 1
        color.color=(exposure*(1-dust*.08),exposure*(1-dust*.13),exposure*(1-dust*.18),1)
    return obj


def build_option(source,index,material):
    # x,y,long-axis size,z-rotation,pitch,roll,budget. These are assembled scans,
    # not ellipsoids: dimensions retain the natural scan proportions.
    layouts=[
      [(-.8,.4,8.8,76,-8,10,8200),(3.5,-.1,4.7,22,12,-17,2800),(-4.,-.5,4.5,110,-16,8,2600),(.8,-2.2,4.3,66,21,-11,2100)],
      [(-4.3,.3,4.8,10,9,-35,3700),(-1.8,.9,5.7,193,7,-35,4300),(1.2,-.1,6.1,17,11,-32,4200),(4.,.25,4.2,199,7,-38,2900)],
      [(-2.8,.5,7.2,33,-2,-5,6500),(2.6,.6,7.3,-35,2,4,6500),(.2,-1.8,4.,86,-8,18,1900),(-4.2,-1.2,3.2,12,9,-13,1300)],
      [(-2.5,.5,6.9,110,35,9,6100),(2.6,.3,7.7,59,-28,17,6600),(-.3,-1.7,4.1,98,12,-10,1900),(4.6,-1.0,2.8,84,21,7,1000)],
      [(-3.7,.5,4.5,87,15,-12,2600),(.0,.9,5.6,106,-7,13,4100),(3.5,.4,4.4,12,-25,17,2700),(-4.5,-1.7,3.3,29,24,11,1400),(-1.7,-2.,4.1,80,24,-7,2600),(2.,-1.8,3.7,99,-6,16,2100),(4.8,-1.3,2.5,83,35,7,800)],
      [(-3.5,.7,6.2,75,16,-4,4800),(.4,.7,7.7,76,18,0,6100),(4.2,.7,4.7,76,14,-3,3200),(.0,-2.,5.1,82,12,4,2900)]
    ][index]
    parts=[]
    for role,spec in enumerate(layouts):parts.append(make_piece(source,material,*spec,index,role))
    rng=random.Random(1047+index)
    for i in range(9):
        angle=math.tau*(i+.2)/9
        x=math.cos(angle)*rng.uniform(4.6,5.2);y=math.sin(angle)*rng.uniform(2.5,3)
        parts.append(make_piece(source,material,x,y,rng.uniform(.55,1.1),rng.uniform(0,360),rng.uniform(-30,30),rng.uniform(-20,20),110,index,i))
    activate(parts[0])
    for obj in parts:obj.select_set(True)
    bpy.ops.object.join();obj=bpy.context.object;obj.name=IDS[index];obj.data.name=IDS[index]
    minimum=Vector(tuple(min(v.co[i] for v in obj.data.vertices) for i in range(3)))
    maximum=Vector(tuple(max(v.co[i] for v in obj.data.vertices) for i in range(3)))
    center=Vector(((minimum.x+maximum.x)/2,(minimum.y+maximum.y)/2,minimum.z))
    width=max(maximum.x-minimum.x,maximum.y-minimum.y)
    for v in obj.data.vertices:v.co=(v.co-center)*14/width
    # Keep every variant within the existing resource collision footprint.
    radius=max(math.hypot(v.co.x,v.co.y) for v in obj.data.vertices)
    if radius>7.3:
        for v in obj.data.vertices:
            v.co.y*=math.sqrt(max(0,7.3**2-v.co.x**2))/max(.001,abs(v.co.y)) if math.hypot(v.co.x,v.co.y)>7.3 else 1
    return obj


def export_object(obj):
    activate(obj);path=WORK/(obj.name+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,
        export_materials='EXPORT',export_image_format='AUTO',export_jpeg_quality=94,export_texcoords=True,
        export_normals=True,export_vertex_color='NAME',export_vertex_color_name='Exposure',export_all_vertex_colors=False)
    obj.data.calc_loop_triangles()
    return {'id':obj.name,'file':str(path.relative_to(ROOT)), 'bytes':path.stat().st_size,
      'triangles':len(obj.data.loop_triangles),'meshes':1,'materials':1,
      'radius':max(math.hypot(v.co.x,v.co.y) for v in obj.data.vertices),
      'height':max(v.co.z for v in obj.data.vertices),'base':min(v.co.z for v in obj.data.vertices),
      'bounds_gltf_min':[min(v.co.x for v in obj.data.vertices),min(v.co.z for v in obj.data.vertices),-max(v.co.y for v in obj.data.vertices)],
      'bounds_gltf_max':[max(v.co.x for v in obj.data.vertices),max(v.co.z for v in obj.data.vertices),-min(v.co.y for v in obj.data.vertices)]}


prepare_maps()
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
source=next(o for o in bpy.context.scene.objects if o.type=='MESH');activate(source)
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
# glTF duplicates positions at scan UV seams. Restore adjacency before decimation;
# corner UVs stay intact, so this does not weld away separate photographed islands.
bm=bmesh.new();bm.from_mesh(source.data)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=0.000001)
bm.to_mesh(source.data);bm.free();source.hide_render=True
options=[build_option(source,index,material_for(index)) for index in range(6)]
metadata=[dict(export_object(obj),description=DESCRIPTIONS[index]) for index,obj in enumerate(options)]
ledger={'source':'https://polyhaven.com/a/boulder_01','source_author':'Rico Cilliers','source_license':'CC0-1.0',
  'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'assembly_license':'CC-BY-SA-4.0',
  'texture_resolution':2048,'maps':['base color','normal','ambient occlusion/roughness/metallic'],
  'usage':'Centered Y-up meshes,14m wide,baseY0,radius<=7.3m. Native-scale burial0.3–0.5m recommended. One standard PBR material per option; no extensions or runtime shader.',
  'options':metadata}
(WORK/'options.json').write_text(json.dumps(ledger,indent=2)+'\n')
print('TITANIUM_OPTIONS',json.dumps(ledger),flush=True)
# Inspect the actual exports, not Blender-only source-node appearances.
for obj in [source,*options]:bpy.data.objects.remove(obj,do_unlink=True)
# Let the importer make its full settings group rather than reuse our export-only AO socket.
bpy.data.node_groups.remove(bpy.data.node_groups['glTF Material Output'],do_unlink=True)
options=[]
for entry in metadata:
    before=set(bpy.context.scene.objects);bpy.ops.import_scene.gltf(filepath=str(ROOT/entry['file']))
    obj=next(o for o in set(bpy.context.scene.objects)-before if o.type=='MESH');options.append(obj);obj.hide_render=True
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=20;scene.cycles.use_denoising=True
scene.render.resolution_x=1100;scene.render.resolution_y=850;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.62,.68,.78,1);scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.5
bpy.ops.mesh.primitive_plane_add(size=100);floor=bpy.context.object;floor.location.z=-.03
mat=bpy.data.materials.new('desert-review');mat.use_nodes=True
shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');shader.inputs['Base Color'].default_value=(.32,.17,.073,1);shader.inputs['Roughness'].default_value=.94
floor.data.materials.append(mat)
bpy.ops.object.light_add(type='SUN',location=(-20,-30,45));sun=bpy.context.object;sun.data.energy=2.7;sun.data.angle=.13;sun.rotation_euler=(-sun.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(15,-23,19));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,2))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=21;scene.camera=camera
for obj in options:
    obj.hide_render=False;obj.location.z=-.38;scene.render.filepath=str(WORK/'renders'/(obj.name+'.png'));bpy.ops.render.render(write_still=True);obj.hide_render=True
bpy.ops.wm.save_as_mainfile(filepath=str(WORK/'titanium-options.blend'))
