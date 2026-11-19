"""Ruins, rubble and scrap for the death effects (docs/death_effects.md).

What a building leaves behind, built from the shared building parts and the Aged desert palette:
- command-center-ruin: burnt-out wall stubs around fallen roof plates, girders, machinery and the dish.
- turret-ruin: the cracked feet and pods, the bearing, and the gun lying across them.
- site-rubble, site-rubble-small: the dry heap a half-built Command Center or Turret collapses
  into: fallen scaffold, unfinished wall slabs and bare steel. Nothing in it has burnt.
- scrap-plate, scrap-beam: the pieces thrown about, about a metre long before the game scales them.

Each is centred on its footprint with the ground at Z = 0, in metres. The burnt ruins lie in an
apron of ash whose surface rolls above and below the sand near its edge, so the outline on the
ground is ragged; the site rubble lies on the sand itself. Loose pieces are laid one at a time
onto what is already there, so each rests on the ground or on another piece.

  box blender --background --python-exit-code 1 --python tools/assets/build_death_wreck_ruins.py
  box pull art/workbench/death-wreck/

`--only <name>` builds one model and `--draft` renders it unbaked, without writing a GLB. Both
leave a render in art/workbench/death-wreck/previews/.
"""
import argparse
import json
import math
from pathlib import Path
import random
import sys
from types import SimpleNamespace

import bpy
from mathutils import Euler, Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).parent))
from building_bake import bake_runtime
from building_materials import create_materials
from building_parts import BuildingParts, outline
from death_wreck_common import OUTPUT, ROOT, Graph, base_color, export, preview, scorched

parser = argparse.ArgumentParser()
parser.add_argument('--only', help='Build one model, for example turret-ruin')
parser.add_argument('--draft', action='store_true', help='Render the unbaked pile and write no GLB')
parser.add_argument('--seed', type=int, default=77)
parser.add_argument('--texture-python', default='python3')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
WORK = ROOT/'art/workbench/death-wreck'
WORK.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
clean = create_materials(ROOT/'art/workbench/building-materials/aged-desert', args.texture_python, args.seed)
WEATHERING = json.loads((Path(__file__).parent/'building_materials/palette.json').read_text())['weathering']


def weathering(name, strength=1.0):
    """A weathering colour of the palette as a linear base colour."""
    return tuple(strength*(v/255/12.92 if v/255 <= .04045 else ((v/255 + .055)/1.055)**2.4) for v in WEATHERING[name])


# The default terrain's sand as a base colour, matched in the death-effects stage: pieces fade
# to it where they meet the ground, and so does the edge of the ash.
SAND = (.2, .112, .052)
# The darkest a burnt surface gets. The game's sun still has to show its shape, so this is
# charcoal grey and not black, and soot never covers a finish completely.
CHAR = (.062, .055, .05)
ASH = (.21, .195, .175)
EMBERS = (.1, .088, .076)
RUST = (.14, .062, .03)
HEAT_STAIN = (.105, .05, .034)
FRACTURE = weathering('paint_highlight', .4)
BARE_METAL = weathering('exposed_metal', .7)
DUST = weathering('dust')
# Bare steel and its ribs as the construction site draws them (src/construction/reveal.ts),
# lifted a little: lying in the open the plates are scuffed and dusty.
STEEL = (.082, .072, .062)
STEEL_RIB = (.15, .1, .052)
CUT_EDGE = (.4, .33, .23)


def refinished(source, name, paint):
    """A copy of a palette finish with its colour reworked by `paint(graph, colour)`. It bakes as
    a non-metal: the game has no reflection environment, so metal there renders black."""
    material = source.copy()
    material.name = name
    shader = material.node_tree.nodes['Principled BSDF']
    material.node_tree.links.new(paint(Graph(material), base_color(material)), shader.inputs['Base Color'])
    shader.inputs['Metallic'].default_value = 0
    return material


