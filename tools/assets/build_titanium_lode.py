"""Author the "Lode" Titanium Deposit: a crown of massive metal crystals in cracked host rock.

blender --background --threads 6 --python-exit-code 1 --python tools/assets/build_titanium_lode.py -- [--seed 1 2] [--out <dir>] [--draft]

A low mound of terrain rock carries broken crust slabs; stout titanium prisms
burst through the middle and out of the mound's flank. Each `--seed` is one
composition from the same code. The first seed exports `full.glb` and
`depleted.glb`, the next `full-b.glb` and `depleted-b.glb`, and so on. Both states
of a seed are subsets of one baked mesh and share its 1024 px atlas: the full
state shows the crystals, the depleted state the dark stumps that sit inside them.
`--draft` saves `source.blend` without baking. Nothing is written to assets/models;
review candidates with `bun tools/verify/capture-ore.mjs --model <glb> --out <dir>`.

The game never turns the model, the camera or the sun, so the half-vector between
sun and camera is one fixed direction (GLINT). Crystal tops cleaved within a few
degrees of it show a real sun glint with no environment map; the rest of the
metal's sheen is baked into the base color as one tone per facet.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
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
FOOTPRINT_RADIUS = 5.35
# Blender-space directions from the scene toward the game's sun and camera.
SUN = Vector((-.518, -.327, .791)).normalized()
VIEW = Vector((.528, -.528, .666)).normalized()
GLINT = (SUN + VIEW).normalized()
FRONT = Vector((VIEW.x, VIEW.y)).normalized()
# Titanium in linear RGB: shade facets, mid tones and sunlit facets.
SHADOW, MID, LIGHT = (.04, .052, .08), (.22, .3, .4), (.66, .75, .86)
# Tried in game: at .3 the metal reads as painted stone, at .6 shaded sides go near black.
METALNESS = .45
BOTH, FULL, DEPLETED = 0, 1, 2
# Facet kinds: prism side, cleaved top, chipped corner, worn edge.
SIDE, TOP, CHIP, EDGE = 0, 1, 2, 3

parser = argparse.ArgumentParser()
parser.add_argument('--seed', type=int, nargs='+', default=[1, 2], help='one composition per seed')
parser.add_argument('--draft', action='store_true', help='save the editable source without baking')
parser.add_argument('--out', type=Path, default=ROOT / 'art/workbench/titanium-lode')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = args.out.resolve()


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def link(name, bm, smooth=True):
    data = bpy.data.meshes.new(name)
    bm.to_mesh(data)
    bm.free()
    for polygon in data.polygons:
        polygon.use_smooth = smooth
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return obj


def paint(obj, corner_masks, state):
    """Store three masks per corner, the state that shows the part, and the source UV the baker expects."""
    obj.data.color_attributes.new('Masks', 'FLOAT_COLOR', 'CORNER').data.foreach_set(
        'color', [channel for masks in corner_masks for channel in (*masks, 1)])
    obj.data.attributes.new('state', 'INT', 'FACE').data.foreach_set('value', [state] * len(obj.data.polygons))
    if 'SourceUV' not in obj.data.uv_layers:
        obj.data.uv_layers.new(name='SourceUV')


def polar(radius, angle):
    return Vector((math.cos(angle) * radius, math.sin(angle) * radius))


def tilted(axis, angle, toward):
    """`axis` leaned by `angle` toward the bearing `toward` around itself."""
    side = axis.orthogonal().normalized()
    return axis * math.cos(angle) + (side * math.cos(toward) + axis.cross(side) * math.sin(toward)) * math.sin(angle)


# --- Host rock -------------------------------------------------------------

def outline(center, radius, rng, count, spread):
    """An irregular polygon around a circle."""
    return [Vector(center) + polar(radius * rng.uniform(*spread), math.tau * (index + rng.uniform(-.3, .3)) / count)
            for index in range(count)]


def add_solid(bm, points, rings, rng, wobble=.4):
    """A closed solid; each (height, shrink) ring pulls the outline toward its centroid."""
    centroid = sum(points, Vector((0, 0))) / len(points)
    leans = [rng.uniform(1 - wobble, 1 + wobble) for _ in points]
    loops = [[bm.verts.new((*(centroid + (point - centroid) * (1 - shrink * lean)), height))
              for point, lean in zip(points, leans)] for height, shrink in rings]
    for lower, upper in zip(loops, loops[1:]):
        for index in range(len(points)):
            bm.faces.new((lower[index - 1], lower[index], upper[index], upper[index - 1]))
    bm.faces.new(loops[0])
    bm.faces.new(loops[-1])


def smooth(bm, repeat, factor):
    for _ in range(repeat):
        bmesh.ops.smooth_vert(bm, verts=list(bm.verts), factor=factor,
                              use_axis_x=True, use_axis_y=True, use_axis_z=True)


def fuse(name, build, seed, toe=0., crag=.1, voxel=.055):
    """Union the solids `build` adds through a voxel remesh, then weather the surface."""
    bm = bmesh.new()
    build(bm)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    obj = link(name, bm)
    activate(obj)
    remesh = obj.modifiers.new('Fuse', 'REMESH')
    remesh.mode, remesh.voxel_size, remesh.adaptivity, remesh.use_smooth_shade = 'VOXEL', voxel, 0, True
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    smooth(bm, 1, .5)
    bm.normal_update()
    shift = Vector((seed * .71, seed * .37, seed * .53))
    moves = []
    for vertex in bm.verts:
        point, normal = vertex.co + shift, vertex.normal
        # Broad tops stay calm; flanks carry the relief and faint strata.
        relief = noise.fractal(point * .45, .6, 2.0, 3) * crag * (1 - .6 * max(0, normal.z))
        relief += noise.noise(point * 1.7) * .03
        phase = (vertex.co.z + noise.noise(point * .33) * .14) / .3
        relief -= math.exp(-((phase % 1 - .5) / .12) ** 2) * .045 * max(0, 1 - abs(normal.z) * 1.6)
        move = normal * relief
        outward = Vector((normal.x, normal.y, 0))
        if toe and vertex.co.z < .5 and outward.length > .2:
            # The foot spreads, so it meets the terrain at a slant instead of a hard seam.
            spread = min(1, (.5 - vertex.co.z) / .6) ** 2
            move += outward.normalized() * spread * toe * (1 + noise.noise(point * 2.3) * .4)
        moves.append(move)
    for vertex, move in zip(bm.verts, moves):
        vertex.co += move
    smooth(bm, 1, .3)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def mound(rng, seed):
    """The skirt: a low craggy plateau whose walls drop straight below the ground,
    tall and wide enough for a Scout's tool to meet from every bearing, with talus
    lobes and boulders spreading its foot unevenly."""
    def build(bm):
        add_solid(bm, outline((0, 0), 4.25, rng, 11, (.95, 1.05)), [(-.5, 0), (0, 0), (.55, .03), (1., .08)], rng)
        for index in range(8):
            radius = rng.uniform(.9, 1.4)
            center = polar(min(rng.uniform(3.5, 4.2), 5.05 - radius * 1.05), math.tau * (index + rng.uniform(-.4, .4)) / 8)
            add_solid(bm, outline(center, radius, rng, 7, (.8, 1.1)),
                      [(-.5, 0), (0, 0), (.3, .2), (rng.uniform(.45, .95), .5)], rng)
        for _ in range(rng.randint(5, 7)):
            radius = rng.uniform(.3, .55)
            add_solid(bm, outline(polar(rng.uniform(4.1, 4.7), rng.uniform(0, math.tau)), radius, rng, 6, (.8, 1.1)),
                      [(-.5, 0), (.1, 0), (rng.uniform(.4, .75), .45)], rng)
    return fuse('host / mound', build, seed, toe=.2, crag=.16)


def crust(rng, seed):
    """Broken plates of crust lying on the mound, most of them lifted toward the
    middle by the crystals below and sunk into the mound at their outer edge."""
    slabs = []
    count = rng.randint(6, 7)
    for index in range(count):
        bearing = math.tau * (index + rng.uniform(-.3, .3)) / count
        center = polar(rng.uniform(2.1, 2.8), bearing)
        thickness = rng.uniform(.3, .5)
        points = outline(center, rng.uniform(1.15, 1.6), rng, 7, (.8, 1.12))
        slab = fuse(f'host / crust {index + 1}', lambda bm: add_solid(
            bm, points, [(0, 0), (thickness * .6, 0), (thickness, .08)], rng), seed + index + 1)
        # Strata were cut while the slab lay flat, so they tilt with it.
        pivot = Vector((*center, 0))
        slab.data.transform(
            Matrix.Translation(pivot + Vector((0, 0, rng.uniform(.72, .95))))
            @ Matrix.Rotation(rng.uniform(0, .25), 4, Vector((-math.sin(bearing), math.cos(bearing), 0)))
            @ Matrix.Rotation(rng.uniform(-.1, .1), 4, Vector((math.cos(bearing), math.sin(bearing), 0)))
            @ Matrix.Translation(-pivot))
        slabs.append(slab)
    return slabs


def rock_masks(obj, tone, sandy_top=False):
    """Paint the part's tone and where sand settles: on the foot and in the cracks."""
    masks = []
    for vertex in obj.data.vertices:
        point, normal = vertex.co, vertex.normal
        dust = max(0, normal.z - .45) * 1.1 * max(0, 1 - point.z / .9) + .75 * max(0, 1 - (point.z + .1) / .45)
        if sandy_top:
            dust += min(1, max(0, (normal.z - .6) / .2)) * min(1, max(0, (point.z - .6) / .2))
        masks.append((tone, min(1, max(0, dust)), 0))
    paint(obj, [masks[loop.vertex_index] for loop in obj.data.loops], BOTH)


