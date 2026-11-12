"""Procedural construction scaffold kit: the pieces the game arranges around any building site.

One GLB holds every piece as its own named mesh, all sharing one baked atlas. Each piece sits
at its own pivot so the game can place it with a bay frame: +X along the bay, +Z up, -Y facing
out of the site (glTF: +X along, +Y up, +Z out). `ScaffoldKit` carries the nominal bay and lift
sizes; the game fits members to a site by scaling them along their length only, never across.
"""
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
parser.add_argument('--output', type=Path, default=ROOT/'art/workbench/procedural-scaffold-kit')
parser.add_argument('--seed', type=int, default=77)
parser.add_argument('--draft', action='store_true')
parser.add_argument('--texture-python', default='python3')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
args.output.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
materials = create_materials(ROOT/'art/workbench/building-materials/aged-desert', args.texture_python, args.seed)
kit = BuildingParts(materials)
graphite, rubber, cyan = materials.machinery, materials.recess, materials.indicator


def painted(source, name, color, blend='MULTIPLY', factor=1):
    """A non-metal coat over a palette finish, keeping its panel wear. The game has no
    reflection environment, so bare metal tubes this thin render almost black."""
    mat = source.copy()
    mat.name = name
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Metallic'].default_value = 0
    coat = nodes.new('ShaderNodeMix')
    coat.data_type, coat.blend_type = 'RGBA', blend
    coat.inputs['Factor'].default_value = factor
    coat.inputs['B'].default_value = (*color, 1)
    links.new(shader.inputs['Base Color'].links[0].from_socket, coat.inputs['A'])
    links.new(coat.outputs['Result'], shader.inputs['Base Color'])
    return mat


# Ochre bronze lifted to the palette's exposed-metal tone: lighter than graphite machinery,
# darker and yellower than ivory armor, so the scaffold never reads as part of the building.
ochre = painted(materials.structure, 'Scaffold ochre paint', (1.75, 1.7, 1.55))
# Dust-covered road plate: a quiet mid-tone under the site instead of a black square. It
# keeps a third of the graphite tile, enough for seams without bright worn edges.
plate = painted(materials.machinery, 'Dusty road plate', (.15, .108, .072), 'MIX', .68)

# A bay is the nominal spacing between posts, a lift the nominal spacing between rail levels.
BAY, LIFT = 1.6, 1.8
POST_RADIUS, RAIL_RADIUS, BRACE_RADIUS = .075, .055, .042
PAD_TOP = .06
# Half the height of the node collar on a post top, and the top of a foot's screw jack: a
# lamp stands on either.
COLLAR, JACK_TOP = .085, PAD_TOP+.19
# Pieces are authored this far apart so the contact-shading bake of one never darkens another.
SPACING = 4.0

pieces = {}
origin = Vector((0, 0, 0))


def piece(name):
    """Start a piece: parts added until the next call belong to it, built around `origin`."""
    global origin
    origin = Vector((len(pieces)*SPACING, 0, 0))
    pieces[name] = (origin.copy(), len(kit.parts))


def at(point):
    return origin+Vector(point)


def tube(name, start, end, radius, mat, sides=6, turn=0, caps=True):
    """Prism between two points. Scaffold members are a few pixels wide in play, so a
    hexagonal section, with no end caps where a joint hides them, keeps hundreds of
    instances cheap."""
    start, end = at(start), at(end)
    axis = (end-start).normalized()
    side = axis.cross(Vector((0, 1, 0)))
    side = (side if side.length > .01 else Vector((1, 0, 0))).normalized()
    up = axis.cross(side)
    def ring(center):
        return [center+(side*math.cos(a)+up*math.sin(a))*radius
                for a in (turn+i*math.tau/sides for i in range(sides))]
    if caps:
        return kit.solid(name, ring(start), ring(end), mat, 0)
    walls = [(i, (i+1) % sides, (i+1) % sides+sides, i+sides) for i in range(sides)]
    obj = kit.mesh(name, [*ring(start), *ring(end)], walls, mat, closed=False)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def block(name, center, size, mat):
    return kit.box(name, at(center), size, mat, 0)


def stripes(name, x0, x1, count, profile, mat, lean=.11):
    """Slanted warning stripes laid just proud of a beam; `profile` is its (y, z) outline."""
    pitch = (x1-x0)/count
    vertices, faces = [], []
    for i in range(count):
        for x in (x0+i*pitch+pitch*.25, x0+i*pitch+pitch*.75):
            # The stripe leans along the beam as it climbs over the profile.
            vertices += [at((x+lean*step, y, z)) for step, (y, z) in enumerate(profile)]
        base, n = i*2*len(profile), len(profile)
        faces += [(base+j, base+n+j, base+n+j+1, base+j+1) for j in range(n-1)]
    return kit.mesh(name, vertices, faces, mat, closed=False)


piece('ScaffoldPost')
tube('Post / ochre standard', (0, 0, 0), (0, 0, LIFT), POST_RADIUS, ochre, turn=math.pi/6, caps=False)
# The node collar sits where the rails meet the post and hides the joint to the post above.
tube('Post / graphite node collar', (0, 0, LIFT-COLLAR), (0, 0, LIFT+COLLAR), POST_RADIUS+.038, graphite)