def plain(name, paint):
    """A finish with no panel tile, coloured by `paint(graph)` from where a surface is in the pile."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes['Principled BSDF']
    material.node_tree.links.new(paint(Graph(material)), shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value = .9
    return material


def grounded(graph, color, reach, settled):
    """Sand against the first `reach` metres above the ground, and `settled` of it on what faces the sky."""
    dusted = graph.mix(color, SAND, graph.scaled(graph.skyward(), settled))
    return graph.mix(SAND, dusted, graph.height(-.02, reach))


def burnt(size, core, seed, value, soot, edge, chip=.045, stain=None):
    """The burnt-out look of a palette finish: its paint dulled to `value`, soot in blotches about
    `size` metres wide and heavier inside the `core` radius, the `edge` colour showing `chip`
    metres in from where plates broke, and an optional heat `stain`."""
    def paint(graph, color):
        color = graph.faded(color, .6, value)
        if stain:
            color = graph.mix(color, stain, graph.scaled(graph.noise(2.4/size, .44, .6, seed + 3.1), .8))
        char = graph.mix(CHAR, ASH, graph.scaled(graph.noise(11, .5, .78, seed + 7), .55))
        sooted = graph.mix(graph.noise(1.6/size, soot - .16, soot + .04, seed), graph.noise(1.6/size, soot, soot + .2, seed),
                           graph.radius(core, core*1.3))
        color = graph.mix(color, char, graph.scaled(sooted, .8))
        # Smudges a hand wide, so a piece smaller than a soot blotch is not one flat tone.
        color = graph.mix(color, char, graph.scaled(graph.noise(9/size, .5, .68, seed + 13), .4))
        color = graph.mix(color, edge, graph.scaled(graph.edges(chip), .6))
        return grounded(graph, color, .05*size, .22)
    return paint


def unburnt(seed, value=1.0, tint=None):
    """A palette finish as it lies in a collapsed site: sand blown over it in patches, nothing burnt."""
    def paint(graph, color):
        color = graph.faded(color, 1, value)
        if tint:
            color = graph.mix(color, tint, 1, 'MULTIPLY')
        color = graph.mix(color, DUST, graph.scaled(graph.noise(1.3, .45, .7, seed), .22))
        return grounded(graph, color, .1, .3)
    return paint


def burnt_finishes(name, size, core, depth, seed):
    """The finishes of a burnt ruin whose ash lies up to `depth` metres deep."""
    def finish(source, label, *look):
        return refinished(source, f'{name} {label}', burnt(size, core, seed + len(label), *look))

    def ash(graph):
        heap = graph.mix(EMBERS, CHAR, graph.noise(2.8/size, .42, .62, seed))
        heap = graph.mix(heap, ASH, graph.scaled(graph.noise(8/size, .5, .7, seed + 2), .45))
        heap = graph.mix(heap, ASH, graph.scaled(graph.noise(14, .54, .72, seed + 5), .7))
        scorched_sand = tuple(.5*sand + .5*char for sand, char in zip(SAND, CHAR))
        return graph.mix(SAND, graph.mix(scorched_sand, heap, graph.height(.1*depth, .45*depth)), graph.height(-.03, .1*depth))

    def broken(graph):
        return grounded(graph, graph.mix(FRACTURE, CHAR, graph.scaled(graph.noise(3/size, .34, .6, seed), .72)), .04*size, .15)

    return SimpleNamespace(armor=finish(clean.armor, 'armor', .3, .43, FRACTURE), roof=finish(clean.roof, 'roof', .3, .42, FRACTURE),
                           # The inside of a wall, where the fire was.
                           lining=finish(clean.armor, 'lining', .26, .3, FRACTURE),
                           metal=finish(clean.machinery, 'graphite', 1.5, .56, BARE_METAL, .025, RUST),
                           trim=finish(clean.structure, 'bronze', .8, .58, BARE_METAL, .025, HEAT_STAIN),
                           broken=plain(name+' break', broken), ash=plain(name+' ash', ash))


def site_finishes(name, seed):
    """The finishes of a collapsed construction site."""
    def steel(color):
        return lambda graph: grounded(graph, graph.mix(color, DUST, graph.scaled(graph.noise(2.2, .4, .7, seed), .3)), .1, .3)

    return SimpleNamespace(armor=refinished(clean.armor, name+' wall', unburnt(seed, .95)),
                           # The scaffold kit's ochre paint and graphite braces (build_scaffold_kit.py).
                           ochre=refinished(clean.structure, name+' scaffold', unburnt(seed + 3, tint=(1.75, 1.7, 1.55))),
                           brace=refinished(clean.machinery, name+' brace', unburnt(seed + 6, 1.5)),
                           steel=plain(name+' steel', steel(STEEL)), rib=plain(name+' rib', steel(STEEL_RIB)),
                           cut=plain(name+' cut edge', steel(CUT_EDGE)))


class Shape:
    """The geometry of one loose piece, built around its own origin before it is laid on the pile.
    Every face names a slot: the place of its material in the list the piece is made with."""

    def __init__(self):
        self.vertices, self.faces, self.slots, self.smooth, self.uvs = [], [], [], [], []

    def points(self, points, matrix=None):
        start = len(self.vertices)
        self.vertices += [matrix @ Vector(point) if matrix else Vector(point) for point in points]
        return start

    def face(self, corners, slot=0, smooth=False, uv=None):
        """`uv` maps the face's vertices to texture coordinates; without it the face gets one whole tile."""
        self.faces.append(tuple(corners))
        self.slots.append(slot)
        self.smooth.append(smooth)
        self.uvs.append(uv)

    def prism(self, ring, low, high, slots=(0, 0), matrix=None, floor=True):
        """A column over the counter-clockwise `ring` from `low` up to `high`, which may give each
        corner its own height for a broken top. `slots` are the top, the sides and, if given, the
        underside; a piece that lies on the ground needs no `floor`."""
        count = len(ring)
        highs = high if isinstance(high, (list, tuple)) else [high]*count
        start = self.points([(x, y, low) for x, y in ring] + [(x, y, z) for (x, y), z in zip(ring, highs)], matrix)
        self.face(range(start + count, start + 2*count), slots[0])
        if floor:
            self.face(reversed(range(start, start + count)), slots[-1] if len(slots) > 2 else slots[0])
        for a in range(count):
            b = (a + 1) % count
            self.face((start + a, start + b, start + count + b, start + count + a), slots[1])
        return self

    def plate(self, ring, thickness, slots, fold=None, angle=0.0):
        """A slab on z = 0, bent up by `angle` along the line x = `fold`."""
        if fold is None:
            return self.prism(ring, 0, thickness, slots)
        near, far = split(ring, fold)
        hinge = Matrix.Translation((fold, 0, 0)) @ Matrix.Rotation(-angle, 4, 'Y') @ Matrix.Translation((-fold, 0, 0))
        self.prism(near, 0, thickness, slots)
        return self.prism(far, 0, thickness, slots, hinge)

    def tube(self, path, radius, slot=0, sides=6, matrix=None):
        """A tube through the points of `path`, bent where they turn. Its tile repeats every metre
        of length, so the tile's seams read as the joints between lengths of tube."""
        path = [Vector(point) for point in path]
        headings = [(b - a).normalized() for a, b in zip(path, path[1:])]
        tangents = [headings[0]] + [(a + b).normalized() for a, b in zip(headings, headings[1:])] + [headings[-1]]
        side, travelled, rings = headings[0].orthogonal().normalized(), 0, []
        for index, (point, tangent) in enumerate(zip(path, tangents)):
            side = (side - tangent*side.dot(tangent)).normalized()
            other = tangent.cross(side)
            travelled += (point - path[index - 1]).length if index else 0
            rings.append((self.points([point + (side*math.cos(turn) + other*math.sin(turn))*radius
                                       for turn in (step*math.tau/sides for step in range(sides))], matrix), travelled))
        for (a, va), (b, vb) in zip(rings, rings[1:]):
            for k in range(sides):
                n = (k + 1) % sides
                self.face((a + k, a + n, b + n, b + k), slot, sides > 4,
                          {a + k: (k/sides, va), a + n: ((k + 1)/sides, va), b + n: ((k + 1)/sides, vb), b + k: (k/sides, vb)})
        self.face(reversed(range(rings[0][0], rings[0][0] + sides)), slot)
        self.face(range(rings[-1][0], rings[-1][0] + sides), slot)
        return self

    def wall(self, dice, length, peak, thickness, strong, ribs=0):
        """A wall along x broken off along a jagged line, tallest at its `strong` end (1 for +x,
        -1 for -x). Slot 0 is the outer face at -y, slot 1 the break, slot 2 the lining, and slot 3
        the frame, which a wall with `ribs` has: a sill along the foot of the outer face and that
        many members on the lining, which outlast the wall above them."""
        stations, profile = [-length/2], []
        while stations[-1] < length/2 - .3:
            stations.append(min(length/2, stations[-1] + dice.uniform(.28, .6)))
        for station, x in enumerate(stations):
            top = peak*(.25 + .75*(.5 + strong*x/length))*dice.uniform(.6, 1)
            profile.append((station, top))
            if 0 < station < len(stations) - 1 and dice.random() < .35:
                profile.append((station, top*dice.uniform(.45, .8)))
        low, half = -.3, thickness/2
        bases = self.points([(x, side, low) for x in stations for side in (-half, half)])
        tops = self.points([(stations[station], side, top) for station, top in profile for side in (-half, half)])

        def uv(*corners):
            return {corner: (self.vertices[corner].x/1.6, self.vertices[corner].z/1.3) for corner in corners}

        for index, ((a, _), (b, _)) in enumerate(zip(profile, profile[1:])):
            outer, inner = tops + 2*index, tops + 2*index + 1
            self.face((outer, outer + 2, inner + 2, inner), 1)
            if a != b:
                corners = (bases + 2*a, bases + 2*b, outer + 2, outer)
                self.face(corners, 0, uv=uv(*corners))
                corners = (bases + 2*b + 1, bases + 2*a + 1, inner, inner + 2)
                self.face(corners, 2, uv=uv(*corners))
                self.face((bases + 2*b, bases + 2*a, bases + 2*a + 1, bases + 2*b + 1), 2)
        last = len(profile) - 1
        self.face((bases, tops, tops + 1, bases + 1), 1)
        self.face((bases + 2*len(stations) - 1, tops + 2*last + 1, tops + 2*last, bases + 2*len(stations) - 2), 1)
        if ribs:
            self.prism([(-length/2, -half - .07), (length/2, -half - .07), (length/2, -half), (-length/2, -half)], low, .26, (3, 3))
        for _ in range(ribs):
            x = dice.uniform(-length/2 + .3, length/2 - .3)
            top = min(top for station, top in profile if abs(stations[station] - x) < .6) + dice.uniform(.3, 1)
            self.prism([(x - .08, half), (x + .08, half), (x + .08, half + .17), (x - .08, half + .17)], low, top, (3, 3))
        return self


