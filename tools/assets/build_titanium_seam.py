"""Author the "Seam" Titanium Deposit: the terrain's own rock, marked by bold metal bands.

box 'blender --background --threads 6 --python-exit-code 1 --python tools/assets/build_titanium_seam.py -- [--seed 1] [--out art/workbench/titanium-seam] [--draft]'

A low outcrop of oxide sandstone is crossed by two thick titanium seams that share
one dip. The metal is harder than the stone, so each seam stands proud as a ledge and
the stone has weathered back between them. The game's camera, sun and model
orientation never change, so the dip is the half-vector between sun and camera: every
seam's upper face shows a real sun glint without any runtime shader work.

`--seed` composes a different outcrop from the same code. `--out` receives `full.glb`,
`depleted.glb` (the same rock with the seams dug out), the editable `source.blend`
and `export.json`, which records the triangle counts and a survey of the full
deposit: how close the mining rays' first hits come to the center, and the share of
the camera's view that is ore. Both GLBs are subsets of one baked mesh and share its
1024 px atlas. `--draft` stops after the survey and the source, without baking.
Review candidates in the game with `bun tools/verify/capture-ore.mjs --model <glb> --out <dir>`.
"""
import argparse
import json
import math
from pathlib import Path
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector
from mathutils import noise
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/assets'))
from building_bake import bake_runtime

CLIFF_COLOR = 'assets/textures/terrain/oxide-cliff-color.webp'
SCREE_COLOR = 'assets/textures/terrain/oxide-scree-color.webp'
CLIFF_GRAIN = 'assets/source/polyhaven/titanium/cliff_side_diff_2k.jpg'
GROUND_COLOR = 'assets/textures/terrain/sand-scan.webp'
# The main game multiplies its 30 m sand tile by hsl(29, 94%, 75%); linear RGB here.
GROUND_TINT = (.966, .51, .228)
# The game scales a model so its widest reach equals the deposit's blocked radius.
# Fallen blocks, which both states keep, hold that reach; the seamed body stays inside it.
FOOTPRINT_RADIUS = 5.35
BODY_RADIUS = 5.15
# Bedding normal: the half-vector between the game's fixed sun and camera, in Blender axes.
DIP = Vector((.006, -.506, .862)).normalized()
# Direction from the scene toward the game's fixed orthographic camera.
CAMERA = Vector((.528, -.528, .666)).normalized()
# How far the stone has weathered back from the seams' faces, sideways and on top.
LEDGE, DROP = .25, .15
# Face tags: the host rock shows in both states, the ore only while the deposit is
# full, the empty slots and their rubble only once it is depleted.
ROCK, ORE, SPENT = 0, 1, 2
STONE, CUT, HIDDEN = 0, 1, 2
TRIANGLES = dict(rock=6000, ore=2000, inner=500, block=200)

parser = argparse.ArgumentParser()
parser.add_argument('--seed', type=int, default=1, help='composes a different outcrop of the same design')
parser.add_argument('--out', type=Path, default=ROOT / 'art/workbench/titanium-seam')
parser.add_argument('--draft', action='store_true', help='save the editable source without baking')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = args.out.resolve()


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def link(name, bm):
    data = bpy.data.meshes.new(name)
    bm.to_mesh(data)
    bm.free()
    for polygon in data.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return obj


