"""Author the "Cluster" Titanium Deposit: metal crystals grown into a split bedrock outcrop.

blender --background --threads 6 --python-exit-code 1 --python tools/assets/build_titanium_cluster.py -- [--seed 1 2] [--out <dir>] [--draft]

Underground: ore fluid rose through one steep fracture zone in bedded sandstone and grew
a crust of titanium crystals inward from the walls and floor of the open fracture, and a
little way out along the joints that cross it. Erosion has unroofed the fracture, so the
ore is only that lining: cut the crystals off at their roots and a bare, dark cleft is left.

Each `--seed` composes a different outcrop of the same design. The first seed exports
`full.glb` and `depleted.glb`, the next `full-b.glb` and `depleted-b.glb`, and so on.
`--draft` stops before the bake and saves `source.blend` and `draft.png`, a quick render
from the game's camera. Nothing is written to assets/models; review candidates with
`bun tools/verify/capture-ore.mjs --model <glb> --out <dir>`.

How a build goes:
1. Bedrock. Three shared fracture directions (bedding and two steep joint sets) cut the
   outcrop into blocks under a designed surface: knuckles on a low swell, split by the
   cleft. Exposed faces lean a few degrees off their set, beds step back as ledges, edges
   lose bites and corners, and master joints stand open between the masses. Blocks, fallen
   rubble and drifted sand are fused by a voxel remesh, then weathered: worn edges, bedding
   grooves, chipped relief that runs with the beds, pits.
2. Ore. Crystals are convex solids in the habit of rutile, titanium's own ore: eight-sided
   striated prisms with low pyramids, grown as bundles of parallel individuals with growth
   layers, hopper rims, knee twins, chipped and broken tops. They root on the surfaces the
   cleft can see, tallest toward its back, and on the flanks where a Scout's tool lands.
   They are fused with a thin ore crust over the rock between them and trimmed where they
   enter the rock.
3. Runtime. Both high-poly sources (about a million triangles) are decimated to the
   triangle budget, cut into charts, packed into one atlas and baked high-to-low with
   Cycles: color, normal, occlusion, roughness and metalness, from rays cast inward from a
   cage just outside the low-poly. The rock is baked without the ore, so the depleted state
   is simply the rock's faces: the wall under the crust is recessed and carries the flat-cut
   crystal roots. Export turns the model to the game's axes and scales it to the footprint.

The game never turns the model, the camera or the sun, so the half-vector between sun and
camera is one fixed direction (GLINT). Polished faces near it show a real sun glint with
no environment map; face tones are chosen for the brightness they show under that sun.
"""
import argparse
from collections import deque
import hashlib
import json
import math
from pathlib import Path
import random
import sys
import time

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
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
# Titanium in linear RGB: shaded faces, mid tones and worn edges.
SHADOW, MID, LIGHT = (.042, .052, .074), (.235, .3, .38), (.68, .75, .84)
# Tried in game in round 1: at .3 the metal reads as painted stone, at .6 shaded sides go near black.
METALNESS = .45
BOTH, FULL = 0, 1
PRISM, TIP, BREAK, BASE = 0, 1, 2, 3
LARGE, MEDIUM, SMALL = 0, 1, 2

parser = argparse.ArgumentParser()
parser.add_argument('--seed', type=int, nargs='+', default=[1, 2], help='one composition per seed')
parser.add_argument('--draft', action='store_true', help='save the editable source and a quick render without baking')
parser.add_argument('--out', type=Path, default=ROOT / 'art/workbench/titanium-cluster')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = args.out.resolve()
started = time.time()


def log(message):
    print(f'CLUSTER {time.time() - started:6.1f}s {message}', flush=True)


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


def cells(points, seed):
    """Distance to the nearest of one scattered point per unit cell."""
    cell = np.floor(points).astype(np.int64)
    best = np.full(len(points), 9.)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                near = cell + (dx, dy, dz)
                spot = near + np.stack([hashed(near[:, 0], near[:, 1], near[:, 2], seed + k) for k in range(3)], 1)
                best = np.minimum(best, np.linalg.norm(points - spot, axis=1))
    return best


def facets(points, seed):
    """Small planar facets: each scattered cell is a flat chip with its own tilt, so the
    surface steps crisply where two chips meet. Returns each point's offset from its chip."""
    cell = np.floor(points).astype(np.int64)
    best, offset = np.full(len(points), 9.), np.zeros(len(points))
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                near = cell + (dx, dy, dz)
                rolls = [hashed(near[:, 0], near[:, 1], near[:, 2], seed + k) for k in range(6)]
                away = points - (near + np.stack(rolls[:3], 1))
                distance = np.linalg.norm(away, axis=1)
                closer = distance < best
                best[closer] = distance[closer]
                offset[closer] = (away * (np.stack(rolls[3:], 1) - .5)).sum(1)[closer]
    return offset


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


def tree_of(mesh):
    vertex, _ = corners(mesh)
    start = np.empty(len(mesh.polygons), np.int64)
    mesh.polygons.foreach_get('loop_start', start)
    faces = np.split(vertex, start[1:])
    return BVHTree.FromPolygons(coords(mesh).tolist(), [face.tolist() for face in faces])


def paint(mesh, name, values, domain='POINT'):
    """Store (N, 3) vectors or (N, 4) colors for the source materials."""
    if values.shape[1] == 4:
        mesh.color_attributes.new(name, 'FLOAT_COLOR', domain).data.foreach_set('color', values.ravel())
    else:
        mesh.attributes.new(name, 'FLOAT_VECTOR', domain).data.foreach_set('vector', values.ravel())


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


def turned(vector, axis, angle):
    """`vector` rotated around the unit `axis`."""
    return (vector * math.cos(angle) + np.cross(axis, vector) * math.sin(angle)
            + axis * (axis @ vector) * (1 - math.cos(angle)))


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


# --- Bedrock -------------------------------------------------------------------

def spaced(rng, low, high, gaps):
    """Irregularly spaced fracture planes: some half the usual gap apart, some half as much again."""
    marks = [low]
    while marks[-1] < high:
        marks.append(marks[-1] + rng.uniform(*gaps) * rng.choice((.5, .8, 1, 1.2, 1.5)))
    return np.array(marks)