def split(ring, at):
    """The parts of a convex outline before and after the line x = at."""
    def part(keeps):
        points = []
        for a, b in zip(ring, ring[1:] + ring[:1]):
            if keeps(a[0]):
                points.append(a)
            if keeps(a[0]) != keeps(b[0]):
                points.append((at, a[1] + (b[1] - a[1])*(at - a[0])/(b[0] - a[0])))
        return points
    return part(lambda x: x <= at), part(lambda x: x > at)


def chipped(dice, length, width):
    """A rectangle from x = 0 to `length` with its corners knocked off unevenly."""
    x, y = length, width/2

    def cut(span):
        return span*dice.uniform(.04, .3)
    return [(cut(x), -y), (x - cut(x), -y), (x, -y + cut(width)), (x, y - cut(width)),
            (x - cut(x), y), (cut(x), y), (0, y - cut(width)), (0, -y + cut(width))]


def lump(dice, size, squash=.5):
    """An uneven outline `size` across, counter-clockwise around the origin."""
    count = dice.randint(4, 6)
    return [(math.cos(turn)*reach, math.sin(turn)*reach*squash**dice.random())
            for turn, reach in (((step + dice.uniform(-.3, .3))*math.tau/count, size/2*dice.uniform(.6, 1)) for step in range(count))]


def shard(dice, size):
    """A broken-off chunk: slot 0 its face, slot 1 the break around it."""
    ring = lump(dice, size)
    return Shape().prism(ring, 0, [size*dice.uniform(.2, .5) for _ in ring], (0, 1), floor=False)


def crumb(dice, size):
    """A piece too small to show a face: a low peak, so the atlas spends one island on it."""
    shape = Shape()
    ring = lump(dice, size)
    start = shape.points([(x, y, 0) for x, y in ring] + [(0, 0, size*dice.uniform(.25, .45))])
    for a in range(len(ring)):
        shape.face((start + a, start + (a + 1) % len(ring), start + len(ring)), 0, True)
    return shape


def samples(obj, spacing=.25):
    """Points over the object's faces, close enough together to find what it comes to rest on."""
    points = []
    for polygon in obj.data.polygons:
        corners = [obj.data.vertices[index].co for index in polygon.vertices]
        for a, b in zip(corners, corners[1:] + corners[:1]):
            steps = max(1, math.ceil((b - a).length/spacing))
            for step in range(steps):
                edge = a.lerp(b, step/steps)
                inward = max(1, math.ceil((polygon.center - edge).length/spacing))
                points += [edge.lerp(polygon.center, share/inward) for share in range(inward)]
    return points