def edit(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    return bm


def smooth(bm, repeat, factor):
    for _ in range(repeat):
        bmesh.ops.smooth_vert(bm, verts=list(bm.verts), factor=factor,
                              use_axis_x=True, use_axis_y=True, use_axis_z=True)


def lobe(rng, center, radius, top, corners, spread, taper):
    """One bed of the outcrop: an irregular polygon whose walls lean inward toward its top."""
    turn = rng.uniform(0, math.tau)
    points = []
    for index in range(corners):
        angle = turn + math.tau * (index + rng.uniform(-.3, .3)) / corners
        reach = radius * rng.uniform(*spread)
        points.append(Vector((center[0] + math.cos(angle) * reach, center[1] + math.sin(angle) * reach)))
    return dict(points=points, top=top, leans=[taper * rng.uniform(.5, 1.5) for _ in points],
                tilt=(rng.uniform(-.05, .05), rng.uniform(-.05, .05)))


def layout(rng):
    """A wide low bed ringed by taller crags and lower benches."""
    lobes = [lobe(rng, (rng.uniform(-.2, .2), rng.uniform(-.2, .2)), 4.8, rng.uniform(1.5, 1.9), 12, (.96, 1.04), .06)]
    count = rng.choice((3, 4))
    tops = [rng.uniform(2.5, 3), rng.uniform(1.1, 1.3), rng.uniform(2, 2.4), rng.uniform(1.2, 2.6)]
    rng.shuffle(tops)
    start = rng.uniform(0, math.tau)
    for index in range(count):
        angle = start + math.tau * (index + rng.uniform(-.2, .2)) / count
        radius = rng.uniform(2.2, 2.9)
        distance = 4.95 - radius - rng.uniform(0, .4)
        lobes.append(lobe(rng, (math.cos(angle) * distance, math.sin(angle) * distance), radius, tops[index],
                          rng.randint(7, 9), (.88, 1.08), rng.uniform(.1, .2)))
    return lobes


def add_lobe(bm, spec, inset, drop, bottom):
    """A closed prism, moved `inset` inward and `drop` down so several can nest."""
    points = spec['points']
    centroid = sum(points, Vector((0, 0))) / len(points)
    points = [centroid + (point - centroid) * max(.2, 1 - inset / (point - centroid).length) for point in points]
    top = spec['top'] - drop
    pivot = Vector((centroid.x, centroid.y, spec['top'] / 2))
    rotation = Matrix.Rotation(spec['tilt'][0], 3, 'X') @ Matrix.Rotation(spec['tilt'][1], 3, 'Y')
    rings = [[bm.verts.new(pivot + rotation @ Vector((*((point - centroid) * (1 - lean * f)), z - pivot.z)))
              for point, lean in zip(points, spec['leans'])]
             for z, f in [(bottom, 0), (bottom + (top - bottom) * .55, .35), (top, 1)]]
    for lower, upper in zip(rings, rings[1:]):
        for index in range(len(points)):
            bm.faces.new((lower[index - 1], lower[index], upper[index], upper[index - 1]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])


def weather(bm, relief, toe, shift):
    """Wear hollows, bedding grooves and joints into a fused rock; all bite inward so
    nested rocks stay nested. The foot spreads to meet the terrain at a slant."""
    bm.normal_update()
    moves = []
    for vertex in bm.verts:
        point, normal = vertex.co + shift, vertex.normal
        wear = (noise.fractal(point * .28, 1, 2, 2) - .35) * .2 * (1 - .55 * max(0, normal.z))
        wear += noise.fractal(point * .9, .7, 2, 3) * .07
        # Softer beds weather back into grooves that follow the seams' dip.
        bed = (vertex.co.dot(DIP) + noise.noise(point * .3) * .12) / .55
        wear -= math.exp(-((bed % 1 - .5) / .16) ** 2) * .1 * (1 - normal.dot(DIP) ** 2)
        # Near-vertical joints split the mass into blocks.
        joint = noise.noise(Vector((point.x, point.y, point.z * .15)) * .42)
        wear -= math.exp(-(joint / .05) ** 2) * .16
        # The buried underside stays flat, clear of the inner walls' higher floors.
        move = normal * max(-.3, min(.1, wear * relief)) * (normal.z > -.5)
        outward = Vector((normal.x, normal.y, 0))
        if vertex.co.z < .5 and outward.length > .2:
            spread = min(1, (.5 - max(0, vertex.co.z)) / .5) ** 2
            move += outward.normalized() * spread * toe * (1 + noise.noise(point * 2.3) * .4)
        moves.append(move)
    for vertex, move in zip(bm.verts, moves):
        vertex.co += move


def fuse(name, lobes, inset=0., drop=0., voxel=.06, relief=0., toe=0., shift=Vector(), bottom=-.62):
    """Union the lobes through a voxel remesh, then weather the surface."""
    bm = bmesh.new()
    for spec in lobes:
        add_lobe(bm, spec, inset, drop, bottom)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    obj = link(name, bm)
    activate(obj)
    remesh = obj.modifiers.new('Fuse beds', 'REMESH')
    remesh.mode, remesh.voxel_size, remesh.adaptivity, remesh.use_smooth_shade = 'VOXEL', voxel, 0, True
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    bm = edit(obj)
    smooth(bm, 2, .5)
    if relief or toe:
        weather(bm, relief, toe, shift)
        smooth(bm, 1, .3)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def shell(outer, inner):
    """A hollow copy of `outer` whose inside wall is `inner`: a cut through it fills as
    a ring, so the atlas spends little on cut faces buried deep in the rock."""
    bm = edit(outer)
    count = len(bm.faces)
    bm.from_mesh(inner.data)
    bm.faces.ensure_lookup_table()
    inside = bm.faces[count:]
    for face in inside:
        face.material_index = HIDDEN
    bmesh.ops.reverse_faces(bm, faces=inside)
    return bm


def between(source, low, high, fill=True):
    """The slice of a mesh between two bedding offsets (None is unbounded). Cut faces
    are filled and marked CUT; a shell's inside wall is dropped."""
    bm = source.copy()
    for offset, side in ((low, 1), (high, -1)):
        if offset is None:
            continue
        cut = bmesh.ops.bisect_plane(bm, geom=[*bm.verts, *bm.edges, *bm.faces], dist=1e-5, plane_co=DIP * offset,
                                     plane_no=DIP, clear_inner=side > 0, clear_outer=side < 0)['geom_cut']
        edges = [item for item in cut if isinstance(item, bmesh.types.BMEdge)]
        if not fill or not edges:
            continue
        for face in bmesh.ops.triangle_fill(bm, use_beauty=True, edges=edges)['geom']:
            if isinstance(face, bmesh.types.BMFace):
                face.material_index = CUT
                face.normal_update()
                if face.normal.dot(DIP) * side > 0:
                    face.normal_flip()
    bmesh.ops.delete(bm, geom=[face for face in bm.faces if face.material_index == HIDDEN], context='FACES')
    return bm


def merge(name, slices):
    """Join slices into one object, dropping the walls far below the ground line."""
    bm = bmesh.new()
    for part in slices:
        data = bpy.data.meshes.new('slice')
        part.to_mesh(data)
        part.free()
        bm.from_mesh(data)
        bpy.data.meshes.remove(data)
    bmesh.ops.bisect_plane(bm, geom=[*bm.verts, *bm.edges, *bm.faces], dist=1e-5, plane_co=(0, 0, -.42),
                           plane_no=(0, 0, 1), clear_inner=True)
    return link(name, bm)


def decimate(obj, triangles):
    obj.data.calc_loop_triangles()
    activate(obj)
    modifier = obj.modifiers.new('Runtime budget', 'DECIMATE')
    modifier.ratio = min(1, triangles / len(obj.data.loop_triangles))
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def crease(obj, angle=math.pi):
    """Sharpen the edges of cut faces, so they stay clean planes, and any edge that
    turns more than `angle`, which keeps the metal's facets crisp."""
    bm = edit(obj)
    for edge in bm.edges:
        edge.smooth = (len({face.material_index for face in edge.link_faces}) == 1
                       and edge.calc_face_angle(0) < angle)
    bm.to_mesh(obj.data)
    bm.free()


def stones(name, sites, rng):
    """Angular fragments; each site is (position, radius)."""
    bm = bmesh.new()
    for position, radius in sites:
        turn = Euler([rng.uniform(0, math.tau) for _ in range(3)]).to_matrix().to_4x4()
        squash = Matrix.Diagonal((1, rng.uniform(.6, .9), rng.uniform(.45, .7), 1))
        made = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius,
                                          matrix=Matrix.Translation(position) @ turn @ squash)
        for vertex in made['verts']:
            vertex.co += Vector([rng.uniform(-.2, .2) * radius for _ in range(3)])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    obj = link(name, bm)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    return obj