piece('ScaffoldRail')
# Both ends disappear inside the node collars, so the ledger is one open tube.
tube('Rail / ochre ledger', (.05, 0, 0), (BAY-.05, 0, 0), RAIL_RADIUS, ochre, caps=False)

piece('ScaffoldBrace')
# Braces clamp outside the rail plane, short of the nodes, as on a real tube scaffold.
tube('Brace / diagonal tube', (.13, -.085, .10), (BAY-.13, -.085, LIFT-.10), BRACE_RADIUS, graphite, caps=False)
for x, z in ((.13, .10), (BAY-.13, LIFT-.10)):
    block('Brace / swivel clamp', (x, -.045, z), (.11, .10, .11), ochre)

piece('ScaffoldFoot')
block('Foot / base plate', (0, 0, PAD_TOP+.02), (.36, .36, .04), graphite)
tube('Foot / screw jack', (0, 0, PAD_TOP+.03), (0, 0, JACK_TOP), POST_RADIUS+.03, graphite)

piece('ScaffoldPad')
# One steel road plate per square of the pad's grid, from the pivot along +X and inward. The
# game leaves the joint between plates when it lays them.
block('Pad / steel road plate', (BAY/2, -BAY/2, PAD_TOP/2), (BAY, BAY, PAD_TOP), plate)

piece('ScaffoldPadCut')
# The same plate cut on the diagonal, with its right angle at the pivot. Any triangle is a
# sheared copy of it, so a few of them make up a plate trimmed to a slanted side of a pad.
corners = [(0, 0), (0, -BAY), (BAY, 0)]
kit.solid('Pad / cut road plate', [at((x, y, 0)) for x, y in corners],
          [at((x, y, PAD_TOP)) for x, y in corners], plate, 0)

piece('ScaffoldCurb')
curb = [(-.11, PAD_TOP), (-.11, PAD_TOP+.20), (.11, PAD_TOP+.20), (.11, PAD_TOP)]
block('Curb / ochre kerb beam', (BAY/2, 0, PAD_TOP+.10), (BAY-.44, .22, .20), ochre)
stripes('Curb / warning stripes', .26, BAY-.26, 4,
        [(y*1.03, PAD_TOP+(z-PAD_TOP)*1.03+.001) for y, z in curb], rubber)

piece('ScaffoldBeacon')
# The lamp sits straight on a collar or a jack. On a mast its head was the last thing above
# ground when the scaffold drops, and it looked as if it floated.
block('Beacon / lamp housing', (0, 0, .04), (.17, .17, .08), graphite)
tube('Beacon / cyan lens', (0, 0, .08), (0, 0, .20), .062, cyan, 8)
block('Beacon / lamp cap', (0, 0, .2125), (.15, .15, .025), graphite)

names = list(pieces)
ranges = {name: kit.parts[start:(pieces[names[i+1]][1] if i+1 < len(names) else None)]
          for i, (name, (_, start)) in enumerate(pieces.items())}
for name, parts in ranges.items():
    for obj in parts:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        obj.select_set(False)
        # Joining for the shared atlas keeps this ownership, so the bake can be split back
        # into whole pieces afterwards.
        obj.vertex_groups.new(name=name).add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
bpy.ops.wm.save_as_mainfile(filepath=str(args.output/'scaffold-kit.blend'))

root = bpy.data.objects.new('ScaffoldKit', None)
bpy.context.collection.objects.link(root)
root['bay'], root['lift'], root['post_top'], root['jack_top'] = BAY, LIFT, LIFT+COLLAR, JACK_TOP

if args.draft:
    runtime = kit.parts[0]
    bpy.ops.object.select_all(action='DESELECT')
    for obj in kit.parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = runtime
    bpy.ops.object.join()
else:
    runtime = bake_runtime(kit.parts, args.output, size=512, name='Scaffold kit')

meshes = []
for name in names:
    group = runtime.vertex_groups[name].index
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    for vertex in runtime.data.vertices:
        vertex.select = any(g.group == group for g in vertex.groups)
    if name == names[-1]:
        obj = runtime
    else:
        before = set(bpy.context.scene.objects)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.separate(type='SELECTED')
        bpy.ops.object.mode_set(mode='OBJECT')
        obj = next(o for o in bpy.context.scene.objects if o not in before)
    obj.name = obj.data.name = name
    obj.data.transform(Matrix.Translation(-pieces[name][0]))
    obj.vertex_groups.clear()
    obj.parent = root
    meshes.append(obj)

bpy.context.view_layer.update()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(args.output/'scaffold-kit.glb'), export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True, export_extras=True,
                          export_image_format='WEBP', export_image_quality=85)
for obj in meshes:
    obj.data.calc_loop_triangles()
report = {'seed': args.seed, 'geometry_source': 'fully procedural; shared BuildingParts and Aged desert materials',
          'bay': BAY, 'lift': LIFT,
          'pieces': {obj.name: len(obj.data.loop_triangles) for obj in meshes},
          'triangles': sum(len(obj.data.loop_triangles) for obj in meshes),
          'glb_bytes': (args.output/'scaffold-kit.glb').stat().st_size,
          'sha256': hashlib.sha256((args.output/'scaffold-kit.glb').read_bytes()).hexdigest(),
          'frame': '+X along the bay, +Z up, -Y out of the site (glTF: +Y up, +Z out)',
          'license': 'CC BY-SA 4.0'}
(args.output/'build-report.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report), flush=True)
