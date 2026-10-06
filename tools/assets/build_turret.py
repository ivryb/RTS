"""Procedural Dune77 turret with an overlapping yaw bearing and an authored muzzle."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))
from building_materials import create_materials
from building_parts import BuildingParts
from building_bake import bake_runtime

parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=ROOT/'art/workbench/procedural-turret')
parser.add_argument('--seed', type=int, default=77)
parser.add_argument('--draft', action='store_true')
parser.add_argument('--texture-python', default='python3')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
args.output.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
materials = create_materials(ROOT/'art/workbench/building-materials/aged-desert', args.texture_python, args.seed)
kit = BuildingParts(materials)
armor,roof = materials.armor,materials.roof
metal,trim,rubber = materials.machinery,materials.structure,materials.recess


def bolt(name, point, normal=(0,0,1), radius=.018):
    point = Vector(point)
    kit.rod(name,point,point+Vector(normal)*.012,radius,trim,8)


def armor_shell(name, rows, mat, bevel=.04):
    """Loft matching footprint loops; rows contain (z, XY outline)."""
    count = len(rows[0][1])
    vertices = [(x,y,z) for z,ring in rows for x,y in ring]
    faces = [(r*count+i,r*count+(i+1)%count,(r+1)*count+(i+1)%count,(r+1)*count+i)
             for r in range(len(rows)-1) for i in range(count)]
    faces += [tuple(reversed(range(count))),tuple(range(len(vertices)-count,len(vertices)))]
    obj = kit.mesh(name,vertices,faces,mat,bevel)
    # Keep each side's wear continuous over the shoulder and toe, rather than
    # restarting the shared tile on every row of the shell.
    for face in obj.data.polygons[:(len(rows)-1)*count]:
        for loop in face.loop_indices:
            row,column = divmod(obj.data.loops[loop].vertex_index,count)
            obj.data.uv_layers.active.data[loop].uv = (.02+.96*(column==(face.index%count+1)%count),
                                                      .02+.96*(rows[row][0]-rows[0][0])/(rows[-1][0]-rows[0][0]))
    return obj


def foot_outline(inner, outer, width, clip):
    return [(inner,-width/2+clip),(inner+clip,-width/2),(outer-clip,-width/2),(outer,-width/2+clip),
            (outer,width/2-clip),(outer-clip,width/2),(inner+clip,width/2),(inner,width/2-clip)]


def cut_armor(obj, cutter):
    """Cut a kit solid out of armor, then discard the temporary cutting part."""
    bpy.context.view_layer.update()
    modifier = obj.modifiers.new('Recessed equipment opening','BOOLEAN')
    modifier.operation,modifier.solver,modifier.object = 'DIFFERENCE','EXACT',cutter
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_move_to_index(modifier=modifier.name,index=0)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    kit.parts.remove(cutter)
    bpy.data.objects.remove(cutter,do_unlink=True)


def pocket(obj, center, dimensions, rotation=(0,0,0)):
    # The cutter carries the armor material so cut faces never acquire an empty
    # material slot, which would leave the opening untextured and break baking.
    cutter = kit.box('Temporary opening cutter',center,dimensions,obj.data.materials[0],0)
    cutter.rotation_euler = rotation
    cut_armor(obj,cutter)


def radial_plate(name, angle, radii, z, width, height, clip, mat, bevel=.012):
    """A clipped plate facing outward from one foundation module."""
    outward = Vector((math.cos(angle),math.sin(angle),0))
    tangent = Vector((-outward.y,outward.x,0))
    shape = foot_outline(-width/2,width/2,height,clip)
    rings = [[outward*r+tangent*u+Vector((0,0,z+v)) for u,v in shape] for r in radii]
    return kit.solid(name,*rings,mat,bevel)


FOOT_WIDTH = .90
JOINT_GAP = .018
# This profile shapes only the pod. The feet keep parallel sides; using the
# pod's changing radius to set their width made the large armor blocks wavy.
POD_EDGE_PROFILE = [(1.22,.045),(1.256,.077),(1.265,.115),(1.265,.285),
                    (1.263,.301),(1.255,.315),(1.240,.329),(.997,.525)]
SHOE_FRONT_PROFILE = [(1.50,.055),(1.50,.205),(1.27,.59),(1.155,.65)]


def profile_radius(profile, z):
    for (ra,za),(rb,zb) in zip(profile,profile[1:]):
        if z <= zb:
            return ra+(rb-ra)*max(0,(z-za)/(zb-za))
    return profile[-1][0]


def foundation_foot(index):
    angle = index*math.pi/2
    start = len(kit.parts)
    sole = [(z,foot_outline(.73,1.505,FOOT_WIDTH+.02,.10)) for z in [0,.06]]
    armor_shell(f'Foot {index} / individual rubber sole',sole,rubber,.018)
    # Extend the straight side under the bearing so the pod meets a plane, not
    # the shoe's clipped rear corner. The width stays constant through every row.
    rows=[(z,foot_outline(.74,outer,FOOT_WIDTH,.10)) for outer,z in SHOE_FRONT_PROFILE]
    foot = armor_shell(f'Foot {index} / rectangular ivory shoe',rows,armor,.052)
    # Equipment follows the sloping face as its proportions change.
    (toe_r,toe_z),(shoulder_r,shoulder_z)=SHOE_FRONT_PROFILE[1:3]
    slope = math.atan2(toe_r-shoulder_r,shoulder_z-toe_z)
    normal = Vector((math.cos(slope),0,math.sin(slope)))
    along = Vector((-math.sin(slope),0,math.cos(slope)))
    center_z=(toe_z+shoulder_z)/2
    center = Vector((profile_radius(SHOE_FRONT_PROFILE,center_z),0,center_z))
    pocket(foot,center-normal*.025,(.20,.43,.235),(0,-slope,0))
    rim=[center+Vector((0,y,0))+along*z-normal*depth
         for width,height,depth in [(.211,.113,.012),(.189,.094,.105)]
         for y,z in [(-width,-height),(width,-height),(width,height),(-width,height)]]
    kit.mesh(f'Foot {index} / dark opening returns',rim,
             [(i,(i+1)%4,(i+1)%4+4,i+4) for i in range(4)],metal,closed=False)
    liner = kit.box(f'Foot {index} / inset cooling well',center-normal*.114,(.012,.40,.218),rubber,.005)
    liner.rotation_euler.y = -slope
    point = center-normal*.089-along*.04
    blade = kit.box(f'Foot {index} / inner cooling baffle',point,(.055,.375,.035),metal,.006)
    blade.rotation_euler.y = -slope-.25
    kit.box(f'Foot {index} / toe recess',(toe_r-.004,0,.088),(.014,.49,.024),metal,.006)
    for y in [-.30,.30]:
        bolt(f'Foot {index} / captive fastener',(toe_r-.012,y,.145),normal=(1,0,0),radius=.013)
    # Rotate the complete shoe, including its opening, as one repeated assembly.
    bpy.context.view_layer.update()
    for obj in kit.parts[start:]:
        obj.matrix_world = Matrix.Rotation(angle,4,'Z') @ obj.matrix_world


def curved_module(name, angle, rows, mat, bevel, segments=16):
    """Rows define center radius, height, angular span, and radius at the joint."""
    vertices=[]
    for center,z,span,end in rows:
        for i in range(segments+1):
            t=2*i/segments-1
            a=angle+t*span/2
            radius=center+(end-center)*t*t
            vertices.append((radius*math.cos(a),radius*math.sin(a),z))
    stride=segments+1
    faces = [(row*stride+i,row*stride+i+1,((row+1)%len(rows))*stride+i+1,((row+1)%len(rows))*stride+i)
             for row in range(len(rows)) for i in range(segments)]
    faces += [tuple(row*stride for row in reversed(range(len(rows)))),
              tuple(row*stride+segments for row in range(len(rows)))]
    obj=kit.mesh(name,vertices,faces,mat,bevel)
    distances=[0]
    for a,b in zip(rows,rows[1:]+rows[:1]):
        distances.append(distances[-1]+math.dist(a[:2],b[:2]))
    for face in obj.data.polygons[:len(rows)*segments]:
        row,column=divmod(face.index,segments)
        for loop,(u,v) in zip(face.loop_indices,[(column,row),(column+1,row),(column+1,row+1),(column,row+1)]):
            obj.data.uv_layers.active.data[loop].uv=(.02+.96*u/segments,.02+.96*distances[v]/distances[-1])
    return obj


def cubic_profile(points, steps):
    a,b,c,d = map(Vector,points)
    return [tuple((1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d)
            for t in [i/steps for i in range(steps+1)]]


def pod_span(radius, clearance):
    """Trim a circular row against the neighboring feet's parallel side walls."""
    return math.pi/2-2*math.asin((FOOT_WIDTH/2+clearance)/radius)


