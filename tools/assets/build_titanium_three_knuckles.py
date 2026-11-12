"""Author the "Three knuckles" Titanium Deposit after its approved concept image.

blender --background --threads 6 --python-exit-code 1 --python tools/assets/build_titanium_three_knuckles.py -- [--seed 1 2] [--out <dir>] [--draft]

Concept: art/workbench/terrain-composite/ore-designs-v2/three-knuckles.png. Three blocky
masses that touch, dominant behind, half-size and quarter-size in front. They are the broken
top of one ore bed with a sandstone skin: the skin still caps their tops, corners and feet,
and their broken-open faces are the ore itself. Mined out, each face is cut back into a
dull hollow with sand on its floor, inside the same skin.

Each `--seed` composes a sibling outcrop. The first exports `full.glb` and `depleted.glb`,
the next `full-b.glb` and `depleted-b.glb`. `--draft` stops before the bake and renders
`draft-full.png` and `draft-depleted.png` from the game's camera. Nothing is written to
assets/models; review with `bun tools/verify/capture-ore.mjs --model <glb> --out <dir>`.

How a build goes:
1. Masses. Each knuckle is a convex block placed by hand-chosen numbers that the seed
   jitters: a tilted top, leaning sides, and a shoulder between them. A few cracks split it
   into panels that sit a little proud of one another, and corners are chamfered or stepped.
   Blocks, loose chips and banked sand are fused by a voxel remesh.
2. Skin and ore. Every surface point knows the plane it lies on. Planes that face the
   camera and sun lean toward ore, tops and backs toward crust, and noise makes the border
   ragged, so the crust overlaps the ore in patches. Ore sits a few centimetres behind the
   crust and breaks into flat cleavage chips; crust gets worn edges and blocky relief.
3. Depleted. The same surface with every ore region drawn back into its block: a back
   wall that leans, sand on the floor, the crust rim untouched.
4. Runtime. The source is decimated to the triangle budget. Faces that show ore are copied
   and moved to the hollow, so the two states share every other face. One atlas is baked
   from the two high-poly sources with Cycles, and each state is exported as a face subset.

The game never turns the model, the camera or the sun, so the half-vector between sun and
camera is one fixed direction (GLINT). Each mass has an ore shoulder a few degrees off it:
that is where the real sun sheen falls. Steeper ore carries its sheen in the base color.
"""
import argparse
from collections import Counter, deque
import hashlib
import json
import math
from pathlib import Path
import random
import sys
import time
from types import SimpleNamespace

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CLIFF_COLOR = 'assets/textures/terrain/oxide-cliff-color.webp'
SCREE_COLOR = 'assets/textures/terrain/oxide-scree-color.webp'
CLIFF_GRAIN = 'assets/source/polyhaven/titanium/cliff_side_diff_2k.jpg'
GROUND_COLOR = 'assets/textures/terrain/sand-scan.webp'
# The main game multiplies its 30 m sand tile by hsl(29, 94%, 75%); linear RGB here.
GROUND_TINT = (.966, .51, .228)
FOOTPRINT_RADIUS = 5.35
ATLAS = 1024
TRIANGLES = 8600
# The model is authored on a stage turned 45 degrees from the game, where +X is screen
# right and -Y is toward the camera; objects carry the turn until export applies it.
STAGE_TURN = math.radians(45)


def unit(vector):
    vector = np.asarray(vector, float)
    return vector / np.linalg.norm(vector)


def staged(vector):
    return np.array(Matrix.Rotation(-STAGE_TURN, 3, 'Z') @ Vector(vector))


# Directions from the scene toward the game's sun and camera, on the stage.
SUN = unit(staged((-.518, -.327, .791)))
VIEW = unit(staged((.528, -.528, .666)))
GLINT = unit(SUN + VIEW)
UP = np.array((0., 0., 1.))
# Linear RGB. Ore is neutral graphite with the faintest cool cast.
ORE_TINT, ORE_VEIN = (1.05, 1, .94), (.6, .6, .6)
CRUST_PALE, CRUST_RUST, HOLLOW = (.3, .17, .078), (.23, .11, .045), (.23, .15, .09)
# Tried in game in earlier rounds: at .3 the metal reads as painted stone, at .6 shaded sides go near black.
METALNESS = .45
BOTH, FULL, DEPLETED = 0, 1, 2
TOP, SIDE, CRACK, STEP, BASE = 0, 1, 2, 3, 4
# Panels overlap this far past the crack between them, so their union is solid.
OVERLAP = .04
CRUST_THICKNESS = .055

parser = argparse.ArgumentParser()
parser.add_argument('--seed', type=int, nargs='+', default=[1, 2], help='one composition per seed')
parser.add_argument('--draft', action='store_true', help='render the high-poly sources from the game camera without baking')
parser.add_argument('--out', type=Path, default=ROOT / 'art/workbench/titanium-three-knuckles')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = args.out.resolve()
started = time.time()


def log(message):
    print(f'KNUCKLES {time.time() - started:6.1f}s {message}', flush=True)


# --- Noise and mesh arrays ---------------------------------------------------

def hashed(x, y, z, seed):
    """Integer lattice points to [0, 1)."""
    value = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ (seed * 2654435761)
    value = (value ^ (value >> 13)) * 1274126177
    return ((value ^ (value >> 16)) & 0xFFFFFF) / 0x1000000


def value_noise(points, seed):
    """Smooth noise in [-1, 1] over an (N, 3) array."""
    cell = np.floor(points).astype(np.int64)
    blend = points - cell
    blend = blend * blend * (3 - 2 * blend)
    total = 0
    for corner in range(8):
        step = np.array(((corner >> 0) & 1, (corner >> 1) & 1, (corner >> 2) & 1))
        weight = np.prod(np.where(step, blend, 1 - blend), axis=1)
        total = total + weight * hashed(cell[:, 0] + step[0], cell[:, 1] + step[1], cell[:, 2] + step[2], seed)
    return total * 2 - 1


def fbm(points, seed, octaves=3, gain=.5):
    total, amplitude, reach = 0, 1, 0
    for octave in range(octaves):
        total = total + amplitude * value_noise(points * 2 ** octave + octave * 17.3, seed + octave)
        reach += amplitude
        amplitude *= gain
    return total / reach


def chips(points, seed):
    """Flat chips: each scattered cell is a small plane with its own tilt, so the surface
    steps crisply where two chips meet. Returns each point's offset from its chip, a random
    value per chip, the distance to the chip's center, and how much nearer that is than
    the next chip's (0 on the border between chips)."""
    cell = np.floor(points).astype(np.int64)
    best, second = np.full(len(points), 9.), np.full(len(points), 9.)
    offset, roll = np.zeros(len(points)), np.zeros(len(points))
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                near = cell + (dx, dy, dz)
                rolls = [hashed(near[:, 0], near[:, 1], near[:, 2], seed + k) for k in range(7)]
                away = points - (near + np.stack(rolls[:3], 1))
                distance = np.linalg.norm(away, axis=1)
                closer = distance < best
                second = np.where(closer, best, np.minimum(second, distance))
                best[closer] = distance[closer]
                offset[closer] = (away * (np.stack(rolls[3:6], 1) - .5)).sum(1)[closer]
                roll[closer] = rolls[6][closer]
    return np.clip(offset, -.3, .3), roll, best, second - best