def camera_hits(tree):
    """Where the game's fixed camera sees a mesh above the ground, sampled every 0.1 m:
    (point, face index)."""
    side = CAMERA.cross(Vector((0, 0, 1))).normalized()
    up = side.cross(CAMERA)
    for column in range(-70, 71):
        for row in range(-70, 71):
            point, _, face, _ = tree.ray_cast(CAMERA * 30 + (side * column + up * row) * .1, -CAMERA)
            if point and point.z > 0:
                yield point, face


def place_seams(envelope, rng):
    """Bedding offsets (low, high) of two seams, centered on the first and last
    quarter of what the camera sees of the outcrop, so both cross its visible faces.
    The camera looks almost straight down the dip: with their ledges and upper faces,
    two 0.4 to 0.5 m seams already fill 35 to 50% of the view, and a third seam or
    thicker ones leave the outcrop mostly metal."""
    bm = edit(envelope)
    offsets = sorted(point.dot(DIP) for point, _ in camera_hits(BVHTree.FromBMesh(bm)))
    bm.free()
    seams = []
    for quarter in (.25, .75):
        middle, thickness = offsets[int(len(offsets) * (quarter + rng.uniform(-.1, .1)))], rng.uniform(.4, .5)
        seams.append((middle - thickness / 2, middle + thickness / 2))
    return seams


