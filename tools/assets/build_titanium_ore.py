"""Author compact titanium outcrops from the selected Dune77 concepts.

Blender --background --threads 6 --python tools/assets/build_titanium_ore.py -- [--variant eroded-window] [--out <dir>]
No scanned geometry is used. Overlapping sandstone beds fuse into one weathered
outcrop that rises straight out of the game's terrain: its foot spreads and takes
the ground's sand color, so no separate ground mesh has to match the terrain.
Titanium shows where the rind has worn through and inside a cave mouth on the
workface.
The editable source is saved before baking; runtime exports use one standard
PBR material and a ground pivot. Review candidates in the game with
`bun tools/verify/capture-ore.mjs --model <glb> --out <dir>`.
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

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'art/workbench/titanium-ore'
sys.path.insert(0, str(ROOT / 'tools/assets'))
from building_bake import bake_runtime

CLIFF_SCAN = 'assets/source/polyhaven/titanium/cliff_side_diff_2k.jpg'
MOUNTAIN_COLOR = 'assets/textures/terrain/oxide-cliff-color.webp'
GROUND_COLOR = 'assets/textures/terrain/sand-scan.webp'
# The game's crackled cliff detail; its isotropic crack network reads as crinkled metal.
ORE_GRAIN = 'assets/textures/terrain/cliff-marble-02.webp'
# The main game multiplies its 30 m sand tile by hsl(29, 94%, 75%); linear RGB here.
GROUND_TINT = (.966, .51, .228)
FOOTPRINT_RADIUS = 5.35

# Beds are (center, radii, bottom, top, seed, taper, turn, tilt) and fuse into one
# rock; walls start below the ground line so no edge shows where sand runs low.
# The cap (center, radii, bottom, top, seed, taper, turn, crack) is one slab
# broken in two along a line whose normal points at angle `crack`; the halves stay
# separate stones. Layouts open the cave toward -Y; `facing` then turns the whole
# outcrop so the cave looks at the game camera, which sits toward Blender +X -Y.
VARIANTS = {
    'eroded-window': dict(
        body=[((-2.5, .55), (1.6, 2.4), -.6, 1.75, 23, .12, .3, (0, 0)),
              ((2.35, .4), (1.65, 2.5), -.6, 1.65, 37, .12, -.2, (0, 0)),
              ((-.05, .45), (1.45, 1.55), -.6, 1.7, 41, .08, 0, (0, 0)),
              ((-.05, .7), (3.95, 2.65), 1.55, 2.4, 53, .08, .05, (.02, -.03))],
        cap=((-.05, .75), (3.55, 2.4), 2.3, 2.95, 67, .14, .2, .25),
        # Ellipsoid (center, radii) of the cave mouth between the shoulders.
        cave=((-.05, -1.5, 1.0), (.85, .7, .58)),
        facing=math.radians(30),
    ),
}

parser = argparse.ArgumentParser()
parser.add_argument('--variant', choices=list(VARIANTS))
parser.add_argument('--draft', action='store_true', help='save the editable source without baking')
parser.add_argument('--out', type=Path, help='write candidate GLBs, export.json and the manifest here, not assets/models')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = args.out.resolve() if args.out else None


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


def paint(obj, corner_masks):
    """Store (rind, dust, core) per corner, plus the source UV the baker expects."""
    obj.data.color_attributes.new('Masks', 'FLOAT_COLOR', 'CORNER').data.foreach_set(
        'color', [channel for masks in corner_masks for channel in (*masks, 1)])
    obj.data.uv_layers.new(name='SourceUV')


def smooth(bm, repeat, factor):
    for _ in range(repeat):
        bmesh.ops.smooth_vert(bm, verts=list(bm.verts), factor=factor,
                              use_axis_x=True, use_axis_y=True, use_axis_z=True)


def outline(center, radii, rng, turn):
    """An irregular polygon of seven to nine corners around an ellipse."""
    count = rng.randint(7, 9)
    points = []
    for index in range(count):
        angle = turn + math.tau * (index + rng.uniform(-.3, .3)) / count
        scale = rng.uniform(.86, 1.1)
        points.append(Vector((center[0] + math.cos(angle) * radii[0] * scale,
                              center[1] + math.sin(angle) * radii[1] * scale)))
    return points


def clip(points, origin, normal):
    """The part of a polygon on the side of a line that its normal points to."""
    kept = []
    for a, b in zip(points, points[1:] + points[:1]):
        da, db = (a - origin).dot(normal), (b - origin).dot(normal)
        if da >= 0:
            kept.append(a)
        if da * db < 0:
            kept.append(a + (b - a) * (da / (da - db)))
    return kept


def add_prism(bm, points, bottom, top, rng, taper, tilt):
    """A closed prism whose sides lean inward by different amounts."""
    centroid = sum(points, Vector((0, 0))) / len(points)
    pivot = Vector((centroid.x, centroid.y, (bottom + top) / 2))
    rotation = Matrix.Rotation(tilt[0], 3, 'X') @ Matrix.Rotation(tilt[1], 3, 'Y')
    leans = [taper * rng.uniform(.5, 1.5) for _ in points]
    rings = [[bm.verts.new(pivot + rotation @ Vector((*((point - centroid) * (1 - lean * f)), z - pivot.z)))
              for point, lean in zip(points, leans)]
             for z, f in [(bottom, 0), (bottom + (top - bottom) * .55, .35), (top, 1)]]
    for lower, upper in zip(rings, rings[1:]):
        for index in range(len(points)):
            bm.faces.new((lower[index - 1], lower[index], upper[index], upper[index - 1]))
    bm.faces.new(rings[0])
    bm.faces.new(rings[-1])


def add_bed(bm, away, center, radii, bottom, top, seed, taper, turn, tilt):
    """A bed of two overlapping lobes; their union leaves notches in the outline and
    a lower step on top. The smaller lobe grows away from the cave, never into it."""
    rng = random.Random(seed)
    angle = math.atan2(center[1] - away[1], center[0] - away[0]) + rng.uniform(-.9, .9)
    lobe = (center[0] + math.cos(angle) * radii[0] * .45, center[1] + math.sin(angle) * radii[1] * .45)
    add_prism(bm, outline(center, radii, rng, turn), bottom, top, rng, taper, tilt)
    add_prism(bm, outline(lobe, (radii[0] * .62, radii[1] * .62), rng, turn + 1), bottom,
              top - rng.uniform(.04, .16) * (top - bottom), rng, taper, tilt)


def cap_halves(center, radii, bottom, top, seed, taper, turn, crack):
    """Two prism builders for a cap slab broken along a line, each half settling
    with its own small tilt; the crack opens a little toward the top."""
    rng = random.Random(seed)
    points = outline(center, radii, rng, turn)
    normal = Vector((math.cos(crack), math.sin(crack)))
    origin = Vector(center) + normal * .25
    halves = []
    for side, sink in [(1, 0), (-1, .07)]:
        half = clip(points, origin + normal * side * .07, normal * side)
        tilt = (rng.uniform(-.06, .06), side * rng.uniform(.02, .05))
        halves.append(lambda bm, half=half, sink=sink, tilt=tilt:
                      add_prism(bm, half, bottom - sink, top - sink, rng, taper, tilt))
    return halves


def fuse(name, build, seed, voxel=.055):
    """Union the prisms `build` adds through a voxel remesh, then weather the surface."""
    bm = bmesh.new()
    build(bm)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    obj = link(name, bm)
    activate(obj)
    remesh = obj.modifiers.new('Fuse beds', 'REMESH')
    remesh.mode, remesh.voxel_size, remesh.adaptivity, remesh.use_smooth_shade = 'VOXEL', voxel, 0, True
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    # Rounded voxel corners become the concept's soft chamfers.
    smooth(bm, 1, .5)
    bm.normal_update()
    shift = Vector((seed * .71, seed * .37, seed * .53))
    moves = []
    for vertex in bm.verts:
        point, normal = vertex.co + shift, vertex.normal
        # Broad tops stay calm; flanks carry the relief and faint strata.
        relief = noise.fractal(point * .45, .6, 2.0, 3) * .1 * (1 - .6 * max(0, normal.z))
        relief += noise.noise(point * 1.7) * .025
        phase = (vertex.co.z + noise.noise(point * .33) * .14) / .3
        relief -= math.exp(-((phase % 1 - .5) / .12) ** 2) * .045 * max(0, 1 - abs(normal.z) * 1.6)
        move = normal * relief
        outward = Vector((normal.x, normal.y, 0))
        if vertex.co.z < .5 and outward.length > .2:
            # The foot spreads a little, so it meets the terrain at a slant
            # instead of a hard vertical seam.
            toe = min(1, (.5 - vertex.co.z) / .6) ** 2
            move += outward.normalized() * toe * .3 * (1 + noise.noise(point * 2.3) * .4)
        moves.append(move)
    for vertex, move in zip(bm.verts, moves):
        vertex.co += move
    smooth(bm, 1, .3)
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def crystals(sites, seed):
    """Blunt titanium prisms; each site is (root, direction, length, radius)."""
    rng = random.Random(seed)
    bm = bmesh.new()
    for root, direction, length, radius in sites:
        direction = direction.normalized()
        side = direction.orthogonal().normalized()
        other = direction.cross(side)
        sides = rng.choice((5, 6))
        ring = [(side * math.cos(angle) + other * math.sin(angle)) * radius * rng.uniform(.75, 1.1)
                for angle in (math.tau * (index + rng.uniform(-.15, .15)) / sides for index in range(sides))]
        base = [bm.verts.new(root - direction * length * .35 + offset) for offset in ring]
        shoulder = [bm.verts.new(root + direction * length * .7 + offset * .85) for offset in ring]
        tip = bm.verts.new(root + direction * length + (side * rng.uniform(-.4, .4) + other * rng.uniform(-.4, .4)) * radius)
        for index in range(sides):
            bm.faces.new((base[index - 1], base[index], shoulder[index], shoulder[index - 1]))
            bm.faces.new((shoulder[index - 1], shoulder[index], tip))
        bm.faces.new(list(reversed(base)))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    obj = link('titanium crystals', bm, smooth=False)
    # Each facet gets its own tone, from dark graphite to bright steel.
    facets = [rng.random() for _ in obj.data.polygons]
    paint(obj, [(facets[polygon.index], 0, 1) for polygon in obj.data.polygons for _ in polygon.loop_indices])
    return obj


def cave_sites(cave, rng, count=11):
    """Crystals rooted in the cave's back wall, some jutting out of its mouth."""
    (cx, cy, cz), (rx, ry, rz) = cave
    return [(Vector((cx + rng.uniform(-.8, .8) * rx, cy + ry * rng.uniform(.3, .85), cz + rng.uniform(-.9, .4) * rz)),
             Vector((rng.uniform(-.5, .5), -1, rng.uniform(.05, .8))), rng.uniform(.5, 1.0), rng.uniform(.12, .22))
            for _ in range(count)]