def edge_distance(ring, angle):
    """How far the outline `ring` is from the origin in the direction `angle`."""
    direction = Vector((math.cos(angle), math.sin(angle)))
    hits = []
    for a, b in zip(ring, ring[1:] + ring[:1]):
        a, along = Vector(a), Vector(b) - Vector(a)
        across = direction.cross(along)
        if abs(across) > 1e-9 and 0 <= a.cross(direction)/across <= 1 and a.cross(along)/across > 0:
            hits.append(a.cross(along)/across)
    return min(hits)


def bake(parts, name, atlas, turn=0.0):
    """Bakes the parts into one mesh and atlas, writes its GLB and returns the build report line.
    A draft only renders the parts as they are."""
    if args.draft:
        preview(parts, name, 0, turn)
        return {'file': name, 'draft': True}
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        bpy.context.view_layer.objects.active = obj
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(True)
    # The finishes read the surface's place in the pile, so the joined mesh must keep world coordinates.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    folder = WORK/name
    folder.mkdir(exist_ok=True)
    runtime = bake_runtime(parts, folder, size=atlas, name=name)
    runtime.name = ''.join(part.title() for part in name.split('-'))
    # Nothing in a ruin is lit from inside, so the black emission map is left out of the GLB.
    shader = runtime.active_material.node_tree.nodes['Principled BSDF']
    for link in list(shader.inputs['Emission Color'].links):
        runtime.active_material.node_tree.links.remove(link)
    shader.inputs['Emission Strength'].default_value = 0
    line = export([runtime], name)
    preview([runtime], name, 0, turn)
    bpy.data.objects.remove(runtime)
    return line


class Ruin:
    """One pile of pieces, laid in order with its own seeded dice."""

    def __init__(self, name, seed, finishes, turn=0.0):
        self.name, self.finishes, self.turn = name, finishes, turn
        self.dice = random.Random(seed)
        self.kit = BuildingParts(clean)
        self.pile_vertices, self.pile_faces, self.tree = [], [], None

    def between(self, low, high):
        return low + (high - low)*self.dice.random()

    def piece(self, label, shape, materials, closed=True):
        """Makes a shape into a part; `materials` fill its slots in order."""
        obj = self.kit.mesh(f'{self.name} / {label}', shape.vertices, shape.faces, materials[0], closed=closed)
        for material in materials[1:]:
            obj.data.materials.append(material)
        uv = obj.data.uv_layers.active.data
        for polygon, slot, smooth, custom in zip(obj.data.polygons, shape.slots, shape.smooth, shape.uvs):
            polygon.material_index, polygon.use_smooth = slot, smooth
            for loop in polygon.loop_indices if custom else ():
                uv[loop].uv = custom[obj.data.loops[loop].vertex_index]
        return obj

    def height(self, x, y):
        """The top of the pile at a point, or the ground where nothing lies yet."""
        if self.tree is None and self.pile_faces:
            self.tree = BVHTree.FromPolygons(self.pile_vertices, self.pile_faces)
        hit = self.tree.ray_cast(Vector((x, y, 60)), Vector((0, 0, -1)))[0] if self.tree else None
        return max(0, hit.z) if hit else 0

    def clearance(self, points, matrix):
        return min(point.z - self.height(point.x, point.y) for point in (matrix @ point for point in points))

    def rest(self, obj, matrix):
        """Fixes a part where `matrix` puts it and makes it part of the pile."""
        obj.matrix_world = matrix
        start = len(self.pile_vertices)
        self.pile_vertices += [matrix @ vertex.co for vertex in obj.data.vertices]
        self.pile_faces += [[start + index for index in polygon.vertices] for polygon in obj.data.polygons]
        self.tree = None
        return obj

    def drop(self, obj, x, y, rotation=(0, 0, 0), sink=.03):
        """Lowers a part onto the pile in the given pose until it touches, then `sink` further."""
        matrix = Matrix.Translation((x, y, 0)) @ Euler(rotation).to_matrix().to_4x4()
        return self.rest(obj, Matrix.Translation((0, 0, -self.clearance(samples(obj), matrix) - sink)) @ matrix)

    def lean(self, obj, place, limit=.6, roll=0.0, sink=.04):
        """Stands a part that runs along its own +X on the pile, its origin at the `x, y` and its
        heading at the `yaw` that `place()` returns, and lets it fall until it rests on the pile or
        flat on the ground. Where it would come to rest steeper than `limit`, another place is tried."""
        points = samples(obj)
        length = max(point.x for point in points)
        far = [point for point in points if point.x > .3*length]
        lift = -min(point.z for point in points if point.x < .3*length) - sink
        best = None
        for _ in range(12):
            x, y, yaw = place()
            stand = Matrix.Translation((x, y, self.height(x, y) + lift)) @ Matrix.Rotation(yaw, 4, 'Z')
            pitch = 1.3
            while pitch > 0 and self.clearance(far, stand @ Matrix.Rotation(-pitch, 4, 'Y') @ Matrix.Rotation(roll, 4, 'X')) > 0:
                pitch -= .02
            if best is None or pitch < best[0]:
                best = (pitch, stand @ Matrix.Rotation(-max(pitch, 0), 4, 'Y') @ Matrix.Rotation(roll, 4, 'X'))
            if pitch <= limit:
                break
        return self.rest(obj, best[1])

    def apron(self, ring, height, segments, roll, spread=.98):
        """The ash and grit a burnt ruin lies in: a low heap over the footprint `ring`. Near its edge
        the surface rolls `roll` metres above and below the sand, so the game's ground cuts it along
        a ragged line. A skirt under the edge covers ground that falls away on a slope."""
        phases = [self.between(0, math.tau) for _ in range(5)]
        drift = self.between(0, 50)

        def rim(angle):
            lobes = sum(size*math.sin(count*angle + phase)
                        for (count, size), phase in zip(((2, .05), (3, .06), (5, .05), (8, .035), (13, .025)), phases))
            return edge_distance(ring, angle)*(spread + lobes)

        def surface(share, x, y):
            lumps = .75 + .7*noise.noise(Vector((x*.45, y*.45, drift)))
            rubble = noise.noise(Vector((x*2.2, y*2.2, drift + 9))) + .5*noise.noise(Vector((x*5, y*5, drift + 19)))
            return height*(1 - share**1.5)*lumps + 1.4*roll*rubble - 1.2*roll*share**6

        shares = (.1, .2, .3, .4, .5, .6, .68, .75, .81, .86, .9, .94, .97, 1)
        vertices = [(0, 0, surface(0, 0, 0))]
        for share in shares:
            for step in range(segments):
                angle = step*math.tau/segments
                x, y = math.cos(angle)*rim(angle)*share, math.sin(angle)*rim(angle)*share
                vertices.append((x, y, surface(share, x, y)))
        vertices += [(x, y, -.5) for x, y, _ in vertices[-segments:]]
        faces = [(0, 1 + step, 1 + (step + 1) % segments) for step in range(segments)]
        for row in range(len(shares)):
            a, b = 1 + row*segments, 1 + (row + 1)*segments
            faces += [(a + step, b + step, b + (step + 1) % segments, a + (step + 1) % segments) for step in range(segments)]
        obj = self.kit.mesh(self.name+' / ash', vertices, faces, self.finishes.ash, closed=False)
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        self.reach = rim
        return self.rest(obj, Matrix())

    def scatter(self, count, near, far, low, high, kinds, chunk=shard):
        """Loose chunks dropped on the pile between the shares `near` and `far` of its reach,
        thinning out and getting smaller toward the edge. `kinds` are the material lists to pick from."""
        for index in range(count):
            angle, share = self.between(0, math.tau), self.between(near, far)
            distance, size = self.reach(angle)*share, self.between(low, high)*(1.2 - .6*share/far)
            self.drop(self.piece(f'chunk {index}', chunk(self.dice, size), self.dice.choice(kinds), closed=False),
                      math.cos(angle)*distance, math.sin(angle)*distance,
                      (self.between(-.5, .5), self.between(-.5, .5), self.between(0, math.tau)), size*.1)

    def surface_report(self, points):
        """Prints how high the pile stands under each smoke and flame point of the game (x, up, z)."""
        print('EMITTERS '+json.dumps([{'point': point, 'pile top': round(self.height(point[0], -point[2]), 2)} for point in points]),
              flush=True)

    def finish(self, atlas):
        return bake(self.kit.parts, self.name, atlas, self.turn)