def decimate(obj, triangles):
    obj.data.calc_loop_triangles()
    activate(obj)
    modifier = obj.modifiers.new('Runtime budget', 'DECIMATE')
    modifier.ratio = min(1, triangles / len(obj.data.loop_triangles))
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def surface(objects):
    tree_vertices, polygons = [], []
    for obj in objects:
        offset = len(tree_vertices)
        tree_vertices += [vertex.co.copy() for vertex in obj.data.vertices]
        polygons += [[offset + index for index in polygon.vertices] for polygon in obj.data.polygons]
    return BVHTree.FromPolygons(tree_vertices, polygons)


# --- Crystals --------------------------------------------------------------

def grow(rng, ground, xy, toward, lean, rise, radius, glint, spin=None, chips=(0, 2)):
    """Plan one prism: its root on the rock, axis, cross-section and the planes
    that cleave its top. `rise` is the tip's height above the rock."""
    root = Vector((xy[0], xy[1], ground(xy)))
    axis = Vector((math.cos(toward) * math.sin(lean), math.sin(toward) * math.sin(lean), math.cos(lean)))
    side = axis.orthogonal().normalized()
    other = axis.cross(side)
    sides = rng.choice((4, 4, 4, 5))
    spin = rng.uniform(0, math.tau) if spin is None else spin
    squash = rng.uniform(.8, 1)
    ring = [(side * math.cos(angle) + other * math.sin(angle) * squash) * radius * rng.uniform(.93, 1.06)
            for angle in (spin + math.tau * (index + rng.uniform(-.08, .08)) / sides for index in range(sides))]
    tip = root + axis * (rise / axis.z)
    if axis.dot(GLINT) > .6 and rng.random() < glint:
        # Within a few degrees of the sun-camera half-vector, so tops flash by different amounts.
        cuts = [(tip, tilted(GLINT, rng.uniform(.03, .15), rng.uniform(0, math.tau)), TOP)]
        across = GLINT - axis * GLINT.dot(axis)
        if rng.random() < .5 and across.length > .2:
            # A chisel top: a second cleave falls away behind the glinting one.
            cuts.append((tip, (axis * math.cos(.7) - across.normalized() * math.sin(.7)), TOP))
    else:
        cuts = [(tip, tilted(axis, rng.uniform(.2, .6), rng.uniform(0, math.tau)), TOP)]
    for _ in range(rng.randint(*chips)):
        bearing, slant = rng.uniform(0, math.tau), rng.uniform(.7, 1.2)
        out = side * math.cos(bearing) + other * math.sin(bearing)
        cuts.append((tip - axis * radius * rng.uniform(.1, .5) + out * radius * rng.uniform(.5, .8),
                     axis * math.cos(slant) + out * math.sin(slant), CHIP))
    return dict(root=root, axis=axis, ring=ring, length=rise / axis.z, radius=radius, spin=spin, cuts=cuts,
                stump=(root + Vector((0, 0, rng.uniform(.03, .2))),
                       tilted(Vector((0, 0, 1)), rng.uniform(.02, .14), rng.uniform(0, math.tau)), TOP))