def pod_rows(profile, clearance, recess=0):
    rows=[]
    for index,(r,z) in enumerate(profile):
        end=profile_radius(POD_EDGE_PROFILE,z)-recess if 1<=index<=len(profile)-3 else r
        rows.append((r,z,pod_span(end,clearance),end))
    return rows


def foundation_service_pod(index):
    angle = math.pi/4+index*math.pi/2
    segments=16
    toe=cubic_profile([(1.210,.045),(1.255,.045),(1.263,.075),(1.263,.115)],4)
    shoulder=cubic_profile([(1.261,.290),(1.267,.387),(1.108,.474),(.963,.525)],12)
    surface=[*toe,(1.265,.21),*shoulder]
    # Float32 curve samples and authored joint heights can differ by nanometers;
    # merge those rows before beveling to avoid nearly zero-height mesh strips.
    heights=sorted({round(z,6) for _,z in surface} | {z for _,z in POD_EDGE_PROFILE})
    profile=[(.90,.045),*((profile_radius(surface,z),z) for z in heights),(.88,.50),(.88,.12)]
    # The exposed dark backing fills recessed channels beside the ivory shell.
    # It is set back from the rounded face, so the divider has visible depth.
    backing=[(r-.022,z-.010) for r,z in profile]
    curved_module(f'Service pod {index} / recessed joint backing',angle,pod_rows(backing,0,.022),rubber,.008)
    pod=curved_module(f'Service pod {index} / rounded ivory armor',angle,pod_rows(profile,JOINT_GAP),armor,.018)
    edge=pod.modifiers['Machined edge radius']
    # The profile already rounds the shoulder and toe. Bevel only the hard side
    # and opening edges; beveling profile rows pinches the surface by the hatch.
    edge.limit_method,edge.angle_limit='ANGLE',1.2
    # This is a continuously curved shell. Area-weighting its normals would pull
    # the highlights toward the large front faces and recreate faceted shoulders.
    pod.modifiers.remove(pod.modifiers['Weighted corner normals'])
    edge.harden_normals=False
    # Use distance along the curved panel, so nearly horizontal shoulders do not
    # stretch the edge of a wall texture across their entire roof.
    distances=[0]
    for a,b in zip(profile,profile[1:]): distances.append(distances[-1]+math.dist(a,b))
    stride=segments+1
    for face in pod.data.polygons[:len(profile)*segments]:
        if face.index//segments not in range(1,len(profile)-3): continue
        for loop in face.loop_indices:
            row,column=divmod(pod.data.loops[loop].vertex_index,stride)
            pod.data.uv_layers.active.data[loop].uv=(.02+.96*column/segments,
                .02+.96*(distances[row]-distances[1])/(distances[-3]-distances[1]))
    outward=Vector((math.cos(angle),math.sin(angle),0))
    cutter=radial_plate('Temporary service hatch cutter',angle,(1.16,1.335),.226,.535,.206,.055,armor,0)
    cut_armor(pod,cutter)
    radial_plate(f'Service pod {index} / hatch gasket',angle,(1.178,1.209),.226,.516,.196,.052,rubber)
    radial_plate(f'Service pod {index} / clipped hatch bezel',angle,(1.201,1.233),.226,.495,.180,.050,metal)
    radial_plate(f'Service pod {index} / inset hatch leaf',angle,(1.230,1.239),.226,.389,.108,.030,metal,.005)
    for z in [.199,.253]:
        kit.box(f'Service pod {index} / hatch rib',outward*1.247+Vector((0,0,z)),(.010,.28,.017),metal,.004,angle)
    seam=shoulder[5:]
    for (r0,z0),(r1,z1) in zip(seam,seam[1:]):
        kit.rod(f'Service pod {index} / panel seam',outward*(r0+.001)+Vector((0,0,z0+.002)),
                outward*(r1+.001)+Vector((0,0,z1+.002)),.004,metal,6)
    # Plain ivory band, seated over the full pod neck with a narrow recessed seal.
    saddle=[(.83,.51),(1.002,.51),(1.002,.543),(.967,.574),(.835,.566)]
    curved_module(f'Service pod {index} / saddle gasket',angle,
                  [(r,z-.010,pod_span(r,.002),r) for r,z in saddle],rubber,.008)
    curved_module(f'Service pod {index} / ivory mounting saddle',angle,
                  [(r,z,pod_span(r,JOINT_GAP),r) for r,z in saddle],armor,.011)