def hulk(dice, width, depth, height):
    """A burnt-out machine: slot 0 its graphite body and tank, slot 1 bronze fittings, slot 2 a
    scrap of armor still bolted on, slot 3 that armor's broken edge."""
    shape = Shape()
    x, y = width/2, depth/2
    ring = [(-x, -y), (x, -y), (x*dice.uniform(.8, 1), y), (-x*dice.uniform(.8, 1), y)]
    shape.prism(ring, 0, [height*dice.uniform(.82, 1) for _ in ring])
    shape.prism([(px*1.07, py*1.07) for px, py in ring], height*.34, height*.46, (1, 1))
    shape.tube([(-x*.7, y + .26, .27), (x*.6, y + .26, .31)], .27, 0, 8)
    shape.tube([(x*.4, -y, height*.6), (x*.4, -y - .28, height*.66), (x*.45, -y - .4, 0)], .06, 1)
    lid = Matrix.Translation((-x*.2, 0, height*.86)) @ Matrix.Rotation(dice.uniform(.15, .35), 4, 'Y')
    return shape.prism(chipped(dice, width*.8, depth*.9), 0, .12, (2, 3), lid)


def command_center_ruin():
    # The game stands a Command Center at a quarter turn, which puts this model's -Y toward the
    # camera: the tall stubs stand at the back, +Y, and the front is blown open.
    f = burnt_finishes('command-center-ruin', 3.2, 3.5, .75, args.seed)
    ruin = Ruin('command-center-ruin', args.seed, f, math.pi/4)
    footprint = outline(8.8, 9.8, 1.5)
    ruin.apron(footprint, .75, 88, .1)
    stub, corner = [f.armor, f.broken, f.lining, f.trim], [f.broken, f.armor]
    # Corner piers outlast the walls between them: height at each corner of the octagon the
    # building stood on, counted from the front left. The front right corner is gone.
    for index, height in enumerate([.5, 0, .7, 1.6, 2.3, 3.3, 2.6, 1.2]):
        if height:
            x, y = Vector(footprint[index])*.955
            ring = lump(ruin.dice, .85, 1)
            pier = Shape().prism(ring, -.3, [height*ruin.between(.85, 1) for _ in ring], (0, 1))
            ruin.rest(ruin.piece(f'pier {index}', pier, corner),
                      Matrix.Translation((x, y, 0)) @ Matrix.Rotation(ruin.between(-.06, .06), 4, 'X'))
    # Wall stubs: peak height, share of the side still standing, and the end that held (1 the far corner).
    walls = {0: (.55, .3, -1), 2: (1.3, .7, 1), 3: (2, .8, 1), 4: (2.6, .9, 1), 5: (3, .85, -1), 6: (2, .8, -1), 7: (.9, .6, -1)}
    for side, (peak, share, strong) in walls.items():
        a, b = Vector(footprint[side]), Vector(footprint[(side + 1) % 8])
        along = b - a
        middle = (a + b)/2 + along*strong*(1 - share)/2
        wall = Shape().wall(ruin.dice, along.length*share, peak, .45, strong, ribs=2 if peak > 1 else 1)
        ruin.rest(ruin.piece(f'wall stub {side}', wall, stub, closed=False),
                  Matrix.Translation((*(middle*.955), 0)) @ Matrix.Rotation(math.atan2(along.y, along.x), 4, 'Z')
                  @ Matrix.Rotation(ruin.between(-.1, .1), 4, 'X'))
    # A burnt-out machine stands under each of the game's four smoke and flame points.
    emitters = [(.4, 1.4, -.6), (-2.2, 1, 1.6), (2.3, .9, 1.9), (-1.4, 1.2, -2.6)]
    machine = [f.metal, f.trim, f.armor, f.broken]
    for index, ((x, top, z), (width, depth)) in enumerate(zip(emitters, [(1.9, 1.5), (1.3, 1.1), (1.2, 1), (1.4, 1.1)])):
        height = top - ruin.height(x, -z) + .1
        ruin.drop(ruin.piece(f'machine {index}', hulk(ruin.dice, width, depth, height), machine), x, -z,
                  (ruin.between(-.06, .06), ruin.between(-.06, .06), ruin.between(0, math.tau)), .1)
    # The roof came down in plates around the machine at the centre. They stop short of it, so
    # its top, the first flame point, stays open.
    for index in range(6):
        def beside_core():
            angle, distance = index*math.tau/6 + ruin.between(-.3, .3), ruin.between(2.5, 3.4)
            return (emitters[0][0] + math.cos(angle)*distance, -emitters[0][2] + math.sin(angle)*distance,
                    angle + math.pi + ruin.between(-.4, .4))
        length, width = ruin.between(1.9, 2.7), ruin.between(1.6, 2.4)
        plate = Shape().plate(chipped(ruin.dice, length, width), .2, (0, 1, 2), length*ruin.between(.4, .7), ruin.between(-.5, .3))
        ruin.lean(ruin.piece(f'roof plate {index}', plate, [f.roof if index % 2 else f.armor, f.broken, f.metal]), beside_core,
                  roll=ruin.between(-.25, .25))
    # The dish is the one part of the roof that stays whole enough to recognise. It lies in the open front.
    dish = ruin.kit.lathe('command-center-ruin / fallen dish',
                          [(.05, .02), (.55, .07), (1.05, .27), (1.36, .56), (1.33, .6), (1.02, .32), (.53, .13), (.05, .09)],
                          f.roof, segments=24)
    ruin.drop(dish, 1.2, -3.5, (1.0, .25, .5), .12)
    # Girders: some fell outward against the back walls, some lie across the heap, a few stand in it.
    for index in range(11):
        girder = Shape().tube([(0, 0, 0), (ruin.between(2.4, 3.6), 0, 0)], ruin.between(.07, .1), 0, 4)
        part = ruin.piece(f'girder {index}', girder, [f.trim if index % 3 == 0 else f.metal])
        def toward_back_wall():
            angle, distance = ruin.between(.3, 3.3), ruin.between(1.6, 2.4)
            return math.cos(angle)*distance, math.sin(angle)*distance, angle + ruin.between(-.5, .5)

        def across_front():
            angle, distance = ruin.between(3.4, 6), ruin.between(2, 3.4)
            return math.cos(angle)*distance, math.sin(angle)*distance, angle + math.pi/2 + ruin.between(-.5, .5)
        if index < 5:
            ruin.lean(part, toward_back_wall, 1.1, ruin.between(0, 1.5))
        elif index < 8:
            ruin.lean(part, across_front, .4, ruin.between(0, 1.5))
        else:
            angle, distance = ruin.between(0, math.tau), ruin.between(1.4, 3)
            x, y = math.cos(angle)*distance, math.sin(angle)*distance
            ruin.rest(part, Matrix.Translation((x, y, ruin.height(x, y) - .6)) @ Matrix.Rotation(ruin.between(0, math.tau), 4, 'Z')
                      @ Matrix.Rotation(-ruin.between(.8, 1.25), 4, 'Y'))
    kinds = [[f.armor, f.broken], [f.armor, f.broken], [f.roof, f.broken], [f.metal, f.metal], [f.trim, f.trim]]
    ruin.scatter(120, .12, .98, .25, .7, kinds)
    ruin.scatter(110, .7, 1.07, .12, .3, [[f.armor], [f.broken], [f.metal], [f.trim]], crumb)
    ruin.surface_report(emitters)
    return ruin.finish(1024)