def compose(rng, ground):
    """The crown: a king behind the middle, a ring of leaning blocks around it with
    twins and small ones at their feet, and stout blocks breaking out of the mound's
    flank, where a Scout's tool lands."""
    middle = -FRONT * rng.uniform(.2, .6)
    king = grow(rng, ground, middle, rng.uniform(0, math.tau), rng.uniform(.08, .22),
                rng.uniform(2.8, 3.2), rng.uniform(1., 1.1), 1, chips=(2, 3))
    plans = [king]
    count = rng.randint(5, 6)
    start = rng.uniform(0, math.tau)
    for index in range(count):
        bearing = start + math.tau * (index + rng.uniform(-.22, .22)) / count
        out = polar(1, bearing)
        # Taller behind, shorter toward the camera, so the front row hides nothing.
        back = -out.dot(FRONT)
        radius = rng.uniform(.62, .9)
        plan = grow(rng, ground, middle * .4 + out * rng.uniform(1.5, 2.3), bearing + rng.uniform(-.4, .4),
                    rng.uniform(.2, .5), max(1., 1.5 + .8 * back + rng.uniform(-.2, .4)), radius, .65)
        plans.append(plan)
        for _ in range(rng.randint(1, 2)):
            turn = bearing + rng.uniform(-1.3, 1.3)
            plans.append(grow(rng, ground, Vector(plan['root'][:2]) + polar(radius + rng.uniform(.2, .5), turn),
                              turn, rng.uniform(.4, .8), rng.uniform(.5, .9), rng.uniform(.3, .45), .3))
    # Twins share a prism's axis and turn, like intergrown blocks of one crystal.
    for plan in [king, king] + rng.sample(plans[1:], count // 2):
        if plan['radius'] < .5:
            continue
        offset = tilted(plan['axis'], math.pi / 2, rng.uniform(0, math.tau)) * plan['radius'] * rng.uniform(.7, 1.)
        plans.append(grow(rng, ground, Vector((plan['root'] + offset)[:2]), math.atan2(plan['axis'].y, plan['axis'].x),
                          math.acos(plan['axis'].z), plan['length'] * plan['axis'].z * rng.uniform(.45, .7),
                          plan['radius'] * rng.uniform(.5, .65), .5, plan['spin']))
    count = rng.randint(8, 9)
    for index in range(count):
        bearing = math.tau * (index + rng.uniform(-.3, .3)) / count
        plans.append(grow(rng, lambda xy: .35, polar(rng.uniform(3.6, 3.85), bearing), bearing + rng.uniform(-.3, .3),
                          rng.uniform(.2, .4), rng.uniform(.8, 1.25), rng.uniform(.68, .88), .5))
    return plans


def cut(bm, point, normal, kind, layer):
    """Keep the part of a convex solid behind a plane and close it with one flat facet."""
    result = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=point,
                                    plane_no=normal, clear_outer=True)
    edges = [item for item in result['geom_cut'] if isinstance(item, bmesh.types.BMEdge)]
    for face in (bmesh.ops.edgeloop_fill(bm, edges=edges)['faces'] if edges else []):
        face[layer] = kind