# The reference has four long square shoes and four lower curved service pods.
# A continuous eight-sided skirt loses both that scalloped footprint and the gaps.
kit.lathe('Foundation concealed core',[(.91,.055),(.96,.43),(.93,.56)],metal)
for side in range(4):
    foundation_foot(side)
    foundation_service_pod(side)
kit.lathe('Fixed bearing lower race',[(.86,.515),(.895,.55),(.895,.61),(.861,.64),(.861,.775)],metal)
rim=kit.lathe('Fixed bearing upper rim',[(.857,.71),(.90,.755),(.898,.865),(.857,.91),(.77,.934)],metal)
for loop in rim.data.uv_layers.active.data: loop.uv.x*=12
kit.lathe('Bearing lower seam',[(.895,.568),(.902,.579),(.902,.604),(.894,.613)],rubber)
kit.lathe('Bearing rim wear line',[(.899,.756),(.903,.765),(.902,.775)],trim)
for i in range(12):
    angle=i*math.tau/12
    # Keep the teeth above the raised shoe roofs while interrupting the drum band.
    kit.box(f'Bearing locking tooth {i}',(.867*math.cos(angle),.867*math.sin(angle),.700),(.20,.045,.085),metal,.009,angle-math.pi/2)
    bolt('Bearing flange fastener',(.818*math.cos(angle),.818*math.sin(angle),.914),radius=.013)