def reach(obj):
    return max(math.hypot(vertex.co.x, vertex.co.y) for vertex in obj.data.vertices)


def dust(point, normal):
    """A thin, patchy dusting of sand where walls meet the terrain and on low shelves."""
    return min(1, max(0, normal.z - .45) * 1.8 * max(0, 1 - point.z / .9) + .75 * max(0, 1 - (point.z + .1) / .5))


def paint(obj, corner_masks, states):
    """Store (tone, dust, polish) per corner and the state tag per face, plus the
    source UV the baker expects."""
    obj.data.color_attributes.new('Masks', 'FLOAT_COLOR', 'CORNER').data.foreach_set(
        'color', [channel for masks in corner_masks for channel in (*masks, 1)])
    obj.data.attributes.new('state', 'INT', 'FACE').data.foreach_set('value', states)
    obj.data.uv_layers.new(name='SourceUV')


def paint_rock(obj):
    vertices = obj.data.vertices
    paint(obj, [(0, dust(vertices[loop.vertex_index].co, vertices[loop.vertex_index].normal), 0)
                for loop in obj.data.loops],
          [SPENT if polygon.material_index == CUT else ROCK for polygon in obj.data.polygons])


def paint_ore(obj, shift):
    """Each facet gets its own tone; the seams' upper bedding faces are wind-polished
    and their undersides stay dark. Tones stay in the dark half of the steel ramp:
    paler metal reads as ice in game, and the sun and worn edges supply the silver."""
    masks = []
    for polygon in obj.data.polygons:
        up, facet = polygon.normal.dot(DIP), noise.noise(polygon.center * .8 + shift)
        if polygon.material_index == CUT:
            tone, polish = (.3 + facet * .1, 1) if up > 0 else (.12, 0)
        else:
            tone, polish = .28 + facet * .2, 0
        masks += [(tone, dust(obj.data.vertices[vertex].co, polygon.normal) * .8, polish) for vertex in polygon.vertices]
        polygon.material_index = 0
    paint(obj, masks, [ORE] * len(obj.data.polygons))


class Graph:
    """Small helpers for the procedural source materials."""

    def __init__(self, name):
        self.material = bpy.data.materials.new(name)
        self.material.use_nodes = True
        self.nodes, self.links = self.material.node_tree.nodes, self.material.node_tree.links
        self.shader = self.nodes.get('Principled BSDF')
        self.geometry = self.nodes.new('ShaderNodeNewGeometry')
        self.position = self.geometry.outputs['Position']

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

    def vector(self, operation, other):
        node = self.nodes.new('ShaderNodeVectorMath')
        node.operation = operation
        self.links.new(self.position, node.inputs[0])
        node.inputs[1].default_value = other
        return node.outputs['Value' if operation == 'DOT_PRODUCT' else 'Vector']

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

    def remap(self, value, low, high):
        node = self.nodes.new('ShaderNodeMapRange')
        node.interpolation_type, node.clamp = 'SMOOTHSTEP', True
        self.set(value, node.inputs['Value'])
        node.inputs['From Min'].default_value, node.inputs['From Max'].default_value = low, high
        return node.outputs['Result']

    def noise(self, scale, detail=3., vector=None, output='Fac'):
        node = self.nodes.new('ShaderNodeTexNoise')
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = detail
        node.inputs['Roughness'].default_value = .62
        self.links.new(vector or self.position, node.inputs['Vector'])
        return node.outputs[output]

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
        return channels.outputs['Red'], channels.outputs['Green'], channels.outputs['Blue']

    def bump(self, height, strength, distance, normal=None):
        node = self.nodes.new('ShaderNodeBump')
        self.set(strength, node.inputs['Strength'])
        node.inputs['Distance'].default_value = distance
        self.set(height, node.inputs['Height'])
        if normal:
            self.links.new(normal, node.inputs['Normal'])
        return node.outputs['Normal']

    def sand(self, dust):
        """The terrain's sand color and where the dust mask lets it settle."""
        return (self.mix(1, self.box_image(GROUND_COLOR, 30), GROUND_TINT, 'MULTIPLY'),
                self.remap(self.jitter(dust, 3.5, .4), .38, .62))