def prism(name, plan, stump=False):
    """The planned prism, or the cut-down stump that sits just inside it."""
    root, axis, length, radius = plan['root'], plan['axis'], plan['length'], plan['radius']
    bm = bmesh.new()
    kind = bm.faces.layers.int.new('kind')
    inset = .9 if stump else 1
    low, high = -.8, length + 1.6 * radius
    loops = [[bm.verts.new(root + axis * along + offset * inset * (1.04 - .1 * along / (length + radius)))
              for offset in plan['ring']] for along in (low, high)]
    for index in range(len(plan['ring'])):
        bm.faces.new((loops[0][index - 1], loops[0][index], loops[1][index], loops[1][index - 1]))
    bm.faces.new(loops[0])
    bm.faces.new(loops[1])
    for point, normal, facet in ([plan['stump']] if stump else plan['cuts']):
        cut(bm, point, normal, facet, kind)
    if not stump and radius >= .4:
        # Narrow flats along the edges are the worn arrises, and some of them catch the sun.
        edges = [edge for edge in bm.edges if any((vertex.co - root).dot(axis) > low + .01 for vertex in edge.verts)]
        for face in bmesh.ops.bevel(bm, geom=edges, offset=.04, offset_type='OFFSET', segments=1, profile=.5,
                                    affect='EDGES', clamp_overlap=True)['faces']:
            face[kind] = EDGE
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return link(name, bm, smooth=False)


