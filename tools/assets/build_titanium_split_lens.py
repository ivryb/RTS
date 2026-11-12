"""Author the "Split lens" Titanium Deposit: a squat sandstone shell broken open over a lens of ore.

blender --background --threads 6 --python-exit-code 1 --python tools/assets/build_titanium_split_lens.py -- [--seed 1 3] [--out <dir>] [--draft]

It reproduces the approved concept art/workbench/terrain-composite/ore-designs-v2/split-lens.png:
one low domed mass with a smaller shoulder at one end. A thick sandstone crust wraps the
far side, the outer end and the near foot; inside that rim the crust is gone and the dome
itself is ore, two broad graphite faces split by one deep diagonal crack.

Underground: the ore is one thick lens, domed toward the camera, inside a sandstone shell
whose roof erosion has taken off. Mined out, the lens leaves the shell's rim around a rough
trough with the lens's outline and dip, and sand in its low side.

Each `--seed` composes a different outcrop of the same design, always with the shoulder at
the camera's lower right: mirrored, the lens's slab end faces the sun and reads as a box.
The first seed exports `full.glb` and `depleted.glb`, the next `full-b.glb` and
`depleted-b.glb`, and so on. `--draft` stops before the bake and saves
`draft.png` and `draft-depleted.png`, quick renders from the game's camera; their sky lights
the ore far more than the game does, so judge only shape there. Nothing is written to
assets/models; review candidates with
`bun tools/verify/capture-ore.mjs --model <glb> --out <dir>`.

How a build goes:
1. Dome. Each mass starts from its ore surface, a paraboloid that is almost level at its
   crest and steepens toward the camera. The shell is that surface a crust's thickness
   higher, cut as flat tangent faces and closed by leaning sides.
2. Shell. Two sets of steep joints cut the shell into blocks; every block gets the shell's
   faces a little tilted and set back, bevelled along its joints and chipped, so broad faces
   stay broad but step and crack where blocks meet. Inside the outline of the hole in the
   crust the blocks are cut down to the trough's floor instead.
3. Lens. The ore is the dome cut as a few large facets (tangent planes at hand-placed
   points), bounded by the shell's own faces set in. The master joint splits it with an
   open crack, a cross joint breaks the near half, and broken plates of the next sheet up
   lie on the fragments like slate.
4. Both are fused by voxel remesh and weathered: worn edges, chipped relief and pits on the
   rock; cleavage strips, fracture flats and clinging crust on the ore.
5. Runtime. The worn sources are decimated, cut into charts, packed into one atlas and
   baked from the detailed sources with Cycles: color, normal, occlusion, roughness and
   metalness. Rock faces buried under the lens are drawn only in the depleted state, the
   lens only in the full one. Export turns the model to the game's axes and scales it.

The game never turns the model, the camera or the sun, so the half-vector between sun and
camera is one fixed direction (GLINT), and with no environment map the sun is all the metal
can reflect. Tried in the game: a broad smooth face within ten degrees of GLINT washes out
to pale sheet metal, and one further off stays flat black. So the ore's base is dark and
dull, each facet has its own tone and polish, and only the facets and chips that tilt
toward GLINT, and thin polished streaks along the cleavage, take the sun.
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
# Ore in linear RGB: crack shadow, graphite and silver. Sunlight multiplies these by about
# 2.3, so anything paler than this reads as chalk or ice in the game.
SHADOW, MID, LIGHT = (.016, .016, .017), (.082, .082, .087), (.42, .43, .45)
METALNESS = .5
# How thick the crust is where the ore stands behind it on a flank.
SKIN = .19
# Which state draws a face: the shell in both, the lens when full, the trough under it when depleted.
ROCK, ORE, HOLLOW = 0, 1, 2

# The two masses in their own frame: u runs along the outcrop toward the shoulder, v away
# from the camera, in metres. The dome is the ore surface: (u, v, height) of its crest by
# the far rim, its dip there in degrees, and how fast it steepens along and across. The
# shell is that dome a crust's thickness higher, cut as tangent faces at `grid`, closed by
# the sides: (azimuth, dip, distance of the foot from the center). Edges are (azimuth,
# distance from the patch center) of the hole in the crust: its far and outer-end edges lie
# near the crest; its near edge runs diagonally down the dome to the foot at the shoulder
# end, so the crust is a tall skirt at the outer end. The crack is (u, v, azimuth).
MAIN = dict(
    center=(-1.25, -.3),
    sides=[(180, 66, 3.7), (140, 60, 3.5), (100, 54, 2.97), (62, 56, 3.4), (8, 70, 3.6), (-50, 60, 3.1), (-92, 60, 2.42), (-138, 62, 3.3)],
    dome=(.3, .65, 2.), dip=12, sag=(.05, .3), crust=.42, grid=((-2.2, .2, 2.4), (.5, -.4, -1.2, -1.9)),
    patch=(.5, -.5), edges=[(-104.5, 1.15), (90, .82), (180, 2.7), (0, 2.75), (135, 2.3), (-140, 2.15), (40, 2.35), (-45, 2.8)],
    crack=(.2, -.6, -18), depth=(.22, .6),
    anchors=[(-1.5, .2), (-.2, .2), (1.3, .2), (2.6, .2), (-1.2, -.7), (.4, -.75), (1.9, -.8), (0, -1.5), (1.5, -1.6)])
SHOULDER = dict(
    center=(3.4, -.55),
    sides=[(180, 64, 1.45), (125, 60, 1.35), (70, 58, 1.3), (15, 66, 1.55), (-45, 62, 1.4), (-100, 62, 1.3), (-150, 62, 1.4)],
    dome=(0, .45, 1.), dip=11, sag=(.15, .5), crust=.2, grid=((-.5, .5), (.3, -.3, -.8)),
    patch=(0, -.15), edges=[(-90, .87), (90, .5), (180, .85), (0, .85), (135, .85), (-35, 1.05), (-140, 1.), (45, .8)],
    depth=(.16, .38), anchors=[(-.45, .1), (.4, 0), (-.1, -.55), (.4, -.7)])

parser = argparse.ArgumentParser()
parser.add_argument('--seed', type=int, nargs='+', default=[1, 3], help='one composition per seed')
parser.add_argument('--draft', action='store_true', help='render quick looks from the game camera without baking')
parser.add_argument('--out', type=Path, default=ROOT / 'art/workbench/titanium-split-lens')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = args.out.resolve()
started = time.time()


def log(message):
    print(f'LENS {time.time() - started:6.1f}s {message}', flush=True)


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


def scattered(points, seed):
    """One scattered point per unit cell: the distance to the nearest, and the offset from
    the small tilted chip around it, so the surface steps crisply where two chips meet."""
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
    return best, offset


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


def bulging(points, normal, edge, repeat):
    """How far each vertex stands proud of its neighbourhood: positive on edges, negative in creases."""
    return ((points - relax(points, edge, repeat)) * normal).sum(1)


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


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
    return BVHTree.FromPolygons(coords(mesh).tolist(), [face.tolist() for face in np.split(vertex, start[1:])])


def buried(tree, points, margin):
    """Which points lie inside a closed surface (a ray leaving them crosses it an odd number
    of times), deeper than `margin`."""
    direction, result = Vector((.013, .007, 1)).normalized(), np.zeros(len(points), bool)
    for index, point in enumerate(points.tolist()):
        origin, crossings = Vector(point), 0
        while (hit := tree.ray_cast(origin, direction)[0]) is not None:
            origin, crossings = hit + direction * 1e-4, crossings + 1
        result[index] = crossings % 2 == 1 and tree.find_nearest(Vector(point))[3] > margin
    return result


def paint(mesh, name, values):
    mesh.color_attributes.new(name, 'FLOAT_COLOR', 'POINT').data.foreach_set('color', np.clip(values, 0, 1).ravel())


# --- Convex solids -------------------------------------------------------------

def convex(planes):
    """The solid where normal . p <= offset for every plane, or None if nothing is left."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=40)
    for normal, offset in planes:
        cut = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=Vector(normal) * float(offset),
                                     plane_no=Vector(normal), clear_outer=True)
        rim = [item for item in cut['geom_cut'] if isinstance(item, bmesh.types.BMEdge)]
        if rim:
            bmesh.ops.edgeloop_fill(bm, edges=rim)
        if len(bm.faces) < 4:
            bm.free()
            return None
    return bm