def stone_material():
    """The cliffs' own photograph, a little denser than on their 12 m faces, with scree
    patches and thin dark partings along the dip that tie the stone to its seams."""
    graph = Graph('Seam / host sandstone')
    _, dust, _ = graph.masks()
    stone = graph.mix(graph.remap(graph.noise(.4), .5, .75), graph.box_image(CLIFF_COLOR, 8),
                      graph.box_image(SCREE_COLOR, 5))
    bedding = graph.jitter(graph.vector('DOT_PRODUCT', tuple(DIP)), .5, .5)
    parting = graph.remap(graph.math('SINE', graph.math('MULTIPLY', bedding, math.tau / .34)), .7, 1)
    stone = graph.mix(graph.math('MULTIPLY', parting, .4), stone, (.2, .12, .08), 'MULTIPLY')
    sand, drift = graph.sand(dust)
    graph.set(graph.mix(drift, stone, sand), graph.shader.inputs['Base Color'])
    graph.shader.inputs['Roughness'].default_value = .92
    grain = graph.luma(graph.box_image(CLIFF_GRAIN, 2.4))
    normal = graph.bump(graph.math('SUBTRACT', grain, graph.math('MULTIPLY', parting, .5)), .6, .05)
    graph.links.new(graph.bump(graph.noise(38, 2), .12, .01, normal), graph.shader.inputs['Normal'])
    return graph.material


def ore_material():
    """Cool blue steel. The game has no reflections, so brightness lives in the base
    color: a tone per facet and streaks drawn out along the strike. Polished bedding
    faces carry smooth patches that glint at the fixed half-vector."""
    graph = Graph('Seam / titanium')
    tone, dust, polish = graph.masks()
    streak = graph.noise(1, 3, graph.vector('MULTIPLY', (.15, 1.4, 1.4)))
    # The cliff photograph's grain mottles the metal, so it is as detailed as the stone.
    grain = graph.remap(graph.luma(graph.box_image(CLIFF_GRAIN, 2.4)), .05, .6)
    # Edges wear bright: wherever a rounded normal leaves the true one, an edge is near.
    bevel = graph.nodes.new('ShaderNodeBevel')
    bevel.samples, bevel.inputs['Radius'].default_value = 4, .1
    turn = graph.nodes.new('ShaderNodeVectorMath')
    turn.operation = 'DOT_PRODUCT'
    graph.links.new(bevel.outputs['Normal'], turn.inputs[0])
    graph.links.new(graph.geometry.outputs['Normal'], turn.inputs[1])
    wear = graph.remap(graph.math('SUBTRACT', 1, turn.outputs['Value']), .01, .12)
    value = graph.math('ADD', graph.math('ADD', tone, graph.math('MULTIPLY', graph.math('SUBTRACT', streak, .5), .45)),
                       graph.math('ADD', graph.math('MULTIPLY', graph.math('SUBTRACT', grain, .5), .4),
                                  graph.math('MULTIPLY', wear, .3)))
    steel = graph.ramp(value, [(0, (.04, .055, .085)), (.5, (.2, .29, .42)), (1, (.64, .75, .9))])
    sand, drift = graph.sand(dust)
    clean = graph.math('SUBTRACT', 1, drift)
    graph.set(graph.mix(drift, steel, sand), graph.shader.inputs['Base Color'])
    graph.set(graph.math('MULTIPLY', clean, graph.math('ADD', .3, graph.math('MULTIPLY', polish, .1))),
              graph.shader.inputs['Metallic'])
    # Satin .75 to smooth .48 across a polished face; any smoother and the whole face
    # burns out to flat white under the game's sun.
    patch = graph.remap(graph.noise(.8, 2, graph.vector('MULTIPLY', (.3, 1.6, 1.6))), .35, .65)
    rough = graph.math('ADD', .62, graph.math('MULTIPLY', polish, graph.math('SUBTRACT', .13, graph.math('MULTIPLY', patch, .27))))
    graph.set(graph.math('SUBTRACT', .92, graph.math('MULTIPLY', clean, graph.math('SUBTRACT', .92, rough))),
              graph.shader.inputs['Roughness'])
    normal = graph.bump(graph.noise(1.3, 2), graph.math('MULTIPLY', polish, .5), .15, bevel.outputs['Normal'])
    graph.links.new(graph.bump(grain, .3, .02, normal), graph.shader.inputs['Normal'])
    return graph.material