def crystal_masks(obj, plan, rng):
    """Paint each facet's tone, its height above the crust and whether it glints;
    the source UV runs along the prism so striations follow its length."""
    root, axis = plan['root'], plan['axis']
    kinds = [item.value for item in obj.data.attributes['kind'].data]
    obj.data.uv_layers.new(name='SourceUV')
    uv = obj.data.uv_layers['SourceUV'].data
    masks = []
    for polygon in obj.data.polygons:
        normal, kind = polygon.normal, kinds[polygon.index]
        # Each facet picks the brightness it should show in game: worn edges brightest,
        # cleaved tops silver, sides steel. Sides in shade cannot reach theirs and stay graphite-blue.
        # A whole crown of sunlit silver tops reads as ice or chalk in game. Only a third of
        # the tops cut toward the sun are polished enough to glint; the rest stay dark steel.
        glint = float(kind == TOP and normal.dot(GLINT) > .985 and rng.random() < .35)
        shown = rng.uniform(*((.55, 1.1) if kind == EDGE else (.06, .22) if kind == SIDE
                              else (.5, .8) if glint else (.1, .3)))
        # Measured in game at this metalness: light multiplies base color by about .3 in
        # shade and 2 on a top, and clips above 1.
        albedo = min(.55, shown / (.3 + 2.2 * max(0, normal.dot(SUN))))
        tone = (albedo - .055) / .49 if albedo < .3 else .5 + (albedo - .3) / .9
        across = axis.cross(normal)
        across = across.normalized() if across.length > .05 else axis.orthogonal().normalized()
        for loop in polygon.loop_indices:
            point = obj.data.vertices[obj.data.loops[loop].vertex_index].co
            masks.append((min(1, max(0, tone)), min(1, max(0, (point.z - root.z) / 2)), glint))
            uv[loop].uv = ((point - root).dot(axis), (point - root).dot(across))
    paint(obj, masks, FULL)


def stump_masks(obj):
    kinds = [item.value for item in obj.data.attributes['kind'].data]
    paint(obj, [(float(kinds[polygon.index] == TOP), 0, 0) for polygon in obj.data.polygons
                for _ in polygon.loop_indices], DEPLETED)


# --- Materials -------------------------------------------------------------

class Graph:
    """Small helpers for the procedural source materials."""

    def __init__(self, name):
        self.material = bpy.data.materials.new(name)
        self.material.use_nodes = True
        self.nodes, self.links = self.material.node_tree.nodes, self.material.node_tree.links
        self.shader = self.nodes.get('Principled BSDF')
        self.position = self.nodes.new('ShaderNodeNewGeometry').outputs['Position']

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

    def remap(self, value, low, high):
        node = self.nodes.new('ShaderNodeMapRange')
        node.interpolation_type, node.clamp = 'SMOOTHSTEP', True
        self.set(value, node.inputs['Value'])
        node.inputs['From Min'].default_value, node.inputs['From Max'].default_value = low, high
        return node.outputs['Result']

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

    def source_uv(self, scale):
        """The part's own UV, stretched; the baker leaves non-image nodes alone."""
        uv = self.nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'SourceUV'
        mapping = self.nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = scale
        self.links.new(uv.outputs['UV'], mapping.inputs['Vector'])
        return mapping.outputs['Vector']

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

    def host(self):
        """The terrain's own cliff and scree photographs, in patches."""
        return self.mix(self.remap(self.noise(.45, 3), .42, .62),
                        self.box_image(CLIFF_COLOR, 8), self.box_image(SCREE_COLOR, 5))

    def sand(self):
        return self.mix(1, self.box_image(GROUND_COLOR, 30), GROUND_TINT, 'MULTIPLY')

    def grain(self, strength=.4):
        normal = self.bump(self.luma(self.box_image(CLIFF_GRAIN, 2.4)), strength, .03)
        return self.bump(self.noise(38, 2), .12, .01, normal)