def turret_ruin():
    f = burnt_finishes('turret-ruin', 1.6, .8, .26, args.seed + 1)
    ruin = Ruin('turret-ruin', args.seed + 1, f)
    ruin.apron([(math.cos(step*math.tau/16)*1.58, math.sin(step*math.tau/16)*1.58) for step in range(16)], .26, 44, .055, 1.05)
    # Four feet with a service pod between each pair, as the Turret stands; one foot is shattered.
    for index, (foot, pod) in enumerate(zip([.95, .7, .22, .55], [.42, .2, .34, .12])):
        angle = index*math.tau/4 + .12
        wall = Shape().wall(ruin.dice, .95, foot, .5, ruin.dice.choice((-1, 1)))
        ruin.rest(ruin.piece(f'foot {index}', wall, [f.armor, f.broken, f.armor], closed=False),
                  Matrix.Translation((math.cos(angle)*1.05, math.sin(angle)*1.05, 0)) @ Matrix.Rotation(angle + math.pi/2, 4, 'Z')
                  @ Matrix.Rotation(ruin.between(-.15, .15), 4, 'X'))
        angle += math.tau/8
        ring = [(math.cos(step*math.tau/8)*.36, math.sin(step*math.tau/8)*.36) for step in range(8)]
        ruin.rest(ruin.piece(f'pod {index}', Shape().prism(ring, -.2, [pod*ruin.between(.6, 1) for _ in ring], (1, 0)), [f.metal, f.broken]),
                  Matrix.Translation((math.cos(angle)*.98, math.sin(angle)*.98, 0)))
    # The bearing's top is the game's one smoke and flame point, half a metre up at the centre.
    drum = ruin.kit.lathe('turret-ruin / bearing drum', [(.62, -.1), (.62, .3), (.5, .38), (.5, .47), (.3, .5)], f.metal, 18)
    ruin.rest(drum, Euler((.1, -.08, 0)).to_matrix().to_4x4())
    race = ruin.kit.lathe('turret-ruin / bearing race', [(.5, 0), (.64, 0), (.64, .1), (.5, .1)], f.trim, 20, closed_profile=True)
    ruin.drop(race, -.3, .25, (.45, .2, 0), .03)
    # The head lies on its side across the feet with its two barrels pointing at the sky.
    head = Shape().prism([(-.65, -.42), (.65, -.42), (.65, .42), (-.65, .42)], 0, .55)
    head.prism(chipped(ruin.dice, 1.15, .7), .55, .67, (1, 2), Matrix.Translation((-.6, 0, 0)))
    for side in (-.2, .2):
        head.tube([(-.6, side, .3), (-1.2, side, .3), (-1.6, side + ruin.between(-.15, .15), .3 + ruin.between(-.1, .25))], .085, 0)
        head.tube([(-.65, side, .3), (-.95, side, .3)], .13, 3)
    ruin.drop(ruin.piece('head', head, [f.metal, f.armor, f.broken, f.trim]), .5, -.42, (1.2, .25, .75), .05)
    kinds = [[f.armor, f.broken], [f.armor, f.broken], [f.metal, f.metal], [f.trim, f.trim]]
    ruin.scatter(30, .15, .98, .14, .36, kinds)
    ruin.scatter(36, .65, 1.06, .07, .16, [[f.armor], [f.broken], [f.metal], [f.trim]], crumb)
    ruin.surface_report([(0, .5, 0)])
    return ruin.finish(512)