def cut_material():
    """The dark, matte walls of a dug-out seam."""
    graph = Graph('Seam / empty slot')
    graph.set(graph.mix(1, graph.box_image(CLIFF_COLOR, 8), (.3, .26, .24), 'MULTIPLY'), graph.shader.inputs['Base Color'])
    graph.shader.inputs['Roughness'].default_value = 1
    graph.links.new(graph.bump(graph.luma(graph.box_image(CLIFF_GRAIN, 2.4)), .3, .03), graph.shader.inputs['Normal'])
    return graph.material


def subset(baked, states, path):
    """Export the baked faces a state shows and return (triangles, reach)."""
    obj = bpy.data.objects.new(path.stem, baked.data.copy())
    bpy.context.collection.objects.link(obj)
    bm = edit(obj)
    tag = bm.faces.layers.int['state']
    bmesh.ops.delete(bm, geom=[face for face in bm.faces if face[tag] not in states], context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    activate(obj)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_image_format='WEBP', export_image_quality=85,
                              export_vertex_color='NONE')
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles), reach(obj)


def survey(parts):
    """Measure the full deposit as the game meets it. Mining rays from every bearing give
    the nearest first hit to the center and the share of bearings that first hit ore;
    rays along the fixed camera give the share of the visible outcrop that is ore."""
    bm = bmesh.new()
    for part in parts:
        bm.from_mesh(part.data)
    tag = bm.faces.layers.int['state']
    bm.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm)
    hits = []
    for bearing in range(72):
        origin = Vector((math.cos(bearing * math.tau / 72) * 6.2, math.sin(bearing * math.tau / 72) * 6.2, 1))
        for height in (.65, .35, 1.1):
            point, _, face, _ = tree.ray_cast(origin, (Vector((0, 0, height)) - origin).normalized())
            if point:
                hits.append((math.hypot(point.x, point.y), bm.faces[face][tag] == ORE))
                break
    seen = [bm.faces[face][tag] == ORE for _, face in camera_hits(tree)]
    result = dict(bearings_hit=len(hits), nearest_hit=round(min(hit[0] for hit in hits), 2),
                  ore_bearings=round(sum(hit[1] for hit in hits) / len(hits), 2), ore_in_view=round(sum(seen) / len(seen), 2))
    bm.free()
    return result


bpy.ops.wm.read_factory_settings(use_empty=False)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(args.seed)
shift = Vector((args.seed * .71, args.seed * .37, args.seed * .53))
lobes = layout(rng)

# Four nested rocks: the envelope the metal fills, the weathered stone inside it, and
# two inner walls that bound the ore's hidden roots and the depth of the empty slots.
envelope = fuse('envelope', lobes, voxel=.07, relief=.4, toe=.25, shift=shift)
rock = fuse('rock', lobes, LEDGE, DROP, relief=1, toe=.25, shift=shift)
# Their floors sit higher than the outer rocks': coinciding floors make the cut
# outlines cross, and the slot walls then fail to fill.
tuck = fuse('tuck', lobes, LEDGE + .5, DROP + .45, voxel=.12, bottom=-.5)
core = fuse('core', lobes, LEDGE + .85, DROP + .8, voxel=.12, bottom=-.5)
corners = [vertex.co for vertex in envelope.data.vertices]
center = Vector((sum(f(v.x for v in corners) for f in (min, max)) / 2, sum(f(v.y for v in corners) for f in (min, max)) / 2, 0))
scale = BODY_RADIUS / max(math.hypot(v.x - center.x, v.y - center.y) for v in corners)
for nested in (envelope, rock, tuck, core):
    for vertex in nested.data.vertices:
        vertex.co = (vertex.co - center) * scale
# Inner walls are buried or deep in shade: a few hundred triangles each, fixed before
# the cuts so slot walls and slot backs meet along the same edges.
decimate(tuck, TRIANGLES['inner'])
decimate(core, TRIANGLES['inner'])
seams = place_seams(envelope, rng)
stone_shell, ore_shell = shell(rock, core), shell(envelope, tuck)
# Slot backs stand a little proud of the slot walls' inner edge, so no gap opens between them.
for vertex in core.data.vertices:
    vertex.co += vertex.normal * .08
back = edit(core)
for face in back.faces:
    face.material_index = CUT