kit.lathe('Stationary spindle socket',[(.56,.895),(.59,.94),(.59,.995),(.54,1.025)],metal)
base_parts = list(kit.parts)

# Complete moving parts overlap the fixed bearing; the central spindle fills the
# original split-model gap without making the whole support into a taller drum.
kit.lathe('Head spindle',[(.52,.94),(.535,.985),(.535,1.265),(.57,1.30)],metal)
kit.lathe('Head spindle dust seal',[(.536,1.06),(.551,1.07),(.551,1.115),(.536,1.125)],rubber)
kit.lathe('Head lower bearing plate',[(.53,1.205),(.64,1.225),(.65,1.28),(.59,1.315)],metal)

lower=[(-.28,-.37),(.06,-.73),(.53,-.73),(.83,-.48),(.83,.48),(.53,.73),(.06,.73),(-.28,.37)]
wide=[(-.24,-.43),(.07,-.775),(.54,-.775),(.84,-.52),(.84,.52),(.54,.775),(.07,.775),(-.24,.43)]
upper=[(-.215,-.395),(.095,-.73),(.515,-.73),(.80,-.49),(.80,.49),(.515,.73),(.095,.73),(-.215,.395)]
armor_shell('Head underside gasket',[(1.285,lower),(1.34,wide)],rubber,.027)
head_armor=armor_shell('Head / offset ivory gun housing',[(1.32,lower),(1.40,wide),(1.72,wide),(1.80,upper)],armor,.038)
# The reference's hatch has clipped forward corners, aligned with the gun throat.
# One low cover follows that opening; nested square plates changed its silhouette.
hatch=[(-.135,-.18),(.065,-.31),(.59,-.31),(.59,.31),(.065,.31),(-.135,.18)]
cutter=kit.hull('Temporary roof hatch cutter',hatch,hatch,1.758,1.90,armor,0)
cut_armor(head_armor,cutter)
seal=[(.235+(x-.235)*.98,y*.98) for x,y in hatch]
cover=[(.235+(x-.235)*.93,y*.93) for x,y in hatch]
kit.hull('Head / six-sided hatch gasket',seal,seal,1.761,1.775,rubber,.004)
kit.hull('Head / clipped roof access cover',cover,cover,1.774,1.788,metal,.007)
for y in [-.22,.22]:
    kit.rod('Head / hatch hinge',(.551,y-.035,1.789),(.551,y+.035,1.789),.010,metal,12)

# Exposed recoil boxes flank the gun. The shorter ivory cheek covers flow into
# the offset housing instead of wrapping the barrel in a symmetric white box.
for sign in [-1,1]:
    y=sign*.49
    low=[(-.88,y-.17),(-.11,y-.17),(-.11,y+.17),(-.88,y+.17)]
    high=[(-.79,y-.157),(-.10,y-.157),(-.10,y+.157),(-.79,y+.157)]
    armor_shell(f'Recoil box {sign} / graphite nose',[(1.325,low),(1.665,high)],metal,.033)
    kit.box(f'Recoil box {sign} / ivory cheek',(-.30,y,1.535),(.60,.38,.31),armor,.065)
    kit.box(f'Recoil box {sign} / side inspection plate',(-.68,sign*.660,1.50),(.205,.034,.17),metal,.025)
    kit.box(f'Recoil box {sign} / front inset',(-.835,y,1.49),(.018,.21,.18),rubber,.015)
    for y_offset in [-.11,.11]:
        bolt(f'Recoil box {sign} / top fastener',(-.72,y+y_offset,1.666),radius=.012)