def scaffold_frame(dice, length, bay):
    """Two scaffold posts along +X from their feet at the origin, still joined by rails and a brace
    and bent by the fall. Slot 0 is ochre tube, slot 1 the graphite brace."""
    shape = Shape()
    knee = length*dice.uniform(.45, .7)
    posts = [[Vector((0, side, 0)), Vector((knee, side + dice.uniform(-.08, .08), dice.uniform(-.05, .12))),
              Vector((length, side + dice.uniform(-.3, .3), dice.uniform(-.25, .2)))] for side in (-bay/2, bay/2)]

    def on_post(post, x):
        a, b = (post[0], post[1]) if x <= knee else (post[1], post[2])
        return a.lerp(b, (x - a.x)/(b.x - a.x))

    rails = [length*share for share in (.12, .5, .88)][:dice.randint(2, 3)]
    for post in posts:
        shape.tube(post, .06)
        for x in rails:
            shape.tube([on_post(post, x - .09), on_post(post, x + .09)], .085)
    for x in rails:
        shape.tube([on_post(posts[0], x), on_post(posts[1], x)], .048)
    shape.tube([on_post(posts[0], rails[0]) + Vector((.1, 0, .02)), on_post(posts[1], rails[1]) + Vector((-.1, 0, .02))], .036, 1, 5)
    return shape