def tilt(normal, rng, angle):
    """`normal` leaned by up to `angle` radians in a random direction."""
    side = np.cross(normal, unit([rng.gauss(0, 1) for _ in range(3)]))
    return unit(normal + unit(side) * math.tan(rng.uniform(.25, 1) * angle))


def lean(out, dip):
    """The normal of a face that dips `dip` degrees toward the horizontal direction `out`."""
    return np.array((*(np.asarray(out)[:2] * math.sin(math.radians(dip))), math.cos(math.radians(dip))))


def chips(rng, count, depth):
    """Corners to knock off the top of a block."""
    return [(unit((rng.gauss(0, 1), rng.gauss(0, 1), rng.uniform(.5, 1.6))), rng.uniform(*depth)) for _ in range(count)]


def through(normal, point):
    return normal, float(normal @ np.asarray(point))


def spaced(rng, low, high, gaps):
    """Irregularly spaced fracture planes, one of them at zero."""
    marks = [low]
    while marks[-1] < high:
        marks.append(marks[-1] + rng.uniform(*gaps) * rng.choice((.7, 1, 1, 1.3)))
    marks = np.array(marks)
    return marks - marks[np.abs(marks).argmin()]


class Soup:
    """Closed solids gathered into one mesh; a voxel remesh fuses them into their union."""

    def __init__(self):
        self.points, self.faces = [], []

    def add(self, bm, cuts=(), nudge=None):
        """Add a solid. Each of `cuts` is a direction and how far in from the solid's furthest
        point that way to slice it: a bevel or a knocked-off corner. `nudge` shifts it as one piece."""
        if bm is None:
            return
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        if bm.calc_volume() < .012:
            return bm.free()
        for direction, depth in cuts:
            cut = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_no=Vector(direction), clear_outer=True,
                                         plane_co=Vector(direction) * (max(direction @ np.array(v.co) for v in bm.verts) - depth))
            bmesh.ops.edgeloop_fill(bm, edges=[item for item in cut['geom_cut'] if isinstance(item, bmesh.types.BMEdge)])
        if nudge:
            turn, lift = nudge
            middle = sum((v.co for v in bm.verts), Vector()) / len(bm.verts)
            bmesh.ops.rotate(bm, verts=bm.verts, cent=middle, matrix=Matrix.Rotation(turn, 3, 'X') @ Matrix.Rotation(turn * .7, 3, 'Y'))
            bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, lift))
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
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.points, [], self.faces)
        obj = bpy.data.objects.new(name, mesh)
        obj.rotation_euler.z = STAGE_TURN
        bpy.context.collection.objects.link(obj)
        activate(obj)
        remesh = obj.modifiers.new('Fuse', 'REMESH')
        remesh.mode, remesh.voxel_size, remesh.adaptivity, remesh.use_smooth_shade = 'VOXEL', voxel, 0, True
        bpy.ops.object.modifier_apply(modifier=remesh.name)
        return obj


# --- The design -------------------------------------------------------------------

def blur(field, sigma):
    radius = int(3 * sigma)
    taps = np.exp(-.5 * (np.arange(-radius, radius + 1) / sigma) ** 2)
    taps /= taps.sum()
    for axis in (0, 1):
        padded = np.pad(field, [(radius, radius) if a == axis else (0, 0) for a in (0, 1)], mode='edge')
        field = sum(weight * np.take(padded, range(offset, offset + field.shape[axis]), axis=axis)
                    for offset, weight in enumerate(taps))
    return field