def crack_sites(center, radii, bottom, top, seed, taper, turn, crack, rng, count=3):
    """A few crystals growing out of the cap's crack, leaning out of it."""
    normal = Vector((math.cos(crack), math.sin(crack), 0))
    along = Vector((-normal.y, normal.x, 0))
    origin = Vector((center[0], center[1], bottom + .1)) + normal * .25
    return [(origin + along * rng.uniform(-.45, .45) * radii[1] * (index + 1) / count,
             Vector((0, 0, 1)) + normal * rng.uniform(-.35, .35) + along * rng.uniform(-.2, .2),
             top - bottom + rng.uniform(.3, .55), rng.uniform(.1, .15)) for index in range(count)]


def rock_masks(obj, cave, seed):
    """Paint where the sandstone rind survives, where sand settles and the ore core."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    neighbors = [[edge.other_vert(vertex).index for edge in vertex.link_edges] for vertex in bm.verts]
    convex = []
    for vertex, ring in zip(bm.verts, neighbors):
        points = [bm.verts[index].co for index in ring]
        mean = sum(points, Vector()) / len(points)
        spacing = sum((point - vertex.co).length for point in points) / len(points)
        convex.append(vertex.normal.dot(vertex.co - mean) / max(spacing, 1e-6))
    for _ in range(6):
        convex = [(2 * convex[index] + sum(convex[other] for other in ring)) / (2 + len(ring))
                  for index, ring in enumerate(neighbors)]
    center, radii = cave
    shift = Vector((seed * .3, seed * .7, seed * .1))
    masks = []
    for vertex, edge in zip(bm.verts, convex):
        point, normal = vertex.co, vertex.normal
        inside = math.sqrt(sum(((point[axis] - center[axis]) / radii[axis]) ** 2 for axis in range(3)))
        core = min(1, max(0, (1.9 - inside) / .5)) * min(1, max(0, (point.z - .3) / .3))
        # The rind survives on edges, flanks and the foot; titanium shows through
        # on broad worn tops and wherever the cave cuts into the rock.
        rind = (.52 + edge * 3 + max(0, 1 - point.z / 1.2) * .25 + (1 - abs(normal.z)) * .1
                - max(0, normal.z) * min(1, max(0, point.z - 1.4)) * .12
                + noise.noise(point * .55 + shift) * .32 + noise.noise(point * 1.6 + shift) * .1)
        # A thin, patchy dusting where the walls meet the terrain; a full band of
        # sand reads as a smooth halo against the rippled ground.
        dust = max(0, normal.z - .45) * 1.8 * max(0, 1 - point.z / .9) + .75 * max(0, 1 - (point.z + .1) / .5)
        masks.append((min(1, max(0, rind)) * (1 - core), min(1, max(0, dust)), core))
    bm.free()
    paint(obj, [masks[loop.vertex_index] for loop in obj.data.loops])


def normalize(parts, cave):
    """Center the footprint and scale its widest reach to the deposit radius."""
    coordinates = [vertex.co for part in parts for vertex in part.data.vertices]
    center = Vector((sum(f(v.x for v in coordinates) for f in (min, max)) / 2,
                     sum(f(v.y for v in coordinates) for f in (min, max)) / 2, 0))
    scale = FOOTPRINT_RADIUS / max(math.hypot(v.x - center.x, v.y - center.y) for v in coordinates)
    for part in parts:
        for vertex in part.data.vertices:
            vertex.co = (vertex.co - center) * scale
    return (Vector(cave[0]) - center) * scale, Vector(cave[1]) * scale


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

    def box_image(self, path, meters, color=True):
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
            if not color:
                image.image.colorspace_settings.name = 'Non-Color'
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


def rock_material():
    graph = Graph('Titanium / sandstone rind, sand and graphite ore')
    rind, dust, _ = graph.masks()
    grain = graph.luma(graph.box_image(CLIFF_SCAN, 2.4))
    # The mountains' own graded photograph, a little denser than on their 12 m cliffs
    # so this smaller rock still shows its grain.
    sandstone = graph.box_image(MOUNTAIN_COLOR, 8)
    # Warm graphite-to-steel, from the Aged desert machinery color. The game has no
    # reflections, so the metal's sheen lives in the color: the crackle's linear luma
    # spans .05 to .45, its cracks stay graphite and its brightest facets turn steel.
    crinkle = graph.luma(graph.box_image(ORE_GRAIN, 6.5))
    ore = graph.ramp(crinkle, [(.05, (.018, .017, .015)), (.12, (.04, .038, .034)), (.19, (.065, .062, .057)),
                               (.29, (.11, .106, .098)), (.37, (.2, .195, .183)), (.45, (.42, .41, .39))])
    lines = graph.remap(crinkle, .33, .45)
    worn = graph.remap(graph.jitter(rind, 1.6, .45), .42, .6)
    sand = graph.mix(1, graph.box_image(GROUND_COLOR, 30), GROUND_TINT, 'MULTIPLY')
    drift = graph.remap(graph.jitter(dust, 3.5, .4), .38, .62)
    graph.set(graph.mix(drift, graph.mix(worn, ore, sandstone), sand), graph.shader.inputs['Base Color'])
    exposed = graph.math('MULTIPLY', graph.math('SUBTRACT', 1, worn), graph.math('SUBTRACT', 1, drift))
    shine = graph.math('MULTIPLY', lines, exposed)
    # Real metalness would only darken the flecks without reflections to show.
    graph.set(graph.math('ADD', graph.math('MULTIPLY', exposed, .06), graph.math('MULTIPLY', shine, .12)),
              graph.shader.inputs['Metallic'])
    graph.set(graph.math('SUBTRACT', graph.math('SUBTRACT', .9, graph.math('MULTIPLY', exposed, .35)),
                         graph.math('MULTIPLY', shine, .15)), graph.shader.inputs['Roughness'])
    normal = graph.bump(graph.math('ADD', graph.mix(exposed, grain, crinkle), graph.math('MULTIPLY', shine, .3)),
                        graph.math('ADD', .35, graph.math('MULTIPLY', exposed, .3)), .03)
    graph.links.new(graph.bump(graph.noise(38, 2), .12, .01, normal), graph.shader.inputs['Normal'])
    return graph.material


def crystal_material():
    graph = Graph('Titanium / crystal faces')
    facet, _, _ = graph.masks()
    graph.set(graph.ramp(facet, [(0, (.06, .058, .054)), (.5, (.2, .195, .185)), (1, (.62, .61, .58))]),
              graph.shader.inputs['Base Color'])
    graph.shader.inputs['Metallic'].default_value = .2
    graph.shader.inputs['Roughness'].default_value = .32
    return graph.material


def decimate(obj, triangles):
    obj.data.calc_loop_triangles()
    activate(obj)
    modifier = obj.modifiers.new('Runtime budget', 'DECIMATE')
    modifier.ratio = min(1, triangles / len(obj.data.loop_triangles))
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)


metadata = []
for variant in ([args.variant] if args.variant else VARIANTS):
    bpy.ops.wm.read_factory_settings(use_empty=False)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    spec = VARIANTS[variant]
    output = (OUT or WORK) / variant
    output.mkdir(parents=True, exist_ok=True)
    runtime = (output if OUT else ROOT / 'assets/models') / f'titanium-{variant}.glb'
    away = spec['cave'][0]
    body = fuse(f'{variant} / body', lambda bm: [add_bed(bm, away, *bed) for bed in spec['body']], 1)
    plates = [fuse(f'{variant} / cap {index + 1}', half, index + 2)
              for index, half in enumerate(cap_halves(*spec['cap']))]
    rng = random.Random(13)
    shards = crystals(cave_sites(spec['cave'], rng) + crack_sites(*spec['cap'], rng), 13)
    parts = [body, *plates, shards]
    cave = normalize(parts, spec['cave'])
    for index, rock in enumerate([body, *plates]):
        rock_masks(rock, cave, index)
    # Masks depend only on heights and the unturned cave, so turning comes last.
    for part in parts:
        part.data.transform(Matrix.Rotation(spec['facing'], 4, 'Z'))
    stone, crystal = rock_material(), crystal_material()
    for part in parts:
        part.data.materials.append(crystal if part is shards else stone)
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'source.blend'))
    if args.draft:
        continue
    # Freeze the final topology before baking. Collapsing atlas triangles after
    # the bake can interpolate across source UV islands and expose black seams.
    decimate(body, 7000)
    for plate in plates:
        decimate(plate, 1400)
    baked = bake_runtime(parts, output, size=1024, name='Titanium ' + variant)
    shader = baked.data.materials[0].node_tree.nodes.get('Principled BSDF')
    # Ore is nonemissive. Omit the baker's unused black emission map from export.
    for link_ in list(shader.inputs['Emission Color'].links):
        baked.data.materials[0].node_tree.links.remove(link_)
    shader.inputs['Emission Color'].default_value = (0, 0, 0, 1)
    shader.inputs['Emission Strength'].default_value = 0
    baked.data.validate()
    activate(baked)
    bpy.ops.export_scene.gltf(filepath=str(runtime), export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_image_format='WEBP', export_image_quality=85,
                              export_vertex_color='NONE')
    coordinates = [v.co for v in baked.data.vertices]
    minimum = [min(v[i] for v in coordinates) for i in range(3)]
    maximum = [max(v[i] for v in coordinates) for i in range(3)]
    baked.data.calc_loop_triangles()
    entry = dict(id=variant, path=str(runtime.relative_to(ROOT)), bytes=runtime.stat().st_size,
                 sha256=hashlib.sha256(runtime.read_bytes()).hexdigest(), triangles=len(baked.data.loop_triangles),
                 radius=max(math.hypot(v.x, v.y) for v in coordinates),
                 bounds_min=[minimum[0], minimum[2], -maximum[1]],
                 bounds_max=[maximum[0], maximum[2], -minimum[1]])
    metadata.append(entry)
    (output / 'export.json').write_text(json.dumps(entry, indent=2) + '\n')
    print('TITANIUM_EXPORT', json.dumps(entry), flush=True)

if metadata:
    manifest = dict(generator='tools/assets/build_titanium_ore.py',
                    source='authored fused sandstone beds and titanium crystals; no scan geometry',
                    texture_sources=['assets/source/polyhaven/titanium/source.json', MOUNTAIN_COLOR, GROUND_COLOR, ORE_GRAIN],
                    references='art/workbench/terrain-composite/ore-designs-v2', license='CC BY-SA 4.0',
                    format='1 mesh, 1 standard PBR material, 1024px WebP color/normal/roughness-metallic',
                    coordinates='Y-up, centered X/Z, ground pivot Y=0; exposed workface local +Z', assets=metadata)
    path = (OUT or ROOT / 'assets/models') / 'titanium-manifest.json'
    if args.variant and path.exists():
        previous = json.loads(path.read_text())['assets']
        manifest['assets'] = [entry for entry in previous if entry['id'] != args.variant] + metadata
    path.write_text(json.dumps(manifest, indent=2) + '\n')