def site_rubble(name, seed, reach, slab, pole, bay, slabs, decks, frames, tubes, posts, chips, atlas):
    """What a half-built site falls into. `reach` is the radius the pieces stay inside, `slab` and
    `pole` the shortest and longest wall slab and scaffold tube, `bay` the spacing of the posts.
    Tubes and plates keep the scaffold's own thickness at every size."""
    f = site_finishes(name, seed)
    ruin = Ruin(name, seed, f)
    ruin.reach = lambda angle: reach

    def around(near, far):
        angle, distance = ruin.between(0, math.tau), reach*ruin.between(near, far)
        return math.cos(angle)*distance, math.sin(angle)*distance, angle

    def fallen(length, near, far, swing, turn=math.pi):
        """Places for a piece `length` long to fall from, between two shares of the reach: heading
        for the middle of the heap give or take `swing`, or with a quarter `turn` along the side of
        the site that stood there. The far end stays inside the reach."""
        def place():
            for _ in range(40):
                x, y, angle = around(near, far)
                yaw = angle + ruin.dice.choice((-1, 1))*turn + ruin.between(-swing, swing)
                if math.hypot(x + math.cos(yaw)*length, y + math.sin(yaw)*length) < reach:
                    break
            return x, y, yaw
        return place

    # Wall slabs: sand-ivory outside, bare steel inside. The first lie flat, the rest fall onto them.
    for index in range(slabs):
        length, width = ruin.between(*slab), ruin.between(*slab)*.72
        fold = (length*ruin.between(.35, .65), ruin.between(-.3, .3)) if index % 3 == 2 else ()
        part = ruin.piece(f'wall slab {index}', Shape().plate(chipped(ruin.dice, length, width), .17, (0, 1, 2), *fold),
                          [f.steel, f.cut, f.armor] if index % 5 == 3 else [f.armor, f.cut, f.steel])
        if index < slabs*.4:
            x, y, _ = around(0, .42)
            ruin.drop(part, x - length*.3, y, (ruin.between(-.1, .1), ruin.between(-.1, .1), ruin.between(0, math.tau)), .04)
        else:
            ruin.lean(part, fallen(length, .35, .85, .5), .7, ruin.between(-.2, .2))
    # Deck plates: the ribbed steel that closed the top of the hull as it rose.
    for index in range(decks):
        length, width = ruin.between(*slab)*.8, ruin.between(*slab)*.55
        deck = Shape().plate(chipped(ruin.dice, length, width), .06, (0, 0))
        for rib in range(1, round(length/.5)):
            deck.prism([(rib*.5 - .035, -width*.36), (rib*.5 + .035, -width*.36), (rib*.5 + .035, width*.36), (rib*.5 - .035, width*.36)],
                       .06, .13, (1, 1))
        ruin.lean(ruin.piece(f'deck plate {index}', deck, [f.steel, f.rib]), fallen(length, .15, .6, .8), roll=ruin.between(-.3, .3))
    # The scaffold: frames that fell still joined, inward or along the wall they stood at, posts
    # bent over where they stood, and loose tubes.
    for index in range(frames):
        length = ruin.between(*pole)*.85
        part = ruin.piece(f'scaffold frame {index}', scaffold_frame(ruin.dice, length, bay), [f.ochre, f.brace])
        ruin.lean(part, fallen(length, .6, .9, .45) if index % 2 else fallen(length, .3, .6, .4, math.pi/2), .5, ruin.between(-.3, .3))
    for index in range(posts):
        angle = index*math.tau/posts + ruin.between(-.3, .3)
        foot = Vector((math.cos(angle), math.sin(angle), 0))*reach*.86
        home, rise = -foot.normalized(), pole[0]*ruin.between(.45, .7)
        knee = foot + Vector((0, 0, rise)) + home*ruin.between(.05, .2)
        tip = knee + home*pole[0]*ruin.between(.3, .5) + Vector((0, 0, ruin.between(-.5, .1)*rise))
        post = Shape().tube([foot - Vector((0, 0, .3)), knee, tip], .06)
        post.prism([(foot.x - .13, foot.y - .13), (foot.x + .13, foot.y - .13), (foot.x + .13, foot.y + .13), (foot.x - .13, foot.y + .13)],
                   -.2, .05)
        ruin.rest(ruin.piece(f'standing post {index}', post, [f.ochre]), Matrix())
    for index in range(tubes):
        length = ruin.between(*pole)
        bend = [(0, 0, 0), (length*ruin.between(.3, .7), ruin.between(-.12, .12), 0), (length, ruin.between(-.35, .35), 0)]
        brace = index % 3 == 0
        ruin.lean(ruin.piece(f'tube {index}', Shape().tube(bend, .036 if brace else .052, 0, 5 if brace else 6),
                             [f.brace if brace else f.ochre]), fallen(length, .2, .92, 1.1), .4)
    ruin.scatter(chips, .1, 1, .14, .38, [[f.armor, f.cut], [f.armor, f.cut], [f.steel, f.steel], [f.ochre, f.ochre]])
    ruin.scatter(chips, .3, 1.04, .06, .14, [[f.armor], [f.cut], [f.steel]], crumb)
    return ruin.finish(atlas)


def scrap_plate():
    kit = BuildingParts(clean)
    armor, metal = scorched(clean.armor, .8, .42, seed=0), scorched(clean.machinery, .8, .36, seed=11.4)
    # A torn armor plate, folded along one line.
    vertices = [(-.5, -.3, 0), (-.05, -.38, .02), (.42, -.2, .2), (.5, .12, .26), (.08, .34, .03), (-.4, .3, 0), (-.56, .02, .04)]
    plate = kit.mesh('scrap-plate / plate', vertices, [(0, 1, 4, 5, 6), (1, 2, 3, 4)], armor, closed=False)
    plate.modifiers.new('Plate thickness', 'SOLIDIFY').thickness = .06
    kit.box('scrap-plate / rib', (-.12, 0, .06), (.5, .07, .09), metal, 0, .3)
    return bake(kit.parts, 'scrap-plate', 256)


def scrap_beam():
    kit = BuildingParts(clean)
    kit.box('scrap-beam / beam', (0, 0, 0), (1.1, .16, .12), clean.armor, .02)
    kit.box('scrap-beam / clamp', (.3, 0, 0), (.2, .22, .18), clean.structure, 0)
    kit.rod('scrap-beam / pole', (-.5, .05, .06), (.2, .42, .1), .045, clean.machinery, 6)
    return bake(kit.parts, 'scrap-beam', 256)


def compare(names, gap, turn=0.0):
    """Renders finished GLBs side by side, `gap` metres apart, at the game's camera angle."""
    if args.draft or not all((OUTPUT/f'{name}.glb').exists() for name in names):
        return
    meshes = []
    for index, name in enumerate(names):
        known = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(OUTPUT/f'{name}.glb'))
        for obj in set(bpy.data.objects) - known:
            obj.location.x += index*gap
            meshes += [obj] if obj.type == 'MESH' else []
    bpy.context.view_layer.update()
    preview(meshes, ' beside '.join(names), 0, turn)
    for obj in meshes:
        bpy.data.objects.remove(obj)


BUILDERS = {
    'command-center-ruin': command_center_ruin, 'turret-ruin': turret_ruin,
    'site-rubble': lambda: site_rubble('site-rubble', args.seed + 2, 4.4, (1.5, 2.8), (2.2, 3.8), 1.6, 12, 3, 5, 10, 4, 46, 1024),
    # Authored at Turret size from the same parts, not shrunk: the tubes and slabs keep their thickness.
    'site-rubble-small': lambda: site_rubble('site-rubble-small', args.seed + 5, 1.75, (.6, 1.15), (1.1, 1.9), 1, 6, 1, 2, 4, 2, 18, 512),
    'scrap-plate': scrap_plate, 'scrap-beam': scrap_beam}
report = [build() for name, build in BUILDERS.items() if args.only in (None, name)]
compare(['turret-ruin', 'site-rubble-small'], 4.5)
compare(['command-center-ruin', 'site-rubble'], 11.5, math.pi/4)
print('RUINS '+json.dumps(report), flush=True)