kit.box('Gun / exposed receiver',(-.47,0,1.59),(.61,.32,.265),metal,.032)
kit.box('Gun / receiver spine',(-.42,0,1.733),(.50,.12,.042),metal,.015)
kit.rod('Gun / breech collar',(-.62,0,1.59),(-.79,0,1.59),.162,metal,40)
barrel=kit.lathe('Gun / hollow stepped barrel',[(.127,0),(.13,.11),(.159,.14),(.159,.28),
                                            (.126,.31),(.126,.68),(.169,.715),(.169,.89),(.156,.94),
                                            (.098,.94),(.098,.50),(.105,0)],metal,48,closed_profile=True)
barrel.rotation_euler.y=-math.pi/2
barrel.location=(-.65,0,1.59)
kit.rod('Gun / recessed dark bore',(-1.135,0,1.59),(-1.16,0,1.59),.10,rubber,32)
for i in range(6):
    angle=i*math.tau/6
    radial=Vector((0,math.cos(angle),math.sin(angle)))
    kit.rod('Gun / cooling jacket spline',Vector((-1.29,0,1.59))+radial*.13,
            Vector((-.99,0,1.59))+radial*.13,.012,metal,6)

# The rear has the reference's small framed cylinder, rather than an added sensor box.
kit.rod('Head / rear recoil reservoir',(.84,-.235,1.535),(.84,.235,1.535),.17,metal,32)
for sign in [-1,1]:
    kit.box('Head / rear ivory frame post',(.89,sign*.265,1.555),(.17,.09,.42),armor,.028)
kit.box('Head / rear ivory frame bridge',(.89,0,1.75),(.17,.58,.075),roof,.024)
head_parts = kit.parts[len(base_parts):]

root = bpy.data.objects.new('TurretRoot',None)
pivot = bpy.data.objects.new('TurretHead',None)
muzzle = bpy.data.objects.new('TurretMuzzle',None)
for obj in [root,pivot,muzzle]:
    bpy.context.collection.objects.link(obj)
pivot.parent = root
pivot.location.z = 1.11
muzzle.location = (-1.607,0,1.59)
bpy.context.view_layer.update()


def attach(obj, parent):
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


for obj in base_parts:
    attach(obj,root)
for obj in head_parts:
    attach(obj,pivot)
attach(muzzle,pivot)
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(args.output/'turret.blend'))

for obj in kit.parts:
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    # Joining for a single texture atlas preserves this ownership. Separation after
    # baking follows complete authored parts, so it never cuts away the bearing.
    if obj in head_parts:
        group = obj.vertex_groups.new(name='MovingHead')
        group.add(list(range(len(obj.data.vertices))),1,'REPLACE')

if not args.draft:
    runtime = bake_runtime(kit.parts,args.output,size=1024,name='Turret')
    group_index = runtime.vertex_groups['MovingHead'].index
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    for vertex in runtime.data.vertices:
        vertex.select = any(group.group==group_index for group in vertex.groups)
    before = set(bpy.context.scene.objects)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    head = next(obj for obj in bpy.context.scene.objects if obj not in before)
    runtime.name,head.name = 'TurretBase','TurretHeadMesh'
    bpy.context.view_layer.update()
    attach(head,pivot)

bpy.context.view_layer.update()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(args.output/'turret.glb'),export_format='GLB',use_selection=True,
                          export_apply=True,export_yup=True,export_image_format='WEBP',export_image_quality=85)
meshes = [obj for obj in bpy.context.scene.objects if obj.type=='MESH']
for obj in meshes: obj.data.calc_loop_triangles()
report = {'seed':args.seed,'geometry_source':'fully procedural; shared BuildingParts and Aged desert materials',
          'design':'compact foundation proportions / revision 09','status':'accepted production design',
          'reference':'assets/source/meshy/archive/turret.glb',
          'meshes':len(meshes),'triangles':sum(len(obj.data.loop_triangles) for obj in meshes),
          'glb_bytes':(args.output/'turret.glb').stat().st_size,
          'sha256':hashlib.sha256((args.output/'turret.glb').read_bytes()).hexdigest(),
          'nodes':['TurretRoot','TurretBase','TurretHead','TurretHeadMesh','TurretMuzzle'],
          'joint':'overlapping fixed socket, central head spindle, and lower head plate',
          'forward':'-X','license':'CC BY-SA 4.0'}
(args.output/'build-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
