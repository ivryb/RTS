"""Titanium Deposit option "Blades": a rank of tilted titanium slabs in a sandstone hogback.

box 'blender --background --threads 6 --python-exit-code 1 --python tools/assets/build_titanium_blades.py -- [--seed 1] [--out <dir>] [--draft]'

Tilted strata have weathered into four to six parallel titanium slabs that lean the
same way. Sandstone beds survive behind and between them, and the rank stands on a
low mound whose foot takes the ground's sand color. Each slab's top is cut along the
half-vector between the game's fixed sun and camera, so its crest shows a real glint.

`--seed` picks the composition: the number of slabs, their spacing, heights, lengths,
breaks and lean all come from it. `--out` (default art/workbench/titanium-blades)
receives `full.glb`, `depleted.glb`, the shared 1024 px atlas and `export.json`; both
states are subsets of one baked mesh. `--draft` stops after saving `source.blend`.
Review in the game with `bun tools/verify/capture-ore.mjs --model <glb> --out <dir>`.
"""
import argparse
import json
import math
from pathlib import Path
import random
import sys

import bmesh
import bpy
import numpy
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/assets'))
from building_bake import bake_runtime

CLIFF_SCAN = 'assets/source/polyhaven/titanium/cliff_side_diff_2k.jpg'
CLIFF_COLOR = 'assets/textures/terrain/oxide-cliff-color.webp'
SCREE_COLOR = 'assets/textures/terrain/oxide-scree-color.webp'
SAND_COLOR = 'assets/textures/terrain/sand-scan.webp'
# The main game multiplies its 30 m sand tile by hsl(29, 94%, 75%); linear RGB here.
GROUND_TINT = (.966, .51, .228)
FOOTPRINT_RADIUS = 5.35
# The game never turns its camera, its sun or a deposit, so these Blender-space
# directions hold everywhere on the map. A smooth facet whose normal is HALF, the
# half-vector between sun and camera, mirrors the sun into the camera.
SUN = Vector((-.518, -.327, .791))
HALF = Vector((.006, -.506, .862)).normalized()
# The slabs run along X and lean back toward +Y by LEAN, so their broad faces look
# toward -Y and up: the side that both the sun and the camera see. FRONT and BACK
# are the rows of the first and the last slab.
LEAN = math.radians(24)
FRONT, BACK = -4.0, 3.0
# The round plan (center Y, radius) on which every layer of the rank ends.
PLAN = (-.25, 4.3)
SHADOW, MID, LIGHT = (.05, .06, .08), (.2, .27, .36), (.72, .78, .84)
HOST, BLADE, STUMP = 0, 1, 2
HOST_TRIANGLES = 6800

parser = argparse.ArgumentParser()
parser.add_argument('--seed', type=int, default=1)
parser.add_argument('--out', type=Path, default=ROOT / 'art/workbench/titanium-blades')
parser.add_argument('--draft', action='store_true', help='save the editable source without baking')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = args.out.resolve()


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def link(name, bm, part, smooth=False):
    """Turn a bmesh into an object whose faces all carry `part`, the state they show in."""
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    data = bpy.data.meshes.new(name)
    bm.to_mesh(data)
    bm.free()
    data.polygons.foreach_set('use_smooth', [smooth] * len(data.polygons))
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    tag(obj, part)
    return obj


def tag(obj, part):
    attributes = obj.data.attributes
    (attributes.get('part') or attributes.new('part', 'INT', 'FACE')).data.foreach_set(
        'value', [part] * len(obj.data.polygons))


def paint(obj, face_masks):
    """Store (tone, gloss) per face corner, plus the source UV the baker expects."""
    obj.data.color_attributes.new('Masks', 'FLOAT_COLOR', 'CORNER').data.foreach_set(
        'color', [channel for polygon, masks in zip(obj.data.polygons, face_masks)
                  for _ in polygon.loop_indices for channel in (*masks, 0, 1)])
    obj.data.uv_layers.new(name='SourceUV')


def smooth(bm, factor):
    bmesh.ops.smooth_vert(bm, verts=list(bm.verts), factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)


def reach(y):
    """Half-length of the round plan at row `y`."""
    center, radius = PLAN
    return math.sqrt(max(.2, radius ** 2 - (y - center) ** 2))


def outline(center, radii, rng):
    """An irregular polygon of seven to nine corners around an ellipse."""
    count, turn = rng.randint(7, 9), rng.uniform(0, math.tau)
    return [Vector((center[0] + math.cos(angle) * radii[0] * scale, center[1] + math.sin(angle) * radii[1] * scale))
            for angle, scale in ((turn + math.tau * (index + rng.uniform(-.3, .3)) / count, rng.uniform(.86, 1.1))
                                 for index in range(count))]