offsets = [None, *[offset for seam in seams for offset in seam], None]
host = merge('host rock', [between(stone_shell, low, high) for low, high in zip(offsets[::2], offsets[1::2])])
# The ore is a little thicker than its slot, so it covers the stone's cut edges.
ore = merge('titanium seams', [between(ore_shell, low - .02, high + .02) for low, high in seams])
slots = merge('slot backs', [between(back, low - .06, high + .06, fill=False) for low, high in seams])
for bm in (stone_shell, ore_shell, back):
    bm.free()
for nested in (envelope, rock, tuck, core):
    bpy.data.objects.remove(nested)
# Freeze the final topology before baking. Collapsing atlas triangles after the bake
# can interpolate across source UV islands and expose black seams.
decimate(host, TRIANGLES['rock'])
crease(host)
decimate(ore, TRIANGLES['ore'])
crease(ore, math.radians(12))

# Fallen blocks at the foot hold the footprint's widest reach in both states.
blocks = []
start = rng.uniform(0, math.tau)
for index in range(3):
    angle = start + math.tau * (index + rng.uniform(-.25, .25)) / 3
    block = fuse(f'fallen block {index + 1}', [lobe(rng, (0, 0), rng.uniform(.55, .8), rng.uniform(.5, .95),
                                                     rng.randint(5, 6), (.8, 1.15), .3)],
                 voxel=.05, relief=.5, toe=.1, shift=shift + Vector((index * 7, 0, 0)))
    block.data.transform(Matrix.Rotation(rng.uniform(-.2, .2), 4, 'X'))
    distance = FOOTPRINT_RADIUS - (0 if index == 0 else rng.uniform(.05, .5))
    block.data.transform(Matrix.Translation((math.cos(angle) * distance, math.sin(angle) * distance, 0)))
    direction = Vector((math.cos(angle), math.sin(angle), 0))
    block.data.transform(Matrix.Translation(direction * (distance - reach(block))))
    decimate(block, TRIANGLES['block'])
    blocks.append(block)

# A little rubble lies at the mouths of the empty slots.
low_rim = [vertex.co for vertex in ore.data.vertices if 0 < vertex.co.z < .9]
sites = []
for point in rng.sample(low_rim, 16):
    radius = rng.uniform(.1, .24)
    distance = min(BODY_RADIUS - .1, math.hypot(point.x, point.y) + rng.uniform(-.1, .45))
    sites.append((Vector((point.x, point.y, 0)).normalized() * distance + Vector((0, 0, radius * .3)), radius))
rubble = stones('slot rubble', sites, rng)

stone, steel, dark = stone_material(), ore_material(), cut_material()
host.data.materials.append(stone)
host.data.materials.append(dark)
paint_rock(host)
for block in blocks:
    block.data.materials.append(stone)
    paint_rock(block)
ore.data.materials.append(steel)
paint_ore(ore, shift)
slots.data.materials.append(dark)
paint(slots, [(0, 0, 0)] * len(slots.data.loops), [SPENT] * len(slots.data.polygons))
rubble.data.materials.append(stone)
paint(rubble, [(0, .35, 0)] * len(rubble.data.loops), [SPENT] * len(rubble.data.polygons))
parts = [host, *blocks, ore, slots, rubble]
entry = dict(generator='tools/assets/build_titanium_seam.py', seed=args.seed,
             seams=[[round(offset, 2) for offset in seam] for seam in seams], survey=survey([host, *blocks, ore]))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'source.blend'))
if not args.draft:
    baked = bake_runtime(parts, OUT, size=1024, name='Titanium seam')
    shader = baked.data.materials[0].node_tree.nodes.get('Principled BSDF')
    # Ore is nonemissive. Omit the baker's unused black emission map from export.
    for link_ in list(shader.inputs['Emission Color'].links):
        baked.data.materials[0].node_tree.links.remove(link_)
    shader.inputs['Emission Color'].default_value = (0, 0, 0, 1)
    shader.inputs['Emission Strength'].default_value = 0
    baked.data.validate()
    for name, states in (('full', (ROCK, ORE)), ('depleted', (ROCK, SPENT))):
        path = OUT / f'{name}.glb'
        triangles, radius = subset(baked, states, path)
        entry[name] = dict(bytes=path.stat().st_size, triangles=triangles, radius=round(radius, 3))
    (OUT / 'export.json').write_text(json.dumps(entry, indent=2) + '\n')
print('TITANIUM_SEAM', json.dumps(entry), flush=True)