class Body:
    """One rock mass: the convex envelope of its shell, the outline of the hole in its
    crust, and the domed ore surface under that hole with the trough floor below it."""

    def __init__(self, rng, along, far, plan):
        self.along, self.far = along, far
        self.center = self.at(*plan['center'])
        wobble = lambda value, share=.07: value * rng.uniform(1 - share, 1 + share)
        # The ore surface: a paraboloid that leaves its crest almost level and steepens toward
        # the camera. Its top is dark graphite a long way off the glint direction; lower down
        # it passes within ten degrees of it and takes the sun as a satin sheen.
        u, v, level = plan['dome']
        self.heart, self.level = self.center + self.at(u, v), wobble(level, .05)
        self.slope = math.tan(math.radians(plan['dip'] + rng.uniform(-2, 2))) * far - .05 * along
        self.sag = plan['sag'][0] * np.outer(along, along) + wobble(plan['sag'][1]) * np.outer(far, far)
        self.depth = plan['depth']
        faces = []
        for azimuth, dip, reach in plan['sides']:
            out = self.toward(azimuth + rng.uniform(-6, 6))
            faces.append(through(lean(out, dip + rng.uniform(-4, 4)), (*(self.center + out * wobble(reach)), 0)))
        self.walls = len(faces)
        # The shell's top: the dome a crust higher, as flat faces, and a crown behind the crest.
        for u in plan['grid'][0]:
            for v in plan['grid'][1]:
                spot = self.center + self.at(u + rng.uniform(-.3, .3), v + rng.uniform(-.15, .15))
                faces.append(through(self.cap_normal(spot), (*spot, float(self.cap(spot)) + plan['crust'])))
        faces.append(through(unit(UP + self.flat(.05, .1)), (*self.heart, self.level + plan['crust'])))
        self.normals, self.offsets = np.array([normal for normal, _ in faces]), np.array([offset for _, offset in faces])
        # The hole in the crust, as half-planes around a point inside it.
        middle = self.center + self.at(*plan['patch'])
        self.edges = np.array([self.toward(azimuth + rng.uniform(-5, 5)) for azimuth, _ in plan['edges']])
        self.reaches = np.array([edge @ middle + wobble(reach) for edge, (_, reach) in zip(self.edges, plan['edges'])])
        self.middle, self.face = middle, self.cap_normal(middle)
        self.facets = None
        self.anchors = [self.center + self.at(u + rng.uniform(-.25, .25), v + rng.uniform(-.15, .15)) for u, v in plan['anchors']]

    def at(self, u, v):
        return u * self.along + v * self.far

    def flat(self, u, v):
        return np.array((*self.at(u, v), 0))

    def toward(self, azimuth):
        return self.at(math.cos(math.radians(azimuth)), math.sin(math.radians(azimuth)))

    def height(self, spots):
        """The unbroken shell's surface over (N, 2) ground points."""
        return np.clip(((self.offsets - spots @ self.normals[:, :2].T) / self.normals[:, 2]).min(-1), 0, None)

    def opened(self, spots):
        """How far inside the hole in the crust a ground point is; negative outside it."""
        return (self.reaches - spots @ self.edges.T).min(-1)

    def cap(self, spots):
        away = spots - self.heart
        return self.level + away @ self.slope - .5 * np.einsum('...i,ij,...j', away, self.sag, away)

    def cap_normal(self, spot):
        return unit((*(-self.slope + self.sag @ (np.asarray(spot) - self.heart)), 1))

    def facet(self, spots):
        """Which of the ore's large facets lies over each ground point: the lowest of their planes."""
        normals_, offsets = self.facets
        return ((offsets - spots @ normals_[:, :2].T) / normals_[:, 2]).argmin(-1)

    def floor(self, spots):
        """The trough the lens leaves: shallow at the rim of the hole, deepest in its middle."""
        return self.cap(spots) - self.depth[0] - (self.depth[1] - self.depth[0]) * smoothstep(self.opened(spots), 0, .9)

    def lensed(self, points):
        """How far inside the lens (N, 3) points are: under the ore surface, in the hole, inside the set-in shell."""
        spots = points[:, :2]
        inset = (self.offsets - SKIN - points @ self.normals.T).min(-1)
        return np.minimum.reduce([self.opened(spots), inset, self.cap(spots) - points[:, 2]])

    def pool(self, spots):
        """Sand that slid to the trough's low side. Under the envelope only, so it never shows outside the rock."""
        level = self.floor(spots) + .07 - .3 * (self.reaches[0] - spots @ self.edges[0]) * (1 + .5 * np.sin(spots @ self.along * 1.7))
        return np.where((self.opened(spots) > 0) & (self.height(spots) > level + .05), level, -9.)

    def blocks(self, soup, rng, sides, tight, middle):
        """One joint-bounded column of this mass: its crust outside the hole, its piece of the trough inside."""
        if not self.height(middle + np.array([(dx, dy) for dx in (-.7, 0, .7) for dy in (-.7, 0, .7)])).any():
            return
        # Each block has the envelope's faces a little tilted and set back, now and then broken well back,
        # and its top edges bevelled along the joints, so blocks read as blocks even where a joint is tight.
        shell = [(tilt(normal, rng, .06), offset - (rng.uniform(.06, .13) if rng.random() < .2 else rng.uniform(0, .06)))
                 for normal, offset in zip(self.normals, self.offsets)]
        # Its joint faces wander a little too, so no crack runs dead straight across the outcrop.
        sides = [(tilt(normal, rng, .07), offset - rng.uniform(0, .025)) for normal, offset in sides]
        solid = sides + shell + [(-UP, 1.2)]
        bevels = [(unit(normal * (1, 1, 0) + UP * rng.uniform(.8, 1.5)), rng.uniform(.02, .06)) for normal, _ in sides]
        back, within = rng.uniform(-.03, .14), []
        for edge, reach in zip(self.edges, self.reaches):
            # The crust beyond this edge of the hole. Its broken wall leans back from the ore.
            foot = middle + edge * (reach + back - edge @ middle)
            wall = lean(-edge, rng.uniform(40, 62))
            soup.add(convex(solid + within + [through(wall, (*foot, float(self.cap(foot))))]), bevels + chips(rng, rng.choice((1, 2, 2, 3)), (.04, .22)))
            within.append((np.array((*edge, 0)), reach))
        normal = tilt(self.cap_normal(middle), rng, .04)
        floor = through(normal, (*middle, float(self.floor(middle)) + rng.uniform(-.025, .025)))
        # The trough's blocks are fused, and stay inside where the lens was.
        under = [(normal, offset - SKIN - .1) for normal, offset in zip(self.normals, self.offsets)]
        soup.add(convex(tight + under + within + [floor, (-UP, 1.2)]), bevels + chips(rng, rng.choice((0, 1)), (.02, .08)))

    def lens(self, soup, rng, pieces):
        """The ore: large facets tangent to the cap, inside the shell's own faces set in a hand's
        breadth, with the edge between them broken by a steeper facet. `pieces` are the extra
        planes that bound each fragment between cracks, with how far it may stand up or down."""
        solid = [(-UP, 1.)]
        for anchor in self.anchors:
            solid.append(through(tilt(self.cap_normal(anchor), rng, .13), (*anchor, float(self.cap(anchor)))))
        self.facets = np.array([normal for normal, _ in solid[1:]]), np.array([offset for _, offset in solid[1:]])
        for index, (normal, offset) in enumerate(zip(self.normals, self.offsets)):
            normal, offset = tilt(normal, rng, .05), offset - rng.uniform(SKIN - .03, SKIN + .03)
            solid.append((normal, offset))
            if index >= self.walls:
                continue
            out = unit(normal[:2])
            low, high = 0., 8.
            for _ in range(30):
                spot = self.heart + out * (low + high) / 2
                low, high = ((low + high) / 2, high) if (offset - normal[:2] @ spot) / normal[2] > self.cap(spot) else (low, (low + high) / 2)
            knee = np.array((*(self.heart + out * low), float(self.cap(self.heart + out * low))))
            bevel = tilt(unit(normal + self.cap_normal(knee[:2])), rng, .08)
            solid.append((bevel, bevel @ knee - rng.uniform(.04, .1)))
        for piece, lift in pieces:
            nudge = rng.uniform(-.012, .012), rng.uniform(*lift)
            soup.add(convex(solid + piece), nudge=nudge)
            # Like slate, the ore parts in sheets: on most fragments a broken plate of the next
            # sheet up still lies, a step proud, with a ragged polygon for an outline.
            for _ in range(rng.choice((0, 1))):
                spots = self.middle + np.array([self.at(rng.uniform(-3, 3), rng.uniform(-1.6, 1.2)) for _ in range(40)])
                spots = [spot for spot in spots if self.opened(spot) > .2
                         and all(normal @ (*spot, float(self.cap(spot))) < offset - .15 for normal, offset in piece)]
                if not spots:
                    continue
                turn, lift = rng.uniform(0, 72), rng.uniform(.03, .05)
                outline = [through(np.array((*self.toward(turn + 72 * side + rng.uniform(-20, 20)), 0)),
                                   (*(spots[0] + self.toward(turn + 72 * side) * rng.uniform(.4, 1.2)), 0)) for side in range(5)]
                sheet = [(normal, offset + lift * (index > 0)) for index, (normal, offset) in enumerate(solid[:1 + len(self.anchors)])]
                soup.add(convex(sheet + solid[1 + len(self.anchors):] + piece + outline), nudge=nudge)