def rock_material():
    graph = Graph('Lode / host rock and sand')
    tone, dust, _ = graph.masks()
    drift = graph.remap(graph.jitter(dust, 3.5, .4), .38, .62)
    rock = graph.mix(1, graph.host(), tone, 'MULTIPLY')
    graph.set(graph.mix(drift, rock, graph.sand()), graph.shader.inputs['Base Color'])
    graph.shader.inputs['Metallic'].default_value = 0
    graph.shader.inputs['Roughness'].default_value = .9
    graph.links.new(graph.grain(), graph.shader.inputs['Normal'])
    return graph.material


def crystal_material():
    graph = Graph('Lode / titanium crystal')
    tone, height, glint = graph.masks()
    # Striations along the prism and a finer grain shift each facet's tone a little.
    streak = graph.noise(1, 3, graph.source_uv((.5, 11, 1)))
    value = graph.math('ADD', tone, graph.math('MULTIPLY', graph.math('SUBTRACT', streak, .5), .45))
    # Broad tarnished patches keep big facets from reading as one flat tone.
    value = graph.math('ADD', value, graph.math('MULTIPLY', graph.math('SUBTRACT', graph.noise(.9, 3), .5), .14))
    metal = graph.ramp(value, [(0, SHADOW), (.5, MID), (1, LIGHT)])
    # Host rock still clings to the lowest faces, and sand dusts the metal above it.
    crusted = graph.math('SUBTRACT', 1, graph.remap(graph.jitter(height, 1.6, .45), .18, .36))
    dusted = graph.math('MULTIPLY', graph.math('SUBTRACT', 1, graph.remap(graph.jitter(height, 4, .2), .12, .4)), .45)
    graph.set(graph.mix(crusted, graph.mix(dusted, metal, graph.sand()), graph.host()), graph.shader.inputs['Base Color'])
    bare = graph.math('MULTIPLY', graph.math('SUBTRACT', 1, crusted), graph.math('SUBTRACT', 1, dusted))
    graph.set(graph.math('MULTIPLY', bare, METALNESS), graph.shader.inputs['Metallic'])
    # Glinting tops are the smoothest; a rougher lobe elsewhere gives nearby facets a soft sheen.
    polish = graph.math('SUBTRACT', graph.math('ADD', .52, graph.math('MULTIPLY', streak, .12)),
                        graph.math('MULTIPLY', glint, .24))
    graph.set(graph.math('ADD', polish, graph.math('MULTIPLY', graph.math('SUBTRACT', 1, bare), .5)),
              graph.shader.inputs['Roughness'])
    graph.links.new(graph.bump(streak, .12, .01), graph.shader.inputs['Normal'])
    return graph.material


def stump_material():
    graph = Graph('Lode / spent stump')
    face, _, _ = graph.masks()
    # Flat, dull cut faces; the sides keep a dark crust of host rock.
    sweep = graph.nodes.new('ShaderNodeMapping')
    sweep.inputs['Scale'].default_value = (16, 1.5, 16)
    graph.links.new(graph.position, sweep.inputs['Vector'])
    sawn = graph.ramp(graph.noise(1, 3, sweep.outputs['Vector']), [(.3, (.06, .062, .07)), (.7, (.11, .112, .12))])
    sawn = graph.mix(graph.remap(graph.noise(2.2, 4), .5, .7), sawn, graph.sand())
    crust = graph.mix(.45, graph.host(), (.05, .05, .055))
    graph.set(graph.mix(face, crust, sawn), graph.shader.inputs['Base Color'])
    graph.shader.inputs['Metallic'].default_value = 0
    graph.shader.inputs['Roughness'].default_value = .9
    graph.links.new(graph.grain(.25), graph.shader.inputs['Normal'])
    return graph.material


# --- Bake, split and export ------------------------------------------------

def split(baked, states, path):
    """Export the faces one state shows; the copy keeps the baked atlas and material."""
    obj = baked.copy()
    obj.data = baked.data.copy()
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    layer = bm.faces.layers.int['state']
    bmesh.ops.delete(bm, geom=[face for face in bm.faces if face[layer] not in states], context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.validate()
    activate(obj)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_image_format='WEBP', export_image_quality=85,
                              export_vertex_color='NONE')
    return obj