def strip(center, half_length, thickness, rng):
    """The outline of one bed: ragged, wavering long sides, cut off where the round plan ends."""
    count = max(3, round(half_length / .5))
    wave, phase = rng.uniform(.04, .12), rng.uniform(0, math.tau)
    points = []
    for side in (1, -1):
        for index in range(count + 1):
            along = (index / count * 2 - 1) * side
            pinch = .85 + .15 * (1 - abs(along) ** 3)
            y = center[1] - side * thickness / 2 * pinch * rng.uniform(.75, 1.15) + wave * math.sin(along * 4 + phase)
            x = center[0] + along * half_length + rng.uniform(-.12, .12)
            points.append(Vector((math.copysign(min(abs(x), reach(y)), x), y)))
    return points


def add_prism(bm, points, top, seed, taper, lean):
    """A closed prism from below the ground up to `top`, which leans back by `lean` and
    whose sides narrow by different amounts."""
    rng, bottom = random.Random(seed), -.6
    centroid = sum(points, Vector((0, 0))) / len(points)
    pivot = Vector((centroid.x, centroid.y, (bottom + top) / 2))
    rotation = Matrix.Rotation(-lean, 3, 'X')
    leans = [taper * rng.uniform(.5, 1.5) for _ in points]
    rings = [[bm.verts.new(pivot + rotation @ Vector((*((point - centroid) * (1 - narrow * f)), z - pivot.z)))
              for point, narrow in zip(points, leans)]
             for z, f in [(bottom, 0), (bottom + (top - bottom) * .55, .35), (top, 1)]]
    for lower, upper in zip(rings, rings[1:]):
        for index in range(len(points)):
            bm.faces.new((lower[index - 1], lower[index], upper[index], upper[index - 1]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])