class Outcrop:
    """The whole deposit: a main mass and its shoulder, the joints that cut both, and the sand around them."""

    GRID_LOW, GRID_STEP, GRID = -5.95, .07, 171

    def __init__(self, rng, seed):
        self.rng, self.seed = rng, seed
        turn = math.radians(-27 + rng.uniform(-4, 4))
        along, far = np.array((math.cos(turn), math.sin(turn))), np.array((-math.sin(turn), math.cos(turn)))
        self.main, self.shoulder = Body(rng, along, far, MAIN), Body(rng, along, far, SHOULDER)
        self.bodies = (self.main, self.shoulder)
        # Two sets of steep joints. The first strikes along the diagonal crack, and one of its
        # planes, through the lens's heart, is that crack; the second crosses the outcrop.
        main = self.main
        u, v, azimuth = MAIN['crack']
        self.strike = main.toward(azimuth + rng.uniform(-3, 3))
        self.heart = main.center + main.at(u, v + rng.uniform(-.1, .1))
        self.joints = []
        for azimuth, base, gaps, reach in ((75, self.heart, (.75, 1.25), 4.6), (12, np.zeros(2), (.9, 1.5), 6.6)):
            across = np.array((-self.strike[1], self.strike[0])) if azimuth == 75 else main.toward(azimuth + rng.uniform(-6, 6))
            planes = []
            for mark in spaced(rng, -reach, reach, gaps):
                normal = unit((*(across + np.array((-across[1], across[0])) * rng.uniform(-.06, .06)), rng.uniform(-.1, .1)))
                # Some joints stand open as cracks; the rest are tight and their blocks fuse.
                planes.append((normal, float(normal[:2] @ (base + across * mark)), rng.choice((-.05, -.05, -.05, -.05, .04))))
            self.joints.append(planes)
        self.master = next(index for index, (normal, offset, _) in enumerate(self.joints[0]) if abs(offset - normal[:2] @ self.heart) < 1e-6)
        self.joints[0][self.master] = (*self.joints[0][self.master][:2], .06)
        # Cleavage: two families of parallel planes that cross the ore faces, the first along the crack.
        self.cleavage = []
        for turn_, gaps, slope in ((rng.uniform(-.2, .2), (.12, .5), .06), (rng.uniform(.9, 1.3), (.4, 1.2), .03)):
            across = np.array((-self.strike[1], self.strike[0]))
            across = across * math.cos(turn_) + self.strike * math.sin(turn_)
            axis = unit(np.array((*across, 0)) - main.face * (main.face[:2] @ across))
            marks = np.cumsum([rng.uniform(*gaps) * rng.choice((.6, 1, 1, 1.8)) for _ in range(260)]) - 14
            self.cleavage.append((axis, marks, slope))
        self.drift = self.drifted()

    def height(self, spots):
        return np.maximum(self.main.height(spots), self.shoulder.height(spots))

    def drifted(self):
        """Sand height on a grid: banked against the rock's foot, pooled in the troughs, and
        dropping below the ground at once past a drift's edge, so on a slope the rock's own
        foot shows instead of a smooth apron."""
        axis = self.GRID_LOW + np.arange(self.GRID) * self.GRID_STEP
        x, y = np.meshgrid(axis, axis, indexing='ij')
        spots = np.stack([x.ravel(), y.ravel()], 1)
        rock = (self.height(spots) > .25).astype(float).reshape(x.shape)
        lee = np.roll(rock, (int(self.rng.uniform(4, 9)), int(self.rng.uniform(-5, 5))), (0, 1))
        sand = np.maximum(.5 * (blur(rock, .5 / self.GRID_STEP) - .36), .2 * (blur(lee, .9 / self.GRID_STEP) - .42))
        sand += .03 * fbm(np.concatenate([spots * .9, np.zeros((len(spots), 1))], 1), self.seed + 40, 3).reshape(x.shape)
        sand -= .3 * smoothstep(np.hypot(x, y), 5.05, 5.5)
        sand = np.clip(np.where(sand < 0, sand * 12, sand), -1.3, None)
        return np.maximum(sand, np.maximum(self.main.pool(spots), self.shoulder.pool(spots)).reshape(x.shape))

    def sand(self, x, y):
        grid = self.drift
        fx = np.clip((np.asarray(x) - self.GRID_LOW) / self.GRID_STEP, 0, grid.shape[0] - 1.001)
        fy = np.clip((np.asarray(y) - self.GRID_LOW) / self.GRID_STEP, 0, grid.shape[1] - 1.001)
        ix, iy = fx.astype(int), fy.astype(int)
        tx, ty = fx - ix, fy - iy
        return (grid[ix, iy] * (1 - tx) * (1 - ty) + grid[ix + 1, iy] * tx * (1 - ty)
                + grid[ix, iy + 1] * (1 - tx) * ty + grid[ix + 1, iy + 1] * tx * ty)

    def chunk(self, center, size):
        """A loose block: bounded by the joints' directions, then tumbled."""
        rng = self.rng
        spin = Matrix.Rotation(rng.uniform(0, math.pi), 3, Vector(unit([rng.gauss(0, 1) for _ in range(3)])))
        sides = []
        for index, normal in enumerate((self.joints[0][0][0], self.joints[1][0][0], UP)):
            for side in (-1, 1):
                normal_ = np.array(spin @ Vector(tilt(normal * side, rng, .25)))
                sides.append((normal_, normal_ @ center + size * rng.uniform(.55, 1) * (.6 if index == 2 else 1)))
        return convex(sides)

    def rock(self):
        """The shell: every joint-bounded column of both masses, a few fallen blocks and chips, and the sand."""
        rng, soup = self.rng, Soup()
        first, second = self.joints
        for i in range(len(first) - 1):
            for j in range(len(second) - 1):
                sides, tight, mids = [], [], []
                for (normal, low, gap), (normal_, high, gap_) in ((first[i], first[i + 1]), (second[j], second[j + 1])):
                    sides += [(-normal, -low - gap / 2), (normal_, high - gap_ / 2)]
                    tight += [(-normal, -low + .025), (normal_, high + .025)]
                    mids.append(((normal + normal_)[:2] / 2, (low + high) / 2))
                middle = np.linalg.solve(np.array([mid[0] for mid in mids]), np.array([mid[1] for mid in mids]))
                for body in self.bodies:
                    body.blocks(soup, rng, sides, tight, middle)
        for size_range, count, spread in (((.2, .42), rng.randint(3, 5), .5), ((.05, .13), rng.randint(22, 32), .9)):
            for _ in range(count):
                out = np.array((math.cos(bearing := rng.uniform(0, math.tau)), math.sin(bearing)))
                edge = next((r for r in np.arange(5.3, 1, -.05) if self.height(out * r) > .3), 3.)
                spot = out * min(edge + rng.uniform(.1, spread), 5.1)
                size = rng.uniform(*size_range)
                soup.add(self.chunk(np.array((*spot, float(self.sand(*spot)) + size * .2)), size), chips(rng, 2, (size * .1, size * .5)))
        count = self.GRID
        axis = self.GRID_LOW + np.arange(count) * self.GRID_STEP
        x, y = np.meshgrid(axis, axis, indexing='ij')
        top = np.stack([x.ravel(), y.ravel(), self.drift.ravel()], 1)
        i, j = np.meshgrid(np.arange(count - 1), np.arange(count - 1), indexing='ij')
        a, b, c, d = (i * count + j).ravel(), ((i + 1) * count + j).ravel(), ((i + 1) * count + j + 1).ravel(), (i * count + j + 1).ravel()
        quads = [np.stack([a, b, c, d], 1), np.stack([d, c, b, a], 1) + len(top)]
        line = np.arange(count)
        for rim in (line * count, line * count + count - 1, line, line + (count - 1) * count):
            quads.append(np.stack([rim[:-1], rim[1:], rim[1:] + len(top), rim[:-1] + len(top)], 1))
        soup.add_arrays(np.concatenate([top, top * (1, 1, 0) + (0, 0, -1.6)]), np.concatenate(quads))
        return soup.fuse('rock / high-poly', .025)

    def crack(self, normal, offset, gap, level):
        """One wall of a crack `gap` wide where it crosses `level`: it flares open upward."""
        wall = unit(normal + UP * .1)
        out = unit(normal[:2])
        return wall, float(wall @ np.array((*(out * (offset - gap / 2 - normal[2] * level) / np.linalg.norm(normal[:2])), level)))

    def ore(self):
        """The lens under both masses, broken along the joints: the open diagonal crack and tight cross joints."""
        rng, soup, main = self.rng, Soup(), self.main
        normal, offset, _ = self.joints[0][self.master]
        level = float(main.cap(self.heart))
        gap = rng.uniform(.08, .1)
        near, far = self.crack(normal, offset, gap, level), self.crack(-normal, -offset, gap, level)
        across = np.array((-self.strike[1], self.strike[0])) * np.sign(normal[:2] @ np.array((-self.strike[1], self.strike[0])))
        cross = lambda u: min(self.joints[1], key=lambda joint: abs(joint[1] - joint[0][:2] @ (main.center + main.at(u, 0))))
        halves = lambda joint: ([self.crack(joint[0], joint[1], .03, level)], [self.crack(-joint[0], -joint[1], .03, level)])
        # The slab beyond the crack stands a little proud, so its broken edge faces the camera.
        left, right = halves(cross(rng.uniform(.2, 1.)))
        pieces = [([far], (.03, .07)), ([near] + left, (-.04, 0)), ([near] + right, (-.04, 0))]
        main.lens(soup, rng, pieces)
        body = self.shoulder
        normal = unit((*(across * math.cos(.5) + self.strike * math.sin(.5)), rng.uniform(-.1, .1)))
        offset = float(normal[:2] @ (body.heart + body.at(rng.uniform(-.2, .2), 0)))
        level = float(body.cap(body.heart))
        body.lens(soup, rng, [([self.crack(normal, offset, .06, level)], (-.03, .03)), ([self.crack(-normal, -offset, .06, level)], (-.03, .03))])
        return soup.fuse('ore / high-poly', .018)

    def hollow(self, points):
        """Where the rock was under the lens: 0 on the shell, 1 a hand's breadth inside the ore."""
        return np.maximum.reduce([smoothstep(body.lensed(points), .0, .09) for body in self.bodies])

    def wear(self, obj, strength=1.):
        """Soften the voxel steps and wear the exposed edges, most where the rock is weakest."""
        mesh, seed = obj.data, self.seed
        edge = edges(mesh)
        points = relax(coords(mesh), edge, 2)
        # Small stones lying on the sand would be turned inside out by relief bigger than they are.
        rock = smoothstep(points[:, 2] - self.sand(points[:, 0], points[:, 1]), .04, .3)
        normal = normals(mesh, points)
        weak = (.5 + .4 * fbm(points * .6, seed + 1)) * strength
        for repeat, share in ((10, .85), (40, .18)):
            points -= normal * (np.clip(bulging(points, normal, edge, repeat), 0, None) * weak * share * rock)[:, None]
        relief = fbm(points * .45, seed + 4) * .04 + fbm(points * 1.3, seed + 13) * .022
        normals(mesh, points + normal * (relief * rock * strength)[:, None])

    def roughen(self, obj):
        """The rock's fine relief: flat chips, coarse in some patches and fine in others, grain
        and pits; rougher still where the trough was broken out. Then the masks for its material."""
        mesh, seed = obj.data, self.seed
        points, normal, edge = coords(mesh), normals(mesh), edges(mesh)
        rock = smoothstep(points[:, 2] - self.sand(points[:, 0], points[:, 1]), .04, .3)
        hollow = self.hollow(points)
        rough = .25 + .75 * smoothstep(fbm(points * .5, seed + 9, 2), -.2, .4)
        relief = fbm(points * 2.4, seed + 5, 4) * .02
        relief += (scattered(points * 2.6, seed + 10)[1] / 2.6 * .45 + scattered(points * 7, seed + 11)[1] / 7 * .35) * rough
        pit = np.clip(.3 - scattered(points * 4.2, seed + 6)[0], 0, 1) / .3
        relief -= pit ** 2 * np.clip(fbm(points * .7, seed + 7, 2) * 2, 0, 1) * .035
        points = points + normal * (relief * rock)[:, None]
        normal = normals(mesh, points)
        bulge = bulging(points, normal, edge, 6)
        sand = smoothstep(self.sand(points[:, 0], points[:, 1]) + .03 - points[:, 2], 0, .035)
        dust = (smoothstep(normal[:, 2], .72, .95) * np.clip(.3 - bulge * 25 + .5 * fbm(points * .8, seed + 8), 0, 1)
                * np.clip(1.25 - points[:, 2] * .35, .25, 1)) * (1 + hollow)
        # The lowest hand's breadth of rock is dusted, so its foot fades into the ground.
        foot = smoothstep(points[:, 2], .16, .02) * smoothstep(points[:, 2], -.14, -.02) * .9
        paint(mesh, 'Masks', np.stack([np.maximum.reduce([sand, dust * .85, foot]), hollow, .5 + bulge * 30,
                                       .5 + .5 * fbm(points * .35, seed + 12, 2)], 1))

    def cleave(self, obj, rock):
        """The ore's relief and the masks for its material: cleavage strips, fracture flats, each
        facet's tone and polish, polished streaks, and the crust and sand that still cling.
        `rock` is the detailed shell's surface."""
        mesh, seed = obj.data, self.seed
        points, normal = coords(mesh), normals(mesh)
        # Crust clings where rock stands over the ore, not where the trough's floor lies close under it.
        contact = np.full(len(points), 9.)
        for index, (point, out) in enumerate(zip(points.tolist(), normal.tolist())):
            nearest, _, _, distance = rock.find_nearest(Vector(point))
            if (nearest - Vector(point)).dot(Vector(out)) > .2 * distance:
                contact[index] = distance
        patchy = fbm(points * 1.2, seed + 32, 3)
        fringe = .05 + .1 * np.clip(patchy + .4, 0, 1)
        crust = np.maximum(1 - smoothstep(contact, fringe * .5, fringe), smoothstep(patchy - contact, .26, .34) * (contact < .8))
        # Fine cleavage: strips that wander across the faces, each with its own slight tilt, so
        # the surface steps a little where two meet, over slow waves.
        height = np.zeros(len(points))
        for index, (axis, marks, slope) in enumerate(self.cleavage):
            along = points @ axis + fbm(points * .45, seed + 50 + index, 3) * .4
            strip = np.clip(np.searchsorted(marks, along), 1, len(marks) - 1).astype(np.int64)
            height += (hashed(strip, index, 7, seed + 60) - .5) * 2 * slope * (along - (marks[strip - 1] + marks[strip]) / 2)
        calm = smoothstep(fbm(points * .45, seed + 53, 2), -.5, .2)
        height = height * (.3 + .7 * calm) + fbm(points * 1.3, seed + 52, 3) * .01
        # Fracture flats: angular chips a hand or two across, longer along the cleavage, each
        # tilted a degree or three, so neighbours take the sun differently.
        cleft, across = np.cross(self.cleavage[0][0], self.main.face), self.cleavage[0][0]
        flats = np.stack([points @ cleft * 1.7, points @ across * 2.8, points @ self.main.face * 3], 1)
        flats += np.stack([fbm(points * .5, seed + 68, 2), fbm(points * .5, seed + 69, 2), np.zeros(len(points))], 1) * .9
        height += scattered(flats, seed + 55)[1] / 2.4 * .085
        # Each large facet has its own tone and polish, as the faces of one broken block do,
        # mottled at the scale of the chips. A broad face square to the glint direction would
        # clip to white, so the nearer a face is to it the duller it is.
        body = np.where(self.shoulder.height(points[:, :2]) > self.main.height(points[:, :2]), 1, 0)
        facet = np.where(body == 1, self.shoulder.facet(points[:, :2]) + 40, self.main.facet(points[:, :2])).astype(np.int64)
        square = smoothstep(normal @ GLINT, .982, .997)
        lustre = (.5 * fbm(points * .55, seed + 59, 2) + 1.3 * (hashed(facet, 5, 9, seed + 65) - .5)
                  + .45 * fbm(flats * 1.4, seed + 66, 2) - 1.2 * square)
        # Only thin streaks along the cleavage are polished enough to flash.
        grain = np.stack([points @ across * 14, points @ cleft * 1.8, points @ self.main.face * 3], 1)
        streak = smoothstep(value_noise(grain + fbm(points * .7, seed + 63, 2)[:, None] * 2, seed + 62), .3, .5) * smoothstep(lustre, -.6, 0)
        points = points + normal * (height * (1 - crust) + crust * (.012 + .006 * fbm(points * 9, seed + 56, 2)))[:, None]
        normal = normals(mesh, points)
        bulge = bulging(points, normal, edges(mesh), 5)
        sandy = np.maximum(np.clip(-bulge / .012 - .6, 0, 1) * smoothstep(fbm(points * 1.5, seed + 57, 2), -.25, .25),
                           smoothstep(self.sand(points[:, 0], points[:, 1]) + .05 - points[:, 2], 0, .05))
        # Faces the sun never reaches would go black; they get a paler base color instead.
        lit = np.clip(normal @ SUN, 0, 1)
        tone = .45 + .2 * fbm(points * .8, seed + 58, 3) + .14 * fbm(flats * 1.4, seed + 67, 2) + .2 * lustre + .3 * (1 - smoothstep(lit, .05, .5)) - .2 * np.clip(-bulge / .01, 0, 1)
        # Worn convex edges are polished too, in broken runs.
        worn = np.clip(bulge / .006, 0, 1) * smoothstep(fbm(points * 2.2, seed + 64, 2), .05, .3)
        polish = np.maximum(streak, worn * (1 - .6 * square))
        paint(mesh, 'Masks', np.stack([tone, crust, polish, worn], 1))
        paint(mesh, 'Dust', np.stack([sandy, .5 + .5 * lustre, sandy, sandy], 1))


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

    def noise(self, scale, detail=3.):
        node = self.nodes.new('ShaderNodeTexNoise')
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = detail
        node.inputs['Roughness'].default_value = .62
        self.links.new(self.position, node.inputs['Vector'])
        return node.outputs['Fac']

    def jitter(self, value, scale, amount):
        """Offset a mask by centered noise, so thresholds wander naturally."""
        return self.add(value, self.times(self.math('SUBTRACT', self.noise(scale, 4), .5), amount))

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

    def masks(self, name='Masks'):
        node = self.nodes.new('ShaderNodeAttribute')
        node.attribute_name = name
        channels = self.nodes.new('ShaderNodeSeparateColor')
        self.links.new(node.outputs['Color'], channels.inputs['Color'])
        return channels.outputs['Red'], channels.outputs['Green'], channels.outputs['Blue'], node.outputs['Alpha']

    def sandstone(self):
        """The terrain's own cliff and scree photographs in patches, lifted to a sunlit
        sandstone a little paler and less red than the sand."""
        host = self.mix(self.remap(self.noise(.45, 3), .42, .62), self.image(CLIFF_COLOR, 5), self.image(SCREE_COLOR, 3.5))
        # Deepen the photographs' own cracks and stains before the lift.
        host = self.mix(.25, host, self.mix(1, host, self.times(self.luma(host), 9.5), 'MULTIPLY'))
        return self.mix(1, self.mix(.1, host, self.luma(host)), (1.65, 1.6, 1.55), 'MULTIPLY')

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
    graph = Graph('Split lens / sandstone and sand')
    sand, hollow, wear, patch = graph.masks()
    # Worn edges are paler than hollows, and the tone drifts from block to block.
    stone = graph.mix(1, graph.sandstone(), graph.times(graph.add(.66, graph.times(wear, .68)), graph.add(.84, graph.times(patch, .32))), 'MULTIPLY')
    # Where the ore was cut out the stone is freshly broken and dust-coated: greyer, a shade darker, dead matte.
    broken = graph.mix(1, graph.mix(.4, stone, graph.luma(stone)), (.6, .57, .55), 'MULTIPLY')
    stone = graph.mix(graph.remap(graph.jitter(hollow, 5, .3), .3, .7), stone, broken)
    drift = graph.remap(graph.jitter(sand, 3.5, .4), .38, .62)
    relief = graph.add(graph.times(graph.invert(drift), graph.luma(graph.image(CLIFF_GRAIN, 2.4)), .03),
                       graph.times(drift, graph.luma(graph.image(GROUND_COLOR, 30)), .01))
    return graph.finish(graph.mix(drift, stone, graph.sand()), .92, 0., relief)