def smoothstep(value, low, high):
    t = np.clip((value - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def coords(mesh):
    points = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get('co', points)
    return points.reshape(-1, 3)


def normals(mesh, points=None):
    """Vertex normals, after moving the vertices to `points` if given."""
    if points is not None:
        mesh.vertices.foreach_set('co', points.ravel())
        mesh.update()
    result = np.empty(len(mesh.vertices) * 3)
    mesh.vertex_normals.foreach_get('vector', result)
    return result.reshape(-1, 3)


def edges(mesh):
    result = np.empty(len(mesh.edges) * 2, np.int64)
    mesh.edges.foreach_get('vertices', result)
    return result.reshape(-1, 2)


def corners(mesh):
    """Each face corner's vertex, and the face it belongs to."""
    vertex = np.empty(len(mesh.loops), np.int64)
    mesh.loops.foreach_get('vertex_index', vertex)
    total = np.empty(len(mesh.polygons), np.int64)
    mesh.polygons.foreach_get('loop_total', total)
    return vertex, np.repeat(np.arange(len(total)), total)


def relax(values, edge, repeat, factor=.5):
    """Move each vertex value toward the mean of its neighbours."""
    a, b = edge[:, 0], edge[:, 1]
    count = np.maximum(np.bincount(a, minlength=len(values)) + np.bincount(b, minlength=len(values)), 1)
    flat = values.ndim == 1
    values = values.reshape(len(values), -1)
    for _ in range(repeat):
        total = np.stack([np.bincount(a, values[b, k], len(values)) + np.bincount(b, values[a, k], len(values))
                          for k in range(values.shape[1])], 1)
        values = values + (total / count[:, None] - values) * factor
    return values[:, 0] if flat else values


def tidy(flags, domain, edge, smallest):
    """Flip every connected patch of fewer than `smallest` vertices inside `domain`, so no
    speck of one kind stands alone in the other."""
    flags = flags.copy()
    same = edge[domain[edge].all(1) & (flags[edge[:, 0]] == flags[edge[:, 1]])]
    pairs = np.concatenate([same, same[:, ::-1]])
    pairs = pairs[np.argsort(pairs[:, 0], kind='stable')]
    start = np.searchsorted(pairs[:, 0], np.arange(len(flags) + 1)).tolist()
    beside, seen = pairs[:, 1].tolist(), bytearray(len(flags))
    for vertex in np.nonzero(domain)[0].tolist():
        if seen[vertex]:
            continue
        seen[vertex] = 1
        patch, queue = [vertex], [vertex]
        while queue:
            at = queue.pop()
            for other in beside[start[at]:start[at + 1]]:
                if not seen[other]:
                    seen[other] = 1
                    patch.append(other)
                    queue.append(other)
        if len(patch) < smallest:
            flags[patch] = ~flags[patch]
    return flags


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def new_object(name, points, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(points, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.rotation_euler.z = STAGE_TURN
    bpy.context.collection.objects.link(obj)
    return obj


def duplicate(obj, name):
    copy = obj.copy()
    copy.data = obj.data.copy()
    copy.name = copy.data.name = name
    bpy.context.collection.objects.link(copy)
    return copy


def keep_faces(obj, doomed, smallest=0):
    """Delete the faces whose every corner is `doomed`, then islands of fewer than `smallest` faces."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    if doomed is not None:
        bmesh.ops.delete(bm, geom=[face for face in bm.faces if all(doomed[v.index] for v in face.verts)], context='FACES')
    if smallest:
        seen, scraps = set(), []
        for face in bm.faces:
            if face in seen:
                continue
            island, queue = {face}, [face]
            while queue:
                for edge in queue.pop().edges:
                    for other in edge.link_faces:
                        if other not in island:
                            island.add(other)
                            queue.append(other)
            seen |= island
            if len(island) < smallest:
                scraps += island
        bmesh.ops.delete(bm, geom=scraps, context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def keep_states(obj, states):
    """Delete the faces that belong to none of `states`."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    state = bm.faces.layers.int['state']
    bmesh.ops.delete(bm, geom=[face for face in bm.faces if face[state] not in states], context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def tree_of(mesh):
    vertex, _ = corners(mesh)
    start = np.empty(len(mesh.polygons), np.int64)
    mesh.polygons.foreach_get('loop_start', start)
    faces = np.split(vertex, start[1:])
    return BVHTree.FromPolygons(coords(mesh).tolist(), [face.tolist() for face in faces])


def paint(mesh, name, values):
    """Store (N, 3) vectors or (N, 4) colors per vertex for the source material, replacing earlier ones."""
    if values.shape[1] == 4:
        layer = mesh.color_attributes.get(name) or mesh.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
        layer.data.foreach_set('color', values.ravel())
    else:
        layer = mesh.attributes.get(name) or mesh.attributes.new(name, 'FLOAT_VECTOR', 'POINT')
        layer.data.foreach_set('vector', values.ravel())


# --- Convex solids -------------------------------------------------------------

def carve(bm, normal, offset):
    """Keep the part of a convex solid where normal . p <= offset, and close the cut."""
    cut = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=Vector(normal) * float(offset),
                                 plane_no=Vector(normal), clear_outer=True)
    rim = [item for item in cut['geom_cut'] if isinstance(item, bmesh.types.BMEdge)]
    if rim:
        bmesh.ops.edgeloop_fill(bm, edges=rim)


def convex(planes):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=40)
    for normal, offset in planes:
        carve(bm, normal, offset)
    return bm


def tilt(normal, rng, angle):
    """`normal` leaned by up to `angle` radians in a random direction."""
    side = np.cross(normal, unit([rng.gauss(0, 1) for _ in range(3)]))
    return unit(normal + unit(side) * math.tan(rng.uniform(.25, 1) * angle))


def facing(azimuth, slope):
    """The outward normal of a face that looks toward `azimuth` and rises `slope` from the ground."""
    return np.array((math.cos(azimuth) * math.sin(slope), math.sin(azimuth) * math.sin(slope), math.cos(slope)))


class Soup:
    """Closed solids gathered into one mesh; a voxel remesh fuses them into their union."""

    def __init__(self):
        self.points, self.faces = [], []

    def add(self, bm):
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.verts.index_update()
        base = len(self.points)
        self.points += [tuple(vertex.co) for vertex in bm.verts]
        self.faces += [[base + vertex.index for vertex in face.verts] for face in bm.faces]
        bm.free()

    def add_arrays(self, points, faces):
        base = len(self.points)
        self.points += [tuple(point) for point in points.tolist()]
        self.faces += (faces + base).tolist()

    def fuse(self, name, voxel):
        obj = new_object(name, self.points, self.faces)
        activate(obj)
        remesh = obj.modifiers.new('Fuse', 'REMESH')
        remesh.mode, remesh.voxel_size, remesh.adaptivity, remesh.use_smooth_shade = 'VOXEL', voxel, 0, True
        bpy.ops.object.modifier_apply(modifier=remesh.name)
        return obj


# --- The outcrop ---------------------------------------------------------------

def blur(field, sigma):
    radius = int(3 * sigma)
    taps = np.exp(-.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    taps /= taps.sum()
    for axis in (0, 1):
        padded = np.pad(field, [(radius, radius) if a == axis else (0, 0) for a in (0, 1)], mode='edge')
        field = sum(weight * np.take(padded, range(offset, offset + field.shape[axis]), axis=axis)
                    for offset, weight in enumerate(taps))
    return field


class Piece:
    """One convex panel of a mass. Each plane is [normal, offset, kind, lean toward ore]."""

    def __init__(self, mass, planes, path=''):
        self.mass, self.planes, self.path = mass, planes, path

    def solid(self):
        return convex((normal, offset) for normal, offset, _, _ in self.planes)

    def corners(self):
        bm = self.solid()
        points = np.array([vertex.co for vertex in bm.verts])
        bm.free()
        return points

    def freeze(self):
        self.normals = np.array([plane[0] for plane in self.planes])
        self.offsets = np.array([plane[1] for plane in self.planes])
        self.kinds = np.array([plane[2] for plane in self.planes])
        self.leans = np.array([plane[3] for plane in self.planes])


class Mass:
    """One knuckle: a convex block, split by a few cracks into panels that each sit slightly
    off the others, with chamfered and stepped corners.

    `sides` are (bearing, slope, lean toward ore, corner cut) in degrees and metres, bearings
    in the block's own frame where -90 faces the camera. `shoulders` are (bearing on the
    stage, slope, lean, depth): bevels cut that deep into the block's highest corner.
    `cracks` are (bearing, slope, across, along, height, panels): a plane through that
    point in the block's frame, splitting the panels whose path starts with `panels`."""

    def __init__(self, rng, center, yaw, half, height, sides, shoulders, cracks, bite, breaks):
        self.center, self.height, self.bite = np.array((*center, 0.)), height, bite
        # The block's middle line runs this far each way from its center.
        self.spine = max(half[0] - half[1], 0) * .8
        self.along = np.array((math.cos(yaw), math.sin(yaw), 0))
        self.across = np.array((-math.sin(yaw), math.cos(yaw), 0))
        # Cleavage runs along the block and dips to one side, like the concept's long diagonal cracks.
        self.grain = unit(self.along * math.cos(dip := rng.uniform(.3, .5)) - UP * math.sin(dip) + self.across * rng.uniform(-.15, .15))
        # Tops dip away from the camera and to one side, like beds tilted together.
        top = tilt(unit(UP + self.along * .1 + self.across * .1), rng, .07)
        # Every block goes on below the ground, so no edge shows on a slope.
        planes = [[top, top @ (self.center + UP * height), TOP, -.65], [-UP, 1.2, BASE, 0]]
        for bearing, slope, lean, cut in sides:
            local = math.radians(bearing)
            reach = abs(half[0] * math.cos(local)) + abs(half[1] * math.sin(local)) - cut
            normal = facing(local + yaw + rng.uniform(-.06, .06), math.radians(slope + rng.uniform(-3, 3)))
            foot = self.center + np.array((math.cos(local + yaw), math.sin(local + yaw), 0)) * reach
            planes.append([normal, normal @ foot, SIDE, lean])
        block = Piece(self, planes)
        for bearing, slope, lean, depth in shoulders:
            normal = facing(math.radians(bearing + rng.uniform(-5, 5)), math.radians(slope + rng.uniform(-3, 3)))
            block.planes.append([normal, (block.corners() @ normal).max() - depth, SIDE, lean])
        pieces = [block]
        for bearing, slope, across, along, level, panels in cracks:
            normal = facing(math.radians(bearing) + yaw + rng.uniform(-.1, .1), math.radians(slope + rng.uniform(-5, 5)))
            through = self.center + self.along * (along + rng.uniform(-.2, .2)) + self.across * across + UP * (level + rng.uniform(-.1, .1))
            pieces = self.split(pieces, normal, normal @ through, CRACK, panels)
        pieces = [self.shifted(rng, piece, .09, .22) for piece in pieces]
        for _ in range(breaks):
            pieces = self.broken(rng, pieces)
        self.pieces = pieces

    def split(self, pieces, normal, offset, kind, panels=''):
        result = []
        for piece in pieces:
            reach = piece.corners() @ normal
            if not piece.path.startswith(panels) or reach.min() > offset - .2 or reach.max() < offset + .2:
                result.append(piece)
                continue
            result += [Piece(self, piece.planes + [[normal, offset + OVERLAP, kind, 0]], piece.path + 'a'),
                       Piece(self, piece.planes + [[-normal, -offset + OVERLAP, kind, 0]], piece.path + 'b')]
        return result

    def shifted(self, rng, piece, lean, setback):
        """The panel with each outer face leaned a little and set back, so panels meet in steps."""
        middle = piece.corners().mean(0)
        planes = []
        for normal, offset, kind, ore in piece.planes:
            if kind in (TOP, SIDE):
                pivot = middle + normal * (offset - normal @ middle)
                normal = tilt(normal, rng, lean * (.5 if kind == TOP else 1))
                offset = normal @ pivot - rng.uniform(0, setback) * (.4 if kind == TOP else 1)
            planes.append([normal, offset, kind, ore])
        return Piece(self, planes, piece.path)

    def broken(self, rng, pieces):
        """Break one corner: either knock it off, leaving a chamfer, or part it along a
        small fracture and set it back, leaving a step."""
        index = rng.randrange(len(pieces))
        piece = pieces[index]
        outer = [plane for plane in piece.planes if plane[2] in (TOP, SIDE)]
        chosen = rng.sample(outer, min(len(outer), rng.choice((2, 2, 3))))
        normal = sum(plane[0] * rng.uniform(.5, 1.5) for plane in chosen)
        if min(a[0] @ b[0] for a in chosen for b in chosen) < -.3:
            return pieces
        normal = unit(normal)
        reach = (piece.corners() @ normal).max()
        size = min(self.height, 2.) / 2
        if rng.random() < .55:
            lean = sum(plane[3] for plane in chosen) / len(chosen) - .15
            piece.planes.append([normal, reach - rng.uniform(.1, .38) * size, SIDE, lean])
            return pieces
        parts = self.split([piece], normal, reach - rng.uniform(.3, .7) * size, STEP)
        if len(parts) < 2:
            return pieces
        inner, corner = parts
        return pieces[:index] + [inner, self.shifted(rng, corner, .04, .13)] + pieces[index + 1:]


def loose(rng, center, size):
    """A loose chip of crust lying on the sand."""
    turn = Matrix.Rotation(rng.uniform(0, math.pi), 3, Vector(unit([rng.gauss(0, 1) for _ in range(3)])))
    planes = []
    for axis, flat in zip(np.eye(3), (1, rng.uniform(.6, .9), rng.uniform(.4, .65))):
        for side in (-1, 1):
            normal = np.array(turn @ Vector(tilt(axis * side, rng, .3)))
            planes.append([normal, normal @ center + size * flat * rng.uniform(.6, 1), SIDE, -2])
    stone = SimpleNamespace(bite=0, grain=np.array((1., 0, 0)), height=size, center=center, along=UP, spine=0)
    return Piece(stone, planes)


class Outcrop:
    """The design: three masses and their panels, loose chips, and the sand banked around them."""

    GRID_STEP = .07

    def __init__(self, rng, seed):
        self.seed = seed
        wobble = lambda spread=.07: rng.uniform(1 - spread, 1 + spread)
        # The dominant mass lies across the view, its far end turned toward the camera, so its
        # long front face looks toward the camera and the sun at once.
        yaw = math.radians(rng.uniform(-21, -13))
        half, height = (3.2 * wobble(.05), 1.9 * wobble()), 3.6 * wobble(.05)
        dominant = Mass(rng, (0, 0), yaw, half, height,
                        sides=[(-90, 74, .55, 0), (-35, 72, .1, .5 * wobble(.2)), (8, 79, -.4, 0), (55, 80, -.6, .4),
                               (95, 82, -.6, 0), (172, 79, -.1, 0), (-138, 72, .4, .55 * wobble(.2))],
                        shoulders=[(-120, 38, .3, .3 * wobble(.2))],
                        cracks=[(rng.uniform(-10, 30), rng.uniform(12, 18), -half[1] + .9, 0, height * .46, ''),
                                (rng.uniform(-8, 8), 80, 0, -.5 * wobble(.5), 0, 'b'),
                                (rng.uniform(-8, 8), 82, 0, 1.3 * wobble(.3), 0, 'a')],
                        bite=.42, breaks=13)
        # The two smaller masses lean on its front, one toward each end. An even seed swaps their ends.
        swap = -1 if seed % 2 == 0 else 1
        masses = [dominant]
        for scale, slide, tuck, tall, cracks, breaks in (
                (.63, -.72 * swap, 1.25, 2.3, [(rng.uniform(-10, 10), 80, 0, rng.uniform(-.4, .2), 0, ''),
                                              (rng.uniform(140, 220), rng.uniform(10, 16), 0, 0, 1.15, rng.choice('ab'))], 6),
                (.44, .92 * swap, 1.1, 1.55, [(rng.uniform(-30, 30), rng.uniform(8, 14), 0, 0, .8, '')], 4)):
            size = (half[0] * scale * wobble(), half[1] * scale * 1.1 * wobble())
            center = (dominant.along * slide * half[0] * wobble() - dominant.across * (half[1] + size[1] - tuck * wobble()))[:2]
            masses.append(Mass(rng, center, math.radians(rng.uniform(-30, -14)), size, tall * wobble(),
                               sides=[(-90, 72, .55, 0), (-35, 68, .15, .45 * scale * 2), (10, 75, -.4, 0), (90, 80, -.6, 0),
                                      (160, 74, -.4, .4 * scale * 2), (-148, 68, .35, .55 * scale * 2)],
                               shoulders=[(-125, 37, .3, .22 * scale * 2 * wobble(.2))],
                               cracks=cracks, bite=.2 + .2 * scale, breaks=breaks))
        self.masses = masses
        self.pieces = [piece for mass in masses for piece in mass.pieces]
        for piece in self.pieces:
            piece.freeze()
        low, high = self.bounds()
        count = [int((high[k] - low[k] + 1.2) / self.GRID_STEP) for k in (0, 1)]
        self.grid_low = np.array((low[0] - .6, low[1] - .6))
        self.axes = [self.grid_low[k] + np.arange(count[k]) * self.GRID_STEP for k in (0, 1)]
        self.drift = self.drifted()
        # A few chips of crust have fallen onto the sand in front.
        chips_left = rng.randint(4, 6)
        for _ in range(60):
            mass = rng.choice(masses)
            bearing = rng.uniform(-2.9, -.2)
            spot = mass.center[:2] + np.array((math.cos(bearing), math.sin(bearing))) * rng.uniform(.4, 4)
            if chips_left and .2 < self.solid(np.array([[*spot, .1]]))[0] < .8:
                size = rng.uniform(.11, .26)
                self.pieces.append(loose(rng, np.array((*spot, max(float(self.sand(*spot)), 0) + size * .15)), size))
                self.pieces[-1].freeze()
                chips_left -= 1

    def bounds(self):
        points = np.concatenate([piece.corners() for piece in self.pieces])
        return points.min(0), points.max(0)

    def solid(self, points):
        """Signed distance to the union of the panels, good near their faces."""
        return np.min([(points @ piece.normals.T - piece.offsets).max(1) for piece in self.pieces], 0)

    def drifted(self):
        """Sand height on a grid: banked against the feet, deepest in the corners between
        masses. Past a bank's edge the surface drops below the ground at once, so on
        sloping ground it shows as a short bank, not a flat apron."""
        x, y = np.meshgrid(*self.axes, indexing='ij')
        flat = np.stack([x.ravel(), y.ravel(), np.full(x.size, .12)], 1)
        rock = (self.solid(flat) < 0).reshape(x.shape).astype(float)
        sand = .5 * (blur(rock, .42 / self.GRID_STEP) - .28)
        sand = sand * (1 + .6 * fbm(flat * (.5, .5, 0), self.seed + 41, 2).reshape(x.shape)) + .02 * fbm(flat * (.9, .9, 0), self.seed + 40, 3).reshape(x.shape)
        # A bank eases out of the ground at its rim; past the rim the surface dives under it.
        return np.clip(np.where(sand < 0, sand * 4 - .5 * smoothstep(-sand, .06, .1), sand * sand / (sand + .05)), -1.3, None)

    def sand(self, x, y):
        grid = self.drift
        fx = np.clip((np.asarray(x) - self.grid_low[0]) / self.GRID_STEP, 0, grid.shape[0] - 1.001)
        fy = np.clip((np.asarray(y) - self.grid_low[1]) / self.GRID_STEP, 0, grid.shape[1] - 1.001)
        ix, iy = fx.astype(int), fy.astype(int)
        tx, ty = fx - ix, fy - iy
        return (grid[ix, iy] * (1 - tx) * (1 - ty) + grid[ix + 1, iy] * tx * (1 - ty)
                + grid[ix, iy + 1] * (1 - tx) * ty + grid[ix + 1, iy + 1] * tx * ty)

    def sand_slab(self, soup):
        nx, ny = self.drift.shape
        x, y = np.meshgrid(*self.axes, indexing='ij')
        top = np.stack([x.ravel(), y.ravel(), self.drift.ravel()], 1)
        bottom = top * (1, 1, 0) + (0, 0, -1.6)
        i, j = np.meshgrid(np.arange(nx - 1), np.arange(ny - 1), indexing='ij')
        a, b, c, d = (i * ny + j).ravel(), ((i + 1) * ny + j).ravel(), ((i + 1) * ny + j + 1).ravel(), (i * ny + j + 1).ravel()
        quads = [np.stack([a, b, c, d], 1), np.stack([d, c, b, a], 1) + len(top)]
        for rim in (np.arange(ny), np.arange(ny)[::-1] + (nx - 1) * ny, np.arange(nx)[::-1] * ny, np.arange(nx) * ny + ny - 1):
            quads.append(np.stack([rim[1:], rim[:-1], rim[:-1] + len(top), rim[1:] + len(top)], 1))
        soup.add_arrays(np.concatenate([top, bottom]), np.concatenate(quads))

    def build(self):
        soup = Soup()
        for piece in self.pieces:
            soup.add(piece.solid())
        self.sand_slab(soup)
        obj = soup.fuse('full / high-poly', .03)
        log(f'{len(self.masses)} masses in {len(self.pieces)} panels and chips, {len(obj.data.polygons)} faces')
        return obj

    def survey(self, points):
        """What each surface point lies on: its panel, how far the panel's planes lean it
        toward ore, its distance to the nearest crack and nearest corner step, how far it
        is under its block's top, its block's cleavage direction and hollow depth, and the
        nearest point of the block's middle line."""
        best, owner = np.full(len(points), .09), np.full(len(points), -1)
        for index, piece in enumerate(self.pieces):
            gap = (points @ piece.normals.T - piece.offsets).max(1)
            closer = gap < best
            best[closer], owner[closer] = gap[closer], index
        lean, crack, step = np.full(len(points), -2.), np.full(len(points), 9.), np.full(len(points), 9.)
        under, bite, grain = np.zeros(len(points)), np.zeros(len(points)), np.tile((1., 0, 0), (len(points), 1))
        heart = points.copy()
        for index, piece in enumerate(self.pieces):
            mine = np.nonzero(owner == index)[0]
            gaps = points[mine] @ piece.normals.T - piece.offsets
            outer = piece.kinds <= SIDE
            # A top keeps its skin except right at its edge, and lends it to the faces below.
            weight = np.exp(np.clip(gaps[:, outer], None, 0) / .4) * np.where(piece.kinds[outer] == TOP, 1.6, 1)
            lean[mine] = (weight * piece.leans[outer]).sum(1) / weight.sum(1)
            for kind, target in ((CRACK, crack), (STEP, step)):
                if (piece.kinds == kind).any():
                    target[mine] = np.abs(gaps[:, piece.kinds == kind] + OVERLAP).min(1)
            under[mine], bite[mine], grain[mine] = -gaps[:, 0], piece.mass.bite, piece.mass.grain
            mass = piece.mass
            heart[mine] = mass.center + mass.along * np.clip((points[mine] - mass.center) @ mass.along, -mass.spine, mass.spine)[:, None]
        return SimpleNamespace(owner=owner, lean=lean, crack=crack, step=step, under=under, bite=bite, grain=grain, heart=heart)

    def weather(self, full):
        """Wear the fused rock, decide where its skin is broken away, and shape both states:
        `full` is moved in place and painted; the depleted copy is returned."""
        mesh, seed = full.data, self.seed
        edge = edges(mesh)
        points = relax(coords(mesh), edge, 2)
        at = self.survey(points)
        ground = self.sand(points[:, 0], points[:, 1])
        # No fracture is quite a plane: the whole outcrop is bent a little, the sand with it.
        points[:, :2] += np.stack([fbm(points * .3, seed + 20 + k, 2) for k in (0, 1)], 1) * .15
        # Loose chips and the sand itself would be turned inside out by relief bigger than they are.
        rock = smoothstep(points[:, 2] - ground, .03, .25) * (at.bite > 0)
        normal = normals(mesh, points)
        wear = .55 + .45 * fbm(points * .6, seed + 1)
        for repeat, share in ((8, .8), (40, .3)):
            bulge = ((points - relax(points, edge, repeat)) * normal).sum(1)
            points -= normal * (np.clip(bulge, 0, None) * wear * share * rock)[:, None]
        normal = normals(mesh, points)
        inward = relax(normal, edge, 40)
        inward /= np.linalg.norm(inward, axis=1)[:, None]

        # Where the skin is gone. The skin breaks off in flat-sided flakes, so the border runs in straight pieces.
        patchy = fbm(points * .42, seed + 3, 2)
        field = (at.lean + .7 * patchy + chips(points * 1.2, seed + 4)[0] + .4 * chips(points * 3.4, seed + 2)[0]
                 - 1.3 * (1 - smoothstep(points[:, 2] - np.clip(ground, 0, None), 0, .12 + .9 * np.clip(.5 + fbm(points * .45, seed + 19, 2), 0, 1) ** 2)))
        # No ore at the very foot, no speck of crust or ore alone, and no thin tongue of either.
        height = points[:, 2] - np.clip(ground, 0, None)
        skin = tidy((field > 0) & (height > .1), at.bite > 0, edge, 700) & (at.bite > 0)
        ore = relax((relax(skin.astype(float), edge, 2) > .5).astype(float), edge, 1)

        # Crust: slow swell, blocky chipped relief, pits.
        rough = .4 + .6 * smoothstep(fbm(points * .5, seed + 5, 2), -.3, .3)
        crust = (fbm(points * .45, seed + 6) * .035 + (chips(points * 1.6, seed + 7)[0] / 1.6 * .35 + chips(points * 4.5, seed + 8)[0] / 4.5 * .3) * rough
                 - np.clip(.3 - chips(points * 4.2, seed + 9)[2], 0, 1) ** 2 / .09 * np.clip(fbm(points * .7, seed + 10, 2) * 2, 0, 1) * .015)
        # Ore: flat cleavage chips drawn out along the grain, at two sizes, behind the crust.
        drawn = points - at.grain * ((points * at.grain).sum(1) * .3)[:, None]
        big, big_roll, _, big_border = chips(drawn * 1.8, seed + 11)
        small, small_roll, _, small_border = chips(drawn * 5, seed + 12)
        crease = np.maximum(1 - smoothstep(big_border / 1.8, 0, .05), .6 * (1 - smoothstep(small_border / 5, 0, .035)))
        # Toward the foot the ore comes flush with the crust, so no lip of crust rings the base like a tray.
        metal = -CRUST_THICKNESS * (1 + .5 * patchy) * smoothstep(height, .15, .6) + big / 1.8 * .42 + small / 5 * .4
        groove = .08 * np.exp(-(at.crack / .045) ** 2) + .025 * np.exp(-(at.step / .03) ** 2)
        full_points = points + normal * ((crust * (1 - ore) + metal * ore - groove) * rock)[:, None]

        # Depleted: every ore point is drawn toward the middle line of its block, less near
        # the top, so the hollow's floor is a ledge the camera sees and its back wall leans.
        # Moving along the surface normal instead folded the surface at every corner of a
        # block and showed as black slits (rounds 4 to 7). Ore on the tops sinks straight down;
        # lower ledges do not, or they would leave a pit at the foot.
        # The hollow's outline is the ore's with its thin tongues smoothed away, so no flake
        # of crust is left standing over it. The broken relief is only baked.
        hollow = smoothstep(relax(ore, edge, 60), .45, .6)
        inside = smoothstep(relax(hollow, edge, 150), .5, .97)
        push = (at.heart - points) * (1, 1, 0)
        push = push / np.maximum(np.linalg.norm(push, axis=1), 1e-6)[:, None]
        sinks = smoothstep(inward[:, 2], .6, .9) * smoothstep(at.under, .6, .3)
        push = push * (1 - sinks)[:, None] - UP * sinks[:, None]
        move = push * (np.minimum(at.bite * inside, .02 + .4 * at.under) * hollow)[:, None]
        broken = (chips(points * 1.3, seed + 14)[0] / 1.3 * .18 + chips(points * 4, seed + 15)[0] / 4 * .12) * inside - CRUST_THICKNESS * smoothstep(height, .15, .6) * ore
        hollow_points = points + move + normal * ((crust * (1 - ore) + broken - groove * (1 - hollow)) * rock)[:, None]
        # Sand has drifted into the bottom of each hollow.
        drifted = smoothstep(.5 + .3 * fbm(points * .8, seed + 16, 2) - (hollow_points[:, 2] - np.clip(ground, 0, None)), 0, .3) * inside

        depleted = duplicate(full, 'depleted / high-poly')
        for obj, moved, ore_mask, hollow_mask, floor_sand in ((full, full_points, ore, ore * 0, ore * 0), (depleted, hollow_points, ore * 0, hollow, drifted)):
            normal = normals(obj.data, moved)
            if obj is full:
                self.full_normals = normal
            bulge = ((moved - relax(moved, edge, 5)) * normal).sum(1)
            sand = smoothstep(self.sand(moved[:, 0], moved[:, 1]) + .03 - moved[:, 2], 0, .035)
            # Dust lies on low, flat, sheltered rock, and the lowest hand's breadth fades into the ground.
            dust = (smoothstep(normal[:, 2], .7, .95) * np.clip(.25 - bulge * 25 + .5 * fbm(moved * .8, seed + 17), 0, 1)
                    * np.clip(1.2 - moved[:, 2] * .45, .15, 1)) * (1 - ore_mask)
            foot = smoothstep(moved[:, 2], .12 + .35 * np.clip(.5 + fbm(moved * .7, seed + 21, 2), 0, 1), 0) * .9
            paint(obj.data, 'Masks', np.stack([np.maximum.reduce([sand, dust * .8, foot, floor_sand]), ore_mask,
                                               np.clip(.5 + bulge * 28, 0, 1), hollow_mask], 1))
            # What each chip should show in game, divided by the light its face gets there
            # (measured in round 1: about .3 of the base color in shade, 1.35 facing the sun,
            # less the share metalness takes). Steep ore the sun misses gets a lighter base.
            shown = .055 + .17 * big_roll ** 1.5 + .06 * small_roll
            tone = shown / ((.3 + 1.05 * np.clip(inward @ SUN, 0, 1)) * (1 - METALNESS))
            # Only chips that lie near the glint direction are bright enough to flash; one
            # square to it would clip to white, so those stay a little duller.
            polish = (.3 + .7 * small_roll) * smoothstep(normal @ GLINT, .84, .96) * (1 - .5 * smoothstep(normal @ GLINT, .985, .998))
            paint(obj.data, 'Ore', np.stack([np.clip(tone, .04, .6), polish, crease], 1))
            paint(obj.data, 'Lines', np.stack([at.crack, at.step, self.veins(moved, at)], 1))
            paint(obj.data, 'Grain', at.grain)
        self.ore, self.full_points, self.hollow_move = np.maximum(ore, hollow), full_points, move
        for obj in (full, depleted):
            keep_faces(obj, coords(obj.data)[:, 2] < -.6)
        log(f'weathered: ore on {ore[rock > .5].mean():.0%} of the rock')
        return depleted

    def veins(self, points, at):
        """Distance to the nearest of a few thin mineral veins: steep planes that cross each
        mass's faces, wandering a little."""
        rng = random.Random(self.seed * 31 + 5)
        nearest = np.full(len(points), 9.)
        wander = fbm(points * .9, self.seed + 18, 2) * .12
        for index, mass in enumerate(self.masses):
            mine = np.isin(at.owner, [k for k, piece in enumerate(self.pieces) if piece.mass is mass])
            for _ in range(2 if index == 0 else 1):
                normal = unit(np.cross(mass.grain, tilt(mass.across, rng, .5)))
                through = mass.center + mass.along * rng.uniform(-.6, .6) * mass.height + UP * mass.height * .5
                gap = np.abs((points - through) @ normal + wander)
                nearest[mine] = np.minimum(nearest, gap)[mine]
        return nearest


# --- Material --------------------------------------------------------------------

class Graph:
    """Small helpers for the procedural source material. It can show its shaded surface,
    its base color, or its roughness and metalness, for the bake passes."""

    def __init__(self, name):
        self.material = bpy.data.materials.new(name)
        self.material.use_nodes = True
        self.nodes, self.links = self.material.node_tree.nodes, self.material.node_tree.links
        self.shader = self.nodes.get('Principled BSDF')
        self.position = self.nodes.new('ShaderNodeTexCoord').outputs['Object']

    def set(self, value, socket):
        if isinstance(value, (int, float)):
            socket.default_value = (value, value, value, 1) if socket.type == 'RGBA' else value
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

    def add(self, *values):
        total = values[0]
        for value in values[1:]:
            total = self.math('ADD', total, value)
        return total

    def times(self, *values):
        total = values[0]
        for value in values[1:]:
            total = self.math('MULTIPLY', total, value)
        return total

    def invert(self, value):
        return self.math('SUBTRACT', 1, value)

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

    def line(self, distance, width):
        """1 on a line `width` metres across, 0 away from it."""
        return self.invert(self.remap(self.math('DIVIDE', distance, width), .35, 1))

    def noise(self, scale, detail=3., vector=None):
        node = self.nodes.new('ShaderNodeTexNoise')
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = detail
        node.inputs['Roughness'].default_value = .62
        self.links.new(vector or self.position, node.inputs['Vector'])
        return node.outputs['Fac']

    def jitter(self, value, scale, amount):
        """Offset a mask by centered noise, so thresholds wander naturally."""
        return self.add(value, self.times(self.math('SUBTRACT', self.noise(scale, 4), .5), amount))

    def vector(self, operation, a, b=None, scale=None):
        node = self.nodes.new('ShaderNodeVectorMath')
        node.operation = operation
        self.set(a, node.inputs[0])
        if b is not None:
            self.set(b, node.inputs[1])
        if scale is not None:
            self.set(scale, node.inputs['Scale'])
        return node.outputs['Value' if operation == 'DOT_PRODUCT' else 'Vector']

    def chips(self, scale, vector=None):
        """Flat chips like the high-poly's, for relief finer than its vertices: each cell's
        height above its own tilted plane (in cell widths), a random value per cell, and
        the distance in metres to the cell's border."""
        outputs = []
        for feature in ('F1', 'DISTANCE_TO_EDGE'):
            node = self.nodes.new('ShaderNodeTexVoronoi')
            node.feature = feature
            node.inputs['Scale'].default_value = scale
            self.links.new(vector or self.position, node.inputs['Vector'])
            outputs.append(node.outputs)
        cell = outputs[0]
        lean = self.vector('SUBTRACT', cell['Color'], (.5, .5, .5))
        height = self.vector('DOT_PRODUCT', self.vector('SUBTRACT', vector or self.position, cell['Position']), lean)
        return self.times(height, scale), self.luma(cell['Color']), self.math('DIVIDE', outputs[1]['Distance'], scale)

    def image(self, path, meters):
        """A terrain photograph projected from three sides, repeating every `meters`."""
        mapping = self.nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = (1 / meters,) * 3
        node = self.nodes.new('ShaderNodeTexImage')
        node.image = bpy.data.images.load(str(ROOT / path), check_existing=True)
        node.projection, node.projection_blend = 'BOX', .3
        self.links.new(self.position, mapping.inputs['Vector'])
        self.links.new(mapping.outputs['Vector'], node.inputs['Vector'])
        return node.outputs['Color']

    def luma(self, color):
        node = self.nodes.new('ShaderNodeRGBToBW')
        self.links.new(color, node.inputs[0])
        return node.outputs[0]

    def attribute(self, name, split=True):
        node = self.nodes.new('ShaderNodeAttribute')
        node.attribute_name = name
        if not split:
            return node.outputs['Vector']
        parts = self.nodes.new('ShaderNodeSeparateXYZ')
        self.links.new(node.outputs['Vector'], parts.inputs[0])
        return (*parts.outputs, node.outputs['Alpha'])

    def sand(self):
        return self.mix(1, self.image(GROUND_COLOR, 30), GROUND_TINT, 'MULTIPLY')

    def finish(self, color, roughness, metallic, relief):
        """Wire the surface; `relief` is a height in metres that becomes the baked normal."""
        bump = self.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value, bump.inputs['Distance'].default_value = 1, 1
        self.set(relief, bump.inputs['Height'])
        self.links.new(bump.outputs['Normal'], self.shader.inputs['Normal'])
        for value, name in ((color, 'Base Color'), (roughness, 'Roughness'), (metallic, 'Metallic')):
            self.set(value, self.shader.inputs[name])
        channels = self.nodes.new('ShaderNodeCombineColor')
        channels.inputs['Red'].default_value = 1
        self.set(roughness, channels.inputs['Green'])
        self.set(metallic, channels.inputs['Blue'])
        output = next(node for node in self.nodes if node.type == 'OUTPUT_MATERIAL')
        self.shows = dict(shaded=self.shader.outputs[0])
        for name, source in (('color', color), ('surface', channels.outputs[0]), ('white', (1., 1., 1.))):
            emission = self.nodes.new('ShaderNodeEmission')
            self.set(source, emission.inputs['Color'])
            self.shows[name] = emission.outputs[0]
        SHOWS[self.material.name] = (self.links, self.shows, output.inputs['Surface'])
        return self.material


SHOWS = {}


def show(what):
    """Switch every source material between its shaded surface and a flat data pass."""
    for links, shows, surface in SHOWS.values():
        links.new(shows[what], surface)


def rock_material():
    """Crust, ore, hollow and sand in one material, chosen by the painted masks."""
    graph = Graph('Three knuckles / crust, ore and sand')
    sand, ore, wear, hollow = graph.attribute('Masks')
    tone, polish, crease, _ = graph.attribute('Ore')
    crack, step, vein, _ = graph.attribute('Lines')
    grain = graph.attribute('Grain', split=False)

    # Crust in the terrain's own photographs, lifted from cliff brown toward the pale, warm
    # sandstone of the concept: paler on worn edges, rustier in patches and hollows.
    photo = graph.mix(graph.remap(graph.noise(.45, 3), .42, .62), graph.image(CLIFF_COLOR, 8), graph.image(SCREE_COLOR, 5))
    shade = graph.math('POWER', graph.math('MAXIMUM', graph.math('DIVIDE', graph.luma(photo), .1), .2), .75)
    tint = graph.mix(graph.remap(graph.jitter(graph.noise(.7, 3), 6, .25), .42, .64), CRUST_PALE, CRUST_RUST)
    crust = graph.mix(1, tint, graph.times(shade, graph.add(.66, graph.times(wear, .68))), 'MULTIPLY')
    # Thin flakes of skin have lifted and gone, leaving low terraces with crisp outlines.
    flake = graph.math('SNAP', graph.noise(1.4, 4), .09)
    crust = graph.mix(1, crust, graph.add(.6, graph.times(flake, .8)), 'MULTIPLY')
    # A sparse net of hairline cracks, as on the concept's tops.
    warped = graph.vector('ADD', graph.position, graph.vector('SCALE', graph.position, scale=graph.times(graph.noise(.5, 2), .25)))
    hairline = graph.math('MAXIMUM', graph.times(graph.line(graph.chips(.8, warped)[2], .022), graph.remap(graph.noise(1.1, 3), .4, .55)),
                          graph.times(graph.line(graph.chips(2.3, warped)[2], .012), graph.remap(graph.noise(.8, 3), .5, .62), .7))
    joint = graph.math('MAXIMUM', graph.line(crack, .022), graph.times(graph.line(step, .014), .7))
    crust = graph.mix(graph.math('MAXIMUM', graph.times(hairline, .75), graph.times(joint, .8)), crust, (.035, .02, .012))

    # Ore. Streaks run along each mass's cleavage; every chip has its own tone and polish.
    across = graph.vector('SUBTRACT', graph.position, graph.vector('SCALE', grain, scale=graph.times(
        graph.vector('DOT_PRODUCT', graph.position, grain), .96)))
    streak = graph.noise(30, 3, across)
    fine, fine_roll, fine_border = graph.chips(13, across)
    value = graph.times(tone, graph.add(1, graph.times(graph.math('SUBTRACT', streak, .5), .22), graph.times(graph.math('SUBTRACT', fine_roll, .5), .4),
                                        graph.times(graph.math('SUBTRACT', graph.noise(1.1, 3), .5), .25)))
    # Chip edges are bruised bright, the way broken metal ore catches light on every arris.
    grit = graph.add(.62, graph.times(graph.luma(graph.image(CLIFF_GRAIN, 1.3)), 1.6))
    metal = graph.mix(1, ORE_TINT, graph.times(value, grit, graph.add(1, graph.times(graph.remap(wear, .74, .98), 1.4)),
                                               graph.add(1, graph.times(crease, -.35))), 'MULTIPLY')
    lode = graph.times(graph.line(vein, graph.add(.008, graph.times(graph.noise(1.7, 2), .03))), graph.remap(graph.noise(1.2, 3), .34, .5))
    metal = graph.mix(lode, metal, ORE_VEIN)
    # Sand has packed into the cracks and into pits on the faces.
    packed = graph.math('MAXIMUM', graph.times(graph.line(crack, .035), graph.remap(graph.noise(4, 3), .45, .6)),
                        graph.times(graph.remap(graph.noise(55, 2), .7, .76), graph.remap(graph.noise(2.5, 2), .45, .65)))
    packed = graph.times(packed, graph.invert(lode))
    dusty = graph.mix(1, tint, (.85, .8, .75), 'MULTIPLY')
    metal = graph.mix(graph.times(graph.remap(graph.noise(.9, 4), .42, .8), .4), metal, dusty)
    metal = graph.mix(graph.times(packed, .85), metal, dusty)
    # A crack through ore is a dark line with a bruised, bright lip.
    metal = graph.mix(graph.times(graph.line(crack, .06), graph.remap(graph.noise(3, 3), .3, .6), .6), metal, ORE_VEIN)
    metal = graph.mix(graph.line(crack, .02), metal, (.01, .01, .01))

    # The mined-out hollow: broken stone under dust, a shade darker and greyer than the crust.
    stone = graph.mix(1, graph.mix(graph.remap(graph.noise(1.6, 3), .35, .7), HOLLOW, graph.mix(.5, HOLLOW, tint)),
                      graph.times(shade, graph.add(.5, graph.times(wear, .75))), 'MULTIPLY')

    shows_ore = graph.remap(graph.jitter(ore, 11, .05), .42, .58)
    shows_hollow = graph.remap(graph.jitter(hollow, 11, .05), .42, .58)
    drift = graph.remap(graph.jitter(sand, 3.5, .4), .38, .62)
    color = graph.mix(drift, graph.mix(shows_hollow, graph.mix(shows_ore, crust, metal), stone), graph.sand())

    gleam = graph.times(shows_ore, graph.invert(packed), graph.invert(drift))
    ore_rough = graph.add(.62, graph.times(polish, -.34), graph.times(graph.math('SUBTRACT', streak, .5), .12), graph.times(lode, -.15))
    roughness = graph.mix(gleam, .92, ore_rough)
    stone_relief = graph.add(graph.times(graph.luma(graph.image(CLIFF_GRAIN, 2.4)), .03), graph.times(flake, .12), graph.times(hairline, -.012), graph.times(joint, -.02))
    # Fine cleavage: small flat chips and parallel steps along the grain.
    steps = graph.math('FRACT', graph.times(graph.add(graph.vector('DOT_PRODUCT', across, (.577, .577, .577)), graph.times(graph.noise(3, 2), .08)), 9))
    ore_relief = graph.add(graph.times(fine, 1 / 13, .35), graph.times(steps, .003), graph.times(crease, -.008), graph.times(grit, .006),
                           graph.times(graph.line(crack, .03), -.02), graph.times(packed, .004))
    relief = graph.mix(drift, graph.mix(gleam, stone_relief, ore_relief), graph.times(graph.luma(graph.image(GROUND_COLOR, 30)), .01))
    return graph.finish(color, roughness, graph.times(gleam, METALNESS), relief)


# --- Runtime mesh and bake -------------------------------------------------------

def runtime(outcrop, source, triangles):
    """The low-poly: the full source decimated to the budget. Faces that show any ore are
    marked FULL and copied as DEPLETED, moved to where the hollow is, so the two states
    share every other face and meet along the same edges."""
    obj = duplicate(source, 'runtime')
    for name in ('Masks', 'Ore', 'Lines', 'Grain'):
        obj.data.attributes.remove(obj.data.attributes[name])
    obj.data.materials.clear()
    obj.data.calc_loop_triangles()
    activate(obj)
    modifier = obj.modifiers.new('Runtime budget', 'DECIMATE')
    modifier.ratio = min(1, triangles / len(obj.data.loop_triangles))
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    keep_faces(obj, None, smallest=6)

    tree = tree_of(obj.data)
    shows_ore = {tree.find_nearest(Vector(point))[2] for point in outcrop.full_points[outcrop.ore > .02]}
    near = KDTree(len(outcrop.full_points))
    for index, point in enumerate(outcrop.full_points):
        near.insert(point, index)
    near.balance()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    state = bm.faces.layers.int.new('state')
    # One more ring of faces, so no ore texel bleeds onto a face the depleted state keeps.
    marked = {face for index in shows_ore for vertex in bm.faces[index].verts for face in vertex.link_faces}
    for face in marked:
        face[state] = FULL
    copies = bmesh.ops.duplicate(bm, geom=list(marked))['geom']
    bm.normal_update()
    for item in copies:
        if isinstance(item, bmesh.types.BMFace):
            item[state] = DEPLETED
        elif isinstance(item, bmesh.types.BMVert) and not item.is_boundary:
            # The nearest source point that faces the same way: in a crevice the nearest of all may lie on the other wall.
            alike = max(near.find_n(item.co, 8), key=lambda found: item.normal.dot(Vector(outcrop.full_normals[found[1]])) - found[2] * 4)
            item.co += Vector(outcrop.hollow_move[alike[1]])
    bm.to_mesh(obj.data)
    bm.free()
    log(f'runtime mesh: {len(obj.data.polygons)} triangles, {len(marked)} of them show ore')
    return obj


def unwrap(obj):
    """Keep hard edges hard and give the runtime mesh one atlas."""
    activate(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    state = bm.faces.layers.int['state']
    for face in bm.faces:
        face.smooth = True
    # The border between shared and state faces is split, so each state shades the shared
    # faces exactly as the bake did.
    parted = lambda edge: len(edge.link_faces) != 2 or edge.link_faces[0][state] != edge.link_faces[1][state]
    for edge in bm.edges:
        edge.smooth = not parted(edge) and edge.calc_face_angle() < math.radians(55)
    # Charts: patches grown from the largest faces outward, stopping at the concave creases
    # between bodies. A patch stays within 72 degrees of its mean direction and 65 of its
    # first face's, so it cannot creep around a block.
    chart = bm.faces.layers.int.new('chart')
    charted, firsts, bend = set(), {}, math.cos(math.radians(72))
    for first in sorted(bm.faces, key=lambda face: -face.calc_area()):
        if first in charted:
            continue
        count = len(firsts) + 1
        firsts[count] = first.normal.copy()
        charted.add(first)
        first[chart] = count
        mean, queue = first.normal * first.calc_area(), deque([first])
        while queue:
            for edge in queue.popleft().edges:
                if len(edge.link_faces) != 2 or edge.calc_face_angle_signed() < -math.radians(55):
                    continue
                for other in edge.link_faces:
                    if other not in charted and other.normal.dot(mean.normalized()) > bend and other.normal.dot(firsts[count]) > .42:
                        charted.add(other)
                        other[chart] = count
                        mean += other.normal * other.calc_area()
                        queue.append(other)
    # A scrap of a few faces would cost the atlas a margin of its own; it joins the chart beside it.
    for _ in range(3):
        sizes = Counter(face[chart] for face in bm.faces)
        for face in bm.faces:
            beside = [other[chart] for edge in face.edges if len(edge.link_faces) == 2 for other in edge.link_faces if other[chart] != face[chart]]
            if sizes[face[chart]] < 14 and beside:
                face[chart] = max(beside, key=sizes.get)
    for edge in bm.edges:
        edge.seam = len(edge.link_faces) != 2 or edge.link_faces[0][chart] != edge.link_faces[1][chart]
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.uv_layers.new(name='RuntimeUV')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.unwrap(method='CONFORMAL', margin=.002)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    # The camera never moves: charts it cannot see, or that lie under the ground, get a
    # third of the texels; ore gets a quarter more than crust, and the dull hollow less.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv, state, chart = bm.loops.layers.uv.active, bm.faces.layers.int['state'], bm.faces.layers.int['chart']
    members = {}
    for face in bm.faces:
        members.setdefault(face[chart], []).append(face)
    # The unwrap squeezes the far side of a chart that still curves too much, or leaves a
    # chart it cannot solve collapsed to a point; either way some faces get a hundredth of
    # their texels and show as a smear (rounds 11 to 14). Such a chart is laid out flat
    # instead, seen along its mean direction, at the texel density of the rest.
    flat = lambda face: abs(sum(a[uv].uv.cross(b[uv].uv) for a, b in zip(face.loops, face.loops[1:] + face.loops[:1]))) / 2
    usual = sorted(flat(face) / face.calc_area() for face in bm.faces)[len(bm.faces) // 2]
    squeezed = [faces for faces in members.values() if any(flat(face) < face.calc_area() * usual * .12 for face in faces)]
    for faces in squeezed:
        mean = sum((face.normal * face.calc_area() for face in faces), Vector())
        mean = mean.normalized() if mean.length > 1e-6 else Vector(UP)
        side = mean.orthogonal().normalized()
        for loop in (loop for face in faces for loop in face.loops):
            loop[uv].uv = Vector((loop.vert.co.dot(side), loop.vert.co.dot(mean.cross(side)))) * math.sqrt(usual)
    for faces in members.values():
        area = sum(face.calc_area() for face in faces)
        shown = sum(face.calc_area() for face in faces
                    if face.normal.dot(Vector(VIEW)) > -.05 and face.calc_center_median().z > -.3) / max(area, 1e-9)
        scale = (.33 + .67 * shown) * (1, 1.25, .8)[faces[0][state]]
        loops = [loop for face in faces for loop in face.loops]
        middle = sum((loop[uv].uv for loop in loops), Vector((0, 0))) / len(loops)
        for loop in loops:
            loop[uv].uv = middle + (loop[uv].uv - middle) * scale
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.attributes.remove(obj.data.attributes['chart'])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=.003, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')
    log(f'atlas: {len(members)} charts, {len(squeezed)} of them laid out flat')


def spread(pixels, filled, steps=10):
    """Grow baked texels into the empty ones around them, so seams and mip levels never sample unbaked texels."""
    for _ in range(steps):
        total, count = np.zeros_like(pixels), np.zeros(filled.shape)
        for shift in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            total += np.roll(pixels * filled[..., None], shift, (0, 1))
            count += np.roll(filled, shift, (0, 1))
        grown = ~filled & (count > 0)
        pixels[grown] = total[grown] / count[grown][:, None]
        filled = filled | grown
    pixels[~filled] = pixels[filled].mean(0)
    return pixels


def bake(low, sources, output, name):
    """Bake the high-poly sources onto the low-poly. `sources` pairs the states whose
    faces take color, normal, occlusion and surface values from one high-poly object, found
    by rays cast inward from a cage just outside the low-poly."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    # Occlusion looks only a short way, so a hollow is shaded in its corners, not blackened throughout.
    scene.world = bpy.data.worlds.new('Bake')
    scene.world.light_settings.distance = .7
    settings = dict(use_selected_to_active=True, cage_extrusion=.08, max_ray_distance=.25, margin=0, use_clear=True,
                    uv_layer='RuntimeUV', normal_space='TANGENT')
    # The first pass marks the texels whose ray found the source; the rest take their neighbours' values.
    passes = dict(found=('EMIT', 1, 'white'), color=('EMIT', 6, 'color'), normal=('NORMAL', 8, 'shaded'),
                  occlusion=('AO', 64, 'shaded'), surface=('EMIT', 4, 'surface'))
    layers = {key: np.zeros((ATLAS, ATLAS, 4), np.float32) for key in passes}
    covered = np.zeros((ATLAS, ATLAS), bool)
    highs = [high for _, high in sources]
    for states, high in sources:
        target = duplicate(low, f'bake target {states}')
        target.hide_render = False
        keep_states(target, states)
        material = bpy.data.materials.new(f'bake target {states}')
        material.use_nodes = True
        node = material.node_tree.nodes.new('ShaderNodeTexImage')
        material.node_tree.nodes.active = node
        target.data.materials.clear()
        target.data.materials.append(material)
        for other in highs:
            other.hide_render = other is not high
        low.hide_render = True
        bpy.ops.object.select_all(action='DESELECT')
        high.select_set(True)
        target.select_set(True)
        bpy.context.view_layer.objects.active = target
        for key, (kind, samples, shows) in passes.items():
            image = bpy.data.images.new(f'{key} {states}', ATLAS, ATLAS, alpha=True, float_buffer=True)
            image.colorspace_settings.name = 'Linear Rec.709' if key == 'color' else 'Non-Color'
            node.image = image
            show(shows)
            scene.cycles.samples = samples
            bpy.ops.object.bake(type=kind, **settings)
            pixels = np.empty(ATLAS * ATLAS * 4, np.float32)
            image.pixels.foreach_get(pixels)
            pixels = pixels.reshape(ATLAS, ATLAS, 4)
            if key == 'found':
                hit = pixels[..., 0] > .5
                covered |= hit
                log(f'states {states}: {hit.mean():.1%} of the atlas')
            layers[key][hit] = pixels[hit]
            bpy.data.images.remove(image)
        bpy.data.objects.remove(target)
    show('shaded')
    for high in highs:
        high.hide_render = False
    low.hide_render = False
    occlusion = np.clip(layers['occlusion'][..., 0], 0, 1)
    # The game lights with one sun and no baked contact shadows, so crevice depth goes into the color.
    layers['color'][..., :3] *= (.5 + .5 * occlusion)[..., None]
    layers['surface'][..., 0] = 1
    layers['normal'][~covered] = (.5, .5, 1, 1)
    images = {}
    for key in ('color', 'normal', 'surface'):
        image = bpy.data.images.new(f'{name} {key}', ATLAS, ATLAS, alpha=False, float_buffer=True)
        if key != 'color':
            image.colorspace_settings.name = 'Non-Color'
        pixels = spread(layers[key], covered.copy())
        pixels[..., 3] = 1
        image.pixels.foreach_set(pixels.ravel())
        image.filepath_raw = str(output / f'runtime-{key}.png')
        image.file_format = 'PNG'
        image.save()
        image.pack()
        images[key] = image
    material = bpy.data.materials.new(f'{name} / baked PBR')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')

    def texture(image):
        node = nodes.new('ShaderNodeTexImage')
        node.image = image
        return node

    links.new(texture(images['color']).outputs['Color'], shader.inputs['Base Color'])
    normal = nodes.new('ShaderNodeNormalMap')
    links.new(texture(images['normal']).outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], shader.inputs['Normal'])
    separate = nodes.new('ShaderNodeSeparateColor')
    links.new(texture(images['surface']).outputs['Color'], separate.inputs['Color'])
    links.new(separate.outputs['Green'], shader.inputs['Roughness'])
    links.new(separate.outputs['Blue'], shader.inputs['Metallic'])
    low.data.materials.clear()
    low.data.materials.append(material)


# --- Export ------------------------------------------------------------------------

def mining_contact(obj):
    """Where a Scout's tool lands from 72 bearings, by the game's own rule: a ray from just
    outside the footprint toward three heights over the center; the first that hits counts."""
    tree = tree_of(obj.data)
    states = [item.value for item in obj.data.attributes['state'].data]
    hits = ore = 0
    for step in range(72):
        bearing = math.tau * step / 72
        origin = Vector((math.cos(bearing) * (FOOTPRINT_RADIUS + .7), math.sin(bearing) * (FOOTPRINT_RADIUS + .7), 1.))
        for height in (.65, .35, 1.1):
            hit, _, index, _ = tree.ray_cast(origin, (Vector((0, 0, height)) - origin).normalized())
            if hit:
                hits += 1
                ore += states[index] == FULL
                break
    return dict(bearings_hit=hits / 72, bearings_ore_first=ore / 72)


def export(baked, states, path):
    """Export the faces one state shows; the copy keeps the baked atlas and material."""
    obj = duplicate(baked, path.stem)
    keep_states(obj, states)
    activate(obj)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_image_format='WEBP', export_image_quality=72,
                              export_vertex_color='NONE')
    obj.data.calc_loop_triangles()
    points = coords(obj.data)
    return dict(path=str(path.relative_to(OUT)), bytes=path.stat().st_size,
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(), triangles=len(obj.data.loop_triangles),
                radius=float(np.hypot(points[:, 0], points[:, 1]).max()), height=float(points[:, 2].max()),
                **mining_contact(obj))


def draft(output, sources):
    """A quick look at each source from the game's camera, with its sun."""
    scene = bpy.context.scene
    turn = Matrix.Rotation(STAGE_TURN, 3, 'Z')
    camera = bpy.data.objects.new('Game camera', bpy.data.cameras.new('Game camera'))
    camera.data.type, camera.data.ortho_scale = 'ORTHO', 14
    toward = turn @ Vector(VIEW)
    camera.location = toward * 40 + Vector((0, 0, 1))
    camera.rotation_euler = toward.to_track_quat('Z', 'Y').to_euler()
    sun = bpy.data.objects.new('Game sun', bpy.data.lights.new('Game sun', 'SUN'))
    sun.data.energy, sun.data.angle = 3.5, .03
    sun.rotation_euler = (turn @ Vector(SUN)).to_track_quat('Z', 'Y').to_euler()
    for obj in (camera, sun):
        scene.collection.objects.link(obj)
    scene.camera = camera
    world = bpy.data.worlds.new('Sky')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.5, .47, .44, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .55
    scene.world = world
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, .05))
    ground = Graph('Ground')
    bpy.context.object.data.materials.append(ground.finish(ground.sand(), .9, 0., 0.))
    scene.render.engine = 'CYCLES'
    scene.cycles.device, scene.cycles.samples = 'CPU', 20
    scene.render.resolution_x, scene.render.resolution_y = 1400, 900
    scene.view_settings.view_transform = 'Standard'
    for name, shown in sources.items():
        for source in sources.values():
            source.hide_render = source is not shown
        scene.render.filepath = str(output / f'draft-{name}.png')
        bpy.ops.render.render(write_still=True)
        log(f'draft of {name}')


def author(seed, suffix):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    SHOWS.clear()
    output = OUT / f'seed-{seed}'
    output.mkdir(parents=True, exist_ok=True)
    outcrop = Outcrop(random.Random(seed), seed)
    full = outcrop.build()
    depleted = outcrop.weather(full)
    material = rock_material()
    for obj in (full, depleted):
        obj.data.materials.append(material)
    if args.draft:
        draft(output, dict(full=full, depleted=depleted))
        return []
    low = runtime(outcrop, full, TRIANGLES)
    unwrap(low)
    bake(low, [((BOTH, FULL), full), ((DEPLETED,), depleted)], output, f'Titanium three knuckles {seed}')
    # To the game's axes, centered on the middle of its reach, and scaled to the footprint.
    low.data.transform(Matrix.Rotation(STAGE_TURN, 4, 'Z'))
    low.rotation_euler.z = 0
    points = coords(low.data)
    middle = (points.min(0) + points.max(0)) / 2
    low.data.transform(Matrix.Translation((-middle[0], -middle[1], 0)))
    points = coords(low.data)
    low.data.transform(Matrix.Scale(FOOTPRINT_RADIUS / float(np.hypot(points[:, 0], points[:, 1]).max()), 4))
    entries = []
    for name, states in (('full', (BOTH, FULL)), ('depleted', (BOTH, DEPLETED))):
        entries.append(dict(seed=seed, state=name, **export(low, states, OUT / f'{name}{suffix}.glb')))
        print('KNUCKLES_EXPORT', json.dumps(entries[-1]), flush=True)
    return entries


exports = [entry for index, seed in enumerate(args.seed)
           for entry in author(seed, '-' + chr(ord('a') + index) if index else '')]
if exports:
    (OUT / 'export.json').write_text(json.dumps(dict(
        generator='tools/assets/build_titanium_three_knuckles.py',
        format='1 mesh, 1 standard PBR material, 1024px WebP color/normal/roughness-metallic per seed, shared by both states',
        coordinates='Y-up, centered X/Z, ground pivot Y=0', assets=exports), indent=2) + '\n')
log('done')