def plan_blades(rng):
    """Rows of slabs from front to back: uneven spacing, irregular heights, a slight splay."""
    count = rng.choice((4, 5, 5, 6))
    gaps = [rng.uniform(.7, 1.3) for _ in range(count - 1)]
    # The tallest slab stands in the back half, where it neither shades nor hides the others.
    tallest = rng.randrange(count // 2, count)
    blades = []
    for index in range(count):
        y = FRONT + (BACK - FRONT) * sum(gaps[:index]) / sum(gaps)
        height = rng.uniform(2.85, 3.05) if index == tallest else rng.uniform(1.9, 2.6) * (.85 if index == 0 else 1)
        # The taller a slab, the shorter: a long tall one would read as a wall.
        half = reach(y) * rng.uniform(.8, .97) * (.72 if index == tallest else 1)
        blade = dict(x=rng.uniform(-1, 1) * (reach(y) * .97 - half), y=y, half=half, height=height,
                     thickness=rng.uniform(.36, .55), lean=LEAN + rng.uniform(-.06, .06), yaw=rng.uniform(-.025, .025))
        blades.append(dict(blade, plates=break_blade(blade, rng)))
    return blades


def break_blade(blade, rng):
    """One or two plates per slab; a second plate has lost height, and each has slipped a little."""
    length = 2 * blade['half']
    count = 1 if length < 4.6 or rng.random() < .4 else 2
    cuts = [0, *([rng.choice((rng.uniform(.28, .42), rng.uniform(.58, .72)))] if count == 2 else []), 1]
    whole = rng.randrange(count)
    plates = []
    for index, (start, end) in enumerate(zip(cuts, cuts[1:])):
        lean, yaw = blade['lean'] + rng.uniform(-.04, .04), blade['yaw'] + rng.uniform(-.02, .02)
        plates.append(dict(
            u0=start * length - blade['half'] + (rng.uniform(.1, .3) if index and rng.random() < .3 else 0),
            u1=end * length - blade['half'], shift=rng.uniform(-.07, .07), lean=lean,
            free=[side for side, free in ((-1, index == 0), (1, index == count - 1)) if free],
            height=max(1.6, blade['height'] * (1 if index == whole else rng.uniform(.6, .85))),
            # A slab's whole plate keeps its crest close to the half-vector, so every slab glints.
            tip=math.radians(rng.choice((-3, 2, 5) if index == whole else (-12, -8, 9, 12))),
            thickness=blade['thickness'] * rng.uniform(.85, 1.1),
            # Plate space is (along the slab, through its thickness, up its lean).
            frame=Matrix.Translation((blade['x'], blade['y'], 0)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(-lean, 4, 'X')))
    return plates


def cut(bm, point, normal):
    """Slice away what lies on the side `normal` points to and close the wound."""
    result = bmesh.ops.bisect_plane(bm, geom=[*bm.verts, *bm.edges, *bm.faces], plane_co=point,
                                    plane_no=normal, clear_outer=True)
    edges = [item for item in result['geom_cut'] if isinstance(item, bmesh.types.BMEdge)]
    if edges:
        bmesh.ops.edgeloop_fill(bm, edges=edges)


def build_plate(name, plate, rng):
    """A heavy titanium plate: chisel crest, slanted ends, broken corners, cleaved front."""
    frame, axes = plate['frame'], plate['frame'].to_3x3()
    u0, u1, shift, thickness = plate['u0'], plate['u1'], plate['shift'], plate['thickness']
    top, middle = plate['height'] / math.cos(plate['lean']), (u0 + u1) / 2
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1, matrix=frame @ Matrix.Translation((middle, shift, (top + 1) / 2))
                          @ Matrix.Diagonal((u1 - u0, thickness, top + 2, 1)))  # from .5 m below ground
    # The crest faces the half-vector. Tipped a few degrees off it, about the slab's
    # length, the glint softens to a sheen; a slight tip along the length keeps the
    # crest lines from running dead level.
    crest = (Matrix.Rotation(plate['tip'], 3, axes @ Vector((1, 0, 0)))
             @ Matrix.Rotation(rng.uniform(-.045, .045), 3, 'Y') @ HALF)
    cut(bm, frame @ Vector((middle, shift, top)), crest)
    # A second cut behind it leaves a crest .3 to .5 m wide, a bright edge instead of a lid.
    across = crest.cross(axes @ Vector((1, 0, 0))).normalized()
    across *= 1 if across.y > 0 else -1
    shoulder = rng.uniform(.6, .95)
    cut(bm, frame @ Vector((middle, shift, top)) + across * (rng.uniform(.3, .5) - thickness * .85),
        axes @ Vector((rng.uniform(-.05, .05), math.cos(shoulder), math.sin(shoulder))))
    # One free end of a long plate may run down to the rock as a ramp, like a flatiron.
    ramp = rng.choice(plate['free']) if u1 - u0 > 3 and rng.random() < .6 else 0
    for side, end in ((-1, u0), (1, u1)):
        slant, foot = (rng.uniform(.55, .95), rng.uniform(.3, .45)) if side == ramp else (rng.uniform(-.05, .3), .5)
        cut(bm, frame @ Vector((end, shift, top * foot)),
            axes @ Vector((side * math.cos(slant), rng.uniform(-.25, .25), math.sin(slant))))
        if side != ramp and rng.random() < .6:
            corner, size = rng.uniform(.6, 1.15), rng.uniform(.15, .5)
            cut(bm, frame @ Vector((end - side * size, shift, top - rng.uniform(0, .15))),
                axes @ Vector((side * math.cos(corner), rng.uniform(-.4, .4), math.sin(corner))))
    for _ in range(rng.randint(1, 3)):
        # A shallow cleavage plane shaves a wedge off the front, so the face breaks into facets.
        dip, turn = rng.uniform(.05, .1), rng.uniform(0, math.tau)
        cut(bm, frame @ Vector((rng.uniform(u0, u1), shift - thickness / 2, rng.uniform(.3, .9) * top)),
            axes @ Vector((math.sin(dip) * math.cos(turn), -math.cos(dip), math.sin(dip) * math.sin(turn))))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    down = axes @ Vector((0, 0, -1))
    bmesh.ops.delete(bm, geom=[face for face in bm.faces if face.normal.dot(down) > .999], context='FACES')
    # Narrow bevels become the worn bright edges of the metal; cleavage steps stay plain.
    bmesh.ops.bevel(bm, geom=[edge for edge in bm.edges if len(edge.link_faces) == 2 and edge.calc_face_angle() > .5],
                    offset=.035, offset_type='OFFSET', segments=1, profile=.5,
                    affect='EDGES', clamp_overlap=True)
    return link(name, bm, BLADE)


def build_stump(name, plate, host, rng):
    """What mining leaves of a plate: a low ragged root, sheared off just above the rock."""
    frame, down = plate['frame'], plate['frame'].to_3x3() @ Vector((0, 0, -1))
    half, span = plate['thickness'] / 2 - .04, plate['u1'] - plate['u0'] - .16
    count = max(2, round(span / .45))
    roots = []
    for index in range(count + 1):
        u = plate['u0'] + .08 + span * index / count
        # Follow the plate's front quarter down to where it enters the host rock.
        hit = host.ray_cast(frame @ Vector((u, plate['shift'] - half / 2, 8)), down)
        roots.append((u, 8 - hit[3] if hit[0] else 0))
    ceiling = sorted(root for _, root in roots)[len(roots) // 2] + .5
    bm = bmesh.new()
    rings = []
    for u, root in roots:
        root = min(root, ceiling)
        top = root + rng.uniform(.03, .22)
        rings.append([bm.verts.new(frame @ Vector((u, plate['shift'] + w, v))) for w, v in (
            (-half, root - .3), (-half, top + rng.uniform(-.08, .08)), (half, top + rng.uniform(-.08, .08)), (half, root - .3))])
    for near, far in zip(rings, rings[1:]):
        for index in range(3):
            bm.faces.new((near[index], far[index], far[index + 1], near[index + 1]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])
    return link(name, bm, STUMP)


def plan_host(blades, rng):
    """Beds (outline, top, seed, taper, lean): a low skirt, the sandstone layers
    between the slabs, a core under each slab, clinging slivers and scree at the foot.
    Every layer runs out to the round plan and stands at least 1.15 m there, so a
    Scout's tool finds rock or metal about 4 m from the center on every bearing."""
    beds = []
    center, radius = PLAN

    def bed(points, top, lean=0, taper=.1):
        # Nothing starts beyond 4.85 m, so the spread foot ends near the footprint's 5.35 m.
        points = [point * min(1, 4.85 / point.length) for point in points]
        beds.append((points, top, rng.randrange(10 ** 6), taper, lean))

    def layer(x, row, half, thickness, top, lean):
        bed(strip((x, row + (top - .6) / 2 * math.tan(lean)), half, thickness, rng), top, lean)

    bed(outline((0, center), (radius + .25, radius + .25), rng), rng.uniform(.3, .4))
    for near, far in zip(blades, blades[1:]):
        # Sandstone survives between two slabs, worn lower than both: one layer per
        # .8 m of gap, each a few beds of different heights.
        front, back = near['y'] + near['thickness'] / 2 - .12, far['y'] - far['thickness'] / 2 + .12
        # It stays .3 m under their lowest plate, or it would poke through that plate's crest.
        lowest = min(plate['height'] for plate in near['plates'] + far['plates'])
        rows = max(1, round((back - front) / .8))
        for row in range(rows):
            start, stop = (front + (back - front) * (row + shift) / rows + shift * .12 - .06 for shift in (0, 1))
            half, count = max(reach(start), reach(stop)) * rng.uniform(.88, 1), rng.randint(3, 4)
            for index in range(count):
                top = (rng.uniform(1.2, max(1.3, min(1.7, lowest - .3))) if index in (0, count - 1)
                       else max(.75, lowest * rng.uniform(.35, .65)))
                layer(half * ((index + .5) / count * 2 - 1) + rng.uniform(-.15, .15), (start + stop) / 2,
                      half / count * 1.35, stop - start, top, (near['lean'] + far['lean']) / 2)
    for index, blade in enumerate(blades):
        # The core floors the cut once a slab is mined out, and closes the row beyond the slab's ends.
        half, thickness = reach(blade['y']) * .97, max(.16, blade['thickness'] - .22)
        layer(0, blade['y'], half, thickness, rng.uniform(.5, .9), blade['lean'])
        for side in (-1, 1):
            plug = half - (blade['half'] + side * blade['x']) + .2
            layer(side * (half - plug / 2), blade['y'], plug / 2, thickness, rng.uniform(1.15, 1.3), blade['lean'])
        outer = -1 if index == 0 else 1 if index == len(blades) - 1 else 0
        for _ in range(rng.randint(1, 2) if outer else 0):
            layer(blade['x'] + rng.uniform(-.8, .8) * blade['half'], blade['y'] + outer * (blade['thickness'] / 2 + .1),
                  rng.uniform(.4, .8), .4, rng.uniform(.4, .7), blade['lean'])
    for _ in range(rng.randint(2, 4)):
        # Wind-blown sand banked against the rock breaks the round outline of the foot.
        angle = rng.uniform(0, math.tau)
        bed(outline((math.cos(angle) * 3.5, center + math.sin(angle) * 3.5), (rng.uniform(1, 1.4), rng.uniform(.9, 1.2)), rng),
            rng.uniform(.45, .75), taper=.6)
    for _ in range(rng.randint(6, 9)):
        angle, distance = rng.uniform(0, math.tau), rng.uniform(4.2, 4.5)
        bed(outline((math.cos(angle) * distance, math.sin(angle) * distance),
                    (rng.uniform(.2, .42), rng.uniform(.16, .3)), rng), rng.uniform(.15, .45), taper=.3)
    return beds


def fuse(beds, seed):
    """Union the beds through a voxel remesh, then weather the surface."""
    bm = bmesh.new()
    for bed in beds:
        add_prism(bm, *bed)
    obj = link('host rock', bm, HOST, smooth=True)
    activate(obj)
    remesh = obj.modifiers.new('Fuse beds', 'REMESH')
    remesh.mode, remesh.voxel_size, remesh.adaptivity, remesh.use_smooth_shade = 'VOXEL', .06, 0, True
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    smooth(bm, .35)
    bm.normal_update()
    shift = Vector((seed * .71, seed * .37, seed * .53))
    bedding = Vector((0, -math.cos(LEAN), math.sin(LEAN)))
    moves = []
    for vertex in bm.verts:
        point, normal = vertex.co + shift, vertex.normal
        relief = noise.fractal(point * .45, .6, 2.0, 3) * .16 * (1 - .3 * max(0, normal.z))
        relief += noise.noise(point * 1.7) * .05
        # Joints cross the beds every meter or so and break them into blocks.
        joint = (vertex.co.x + noise.noise(Vector((point.y * 1.3, point.z * .6, seed))) * .9) / 1.1
        relief -= math.exp(-((joint % 1 - .5) / .09) ** 2) * .09
        # Bedding planes run parallel to the slabs: softer beds have worn back between harder ones.
        phase = (vertex.co.dot(bedding) + noise.noise(point * .33) * .12) / .34
        relief -= math.exp(-((phase % 1 - .5) / .16) ** 2) * .07 * (1 - normal.dot(bedding) ** 2)
        move = normal * relief
        outward = Vector((normal.x, normal.y, 0))
        if vertex.co.z < .55 and outward.length > .2:
            # The foot spreads, so it meets the terrain at a slant instead of a hard vertical seam.
            toe = min(1, (.55 - vertex.co.z) / .6) ** 2
            move += outward.normalized() * toe * .4 * (1 + noise.noise(point * 2.3) * .4)
        moves.append(move)
    for vertex, move in zip(bm.verts, moves):
        vertex.co += move
    smooth(bm, .2)
    # Nobody sees the underside.
    bmesh.ops.delete(bm, geom=[face for face in bm.faces if all(vertex.co.z < -.5 for vertex in face.verts)],
                     context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def tree(objects):
    vertices, polygons = [], []
    for obj in objects:
        offset = len(vertices)
        vertices += [vertex.co.copy() for vertex in obj.data.vertices]
        polygons += [[offset + index for index in polygon.vertices] for polygon in obj.data.polygons]
    return BVHTree.FromPolygons(vertices, polygons)


def workface(bvh, radius=FOOTPRINT_RADIUS):
    """Replay the game's mining contact from every bearing: a Scout just outside the
    blocked circle aims at the center, at heights .65, .35 and 1.1 m, and its tool
    touches the first surface hit. Yields (bearing, distance from center, face index)."""
    for bearing in range(0, 360, 5):
        angle = math.radians(bearing)
        origin = Vector((math.cos(angle) * (radius + .8), math.sin(angle) * (radius + .8), 1))
        for height in (.65, .35, 1.1):
            # The game sinks the model .05 m into the ground.
            point, _, index, _ = bvh.ray_cast(origin, (Vector((0, 0, height + .05)) - origin).normalized())
            if point:
                yield bearing, math.hypot(point.x, point.y), index
                break
        else:
            yield bearing, 0, None


class Graph:
    """Small helpers for the procedural source materials."""

    def __init__(self, name):
        self.material = bpy.data.materials.new(name)
        self.material.use_nodes = True
        self.nodes, self.links = self.material.node_tree.nodes, self.material.node_tree.links
        self.shader = self.nodes.get('Principled BSDF')
        geometry = self.nodes.new('ShaderNodeNewGeometry')
        self.position = geometry.outputs['Position']
        self.height, self.up = self.axis(self.position), self.axis(geometry.outputs['Normal'])

    def axis(self, vector):
        node = self.nodes.new('ShaderNodeSeparateXYZ')
        self.links.new(vector, node.inputs[0])
        return node.outputs['Z']

    def set(self, value, socket):
        if isinstance(value, (int, float)):
            socket.default_value = value
        elif isinstance(value, tuple):
            socket.default_value = (*value, 1) if len(value) == 3 and socket.type == 'RGBA' else value
        else:
            self.links.new(value, socket)

    def math(self, operation, a, b=0.):
        node = self.nodes.new('ShaderNodeMath')
        node.operation = operation
        self.set(a, node.inputs[0])
        self.set(b, node.inputs[1])
        return node.outputs[0]

    def mix(self, factor, a, b, blend='MIX'):
        node = self.nodes.new('ShaderNodeMixRGB')
        node.blend_type = blend
        for value, socket in zip((factor, a, b), node.inputs):
            self.set(value, socket)
        return node.outputs[0]

    def ramp(self, source, stops):
        node = self.nodes.new('ShaderNodeValToRGB')
        elements = node.color_ramp.elements
        for index, (position, color) in enumerate(stops):
            element = elements[index] if index < 2 else elements.new(position)
            element.position, element.color = position, (*color, 1)
        self.set(source, node.inputs['Fac'])
        return node.outputs['Color']

    def remap(self, value, low, high, to=(0, 1)):
        node = self.nodes.new('ShaderNodeMapRange')
        node.interpolation_type, node.clamp = 'SMOOTHSTEP', True
        self.set(value, node.inputs['Value'])
        node.inputs['From Min'].default_value, node.inputs['From Max'].default_value = low, high
        node.inputs['To Min'].default_value, node.inputs['To Max'].default_value = to
        return node.outputs['Result']

    def slab_space(self, sizes):
        """Position in the rank's mean plate space (along, through, up the lean), in
        units of `sizes` meters, so noise can run in streaks along the slabs."""
        node = self.nodes.new('ShaderNodeMapping')
        node.vector_type = 'TEXTURE'
        node.inputs['Rotation'].default_value = (-LEAN, 0, 0)
        node.inputs['Scale'].default_value = sizes
        self.links.new(self.position, node.inputs['Vector'])
        return node.outputs['Vector']

    def noise(self, scale, detail=3., vector=None):
        node = self.nodes.new('ShaderNodeTexNoise')
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = detail
        node.inputs['Roughness'].default_value = .62
        self.links.new(vector or self.position, node.inputs['Vector'])
        return node.outputs['Fac']

    def jitter(self, value, scale, amount):
        """Offset a mask by centered noise, so thresholds wander naturally."""
        return self.math('ADD', value, self.math('MULTIPLY', self.math('SUBTRACT', self.noise(scale, 4), .5), amount))

    def box_image(self, path, meters):
        """Seamless object-space projection. The group hides the image node from the
        baker, which would otherwise rewire it to source UVs."""
        key = f'{Path(path).stem} every {meters} m'
        group = bpy.data.node_groups.get(key)
        if group is None:
            group = bpy.data.node_groups.new(key, 'ShaderNodeTree')
            group.interface.new_socket('Color', in_out='OUTPUT', socket_type='NodeSocketColor')
            coordinates = group.nodes.new('ShaderNodeTexCoord')
            mapping = group.nodes.new('ShaderNodeMapping')
            mapping.inputs['Scale'].default_value = (1 / meters,) * 3
            image = group.nodes.new('ShaderNodeTexImage')
            image.image = bpy.data.images.load(str(ROOT / path), check_existing=True)
            image.projection, image.projection_blend = 'BOX', .3
            output = group.nodes.new('NodeGroupOutput')
            group.links.new(coordinates.outputs['Object'], mapping.inputs['Vector'])
            group.links.new(mapping.outputs['Vector'], image.inputs['Vector'])
            group.links.new(image.outputs['Color'], output.inputs['Color'])
        node = self.nodes.new('ShaderNodeGroup')
        node.node_tree = group
        return node.outputs['Color']

    def luma(self, color):
        node = self.nodes.new('ShaderNodeRGBToBW')
        self.links.new(color, node.inputs[0])
        return node.outputs[0]

    def masks(self):
        attribute = self.nodes.new('ShaderNodeAttribute')
        attribute.attribute_name = 'Masks'
        channels = self.nodes.new('ShaderNodeSeparateColor')
        self.links.new(attribute.outputs['Color'], channels.inputs['Color'])
        return channels.outputs['Red'], channels.outputs['Green']

    def bump(self, height, strength, distance, normal=None):
        node = self.nodes.new('ShaderNodeBump')
        self.set(strength, node.inputs['Strength'])
        node.inputs['Distance'].default_value = distance
        self.set(height, node.inputs['Height'])
        if normal:
            self.links.new(normal, node.inputs['Normal'])
        return node.outputs['Normal']

    def sand(self, settled):
        """The ground's own sand and a mask of where it lies: `settled` plus level ledges."""
        ledge = self.math('MULTIPLY', self.remap(self.up, .4, .8), self.remap(self.height, .5, 1.6, (1, .3)))
        drift = self.remap(self.jitter(self.math('MAXIMUM', settled, ledge), 3.5, .5), .38, .62)
        return self.mix(1, self.box_image(SAND_COLOR, 30), GROUND_TINT, 'MULTIPLY'), drift


def rock_material():
    """The terrain's own oxide cliff and scree, bedded parallel to the slabs, sand at the foot."""
    graph = Graph('Blades / sandstone and sand')
    beds = graph.noise(1, 2, graph.slab_space((4, .17, 4)))
    stone = graph.mix(graph.remap(graph.noise(.35), .45, .7), graph.box_image(CLIFF_COLOR, 8),
                      graph.box_image(SCREE_COLOR, 6))
    # Harder beds are paler, softer ones darker.
    stone = graph.mix(1, stone, graph.ramp(beds, [(.3, (.74, .72, .7)), (.7, (1.12, 1.1, 1.06))]), 'MULTIPLY')
    sand, drift = graph.sand(graph.remap(graph.height, .02, .4, (1, 0)))
    graph.set(graph.mix(drift, stone, sand), graph.shader.inputs['Base Color'])
    graph.shader.inputs['Roughness'].default_value = .9
    grain = graph.luma(graph.box_image(CLIFF_SCAN, 2.4))
    normal = graph.bump(graph.math('ADD', grain, graph.math('MULTIPLY', beds, .6)), .8, .1)
    graph.links.new(graph.bump(graph.noise(14, 2), .15, .02, normal), graph.shader.inputs['Normal'])
    return graph.material


def ore_material():
    """Cool blue steel. The game has no reflections, so each facet's brightness is baked
    into its color; only crests get enough metalness and polish to mirror the sun."""
    graph = Graph('Blades / titanium')
    tone, gloss = graph.masks()
    streak = graph.noise(1, 3, graph.slab_space((.45, .6, 3)))
    shade = graph.math('ADD', graph.jitter(tone, .7, .12), graph.math('MULTIPLY', graph.math('SUBTRACT', streak, .5), .32))
    steel = graph.ramp(shade, [(0, SHADOW), (.45, MID), (1, LIGHT)])
    # Hairline fractures: the slabs are broken mineral, not rolled sheet.
    cells = graph.nodes.new('ShaderNodeTexVoronoi')
    cells.feature = 'DISTANCE_TO_EDGE'
    cells.inputs['Scale'].default_value = 1
    graph.links.new(graph.slab_space((2.6, .7, 1.9)), cells.inputs['Vector'])
    cracks = graph.remap(graph.jitter(cells.outputs['Distance'], 2, .02), .0, .012, (1, 0))
    steel = graph.mix(graph.math('MULTIPLY', cracks, .4), steel, SHADOW)
    # Sandstone dust clings to the lowest part, where the plates leave the rock.
    dust = graph.math('MULTIPLY', graph.remap(graph.jitter(graph.height, 2.5, .8), .5, 1.3, (1, 0)), .35)
    graph.set(graph.mix(dust, steel, (.45, .29, .17)), graph.shader.inputs['Base Color'])
    graph.set(graph.math('ADD', .18, graph.math('MULTIPLY', gloss, .27)), graph.shader.inputs['Metallic'])
    graph.set(graph.math('ADD', graph.math('SUBTRACT', .5, graph.math('MULTIPLY', gloss, .08)),
                         graph.math('MULTIPLY', graph.math('SUBTRACT', streak, .5), .12)),
              graph.shader.inputs['Roughness'])
    graph.links.new(graph.bump(graph.math('SUBTRACT', streak, cracks), .15, .012), graph.shader.inputs['Normal'])
    return graph.material


def stump_material():
    """Dark matte roots with sand settling on them: nothing left to catch the eye."""
    graph = Graph('Blades / sheared roots')
    root = graph.ramp(graph.noise(2.2), [(.3, (.03, .035, .045)), (.7, (.085, .095, .115))])
    sand, drift = graph.sand(0)
    graph.set(graph.mix(drift, root, sand), graph.shader.inputs['Base Color'])
    graph.shader.inputs['Roughness'].default_value = .93
    graph.links.new(graph.bump(graph.noise(9, 3), .4, .02), graph.shader.inputs['Normal'])
    return graph.material


def shade_plate(obj, rng):
    """Give each facet its own steel tone, and mark the facets that face the half-vector."""
    vertices, masks = obj.data.vertices, []
    for polygon in obj.data.polygons:
        corners = [vertices[index].co for index in polygon.vertices]
        perimeter = sum((a - b).length for a, b in zip(corners, corners[1:] + corners[:1]))
        normal = polygon.normal
        gloss = min(1, max(0, (normal.dot(HALF) - .955) / .02))
        # Each facet picks the brightness it should show in game and divides out the light it
        # will get there (about .3 of its color in shade, 2.5 facing the sun). Faces stay dark
        # steel, because paler ones read as ice; crests and worn edges supply the silver.
        albedo = (rng.uniform(.1, .24) + .5 * gloss) / (.3 + 2.2 * max(0, normal.dot(SUN.normalized())))
        tone = .45 * (albedo - .06) / .2 if albedo < .26 else .45 + .55 * (albedo - .26) / .52
        # Bevel strips are the worn edges: near-white and half polished.
        masks.append((.92, max(gloss, .5)) if polygon.area / perimeter < .03 else (tone, gloss))
    paint(obj, masks)


def decimate(obj, triangles):
    obj.data.calc_loop_triangles()
    activate(obj)
    modifier = obj.modifiers.new('Runtime budget', 'DECIMATE')
    modifier.ratio = min(1, triangles / len(obj.data.loop_triangles))
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def export_state(baked, name, hidden):
    """Write the baked mesh without the faces of the part this state does not show."""
    obj = baked.copy()
    obj.data = baked.data.copy()
    obj.name = f'Titanium blades / {name}'
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    part = bm.faces.layers.int['part']
    bmesh.ops.delete(bm, geom=[face for face in bm.faces if face[part] == hidden], context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    activate(obj)
    path = OUT / f'{name}.glb'
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_image_format='WEBP', export_image_quality=85,
                              export_vertex_color='NONE')
    obj.data.calc_loop_triangles()
    entry = dict(path=str(path.relative_to(ROOT)), bytes=path.stat().st_size, triangles=len(obj.data.loop_triangles),
                 radius=round(max(math.hypot(v.co.x, v.co.y) for v in obj.data.vertices), 3),
                 height=round(max(v.co.z for v in obj.data.vertices), 3))
    if hidden == STUMP:
        # Only a deposit that still holds ore is mined.
        parts = [item.value for item in obj.data.attributes['part'].data]
        hits = list(workface(tree([obj])))
        entry['workface'] = dict(least_reach=round(min(distance for _, distance, _ in hits), 2),
                                 bearings_on_ore=sum(parts[index] == BLADE for _, _, index in hits if index is not None),
                                 bearings=len(hits))
    return entry


bpy.ops.wm.read_factory_settings(use_empty=False)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(args.seed)
blades = plan_blades(rng)
plates = [plate for blade in blades for plate in blade['plates']]
metal = [build_plate(f'plate {index + 1}', plate, rng) for index, plate in enumerate(plates)]
beds = plan_host(blades, rng)
host = fuse(beds, args.seed)
reach_now = max(math.hypot(v.co.x, v.co.y) for v in host.data.vertices)
# Where a Scout's tool would reach deeper than 3.5 m into the finished model, pile a
# block of rubble: the game needs solid surface around the middle from every bearing.
blocks = []
for bearing, distance, _ in workface(tree([host, *metal]), reach_now):
    if distance < 3.53 * reach_now / FOOTPRINT_RADIUS and not any(abs(bearing - other) < 10 for other in blocks):
        blocks.append(bearing)
        angle = math.radians(bearing)
        beds.append((strip((math.cos(angle) * 3.9, math.sin(angle) * 3.9), .7, .6, rng), rng.uniform(1.25, 1.5),
                     rng.randrange(10 ** 6), .12, LEAN))
if blocks:
    bpy.data.objects.remove(host)
    host = fuse(beds, args.seed)
host_tree = tree([host])
stumps = [build_stump(f'stump {index + 1}', plate, host_tree, rng) for index, plate in enumerate(plates)]
parts = [host, *metal, *stumps]
scale = FOOTPRINT_RADIUS / max(math.hypot(v.co.x, v.co.y) for v in host.data.vertices)
for part in parts:
    part.data.transform(Matrix.Scale(scale, 4))
    part.data.update()
decimate(host, HOST_TRIANGLES)
# Crisp fracture edges instead of one soft skin.
host.data.set_sharp_from_angle(angle=math.radians(38))
tag(host, HOST)
for part in (host, *stumps):
    paint(part, [(0, 0)] * len(part.data.polygons))
for plate in metal:
    shade_plate(plate, rng)
materials = rock_material(), ore_material(), stump_material()
for part in parts:
    part.data.materials.append(materials[part.data.attributes['part'].data[0].value])
print('TITANIUM_BLADES', json.dumps(dict(seed=args.seed, slabs=len(blades), plates=len(plates), scale=round(scale, 3),
                                         rubble_blocks=blocks)), flush=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'source.blend'))
if not args.draft:
    # The topology is final before the bake, and both states are cut from the one
    # baked mesh, so they share its atlas.
    baked = bake_runtime(parts, OUT, size=1024, name='Titanium blades')
    shader = baked.data.materials[0].node_tree.nodes.get('Principled BSDF')
    # Ore is nonemissive. Omit the baker's unused black emission map from export.
    for link_ in list(shader.inputs['Emission Color'].links):
        baked.data.materials[0].node_tree.links.remove(link_)
    shader.inputs['Emission Strength'].default_value = 0
    # Texels between UV islands bake black. Give them the rock's median values, and clear
    # the contact shading the baker leaves in the roughness map's unused red channel: that
    # halves the roughness map's bytes and bleeds no dark halo into small mips.
    for name in ('runtime-color', 'runtime-orm'):
        image = bpy.data.images[name]
        pixels = numpy.empty(len(image.pixels), dtype=numpy.float32)
        image.pixels.foreach_get(pixels)
        pixels = pixels.reshape(-1, 4)
        if name == 'runtime-orm':
            pixels[:, 0] = 1
        unbaked = pixels[:, 1] == 0
        pixels[unbaked, :3] = numpy.median(pixels[~unbaked, :3], axis=0)
        # The exporter reads a packed image's stale bytes, so keep only the saved file.
        image.unpack(method='REMOVE')
        image.pixels.foreach_set(pixels.ravel())
        image.save()
    baked.data.validate()
    states = dict(full=export_state(baked, 'full', STUMP), depleted=export_state(baked, 'depleted', BLADE))
    entry = dict(generator='tools/assets/build_titanium_blades.py', seed=args.seed, slabs=len(blades),
                 format='1 mesh, 1 standard PBR material, 1024px WebP color/normal/roughness-metallic', **states)
    (OUT / 'export.json').write_text(json.dumps(entry, indent=2) + '\n')
    print('TITANIUM_EXPORT', json.dumps(entry), flush=True)