def ore_material():
    graph = Graph('Split lens / titanium ore')
    tone, crust, polish, edge = graph.masks()
    grain = graph.noise(38, 3)
    value = graph.add(tone, graph.times(graph.math('SUBTRACT', grain, .5), .14), graph.times(graph.math('SUBTRACT', graph.noise(1.6, 3), .5), .18))
    metal = graph.ramp(value, [(0, SHADOW), (.5, MID), (1, LIGHT)])
    # Cleavage edges are worn bright.
    metal = graph.mix(graph.times(edge, graph.add(.3, grain), .3), metal, LIGHT)
    stuck = graph.remap(graph.jitter(crust, 16, .7), .45, .6)
    dusty = graph.remap(graph.jitter(graph.masks('Dust')[0], 14, .4), .4, .7)
    color = graph.mix(dusty, graph.mix(stuck, metal, graph.sandstone()), graph.sand())
    bare = graph.invert(graph.math('MAXIMUM', stuck, dusty))
    lustre = graph.masks('Dust')[1]
    roughness = graph.add(graph.mix(graph.remap(polish, .3, .7), graph.add(.52, graph.times(lustre, -.2)), .27),
                          graph.times(graph.math('SUBTRACT', grain, .5), .08), graph.times(graph.invert(bare), .5))
    relief = graph.add(graph.times(bare, grain, .0015), graph.times(graph.invert(bare), graph.luma(graph.image(CLIFF_GRAIN, 2.4)), .02))
    return graph.finish(color, roughness, graph.times(bare, METALNESS), relief)