def mining_contact(obj):
    """Where a Scout's tool lands from every bearing, by the game's own rule: a ray
    from 1 m up just outside the footprint toward the center at three heights."""
    tree = surface([obj])
    states = [item.value for item in obj.data.attributes['state'].data]
    reaches, ore = [], 0
    for step in range(72):
        origin = Vector((*polar(FOOTPRINT_RADIUS + .7, math.tau * step / 72), 1))
        for height in (.65, .35, 1.1):
            hit, _, index, _ = tree.ray_cast(origin, (Vector((0, 0, height)) - origin).normalized())
            if hit:
                reaches.append(math.hypot(hit.x, hit.y))
                ore += states[index] == FULL
                break
        else:
            reaches.append(0)
    return dict(nearest_contact=min(reaches), ore_bearings=ore / 72)


def describe(obj, path):
    obj.data.calc_loop_triangles()
    coordinates = [vertex.co for vertex in obj.data.vertices]
    return dict(path=str(path.relative_to(OUT)), bytes=path.stat().st_size,
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(), triangles=len(obj.data.loop_triangles),
                radius=max(math.hypot(v.x, v.y) for v in coordinates), height=max(v.z for v in coordinates),
                **mining_contact(obj))


def author(seed, suffix):
    bpy.ops.wm.read_factory_settings(use_empty=False)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    rng = random.Random(seed)
    output = OUT / f'seed-{seed}'
    output.mkdir(parents=True, exist_ok=True)
    body = mound(rng, seed)
    slabs = crust(rng, seed * 10)
    rocks = [body, *slabs]
    # The mound's foot is the widest reach; size the rock first so crystals are planned in real metres.
    scale = FOOTPRINT_RADIUS / max(math.hypot(v.co.x, v.co.y) for v in body.data.vertices)
    for rock in rocks:
        rock.data.transform(Matrix.Scale(scale, 4))
    tree = surface(rocks)
    ground = lambda xy: (tree.ray_cast(Vector((xy[0], xy[1], 9)), Vector((0, 0, -1)))[0] or Vector()).z
    plans = compose(rng, ground)
    crystals = [prism(f'titanium / crystal {index + 1}', plan) for index, plan in enumerate(plans)]
    stumped = [plan for plan in plans if plan['radius'] > .36]
    stumps = [prism(f'titanium / stump {index + 1}', plan, stump=True) for index, plan in enumerate(stumped)]
    decimate(body, 3200)
    for slab in slabs:
        decimate(slab, 3600 // len(slabs))
    rock_masks(body, 1, sandy_top=True)
    for slab in slabs:
        rock_masks(slab, rng.uniform(.82, 1.08))
    for obj, plan in zip(crystals, plans):
        crystal_masks(obj, plan, rng)
    for obj in stumps:
        stump_masks(obj)
    for objects, material in [(rocks, rock_material()), (crystals, crystal_material()), (stumps, stump_material())]:
        for obj in objects:
            obj.data.materials.append(material)
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'source.blend'))
    if args.draft:
        return []
    baked = bake_runtime(rocks + crystals + stumps, output, size=1024, name=f'Titanium lode {seed}')
    shader = baked.data.materials[0].node_tree.nodes.get('Principled BSDF')
    # Ore is nonemissive. Omit the baker's unused black emission map from export.
    for link_ in list(shader.inputs['Emission Color'].links):
        baked.data.materials[0].node_tree.links.remove(link_)
    shader.inputs['Emission Color'].default_value = (0, 0, 0, 1)
    shader.inputs['Emission Strength'].default_value = 0
    entries = []
    for name, states in [('full', (BOTH, FULL)), ('depleted', (BOTH, DEPLETED))]:
        path = OUT / f'{name}{suffix}.glb'
        entries.append(dict(seed=seed, state=name, **describe(split(baked, states, path), path)))
        print('LODE_EXPORT', json.dumps(entries[-1]), flush=True)
    return entries


exports = [entry for index, seed in enumerate(args.seed)
           for entry in author(seed, '-' + chr(ord('a') + index) if index else '')]
if exports:
    (OUT / 'export.json').write_text(json.dumps(dict(
        generator='tools/assets/build_titanium_lode.py',
        format='1 mesh, 1 standard PBR material, 1024px WebP color/normal/roughness-metallic per seed, shared by both states',
        coordinates='Y-up, centered X/Z, ground pivot Y=0', assets=exports), indent=2) + '\n')