def blur(field, sigma):
    radius = int(3 * sigma)
    taps = np.exp(-.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    taps /= taps.sum()
    for axis in (0, 1):
        padded = np.pad(field, [(radius, radius) if a == axis else (0, 0) for a in (0, 1)], mode='edge')
        field = sum(weight * np.take(padded, range(offset, offset + field.shape[axis]), axis=axis)
                    for offset, weight in enumerate(taps))
    return field


class Outcrop:
    """The host rock's design: its fracture sets, its knuckles and cleft, and the sand around it."""

    GRID_LOW, GRID_STEP = -5.74, .07

    def __init__(self, rng, seed):
        self.rng, self.seed = rng, seed
        # The cleft follows the first joint set, which strikes roughly toward the camera.
        self.turn = rng.uniform(-.2, .2)
        skew = rng.choice((-1, 1)) * rng.uniform(.12, .3)
        dip, dip_to = rng.uniform(.1, .17), rng.uniform(0, math.tau)
        self.normals = np.array([
            unit((math.cos(self.turn), math.sin(self.turn), rng.uniform(-.09, .09))),
            unit((-math.sin(self.turn + skew), math.cos(self.turn + skew), rng.uniform(-.1, .1))),
            unit((math.sin(dip) * math.cos(dip_to), math.sin(dip) * math.sin(dip_to), math.cos(dip)))])
        self.planes = [spaced(rng, -6.5, 6.5, (.6, 1.3)), spaced(rng, -6.5, 6.5, (.6, 1.4)), spaced(rng, -2.4, 3.6, (.2, .5))]
        # Only some fractures stand open as cracks; the rest are tight.
        self.live = [marks[np.array([rng.random() < share for _ in marks]) | (np.arange(len(marks)) == len(marks) // 2)]
                     for marks, share in zip(self.planes, (.7, .7, .5))]
        self.parting = np.array([rng.uniform(.3, 1) for _ in self.planes[2]])
        self.shift, self.curve = rng.uniform(-.45, .1), rng.uniform(-1, 1)
        self.width = rng.uniform(.9, 1.08)
        wobble = lambda: rng.uniform(.92, 1.08)
        # Knuckles in the cleft's frame: center (across, along), radii, height, turn.
        self.knuckles = [
            ((-2.45 * wobble(), -.4), (2. * wobble(), 3.6), 1.35 * wobble(), rng.uniform(-.15, .15)),
            ((2.45 * wobble(), 1.), (2.1 * wobble(), 2.9), 1.85 * wobble(), rng.uniform(-.15, .15)),
            ((2.3, -2.5 * wobble()), (1.8, 1.5 * wobble()), 1.2 * wobble(), rng.uniform(-.3, .3)),
            ((-.5 * wobble(), 3.2), (2.7, 1.45 * wobble()), 1.5 * wobble(), rng.uniform(-.15, .15))]
        # The bedrock they rise from: a low swell whose rim and height wander with bearing.
        self.swell, self.phases = rng.uniform(1., 1.12), [rng.uniform(0, math.tau) for _ in range(3)]
        # Master joints stand open at the top and part the outcrop into its separate masses.
        nearest = lambda marks, target: int(np.abs(marks - target).argmin())
        self.master = [{nearest(self.planes[0], self.shift + side * rng.uniform(2., 2.8)) for side in (-1, 1)},
                       {nearest(self.planes[1], target + rng.uniform(-.4, .4)) for target in (-1.4, 1.9)}]
        self.drift = self.drifted()

    def cleft_frame(self, x, y):
        """Distance across the cleft's axis and along it (negative toward the camera)."""
        return (x * math.cos(self.turn) + y * math.sin(self.turn) - self.shift,
                -x * math.sin(self.turn) + y * math.cos(self.turn))

    def stage(self, across, along):
        across = across + self.shift
        return np.array((across * math.cos(self.turn) - along * math.sin(self.turn),
                         across * math.sin(self.turn) + along * math.cos(self.turn)))

    def middle(self, along):
        return self.curve * .25 * np.sin((along + 1) * .45)

    def half(self, along):
        return np.interp(along, [-4.6, -1.2, 1.4, 2.5, 2.8], [1.25, 1.15, .75, .35, 0]) * self.width

    def in_cleft(self, x, y, margin=0.):
        across, along = self.cleft_frame(x, y)
        return (np.abs(across - self.middle(along)) < self.half(along) + margin) & (along > -4.45)

    def dome(self, x, y):
        """The weathering surface before the cleft opened: knuckles on a low swell of bedrock,
        tall enough at 3.6 m from the center for a Scout's tool to meet from every bearing."""
        across, along = self.cleft_frame(x, y)
        bearing, reach = np.arctan2(y, x), np.hypot(x, y)
        rim = 4.5 + .16 * np.sin(bearing * 3 + self.phases[0]) + .1 * np.sin(bearing * 5 + self.phases[1])
        tall = self.swell * (1 + .1 * np.sin(bearing * 2 + self.phases[2])) * np.clip(1.6 * (1 - (reach / rim) ** 6), 0, 1)
        for (center_a, center_b), (radius_a, radius_b), top, turn in self.knuckles:
            da, db = across - center_a, along - center_b
            rho = np.hypot((da * math.cos(turn) + db * math.sin(turn)) / radius_a,
                           (-da * math.sin(turn) + db * math.cos(turn)) / radius_b)
            tall = np.maximum(tall, top * np.clip(1.25 * (1 - rho ** 3), 0, 1))
        return tall * np.clip((4.72 - reach) / .25, 0, 1)

    def height(self, x, y):
        """The dome, split by the cleft down to a floor that rises toward its back."""
        along = self.cleft_frame(x, y)[1]
        return np.where(self.in_cleft(x, y), .3 + .55 * smoothstep(along, -3.2, 2.4), self.dome(x, y))

    def drifted(self):
        """Sand height on a grid: banked where rock shelters it, thin on exposed corners, with a
        short tail downwind. Drifts stay small, because on sloping ground they stand proud."""
        axis = self.GRID_LOW + np.arange(165) * self.GRID_STEP
        x, y = np.meshgrid(axis, axis, indexing='ij')
        rock = (self.height(x, y) > .3).astype(float)
        lee = np.roll(rock, (int(self.rng.uniform(4, 9)), int(self.rng.uniform(-5, 5))), (0, 1))
        sand = np.maximum(.5 * (blur(rock, .55 / self.GRID_STEP) - .36), .2 * (blur(lee, .9 / self.GRID_STEP) - .42))
        flat = np.stack([x.ravel(), y.ravel(), np.zeros(x.size)], 1)
        sand += .03 * fbm(flat * .9, self.seed + 40, 3).reshape(x.shape)
        sand -= .3 * smoothstep(np.hypot(x, y), 4.2, 4.95)
        # Sand lies only where it drifted. Past a drift's edge its surface drops away at once, so
        # on sloping ground the rock's own foot shows, not a smooth apron.
        return np.clip(np.where(sand < 0, sand * 12, sand), -1.3, None)

    def sand(self, x, y):
        grid = self.drift
        fx = np.clip((np.asarray(x) - self.GRID_LOW) / self.GRID_STEP, 0, grid.shape[0] - 1.001)
        fy = np.clip((np.asarray(y) - self.GRID_LOW) / self.GRID_STEP, 0, grid.shape[1] - 1.001)
        ix, iy = fx.astype(int), fy.astype(int)
        tx, ty = fx - ix, fy - iy
        return (grid[ix, iy] * (1 - tx) * (1 - ty) + grid[ix + 1, iy] * tx * (1 - ty)
                + grid[ix, iy + 1] * (1 - tx) * ty + grid[ix + 1, iy + 1] * tx * ty)

    def blocks(self, soup):
        """Cut the outcrop into the blocks its fractures bound. Buried faces overlap their
        neighbours; exposed ones lean off their set, step back by bed and lose corners."""
        rng, normals, planes = self.rng, self.normals, self.planes
        tops, centers = {}, {}
        for i in range(len(planes[0]) - 1):
            for j in range(len(planes[1]) - 1):
                middle = np.array(((planes[0][i] + planes[0][i + 1]) / 2, (planes[1][j] + planes[1][j + 1]) / 2))
                x, y = np.linalg.solve(normals[:2, :2], middle - normals[:2, 2] * .8)
                tall = float(self.height(np.array([x]), np.array([y]))[0])
                level = lambda k: (planes[2][k] - normals[2, 0] * x - normals[2, 1] * y) / normals[2, 2]
                # Outside the cleft a bed counts if any of it is under the dome; the slope cut trims it.
                under = (lambda k: (level(k) + level(k + 1)) / 2) if self.in_cleft(x, y) else (lambda k: level(k) + .08)
                top = max((k for k in range(len(planes[2]) - 1) if under(k) < tall), default=-1)
                if tall > .15 and top >= 0:
                    tops[i, j] = top
                    centers[i, j] = (x, y)
        solid = lambda i, j, k: k <= tops.get((i, j), -1)
        ledge = [rng.uniform(0, .11) for _ in planes[2]]
        # Not every fracture shows: neighbouring columns of one height often form a single
        # block with one top surface, so the outcrop is not a grid of equal lumps.
        crowns = {}
        for (i, j), top in tops.items():
            beside = rng.choice(((i + 1, j), (i, j + 1)))
            joined = tops.get(beside) == top and rng.random() < .6 and not (beside[0] in self.master[0] and beside[0] != i
                                                                          or beside[1] in self.master[1] and beside[1] != j)
            x, y = centers[i, j]
            top_at = np.array((x, y, (planes[2][top + 1] - normals[2, 0] * x - normals[2, 1] * y) / normals[2, 2]))
            crown = crowns.setdefault((i, j), (tilt(normals[2], rng, .06), top_at, rng.uniform(0, .07)))
            if joined and beside not in crowns:
                crowns[beside] = crown
        for (i, j), top in tops.items():
            x, y = centers[i, j]
            # Where the dome slopes, the column's blocks are cut back to it instead of standing square,
            # and no block reaches past the foot of the outcrop.
            fall = np.array([float(self.dome(x - dx, y - dy) - self.dome(x + dx, y + dy)) / .3 for dx, dy in ((.15, 0), (0, .15))])
            slope = None if self.in_cleft(x, y) or np.linalg.norm(fall) < .25 else unit((*fall, 1))
            crown = np.array((x, y, float(self.dome(x, y))))
            out = unit((x, y, 0))
            k = 0
            while k <= top:
                upper = min(top, k + rng.choice((0, 0, 1, 1, 2)))
                low = np.array((planes[0][i], planes[1][j], planes[2][k]))
                high = np.array((planes[0][i + 1], planes[1][j + 1], planes[2][upper + 1]))
                center = np.linalg.solve(normals, (low + high) / 2)
                sides, exposed = [], []
                for axis in range(3):
                    for side, offset in ((-1, low[axis]), (1, high[axis])):
                        normal = normals[axis] * side
                        if axis == 2:
                            buried = side < 0 or solid(i, j, upper + 1)
                        else:
                            beside = (i + side, j) if axis == 0 else (i, j + side)
                            parted = ((i, j)[axis] + (side > 0)) in self.master[axis] and upper >= top - 1
                            buried = all(solid(*beside, layer) for layer in range(k, upper + 1)) and not parted
                        if buried:
                            sides.append((normal, offset * side + .07))
                            continue
                        face = center + normal * (offset * side - normal @ center)
                        if axis == 2:
                            # The column's own top lies on its block's shared surface.
                            normal, face, recess = crowns[i, j]
                        else:
                            normal, recess = tilt(normal, rng, .09), ledge[upper] + rng.uniform(0, .06)
                        sides.append((normal, normal @ face - recess))
                        exposed.append(normal)
                if slope is not None:
                    normal = tilt(slope, rng, .16)
                    sides.append((normal, normal @ crown + rng.uniform(0, .1)))
                    exposed.append(normal)
                lean, aside = rng.uniform(1.3, 1.5), np.cross(UP, out) * rng.uniform(-.5, .5)
                normal = unit(out + aside) * math.sin(lean) + UP * math.cos(lean)
                sides.append((normal, normal @ (out * 4.62)))
                # A bite out of an exposed edge leaves a small step: the same fractures at a finer scale.
                pieces = [sides]
                crest = upper == top
                for _ in range(rng.choice((1, 2, 2, 3) if crest else (0, 1, 1, 2)) if len(exposed) >= 2 else 0):
                    piece = pieces.pop(rng.randrange(len(pieces)))
                    first, second = rng.sample(exposed, 2)
                    reach = lambda normal: min(offset for face, offset in piece if face is normal)
                    pieces += [piece + [(tilt(first, rng, .05), reach(first) - rng.uniform(.08, .45))],
                               piece + [(tilt(second, rng, .05), reach(second) - rng.uniform(.08, .32))]]
                for piece in pieces:
                    bm = convex(piece)
                    for _ in range(rng.choice((0, 1, 1, 2, 2, 3)) if len(exposed) >= 2 else 0):
                        chip = sum(face * rng.uniform(.5, 1.5) for face in rng.sample(exposed, min(len(exposed), rng.choice((2, 2, 3)))))
                        if np.linalg.norm(chip) > .4 and len(bm.verts):
                            chip = unit(chip)
                            carve(bm, chip, max(chip @ np.array(vertex.co) for vertex in bm.verts) - rng.uniform(.05, .5 if crest else .32))
                    soup.add(bm)
                k = upper + 1
        return len(tops)

    def chunk(self, center, size):
        """A loose block: bounded by the same three fracture sets, then tumbled."""
        rng = self.rng
        axis, angle = unit([rng.gauss(0, 1) for _ in range(3)]), rng.uniform(0, math.pi)
        sides = []
        for index, normal in enumerate(self.normals):
            for side in (-1, 1):
                normal_ = turned(tilt(normal * side, rng, .2), axis, angle)
                sides.append((normal_, normal_ @ center + size * rng.uniform(.55, 1) * (.6 if index == 2 else 1)))
        bm = convex(sides)
        for _ in range(2):
            chip = unit([rng.gauss(0, 1) for _ in range(3)])
            carve(bm, chip, max(chip @ np.array(vertex.co) for vertex in bm.verts) - size * rng.uniform(.1, .5))
        return bm

    def rubble(self, soup):
        """A few fallen blocks and a scatter of small stones at the rock's foot."""
        rng = self.rng
        for size_range, count, spread in (((.22, .48), rng.randint(4, 6), .55), ((.045, .13), rng.randint(70, 100), .95)):
            for _ in range(count):
                bearing = rng.uniform(0, math.tau)
                out = np.array((math.cos(bearing), math.sin(bearing)))
                edge = next((r for r in np.arange(5, 1, -.05) if self.height(*(out * r)) > .3), 3.)
                spot = out * min(edge + rng.uniform(.1, spread), 4.85)
                size = rng.uniform(*size_range)
                soup.add(self.chunk(np.array((*spot, float(self.sand(*spot)) + size * .2)), size))

    def sand_slab(self, soup):
        count = self.drift.shape[0]
        axis = self.GRID_LOW + np.arange(count) * self.GRID_STEP
        x, y = np.meshgrid(axis, axis, indexing='ij')
        top = np.stack([x.ravel(), y.ravel(), self.drift.ravel()], 1)
        bottom = top * (1, 1, 0) + (0, 0, -1.6)
        i, j = np.meshgrid(np.arange(count - 1), np.arange(count - 1), indexing='ij')
        a, b, c, d = (i * count + j).ravel(), ((i + 1) * count + j).ravel(), ((i + 1) * count + j + 1).ravel(), (i * count + j + 1).ravel()
        quads = [np.stack([a, b, c, d], 1), np.stack([d, c, b, a], 1) + len(top)]
        line = np.arange(count)
        for rim in (line * count, line * count + count - 1, line, line + (count - 1) * count):
            quads.append(np.stack([rim[:-1], rim[1:], rim[1:] + len(top), rim[:-1] + len(top)], 1))
        soup.add_arrays(np.concatenate([top, bottom]), np.concatenate(quads))

    def build(self):
        soup = Soup()
        columns = self.blocks(soup)
        self.rubble(soup)
        self.sand_slab(soup)
        obj = soup.fuse('bedrock / high-poly', .032)
        log(f'bedrock: {columns} columns, {len(obj.data.polygons)} faces')
        return obj

    def weather(self, obj):
        """Wear the fused rock: soften voxel steps and exposed edges, cut grooves along the
        bedding, add relief that runs with the beds, and pit the faces in patches."""
        mesh, seed = obj.data, self.seed
        edge = edges(mesh)
        points = relax(coords(mesh), edge, 2)
        # Small stones lying on the sand would be turned inside out by relief bigger than they are.
        rock = smoothstep(points[:, 2] - self.sand(points[:, 0], points[:, 1]), .04, .3)
        normal = normals(mesh, points)
        wear = .5 + .4 * fbm(points * .6, seed + 1)
        for repeat, share in ((10, .9), (45, .3)):
            bulge = ((points - relax(points, edge, repeat)) * normal).sum(1)
            points -= normal * (np.clip(bulge, 0, None) * wear * share * rock)[:, None]
        normal = normals(mesh, points)
        bed = self.normals[2]
        level = points @ bed
        steep = 1 - (normal @ bed) ** 2
        gap = np.abs(level[:, None] - self.planes[2][None, :])
        groove = np.exp(-(gap.min(1) / .03) ** 2) * self.parting[gap.argmin(1)] * .04
        lamina = value_noise(np.stack([level * 10 + fbm(points * .5, seed + 2, 2) * .6, points[:, 0] * .3, points[:, 1] * .3], 1), seed + 3)
        along_beds = points + bed * (level * 1.6)[:, None]
        relief = fbm(points * .45, seed + 4) * .05 + fbm(along_beds * 2.4, seed + 5, 4) * .022
        # Broken faces: flat chips, thin across the beds, coarse in some patches and fine in others.
        rough = .35 + .65 * smoothstep(fbm(points * .5, seed + 9, 2), -.3, .3)
        relief += (facets(along_beds * 3.6, seed + 10) / 3.6 * 1.1 + facets(along_beds * 9, seed + 11) / 9 * .7) * rough
        pit = np.clip(.3 - cells(points * 4.2, seed + 6), 0, 1) / .3
        patch = np.clip(fbm(points * .7, seed + 7, 2) * 2, 0, 1)
        move = relief - steep * (groove * 1.3 + .016 * np.clip(-lamina, 0, 1)) - pit ** 2 * patch * .035
        normals(mesh, points + normal * (move * rock)[:, None])

    def paint(self, obj):
        """Masks for the rock material: sand, cut crystal roots, the dark halo around the
        ore, edge wear, and each face corner's distance to the nearest open fracture."""
        mesh, seed = obj.data, self.seed
        depth = np.empty(len(mesh.vertices))
        mesh.attributes['ore depth'].data.foreach_get('value', depth)
        points, normal, edge = coords(mesh), normals(mesh), edges(mesh)
        bulge = ((points - relax(points, edge, 6)) * normal).sum(1)
        sand = smoothstep(self.sand(points[:, 0], points[:, 1]) + .03 - points[:, 2], 0, .035)
        dust = (smoothstep(normal[:, 2], .72, .95) * np.clip(.3 - bulge * 25 + .5 * fbm(points * .8, seed + 8), 0, 1)
                * np.clip(1.25 - points[:, 2] * .35, .25, 1))
        # The lowest hand's breadth of rock is dusted, so its foot fades into the ground.
        foot = smoothstep(points[:, 2], .16, .02) * smoothstep(points[:, 2], -.14, -.02) * .9
        root = np.clip(.5 - depth * 5, 0, 1)
        halo = np.clip((np.exp(-np.clip(depth, 0, None) / .4) - .11) / .89, 0, 1)
        paint(mesh, 'Masks', np.stack([np.maximum.reduce([sand, dust * .85, foot]), root, halo, np.clip(.5 + bulge * 30, 0, 1)], 1))
        vertex, face = corners(mesh)
        faces = len(mesh.polygons)
        joint = np.empty((len(vertex), 3))
        for axis in range(3):
            level = points[vertex] @ self.normals[axis]
            middle = np.bincount(face, level, faces) / np.bincount(face, minlength=faces)
            live = self.live[axis]
            joint[:, axis] = level - live[np.abs(middle[:, None] - live[None, :]).argmin(1)][face]
        paint(mesh, 'Joint', joint, 'CORNER')


# --- Crystals --------------------------------------------------------------------

class Crystal:
    """One crystal individual: the convex solid inside its prism faces, termination and base."""

    def __init__(self, rng, root, axis, half, length, style, habit, glint=False, grade=MEDIUM, chips=0):
        root, axis = np.asarray(root, float), unit(axis)
        side = unit(np.cross(axis, UP if abs(axis[2]) < .9 else (1, 0, 0)))
        other = np.cross(axis, side)
        self.outs = [side * math.cos(habit['turn'] + step * math.pi / 4) + other * math.sin(habit['turn'] + step * math.pi / 4)
                     for step in range(8)]
        tip = root + axis * length
        faces = []
        for step, out in enumerate(self.outs):
            # Four main faces, one pair set back to flatten the prism, and four narrower ones on its edges.
            reach = (half * rng.uniform(1., 1.3) * (1 + habit['flat']) / 2 if step % 2
                     else half * (habit['flat'] if step % 4 else 1) * rng.uniform(.93, 1.07))
            normal = unit(out + axis * habit['taper'])
            faces.append((normal, normal @ root + reach, PRISM))
        if style == 'broken':
            normal = tilt(axis, rng, .6)
            faces.append((normal, normal @ tip, BREAK))
            if rng.random() < .5:
                normal = tilt(axis, rng, 1.)
                faces.append((normal, normal @ (tip - axis * half * rng.uniform(0, .5)), BREAK))
        else:
            for step in (0, 2, 4, 6):
                normal = unit(axis * math.cos(habit['steep']) + self.outs[step] * math.sin(habit['steep']))
                setback = half * (rng.uniform(.5, .9) if style == 'chisel' and step % 4 else rng.uniform(0, .25))
                faces.append((normal, normal @ tip - setback, TIP))
            if style == 'flat':
                faces.append((axis, axis @ tip - half * rng.uniform(.3, .6), TIP))
        if glint:
            # Cleaved within a few degrees of the sun-camera half-vector, so the face flashes.
            normal = tilt(GLINT, rng, .22)
            faces.append((normal, normal @ tip - half * rng.uniform(.15, .45), TIP))
        for _ in range(chips):
            # A corner knocked off near the tip, left as a rough fracture.
            step = rng.randrange(8)
            out = unit(self.outs[step] + self.outs[(step + 1) % 8])
            normal = unit(out + axis * rng.uniform(.4, 1.2))
            faces.append((normal, normal @ (tip - axis * half * rng.uniform(.2, 1.2) + out * half * rng.uniform(.75, .95)), BREAK))
        faces.append((-axis, -axis @ root + half * .4 + .12, BASE))
        self.normals = np.array([face[0] for face in faces])
        self.offsets = np.array([face[1] for face in faces])
        self.kinds = np.array([face[2] for face in faces])
        self.root, self.axis, self.tip, self.half, self.length, self.grade, self.style = root, axis, tip, half, length, grade, style
        self.center = root + axis * length / 2
        self.radius = length / 2 + half * 1.7 + .15
        self.tone = habit['tone'] * rng.uniform(.9, 1.1)
        self.polish = habit['polish']

    def solid(self):
        return convex(zip(self.normals, self.offsets))

    def enter(self, origin, direction):
        """How far along a ray the crystal is entered, or None."""
        speed = self.normals @ direction
        gap = self.offsets - self.normals @ origin
        if np.any((np.abs(speed) < 1e-9) & (gap < 0)):
            return None
        with np.errstate(divide='ignore'):
            reach = gap / speed
        near = max(reach[speed < -1e-9], default=0.)
        far = min(reach[speed > 1e-9], default=np.inf)
        return near if near <= far and far > 0 else None


def bundle(rng, root, axis, half, length, grade):
    """A crystal as it really grows: parallel individuals of one orientation, growth layers
    standing proud of its faces, sometimes a knee twin."""
    axis = unit(axis)
    habit = dict(turn=rng.uniform(0, math.tau), taper=rng.uniform(0, .045), flat=rng.uniform(.62, 1),
                 steep=rng.uniform(.62, .92), tone=rng.uniform(.8, 1.25), polish=rng.random() < .65)
    style = lambda: rng.choice(('point', 'point', 'chisel', 'chisel', 'broken', 'flat'))
    glint = lambda: bool(axis @ GLINT > .55 and rng.random() < .6)
    main = Crystal(rng, root, axis, half, length, style(), habit, glint(), grade, rng.randint(1, 3) if grade == LARGE else rng.randint(0, 1))
    parts = [main]
    # A flat-topped crystal often grew fastest at its edges: individuals around its rim stand
    # a little taller than its middle, the stepped hollow of a hopper crystal.
    hopper = main.style == 'flat' and grade != SMALL
    for _ in range(rng.randint(5, 6) if hopper else rng.randint(3, 5) if grade == LARGE else rng.randint(2, 3) if grade == MEDIUM else rng.randint(0, 1)):
        out = main.outs[0] * math.cos(angle := rng.uniform(0, math.tau)) + main.outs[2] * math.sin(angle)
        reach = rng.uniform(1.02, 1.1) if hopper and rng.random() < .7 else rng.uniform(.42, .88)
        parts.append(Crystal(rng, main.root + out * half * rng.uniform(.5, .95) + axis * length * rng.uniform(-.05, .2) * (reach < 1), axis,
                             half * rng.uniform(.36, .68), length * reach, style(), habit, glint(), grade))
    for _ in range(rng.randint(1, 3) if half > .25 else 0):
        out, scale = main.outs[rng.randrange(0, 8, 2)], rng.uniform(.6, .9)
        parts.append(Crystal(rng, main.root + out * half * (1 - scale + rng.uniform(.05, .12)), axis, half * scale,
                             length * rng.uniform(.4, .85), rng.choice(('flat', 'chisel', 'broken')), habit, False, grade))
    if grade != SMALL and rng.random() < .35:
        hinge = main.outs[rng.randrange(8)]
        knee = max((turned(axis, hinge, sign * 1.14) for sign in (-1, 1)), key=lambda vector: vector[2])
        if knee[2] > .15:
            parts.append(Crystal(rng, main.root + axis * length * rng.uniform(.25, .5), knee, half * rng.uniform(.6, .8),
                                 length * rng.uniform(.35, .55), style(), dict(habit, turn=rng.uniform(0, math.tau)), False, grade))
    return parts


def scout_rays(bearing, rng=None):
    """The game's mining rays for a Scout at `bearing`: from 1 m up just outside the
    footprint toward three heights over the center. With `rng`, one ray scattered nearby."""
    if rng:
        bearing += rng.uniform(-.045, .045)
    origin = np.array((math.cos(bearing) * (FOOTPRINT_RADIUS + .7), math.sin(bearing) * (FOOTPRINT_RADIUS + .7), 1.))
    heights = (rng.uniform(.3, 1.25),) if rng else (.65, .35, 1.1)
    return [(origin, unit(np.array((0, 0, height)) - origin)) for height in heights]


def first_contact(tree, crystals, bearing):
    """Where the tool lands on the planned deposit: the point, the rock's normal there, and whether ore is hit first."""
    for origin, direction in scout_rays(bearing):
        hit, normal, _, distance = tree.ray_cast(Vector(origin), Vector(direction))
        entries = [entry for entry in (crystal.enter(origin, direction) for crystal in crystals) if entry is not None]
        nearest = min(entries, default=np.inf)
        if hit is None and not entries:
            continue
        if nearest < (distance if hit else np.inf) + .05:
            return origin + direction * nearest, None, True
        return np.array(hit), np.array(normal), False
    return None, None, False


def plan_ore(rng, outcrop, tree):
    """Root crystals where the story puts them: crowding the cleft, tallest toward its back,
    and in the flank joints where a Scout's tool lands."""
    crystals, taken = [], []

    def free(point, keepout):
        return all(np.linalg.norm(point - other) > (keepout + theirs) / 2 for other, theirs in taken)

    def plant(point, axis, half, length, grade, keepout):
        # No tip stands more than 3 m over the ground (the export scales this up a little),
        # and none reaches as far out as the rock does: the game sizes each state by its widest
        # reach, so the rock must set it with or without the ore.
        axis = unit(axis)
        fitted = min(length, (2.95 - point[2]) / max(axis[2], .1))
        tip = point + axis * fitted
        if fitted < .6 * length or math.hypot(tip[0], tip[1]) > outcrop.reach - .4 or not free(point, keepout):
            return False
        half, length = half * fitted / length, fitted
        taken.append((point, keepout))
        crystals.extend(bundle(rng, point - unit(axis) * .05, axis, half, length, grade))
        return True

    def spray(point, axis, half, length, keepout):
        """A crystal with smaller ones fanning out around its foot, as crystals crowd one
        another on a wall. None of them stands alone."""
        if not plant(point, axis, half, length, MEDIUM, keepout):
            return False
        axis = unit(axis)
        side = unit(np.cross(axis, (.3, .2, 1)))
        for turn in rng.sample((0, 1.3, 2.5, 3.8, 5.), rng.randint(2, 3)):
            out = turned(side, axis, turn + rng.uniform(-.5, .5))
            lean = unit(axis + out * rng.uniform(.4, .9))
            if lean[2] > .1:
                plant(point + out * half * rng.uniform(.9, 1.4), lean, half * rng.uniform(.4, .7), length * rng.uniform(.35, .7), SMALL, 0)
        return True

    # Surfaces the cleft's open space can see, sampled by rays from its middle line.
    seen = []
    for _ in range(9000):
        along = rng.uniform(-4.3, 2.6)
        source = np.array((*outcrop.stage(outcrop.middle(along) + rng.uniform(-.3, .3), along), rng.uniform(.9, 2.3)))
        direction = unit((rng.gauss(0, 1), rng.gauss(0, .6), rng.uniform(-1, .15)))
        hit, normal, _, _ = tree.ray_cast(Vector(source), Vector(direction), 4)
        if hit is None or normal.dot(Vector(direction)) > 0 or normal.z < -.2:
            continue
        if outcrop.in_cleft(hit.x, hit.y, .4):
            seen.append((np.array(hit), np.array(normal)))
    rng.shuffle(seen)
    back = next(index for index, (point, _) in enumerate(seen) if .2 < outcrop.cleft_frame(point[0], point[1])[1] < 1.6)
    seen.insert(0, seen.pop(back))
    heart = np.array((*outcrop.stage(outcrop.middle(.5), .5), 0))

    def jitter(scale):
        return np.array([rng.gauss(0, scale) for _ in range(3)])

    large = 0
    for point, normal in seen:
        along = outcrop.cleft_frame(point[0], point[1])[1]
        if large == 7 or not -1.7 < along < 2.3:
            continue
        fan = unit((point - heart) * (1, 1, 0) + (1e-6, 0, 0)) * rng.choice((1, 1, 1, -.6))
        # The first is the king: upright, tallest and stoutest. Two of the rest lean across the others.
        lean = (0, .3, .65, .25, .75, .35, .2)[large]
        axis = unit(normal * .45 + UP * .9 + fan * (.2 + lean) + jitter(.18))
        axis = unit(axis + UP * max(0, (.62 if lean > .6 else .8) - axis[2]))
        tip = 2.95 if large == 0 else max(1.7, 2.8 - .28 * abs(along - .8) - rng.uniform(0, .7))
        length = max(1.3, (tip - point[2]) / axis[2])
        large += plant(point, axis, length * (.25 if large == 0 else rng.uniform(.17, .22)), length, LARGE, 1.15)
    medium = 0
    for point, normal in seen:
        if medium == 24:
            break
        along = outcrop.cleft_frame(point[0], point[1])[1]
        length = rng.uniform(.8, 1.7) * (1.15 if along < -2.6 else 1)
        medium += plant(point, unit(normal * .5 + UP * .85 + jitter(.28)), length * rng.uniform(.14, .2), length, MEDIUM, .5)
    small = 0
    for point, normal in seen:
        if small == 120:
            break
        length = rng.uniform(.28, .7)
        small += plant(point, unit(normal + UP * .3 + jitter(.35)), length * rng.uniform(.18, .3), length, SMALL, .26)
    log(f'cleft: {len(seen)} sites, {large} large, {medium} medium, {small} small crystals')

    # Flanks. Where a tool would land deeper than 3.5 m from the center (the cleft's mouth,
    # a gully), stand crystals in its way; then line the joints behind the outcrop and two
    # patches in front, so two thirds of the bearings meet ore.
    bearings = [math.tau * step / 72 for step in range(72)]

    def shallow(bearing):
        point = first_contact(tree, crystals, bearing)[0]
        return point is not None and math.hypot(point[0], point[1]) >= 3.5

    for bearing in bearings:
        out = np.array((math.cos(bearing), math.sin(bearing), 0))
        for _ in range(8):
            if all(shallow(bearing + aside) for aside in (-.03, 0, .03)):
                break
            spot = out * rng.uniform(3.65, 4.) + np.cross(UP, out) * rng.uniform(-.12, .12)
            hit, _, _, _ = tree.ray_cast(Vector(spot + UP * 4), Vector((0, 0, -1)))
            if hit is not None and hit.z > -.2:
                axis = unit(UP + out * rng.uniform(0, .45) + np.cross(UP, out) * rng.uniform(-.15, .15))
                spray(np.array(hit), axis, rng.uniform(.22, .32), (rng.uniform(1.3, 1.9) - hit.z) / axis[2], 0)
    deep = [round(math.degrees(bearing)) for bearing in bearings if not shallow(bearing)]
    log(f'tool lands deeper than 3.5 m on stage bearings {deep}')
    hidden = [bearing for bearing in bearings if math.sin(bearing) > .2]
    shown = [bearing for bearing in bearings if math.sin(bearing) <= .2]
    patches = [shown[start:start + 5] for start in (rng.randrange(0, len(shown) // 3), rng.randrange(len(shown) * 2 // 3, len(shown) - 5))]
    for count, bearing in enumerate(hidden + patches[0] + patches[1]):
        point, normal, ore = first_contact(tree, crystals, bearing)
        if point is None or ore or (.2 < math.sin(bearing) < .55 and rng.random() < .5):
            continue
        for index in range(4):
            origin, direction = scout_rays(bearing, rng)[0]
            hit, normal, _, _ = tree.ray_cast(Vector(origin), Vector(direction))
            if hit is None or hit.z < outcrop.sand(hit.x, hit.y) + .05:
                continue
            point, normal = np.array(hit), np.array(normal)
            if index == 0 and count % 3 == 0:
                length = rng.uniform(.55, .95)
                spray(point, unit(normal * .9 + UP * .6 + jitter(.25)), length * rng.uniform(.16, .22), length, .4)
            else:
                length = rng.uniform(.22, .45)
                plant(point, unit(normal + UP * .4 + jitter(.35)), length * rng.uniform(.3, .42), length, SMALL, .24)
    ore = sum(first_contact(tree, crystals, bearing)[2] for bearing in bearings)
    log(f'planned {len(crystals)} individuals; ore is first contact on {ore} of 72 bearings before the crust')
    return crystals


def nearest_crystal(points, crystals, reach):
    """For each point: its signed distance to the crystal it is deepest in (capped at
    `reach`), that crystal, and which of the crystal's faces it lies on."""
    depth = np.full(len(points), float(reach))
    owner = np.full(len(points), -1)
    face = np.zeros(len(points), int)
    for index, crystal in enumerate(crystals):
        near = np.nonzero(((points - crystal.center) ** 2).sum(1) < (crystal.radius + reach) ** 2)[0]
        if not len(near):
            continue
        gaps = points[near] @ crystal.normals.T - crystal.offsets
        which = gaps.argmax(1)
        gap = gaps[np.arange(len(near)), which]
        closer = gap < depth[near]
        depth[near[closer]], owner[near[closer]], face[near[closer]] = gap[closer], index, which[closer]
    return depth, owner, face


def inside(tree, point):
    """Whether a point is inside a closed surface: a ray leaving it crosses the surface an odd number of times."""
    origin, direction, crossings = Vector(point), Vector((.013, .007, 1)).normalized(), 0
    while True:
        hit = tree.ray_cast(origin, direction)[0]
        if hit is None:
            return crossings % 2 == 1
        origin, crossings = hit + direction * 1e-4, crossings + 1


def grow(outcrop, host, crystals):
    """Fuse the crystals with a thin ore crust over the rock between them, recess the rock
    under that lining, and trim the ore where it runs into the rock."""
    mesh, seed = host.data, outcrop.seed
    points, normal = coords(mesh), normals(mesh)
    depth, _, _ = nearest_crystal(points, crystals, .9)
    rock = points[:, 2] > outcrop.sand(points[:, 0], points[:, 1]) + .03
    lined = (depth < .24) & rock
    soup = Soup()
    for crystal in crystals:
        soup.add(crystal.solid())
    # The crust: the lined rock surface lifted a few centimetres, feathered out at its edge.
    vertex, face = corners(mesh)
    quads = vertex.reshape(-1, 4)[lined[vertex].reshape(-1, 4).all(1)]
    used, quads = np.unique(quads, return_inverse=True)
    lift = -.03 + .055 * smoothstep(depth[used], .24, .1) + .03 * fbm(points[used] * 5, seed + 20, 2)
    shell = new_object('ore / crust shell', (points[used] + normal[used] * lift[:, None]).tolist(), quads.reshape(-1, 4).tolist())
    activate(shell)
    solidify = shell.modifiers.new('Thickness', 'SOLIDIFY')
    solidify.thickness, solidify.offset = .16, -1
    bpy.ops.object.modifier_apply(modifier=solidify.name)
    shell_vertex, _ = corners(shell.data)
    soup.add_arrays(coords(shell.data), shell_vertex.reshape(-1, 4))
    bpy.data.objects.remove(shell)
    ore = soup.fuse('ore / high-poly', .02)

    # With the ore gone, the wall it covered is a cut surface a few centimetres down.
    normals(mesh, points - normal * (.05 * smoothstep(depth, .26, .12) * rock)[:, None])
    tree = tree_of(mesh)
    ore_points = coords(ore.data)
    buried = np.array([inside(tree, point) and tree.find_nearest(Vector(point))[3] > .045 for point in ore_points])
    keep_faces(ore, buried | (ore_points[:, 2] < -.25), smallest=40)
    # The rock stayed closed for that test; now drop what lies under the ground.
    mesh.attributes.new('ore depth', 'FLOAT', 'POINT').data.foreach_set('value', depth)
    keep_faces(host, coords(mesh)[:, 2] < -.85)
    log(f'ore: {len(ore.data.polygons)} faces, crust from {len(quads)} rock faces')
    return ore


def paint_ore(ore, host, crystals, outcrop):
    """Break the fractured tops, roughen the crust, and store the metal's masks: tone,
    clinging matrix, polish and edge wear, plus each vertex's crystal axis for striations."""
    mesh, seed = ore.data, outcrop.seed
    points, normal, edge = coords(mesh), normals(mesh), edges(mesh)
    depth, owner, face = nearest_crystal(points, crystals, .035)
    table = np.full((len(crystals) + 1, max(len(crystal.kinds) for crystal in crystals)), -1)
    for index, crystal in enumerate(crystals):
        table[index, :len(crystal.kinds)] = crystal.kinds
    kinds = table[owner, face]
    broken, crust = kinds == BREAK, owner < 0
    move = broken * fbm(points * 9, seed + 30) * .022 + crust * (.45 - cells(points * 11, seed + 31)) * .03
    normal = normals(mesh, points + normal * move[:, None])
    points = coords(mesh)
    bulge = ((points - relax(points, edge, 5)) * normal).sum(1)
    tree = tree_of(host.data)
    contact = np.array([tree.find_nearest(Vector(point))[3] for point in points])
    tones = np.array([crystal.tone for crystal in crystals] + [.7])[owner]
    polished = np.array([crystal.polish for crystal in crystals] + [False])[owner]
    axes = np.array([crystal.axis for crystal in crystals] + [(0, 0, 0)])[owner]
    axes[broken] = 0
    # What a face should show in game, divided by the light it gets: about .3 of its base
    # color in shade and 2.5 facing the sun. Sunlit metal brighter than .3 reads as chalk.
    lit = np.clip(normal @ SUN, 0, 1)
    # Each face has its own lustre, as on a real specimen: some bright, some dull.
    lustre = .72 + .6 * hashed(owner.astype(np.int64), face.astype(np.int64), np.zeros(len(owner), np.int64), seed + 33) ** 1.5
    shown = (.11 + .26 * lit ** .8) * tones * lustre * np.where(kinds == TIP, 1.2, 1) * np.where(broken, 1.3, 1)
    albedo = np.clip(shown / (.3 + 2.2 * lit), .04, .4)
    tone = np.where(albedo < .3, (albedo - .055) / .49, .5 + (albedo - .3) / .9)
    matrix = np.maximum(np.clip(-bulge / .012, 0, 1) * .8, 1 - smoothstep(contact, .02, .11 + .08 * fbm(points * 3, seed + 32)))
    # A flat face square to the glint direction clips to white; keep those a little duller.
    polish = polished * np.isin(kinds, (TIP, PRISM)) * (1 - .6 * smoothstep(normal @ GLINT, .975, .995)) + crust * .3
    paint(mesh, 'Masks', np.stack([np.clip(tone, 0, 1), matrix, np.clip(polish, 0, 1), np.clip(bulge / .005, 0, 1)], 1))
    paint(mesh, 'Axis', axes)


# --- Materials -------------------------------------------------------------------

class Graph:
    """Small helpers for the procedural source materials. Each material can show its
    shaded surface, its base color, or its roughness and metalness, for the bake passes."""

    def __init__(self, name):
        self.material = bpy.data.materials.new(name)
        self.material.use_nodes = True
        self.nodes, self.links = self.material.node_tree.nodes, self.material.node_tree.links
        self.shader = self.nodes.get('Principled BSDF')
        self.position = self.nodes.new('ShaderNodeTexCoord').outputs['Object']
        self.height = self.nodes.new('ShaderNodeSeparateXYZ')
        self.links.new(self.position, self.height.inputs[0])
        self.height = self.height.outputs['Z']

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

    def noise(self, scale, detail=3., vector=None, along=None):
        """Noise over the surface, or with `along` a value, noise in bands across it."""
        node = self.nodes.new('ShaderNodeTexNoise')
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = detail
        node.inputs['Roughness'].default_value = .62
        if along is None:
            self.links.new(vector or self.position, node.inputs['Vector'])
        else:
            node.noise_dimensions = '1D'
            self.links.new(along, node.inputs['W'])
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

    def attribute(self, name):
        node = self.nodes.new('ShaderNodeAttribute')
        node.attribute_name = name
        return node

    def masks(self):
        node = self.attribute('Masks')
        channels = self.nodes.new('ShaderNodeSeparateColor')
        self.links.new(node.outputs['Color'], channels.inputs['Color'])
        return channels.outputs['Red'], channels.outputs['Green'], channels.outputs['Blue'], node.outputs['Alpha']

    def host(self):
        """The terrain's own cliff and scree photographs, in patches."""
        return self.mix(self.remap(self.noise(.45, 3), .42, .62), self.image(CLIFF_COLOR, 8), self.image(SCREE_COLOR, 5))

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
        self.material['shows'] = 'shaded'
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


def host_material(outcrop):
    graph = Graph('Cluster / bedrock and sand')
    sand, root, halo, wear = graph.masks()
    bed = graph.vector('DOT_PRODUCT', graph.position, tuple(outcrop.normals[2]))
    band = graph.noise(3.2, 2, along=bed)
    lamina = graph.noise(26, 2, along=graph.add(bed, graph.times(graph.noise(.6, 2), .12)))
    # Each bed has its own tone, laminae run through it, and worn edges are paler than hollows.
    rock = graph.mix(1, graph.host(), graph.times(graph.add(.9, graph.times(band, .55)), graph.add(.9, graph.times(lamina, .2)),
                                                  graph.add(.62, graph.times(wear, .76))), 'MULTIPLY')
    # Open fractures: thin dark lines where a live plane of any set crosses the surface.
    apart = graph.nodes.new('ShaderNodeSeparateXYZ')
    graph.links.new(graph.vector('ABSOLUTE', graph.attribute('Joint').outputs['Vector']), apart.inputs[0])
    crack = 0.
    for index, channel in enumerate(apart.outputs):
        open_ = graph.times(graph.invert(graph.remap(channel, .003, .017)), graph.remap(graph.noise(1.3 + index * .3, 3), .38, .56))
        crack = graph.math('MAXIMUM', crack, open_)
    rock = graph.mix(graph.times(crack, .8), rock, (0, 0, 0))
    # Ore fluid darkened and cooled the rock beside the fracture.
    rock = graph.mix(graph.times(halo, .8), rock, graph.mix(1, rock, (.5, .46, .44), 'MULTIPLY'))
    drift = graph.remap(graph.jitter(sand, 3.5, .4), .38, .62)
    # Where a crystal was cut off flush: its outline, a dull grey section, a thin dark joint around it.
    cut = graph.times(graph.remap(root, .5, .53), graph.invert(drift))
    rim = graph.times(graph.invert(graph.remap(graph.math('ABSOLUTE', graph.math('SUBTRACT', root, .5)), .02, .09)), graph.invert(drift))
    rock = graph.mix(cut, rock, graph.ramp(graph.noise(7, 3), [(.3, (.075, .07, .068)), (.7, (.12, .112, .108))]))
    rock = graph.mix(graph.times(rim, .7), rock, (.012, .011, .01))
    color = graph.mix(drift, rock, graph.sand())
    stone = graph.add(graph.times(graph.invert(cut), graph.luma(graph.image(CLIFF_GRAIN, 2.4)), .03), graph.times(lamina, .006),
                      graph.times(crack, -.02), graph.times(rim, -.012))
    relief = graph.add(graph.times(graph.invert(drift), stone), graph.times(drift, graph.luma(graph.image(GROUND_COLOR, 30)), .01))
    return graph.finish(color, graph.math('SUBTRACT', .92, graph.times(cut, .3)), graph.times(cut, .2), relief)


def ore_material():
    graph = Graph('Cluster / titanium crystals')
    tone, matrix, polish, edge = graph.masks()
    axis = graph.attribute('Axis').outputs['Vector']
    # Noise squeezed along each crystal's axis: striations that run the length of its faces.
    across = graph.vector('SUBTRACT', graph.position, graph.vector('SCALE', axis, scale=graph.times(
        graph.vector('DOT_PRODUCT', graph.position, axis), .97)))
    streak = graph.noise(34, 3, across)
    value = graph.add(tone, graph.times(graph.math('SUBTRACT', streak, .5), .3), graph.times(graph.math('SUBTRACT', graph.noise(1.1, 3), .5), .14))
    metal = graph.ramp(value, [(0, SHADOW), (.5, MID), (1, LIGHT)])
    metal = graph.mix(graph.times(edge, graph.add(.35, streak), .8), metal, LIGHT)
    # Host rock still clings in the re-entrants; lower down it is sand.
    stuck = graph.remap(graph.jitter(matrix, 9, .5), .45, .65)
    dirt = graph.mix(graph.remap(graph.jitter(graph.height, 2, .5), .5, 1.2), graph.sand(),
                     graph.mix(1, graph.host(), (.5, .5, .55), 'MULTIPLY'))
    color = graph.mix(stuck, metal, dirt)
    roughness = graph.add(graph.mix(polish, graph.add(.54, graph.times(streak, .14)), graph.add(.25, graph.times(streak, .1))),
                          graph.times(stuck, .4))
    # Striations, and a slow waviness that lets a glint grade across a face instead of filling it.
    relief = graph.add(graph.times(graph.invert(stuck), streak, .004), graph.times(graph.noise(7, 2), .006),
                       graph.times(stuck, graph.noise(24, 3), .008))
    return graph.finish(color, roughness, graph.times(graph.invert(stuck), METALNESS), relief)


# --- Runtime mesh and bake -------------------------------------------------------

def runtime(source, triangles, state):
    """The low-poly: the high-poly source decimated to the budget."""
    obj = duplicate(source, source.name.replace('high-poly', 'runtime'))
    for name in ('Masks', 'Joint', 'Axis', 'ore depth'):
        if name in obj.data.attributes:
            obj.data.attributes.remove(obj.data.attributes[name])
    obj.data.materials.clear()
    obj.data.calc_loop_triangles()
    activate(obj)
    modifier = obj.modifiers.new('Runtime budget', 'DECIMATE')
    modifier.ratio = min(1, triangles / len(obj.data.loop_triangles))
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    keep_faces(obj, None, smallest=6)
    obj.data.attributes.new('state', 'INT', 'FACE').data.foreach_set('value', [state] * len(obj.data.polygons))
    return obj


def unwrap(parts):
    """Join the runtime parts, keep hard edges hard, and give them one atlas."""
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for face in bm.faces:
        face.smooth = True
    for edge in bm.edges:
        edge.smooth = len(edge.link_faces) != 2 or edge.calc_face_angle() < math.radians(55)
    # Charts: patches grown from the largest faces outward. They wrap around a convex body
    # (the faces of one crystal, the top and sides of one block) up to a quarter turn from
    # the patch's mean direction, and stop at the concave creases between bodies.
    chart, state = bm.faces.layers.int.new('chart'), bm.faces.layers.int['state']
    charted, count = set(), 0
    for seed in sorted(bm.faces, key=lambda face: -face.calc_area()):
        if seed in charted:
            continue
        count += 1
        charted.add(seed)
        seed[chart] = count
        mean, queue = seed.normal * seed.calc_area(), deque([seed])
        # Rough rock stretches if a chart bends far; a crystal's flat faces unroll cleanly.
        bend = math.cos(math.radians(95 if seed[state] == FULL else 62))
        while queue:
            for edge in queue.popleft().edges:
                if len(edge.link_faces) != 2 or edge.calc_face_angle_signed() < -math.radians(55):
                    continue
                for other in edge.link_faces:
                    if other not in charted and other.normal.dot(mean.normalized()) > bend:
                        charted.add(other)
                        other[chart] = count
                        mean += other.normal * other.calc_area()
                        queue.append(other)
    for edge in bm.edges:
        edge.seam = len(edge.link_faces) != 2 or edge.link_faces[0][chart] != edge.link_faces[1][chart]
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.uv_layers.new(name='RuntimeUV')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.unwrap(method='ANGLE_BASED', margin=.002)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    # The camera never moves: charts it cannot see, or that lie under the ground, get a
    # third of the texels, and the ore a quarter more than the rock.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv, state, chart = bm.loops.layers.uv.active, bm.faces.layers.int['state'], bm.faces.layers.int['chart']
    members = {}
    for face in bm.faces:
        members.setdefault(face[chart], []).append(face)
    for faces in members.values():
        area = sum(face.calc_area() for face in faces)
        shown = sum(face.calc_area() for face in faces
                    if face.normal.dot(Vector(VIEW)) > -.05 and face.calc_center_median().z > -.45) / max(area, 1e-9)
        scale = (.35 + .65 * shown) * (1.25 if faces[0][state] == FULL else 1)
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
    log(f'atlas: {len(members)} charts')
    return obj


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
    """Bake the high-poly sources onto the joined low-poly. `sources` lists, per state,
    the high-poly object and what else may shade it: each state's faces take color, normal,
    occlusion and surface values only from their own source, found by rays cast inward
    from a cage just outside the low-poly."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    settings = dict(use_selected_to_active=True, cage_extrusion=.06, max_ray_distance=.2, margin=0, use_clear=True,
                    uv_layer='RuntimeUV', normal_space='TANGENT')
    # The first pass marks the texels whose ray found the source; the rest take their neighbours' values.
    passes = dict(found=('EMIT', 1, 'white'), color=('EMIT', 4, 'color'), normal=('NORMAL', 8, 'shaded'),
                  occlusion=('AO', 64, 'shaded'), surface=('EMIT', 4, 'surface'))
    layers = {key: np.zeros((ATLAS, ATLAS, 4), np.float32) for key in passes}
    covered = np.zeros((ATLAS, ATLAS), bool)
    states = np.empty(len(low.data.polygons), np.int64)
    low.data.attributes['state'].data.foreach_get('value', states)
    highs = [source for source, _ in sources.values()]
    for state, (high, company) in sources.items():
        target = duplicate(low, f'bake target {state}')
        target.hide_render = False
        vertex, face = corners(target.data)
        doomed = np.ones(len(target.data.vertices), bool)
        doomed[vertex[states[face] == state]] = False
        keep_faces(target, doomed)
        material = bpy.data.materials.new(f'bake target {state}')
        material.use_nodes = True
        node = material.node_tree.nodes.new('ShaderNodeTexImage')
        material.node_tree.nodes.active = node
        target.data.materials.clear()
        target.data.materials.append(material)
        for other in highs:
            other.hide_render = other is not high and other not in company
        low.hide_render = True
        bpy.ops.object.select_all(action='DESELECT')
        high.select_set(True)
        target.select_set(True)
        bpy.context.view_layer.objects.active = target
        for key, (kind, samples, shows) in passes.items():
            image = bpy.data.images.new(f'{key} {state}', ATLAS, ATLAS, alpha=True, float_buffer=True)
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
                log(f'state {state}: {hit.mean():.1%} of the atlas')
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

def split(baked, states, path):
    """Export the faces one state shows; the copy keeps the baked atlas and material."""
    obj = duplicate(baked, path.stem)
    values = np.empty(len(obj.data.polygons), np.int64)
    obj.data.attributes['state'].data.foreach_get('value', values)
    vertex, face = corners(obj.data)
    doomed = np.ones(len(obj.data.vertices), bool)
    doomed[vertex[np.isin(values, states)[face]]] = False
    keep_faces(obj, doomed)
    activate(obj)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_image_format='WEBP', export_image_quality=72,
                              export_vertex_color='NONE')
    return obj


def mining_contact(obj):
    """Where a Scout's tool lands from every bearing, by the game's own rule."""
    tree = tree_of(obj.data)
    states = [item.value for item in obj.data.attributes['state'].data]
    reaches, ore = [], 0
    for step in range(72):
        for origin, direction in scout_rays(math.tau * step / 72):
            hit, _, index, _ = tree.ray_cast(Vector(origin), Vector(direction))
            if hit:
                reaches.append(math.hypot(hit.x, hit.y))
                ore += states[index] == FULL
                break
        else:
            reaches.append(0)
    return dict(nearest_contact=min(reaches), ore_bearings=ore / 72)


def describe(obj, path):
    obj.data.calc_loop_triangles()
    points = coords(obj.data)
    return dict(path=str(path.relative_to(OUT)), bytes=path.stat().st_size,
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(), triangles=len(obj.data.loop_triangles),
                radius=float(np.hypot(points[:, 0], points[:, 1]).max()), height=float(points[:, 2].max()),
                **mining_contact(obj))


def draft(path):
    """A quick look from the game's camera, with its sun."""
    scene = bpy.context.scene
    turn = Matrix.Rotation(STAGE_TURN, 3, 'Z')
    camera = bpy.data.objects.new('Game camera', bpy.data.cameras.new('Game camera'))
    camera.data.type, camera.data.ortho_scale = 'ORTHO', 15
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
    scene.cycles.device, scene.cycles.samples = 'CPU', 24
    scene.render.resolution_x, scene.render.resolution_y = 1500, 1050
    scene.view_settings.view_transform = 'Standard'
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def author(seed, suffix):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    SHOWS.clear()
    rng = random.Random(seed)
    output = OUT / f'seed-{seed}'
    output.mkdir(parents=True, exist_ok=True)
    outcrop = Outcrop(rng, seed)
    host = outcrop.build()
    outcrop.weather(host)
    points = coords(host.data)
    outcrop.reach = float(np.hypot(points[:, 0], points[:, 1])[points[:, 2] > -.85].max())
    log(f'bedrock weathered, reach {outcrop.reach:.2f} m')
    crystals = plan_ore(rng, outcrop, tree_of(host.data))
    ore = grow(outcrop, host, crystals)
    outcrop.paint(host)
    paint_ore(ore, host, crystals, outcrop)
    host.data.materials.append(host_material(outcrop))
    ore.data.materials.append(ore_material())
    log('sources painted')
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'source.blend'))
    if args.draft:
        draft(output / 'draft.png')
        return []
    low = unwrap([runtime(host, 3100, BOTH), runtime(ore, 3700, FULL)])
    log(f'runtime mesh: {len(low.data.polygons)} triangles')
    bake(low, {BOTH: (host, []), FULL: (ore, [host])}, output, f'Titanium cluster {seed}')
    low.data.transform(Matrix.Rotation(STAGE_TURN, 4, 'Z'))
    low.rotation_euler.z = 0
    points = coords(low.data)
    low.data.transform(Matrix.Scale(FOOTPRINT_RADIUS / float(np.hypot(points[:, 0], points[:, 1]).max()), 4))
    entries = []
    for name, states in (('full', (BOTH, FULL)), ('depleted', (BOTH,))):
        path = OUT / f'{name}{suffix}.glb'
        entries.append(dict(seed=seed, state=name, **describe(split(low, states, path), path)))
        print('CLUSTER_EXPORT', json.dumps(entries[-1]), flush=True)
    return entries


exports = [entry for index, seed in enumerate(args.seed)
           for entry in author(seed, '-' + chr(ord('a') + index) if index else '')]
if exports:
    (OUT / 'export.json').write_text(json.dumps(dict(
        generator='tools/assets/build_titanium_cluster.py',
        format='1 mesh, 1 standard PBR material, 1024px WebP color/normal/roughness-metallic per seed, shared by both states',
        coordinates='Y-up, centered X/Z, ground pivot Y=0', assets=exports), indent=2) + '\n')
log('done')