# --- Runtime mesh and bake -------------------------------------------------------

def runtime(source, triangles, state):
    """The low-poly: the worn source decimated to the budget."""
    obj = duplicate(source, source.name.replace('high-poly', 'runtime'))
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
    # Charts: patches grown from the largest faces outward. They wrap around a convex body up
    # to a quarter turn from the patch's mean direction, and stop at concave creases.
    chart, state = bm.faces.layers.int.new('chart'), bm.faces.layers.int['state']
    charted, count = set(), 0
    for seed in sorted(bm.faces, key=lambda face: -face.calc_area()):
        if seed in charted:
            continue
        count += 1
        charted.add(seed)
        seed[chart] = count
        mean, queue = seed.normal * seed.calc_area(), deque([seed])
        while queue:
            for edge in queue.popleft().edges:
                if len(edge.link_faces) != 2 or edge.calc_face_angle_signed() < -math.radians(55):
                    continue
                for other in edge.link_faces:
                    if other not in charted and other[state] == seed[state] and other.normal.dot(mean.normalized()) > math.cos(math.radians(62)):
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
    # The camera never moves: charts it cannot see, or that lie under the ground, get a third
    # of the texels; the ore gets half as many again as the rock, the dull trough fewer.
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
        scale = (.35 + .65 * shown) * {ROCK: 1, ORE: 1.5, HOLLOW: .7}[faces[0][state]]
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
    """Bake the high-poly sources onto the joined low-poly. `sources` lists, per source, the
    states whose faces it fills and what else may shade it: those faces take color, normal,
    occlusion and surface values only from their own source, found by rays cast inward from
    a cage just outside the low-poly."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    settings = dict(use_selected_to_active=True, cage_extrusion=.06, max_ray_distance=.2, margin=0, use_clear=True,
                    uv_layer='RuntimeUV', normal_space='TANGENT')
    # The first pass marks the texels whose ray found the source; the rest take their neighbours' values.
    passes = dict(found=('EMIT', 1, 'white'), color=('EMIT', 4, 'color'), normal=('NORMAL', 8, 'shaded'),
                  occlusion=('AO', 48, 'shaded'), surface=('EMIT', 4, 'surface'))
    layers = {key: np.zeros((ATLAS, ATLAS, 4), np.float32) for key in passes}
    covered = np.zeros((ATLAS, ATLAS), bool)
    states = np.empty(len(low.data.polygons), np.int64)
    low.data.attributes['state'].data.foreach_get('value', states)
    highs = [high for high, _, _ in sources]
    for high, filled, company in sources:
        target = duplicate(low, f'bake target {high.name}')
        target.hide_render = False
        vertex, face = corners(target.data)
        doomed = np.ones(len(target.data.vertices), bool)
        doomed[vertex[np.isin(states, filled)[face]]] = False
        keep_faces(target, doomed)
        material = bpy.data.materials.new(target.name)
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
            image = bpy.data.images.new(f'{key} {high.name}', ATLAS, ATLAS, alpha=True, float_buffer=True)
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
                log(f'{high.name}: {hit.mean():.1%} of the atlas')
            layers[key][hit] = pixels[hit]
            bpy.data.images.remove(image)
        bpy.data.objects.remove(target)
    show('shaded')
    for high in highs:
        high.hide_render = False
    low.hide_render = False
    # The game lights with one sun and no baked contact shadows, so crevice depth goes into the color.
    layers['color'][..., :3] *= (.5 + .5 * np.clip(layers['occlusion'][..., 0], 0, 1))[..., None]
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
                              export_yup=True, export_image_format='WEBP', export_image_quality=78,
                              export_vertex_color='NONE')
    return obj


def mining_contact(obj):
    """Where a Scout's tool lands from 72 bearings, by the game's own rule: a ray from 1 m up
    just outside the footprint toward the center at three heights. Returns the share of
    bearings that meet the model at all, and the share that meet ore first."""
    tree = tree_of(obj.data)
    states = [item.value for item in obj.data.attributes['state'].data]
    met = ore = 0
    for step in range(72):
        bearing = math.tau * step / 72
        origin = Vector((math.cos(bearing) * (FOOTPRINT_RADIUS + .7), math.sin(bearing) * (FOOTPRINT_RADIUS + .7), 1))
        for height in (.65, .35, 1.1):
            hit, _, index, _ = tree.ray_cast(origin, (Vector((0, 0, height)) - origin).normalized())
            if hit:
                met += 1
                ore += states[index] == ORE
                break
    return dict(met_bearings=met / 72, ore_bearings=ore / 72)


def describe(obj, path):
    obj.data.calc_loop_triangles()
    points = coords(obj.data)
    return dict(path=str(path.relative_to(OUT)), bytes=path.stat().st_size,
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(), triangles=len(obj.data.loop_triangles),
                radius=float(np.hypot(points[:, 0], points[:, 1]).max()), height=float(points[:, 2].max()),
                **mining_contact(obj))


def draft(path, hidden=()):
    """A quick look from the game's camera, with its sun."""
    scene = bpy.context.scene
    if not scene.camera:
        turn = Matrix.Rotation(STAGE_TURN, 3, 'Z')
        camera = bpy.data.objects.new('Game camera', bpy.data.cameras.new('Game camera'))
        camera.data.type, camera.data.ortho_scale = 'ORTHO', 14
        toward = turn @ Vector(VIEW)
        camera.location = toward * 40 + Vector((0, 0, .8))
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
        scene.render.resolution_x, scene.render.resolution_y = 1400, 900
        scene.view_settings.view_transform = 'Standard'
    for obj in hidden:
        obj.hide_render = True
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def author(seed, suffix):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    SHOWS.clear()
    rng = random.Random(seed)
    output = OUT / f'seed-{seed}'
    output.mkdir(parents=True, exist_ok=True)
    outcrop = Outcrop(rng, seed)
    rock = outcrop.rock()
    outcrop.wear(rock)
    ore = outcrop.ore()
    outcrop.wear(ore, .45)
    log(f'fused and worn: rock {len(rock.data.polygons)} faces, ore {len(ore.data.polygons)}')
    # Both are still closed surfaces here. Drop the ore that runs into the rock or lies well
    # under the crust, and the rock under the ground, and find the rock that the lens buries.
    rock_tree, ore_tree = tree_of(rock.data), tree_of(ore.data)
    points = coords(ore.data)
    covered = np.maximum(outcrop.main.opened(points[:, :2]), outcrop.shoulder.opened(points[:, :2])) < -.45
    keep_faces(ore, buried(rock_tree, points, .05) | covered | (points[:, 2] < -.3), smallest=40)
    keep_faces(rock, coords(rock.data)[:, 2] < -.85)
    lows = [runtime(rock, 5200, ROCK), runtime(ore, 3000, ORE)]
    faces = lows[1].data.polygons
    area, off = np.array([face.area for face in faces]), np.degrees(np.arccos(np.clip(np.array([face.normal for face in faces]) @ GLINT, -1, 1)))
    shown = area * (np.array([face.normal for face in faces]) @ VIEW > .2)
    log('ore area by angle off the glint direction: ' + ', '.join(
        f'{low}-{high} deg {shown[(off >= low) & (off < high)].sum() / shown.sum():.0%}' for low, high in ((0, 5), (5, 10), (10, 15), (15, 25), (25, 180))))
    under = buried(ore_tree, coords(lows[0].data), .06)
    vertex, face = corners(lows[0].data)
    lows[0].data.attributes['state'].data.foreach_set('value', np.where(under[vertex].reshape(-1, 3).all(1), HOLLOW, ROCK).tolist())
    outcrop.roughen(rock)
    outcrop.cleave(ore, tree_of(rock.data))
    rock.data.materials.append(rock_material())
    ore.data.materials.append(ore_material())
    log('sources detailed and painted')
    if args.draft:
        for low in lows:
            low.hide_render = True
        draft(output / 'draft.png')
        draft(output / 'draft-depleted.png', [ore])
        return []
    low = unwrap(lows)
    log(f'runtime mesh: {len(low.data.polygons)} triangles')
    bake(low, [(rock, (ROCK, HOLLOW), []), (ore, (ORE,), [rock])], output, f'Titanium split lens {seed}')
    low.data.transform(Matrix.Rotation(STAGE_TURN, 4, 'Z'))
    low.rotation_euler.z = 0
    points = coords(low.data)
    low.data.transform(Matrix.Scale(FOOTPRINT_RADIUS / float(np.hypot(points[:, 0], points[:, 1]).max()), 4))
    entries = []
    for name, states in (('full', (ROCK, ORE)), ('depleted', (ROCK, HOLLOW))):
        path = OUT / f'{name}{suffix}.glb'
        entries.append(dict(seed=seed, state=name, **describe(split(low, states, path), path)))
        print('LENS_EXPORT', json.dumps(entries[-1]), flush=True)
    return entries


exports = [entry for index, seed in enumerate(args.seed)
           for entry in author(seed, '-' + chr(ord('a') + index) if index else '')]
if exports:
    (OUT / 'export.json').write_text(json.dumps(dict(
        generator='tools/assets/build_titanium_split_lens.py',
        format='1 mesh, 1 standard PBR material, 1024px WebP color/normal/roughness-metallic per seed, shared by both states',
        coordinates='Y-up, centered X/Z, ground pivot Y=0', assets=exports), indent=2) + '\n')
log('done')
