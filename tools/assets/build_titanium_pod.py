"""Author the "Pod" Titanium Deposit: a broken collar of bedded sandstone around a mass of raw metal.

blender --background --threads 6 --python-exit-code 1 --python tools/assets/build_titanium_pod.py -- [--seed 1 2] [--out <dir>] [--draft]

Underground the titanium is one massive lens-shaped pod lying along the sandstone's
bedding, which fed thin sheets of the same metal into the joints around it. Erosion
has stripped the sandstone off its top and its camera side, so the pod stands out of
a broken collar of bedrock; mining cuts the pod and its veins out, which leaves a
benched pit with dark cut walls and empty slits inside the same collar.

Each `--seed` composes a different outcrop of that design. The first seed exports
`full.glb` and `depleted.glb`, the next `full-b.glb` and `depleted-b.glb`, and so on.
Both states of a seed are face subsets of one baked mesh and share its 1024 px atlas.
`--draft` builds at half resolution, skips the bake and renders `seed-<n>/preview.png`
from the game's camera. Nothing is written to assets/models; review candidates with
`bun tools/verify/capture-ore.mjs --model <glb> --out <dir>`.

How it is built. Rock and ore are signed distance fields on a 3 cm grid (numpy),
meshed with OpenVDB into a high-poly source of about 1.4 million triangles. The
bedrock starts as a horseshoe of rounded masses and is broken along three shared
directions, bedding and two joint sets: hundreds of joint-bounded blocks are plucked
off its surface, which turns slopes into ledges. It is then weathered in the field:
worn edges, recessed beds, cracks along the joints, pits, sand banked against the
foot. The ore is a mass of lumps cut back by large spheres and covered in conchoidal
flake scars, so its faces are slightly hollow like knapped flint and meet in sharp
ridges, with hackly patches on the crest. The runtime mesh is the same fields at half
resolution, decimated; color, normal, occlusion and roughness-metallic are baked from
the high-poly onto it through a cage, each state's source on its own.

The game never turns the model, the camera or the sun, so the half-vector between sun
and camera is one fixed direction (GLINT). A glassy scar whose hollow face passes
through it shows a small graded sun glint with no environment map, and faces turned
that way are baked a little brighter, as if they reflected the sky.
"""
import argparse
import hashlib
import heapq
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
import openvdb

ROOT = Path(__file__).resolve().parents[2]
CLIFF_COLOR = 'assets/textures/terrain/oxide-cliff-color.webp'
SCREE_COLOR = 'assets/textures/terrain/oxide-scree-color.webp'
CLIFF_GRAIN = 'assets/source/polyhaven/titanium/cliff_side_diff_2k.jpg'
GROUND_COLOR = 'assets/textures/terrain/sand-scan.webp'
# The main game multiplies its 30 m sand tile by hsl(29, 94%, 75%); linear RGB here.
GROUND_TINT = (.966, .51, .228)
FOOTPRINT_RADIUS = 5.35
# Blender-space directions from the scene toward the game's sun and camera.
SUN = np.array((-.518, -.327, .791)) / np.linalg.norm((-.518, -.327, .791))
VIEW = np.array((.528, -.528, .666)) / np.linalg.norm((.528, -.528, .666))
GLINT = (SUN + VIEW) / np.linalg.norm(SUN + VIEW)
# Plan directions: toward the camera, and toward screen right.
FRONT, SIDE = np.array((.7071, -.7071)), np.array((.7071, .7071))
FRONT_BEARING = -math.pi / 4
# Titanium as it should show in game, in linear RGB: graphite, steel, bright steel, worn edge.
GRAPHITE, STEEL, BRIGHT, EDGE = (.04, .052, .08), (.1, .135, .19), (.24, .3, .38), (.5, .58, .66)
# Tried in game in round 1: at .3 the metal reads as painted stone, at .6 shaded sides go near black.
METALNESS = .45
BOTH, FULL, DEPLETED = 0, 1, 2
GRID_LO, GRID_HI = (-5.7, -5.7, -.9), (5.7, 5.7, 3.8)
# Fields are trusted as distances only this close to a surface.
BAND = .24
TRIANGLES = dict(host=5600, ore=3800)

parser = argparse.ArgumentParser()
parser.add_argument('--seed', type=int, nargs='+', default=[1, 2], help='one composition per seed')
parser.add_argument('--draft', action='store_true', help='half resolution, no bake, a preview render')
parser.add_argument('--out', type=Path, default=ROOT / 'art/workbench/titanium-pod')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = args.out.resolve()
VOXEL = .06 if args.draft else .03
STARTED = time.time()


def log(message):
    print(f'POD {time.time() - STARTED:6.1f}s {message}', flush=True)


# --- Field helpers -----------------------------------------------------------

def smooth_min(a, b, k):
    h = np.maximum(k - np.abs(a - b), 0) / k
    return np.minimum(a, b) - h * h * (k / 4)


def ease(value, low, high):
    t = np.clip((value - low) / (high - low), 0, 1)
    return t * t * (3 - 2 * t)


def unit(vector):
    return np.asarray(vector, float) / np.linalg.norm(vector)


def tilt(direction, degrees, rng):
    """`direction` turned by up to about `degrees` in a random direction."""
    return unit(direction + np.array([rng.gauss(0, 1) for _ in range(3)]) * math.tan(math.radians(degrees)) * .6)


def along(direction, coords):
    return sum(float(component) * axis for component, axis in zip(direction, coords))


def wrap(angle):
    return (angle + np.pi) % (2 * np.pi) - np.pi


class Grid:
    """A regular grid of samples over the deposit; fields are float32 arrays of its shape."""

    def __init__(self, voxel, seed):
        self.voxel = voxel
        self.shape = tuple(int(round((high - low) / voxel)) + 1 for low, high in zip(GRID_LO, GRID_HI))
        axes = [(low + voxel * np.arange(count)).astype(np.float32) for low, count in zip(GRID_LO, self.shape)]
        self.x, self.y, self.z = axes[0][:, None, None], axes[1][None, :, None], axes[2][None, None, :]
        self.random = np.random.default_rng(seed)

    def full(self, value):
        return np.full(self.shape, value, np.float32)

    def box(self, low, high):
        """Index slices and broadcastable coordinates of the samples inside a world-space box."""
        s = tuple(slice(max(0, int((l - origin) / self.voxel)), max(0, min(count, int((h - origin) / self.voxel) + 2)))
                  for l, h, origin, count in zip(low, high, GRID_LO, self.shape))
        return s, (self.x[s[0]], self.y[:, s[1]], self.z[:, :, s[2]])

    def noise(self, *sizes):
        """Smooth noise with unit variance and features about `sizes` metres across (one size, or one
        per axis; two sizes give a plan field): white noise on a coarse lattice, upsampled with cubic B-splines."""
        shape = self.shape[:len(sizes)] if len(sizes) > 1 else self.shape
        sizes = sizes if len(sizes) > 1 else sizes * 3
        field = self.random.standard_normal([int(count * self.voxel / size) + 5 for count, size in zip(shape, sizes)],
                                            dtype=np.float32)
        for axis, (count, size) in enumerate(zip(shape, sizes)):
            position = np.arange(count) * (self.voxel / size) + self.random.uniform()
            index = np.floor(position).astype(int)
            f = (position - index).astype(np.float32)
            weights = ((1 - f) ** 3 / 6, (3 * f ** 3 - 6 * f ** 2 + 4) / 6, (-3 * f ** 3 + 3 * f ** 2 + 3 * f + 1) / 6, f ** 3 / 6)
            view = [count if a == axis else 1 for a in range(len(shape))]
            field = sum(np.take(field, index + tap, axis=axis) * weight.reshape(view) for tap, weight in enumerate(weights))
        return field / field.std()

    def blur(self, field, radius):
        """Two box blurs of `radius` samples: close to a Gaussian."""
        width, axes = 2 * radius + 1, range(field.ndim)
        for _ in range(2):
            for axis in axes:
                pad = [(radius + 1, radius) if a == axis else (0, 0) for a in axes]
                total = np.cumsum(np.pad(field, pad, mode='edge'), axis=axis, dtype=np.float32)
                upper = tuple(slice(width, None) if a == axis else slice(None) for a in axes)
                lower = tuple(slice(None, -width) if a == axis else slice(None) for a in axes)
                field = (total[upper] - total[lower]) / width
        return field

    def sample(self, field, points):
        """Trilinear samples of a field at world-space points."""
        position = (np.asarray(points, np.float32) - np.array(GRID_LO, np.float32)) / self.voxel
        index = np.clip(np.floor(position).astype(int), 0, np.array(field.shape) - 2)
        f = np.clip(position - index, 0, 1)
        i, j, k = index.T
        result = 0
        for di, wi in ((0, 1 - f[:, 0]), (1, f[:, 0])):
            for dj, wj in ((0, 1 - f[:, 1]), (1, f[:, 1])):
                for dk, wk in ((0, 1 - f[:, 2]), (1, f[:, 2])):
                    result = result + field[i + di, j + dj, k + dk] * wi * wj * wk
        return result

    def normals(self, field, points):
        h = self.voxel
        gradient = np.stack([self.sample(field, points + offset) - self.sample(field, points - offset)
                             for offset in np.eye(3, dtype=np.float32) * h], axis=1)
        return gradient / np.maximum(np.linalg.norm(gradient, axis=1, keepdims=True), 1e-6)

    def mesh(self, field, step=1):
        """The field's zero surface as points and quads, facing outward."""
        volume = openvdb.FloatGrid(BAND)
        volume.copyFromArray(np.ascontiguousarray(np.clip(field[::step, ::step, ::step], -BAND, BAND)))
        points, quads = volume.convertToQuads(0.)
        points = points * (self.voxel * step) + np.array(GRID_LO, np.float32)
        a, b, c = (points[quads[:, corner]].astype(np.float64) for corner in range(3))
        if np.einsum('ij,ij->i', a, np.cross(b, c)).sum() < 0:
            quads = quads[:, ::-1]
        return points, np.ascontiguousarray(quads)

    def scatter(self, field, spacing, rng, keep=lambda points: points[:, 2] > -.05):
        """Points on the field's surface at least `spacing` apart, with their outward normals."""
        points, _ = self.mesh(field, step=max(1, int(round(.12 / self.voxel))))
        points = points[keep(points)]
        alive = np.ones(len(points), bool)
        chosen = []
        while alive.any():
            pick = rng.choice(np.flatnonzero(alive))
            chosen.append(pick)
            alive &= np.linalg.norm(points - points[pick], axis=1) > spacing * rng.uniform(.8, 1.3)
        return points[chosen].astype(float), self.normals(field, points[chosen]).astype(float)


# --- Ore ---------------------------------------------------------------------

def add_lobe(grid, field, center, radii, yaw, lean=0., toward=0., blend=.4):
    """Blend an ellipsoid into a field."""
    rotation = np.array(Matrix.Rotation(toward, 3, 'Z') @ Matrix.Rotation(lean, 3, 'Y') @ Matrix.Rotation(yaw, 3, 'Z'))
    center = np.asarray(center, float)
    reach = max(radii) + blend + BAND
    s, coords = grid.box(center - reach, center + reach)
    offset = [axis - c for axis, c in zip(coords, center)]
    local = [along(rotation[:, column], offset) for column in range(3)]
    k0 = np.sqrt(sum((l / r) ** 2 for l, r in zip(local, radii)))
    k1 = np.sqrt(sum((l / r ** 2) ** 2 for l, r in zip(local, radii)))
    field[s] = smooth_min(field[s], k0 * (k0 - 1) / np.maximum(k1, 1e-6), blend)


def plan(ahead, across):
    """A plan position from metres toward the camera and metres toward screen right."""
    return FRONT * ahead + SIDE * across


def polar(degrees, distance):
    """A plan position from a bearing, counted from the camera's side, and a distance."""
    bearing = FRONT_BEARING + math.radians(degrees)
    return np.array((math.cos(bearing), math.sin(bearing))) * distance


class Ore:
    """The ore's field and, per sample, the tone and polish of the fracture face that owns it.
    `pockets` is the field of the lumps that sit in the rock's alcoves."""

    def __init__(self, grid, rng):
        self.grid, self.rng = grid, rng
        self.field, self.tone, self.polish = grid.full(9.), grid.full(.3), grid.full(0.)
        self.pockets = grid.full(9.)

    def face(self):
        """A fresh fracture face's tone, and its polish: nearly half break glassy, some more than others, the rest dull."""
        return self.rng.uniform(0, 1), (self.rng.uniform(.65, 1.1) if self.rng.random() < .45 else self.rng.uniform(0, .35))

    def chunk(self, center, radii, yaw, lean, toward, least=.55, pocket=False):
        """One broken lump of the mass: an ellipsoid cut back by large spheres from random
        sides and to very different depths, so its faces are nearly flat, slightly hollow,
        uneven in size, and meet in hard ridges. `least` is the smallest share of its reach a
        break may leave."""
        grid, rng = self.grid, self.rng
        rotation = np.array(Matrix.Rotation(toward, 3, 'Z') @ Matrix.Rotation(lean, 3, 'Y') @ Matrix.Rotation(yaw, 3, 'Z'))
        center = np.asarray(center, float)
        reach = max(radii) + .3
        s, coords = grid.box(center - reach, center + reach)
        offset = [axis - c for axis, c in zip(coords, center)]
        local = [along(rotation[:, column], offset) for column in range(3)]
        k0 = np.sqrt(sum((l / r) ** 2 for l, r in zip(local, radii)))
        k1 = np.sqrt(sum((l / r ** 2) ** 2 for l, r in zip(local, radii)))
        solid = (k0 * (k0 - 1) / np.maximum(k1, 1e-6)).astype(np.float32)
        tone, polish = np.full(solid.shape, .3, np.float32), np.zeros(solid.shape, np.float32)
        for _ in range(rng.randint(9, 13)):
            normal = unit((rng.gauss(0, 1), rng.gauss(0, 1), rng.uniform(-.3, 1.2)))
            support = math.sqrt(sum((radius * float(rotation[:, column] @ normal)) ** 2 for column, radius in enumerate(radii)))
            curve = max(radii) * rng.uniform(2., 8.)
            middle = center + normal * (support * rng.uniform(least, .95) + curve)
            bite = curve - np.sqrt(sum((axis - c) ** 2 for axis, c in zip(coords, middle)))
            own = bite > solid
            solid = np.maximum(solid, bite)
            tone[own], polish[own] = self.face()
        if pocket:
            self.pockets[s] = np.minimum(self.pockets[s], solid)
        nearer = solid < self.field[s]
        self.tone[s][nearer], self.polish[s][nearer] = tone[nearer], polish[nearer]
        self.field[s] = smooth_min(self.field[s], solid, .18)

    def scoop(self, before, point, normal, chord, depth):
        """A conchoidal flake scar `chord` metres in half-width: a shallow bite of a large
        sphere, rippled around the point of impact on its rim. `before` is the field when
        this generation of scars began."""
        grid, rng = self.grid, self.rng
        radius = (chord * chord + depth * depth) / (2 * depth)
        center = point + normal * (radius - depth)
        s, coords = grid.box(point - 2.2 * chord - .1, point + 2.2 * chord + .1)
        side = unit(np.cross(normal, tilt(normal, 60, rng)))
        distance = lambda at: np.sqrt(sum((axis - c) ** 2 for axis, c in zip(coords, at)))
        ripple = np.sin(distance(point + side * chord) * (math.tau / rng.uniform(.08, .14))) * rng.choice((0, rng.uniform(.001, .004)))
        # Positive inside the bite. A ball around the point keeps it local, and a generation of
        # scars takes only a shell off the surface it started from, so hollows never deepen
        # into sockets and overlapping scars cannot eat the mass away.
        bite = np.minimum(np.minimum(radius - distance(center) + ripple, 2.2 * chord - distance(point)), before[s] + 1.6 * depth)
        own = bite > self.field[s]
        self.field[s] = np.maximum(self.field[s], bite)
        self.tone[s][own], self.polish[s][own] = self.face()


def pod(grid, rng, alcoves):
    """The ore body as far as it shows: a massif of angular blocks with its peaks just
    behind the middle, buttresses that drop to the sand toward the camera with toes at
    their feet, and a block behind each alcove in the rock. Flake scars cover the blocks'
    faces, and hackly patches roughen the crest and parts of the flanks."""
    ore, u = Ore(grid, rng), rng.uniform
    # Metres toward the camera, toward screen right, the top's height, the two plan radii, how much of the height is above its middle.
    blocks = [(u(-.3, .1), u(-.6, -.1), u(3.7, 3.9), u(1.35, 1.5), u(1.1, 1.25), .55),
              (u(0, .4), u(.7, 1.1), u(2.9, 3.2), u(1.2, 1.4), u(1.05, 1.2), .55),
              (u(.6, 1.), u(-1.4, -1.1), u(2.4, 2.7), u(1.1, 1.3), u(1., 1.1), .6),
              (u(1.2, 1.6), u(-.2, .4), u(2.5, 2.8), u(1.3, 1.5), u(1.2, 1.3), .7),
              (u(2.8, 3.1), u(-1.4, -1.), u(1.9, 2.2), u(1.25, 1.4), u(1.15, 1.3), .9),
              (u(3., 3.3), u(.2, .7), u(1.6, 1.9), u(1.25, 1.4), u(1.15, 1.3), .9),
              (u(2.2, 2.5), u(1.7, 2.), u(1.7, 2.), u(1.2, 1.35), u(1.1, 1.25), .9),
              (u(2.2, 2.5), u(-2.5, -2.2), u(1.5, 1.8), u(1.2, 1.35), u(1.1, 1.25), .9),
              (u(3.9, 4.1), u(-.6, 0), u(.65, .9), u(.8, 1.), u(.6, .8), .8),
              (u(3.5, 3.8), u(1.3, 1.7), u(.55, .75), u(.8, 1.), u(.6, .8), .8)]
    for ahead, across, top, long, short, above in blocks:
        # The row nearest the camera keeps its reach, so a Scout's tool lands on ore there.
        ore.chunk((*plan(ahead, across), top * (1 - above)), (long + .1, short + .1, top * above + .15), u(0, math.pi), u(0, .25), u(0, math.tau),
                  .68 if above == .9 else .55)
        # A smaller lump grown into its side keeps the block from reading as one convex stone.
        size, lower = u(.55, .75), top * u(.65, .85)
        ore.chunk((*plan(ahead + u(-.6, .6), across + u(-.6, .6)), lower * (1 - above)), (long * size, short * size, lower * above),
                  u(0, math.pi), u(0, .35), u(0, math.tau))
    for bearing in alcoves:
        ore.chunk((*polar(bearing, 3.55), .4), (1.2, 1.45, 1.), FRONT_BEARING + math.radians(bearing), 0, 0, .68, pocket=True)
    # Breaks across the joined lumps, which make them one mass; flake scars over the faces; then a
    # denser pass that bites the ridges into serrated edges.
    for spacing, chord, depth, sharpest in ((1.3, (.6, 1.1), (.1, .2), 1.), (1.1, (.3, .6), (.06, .14), 1.), (.4, (.14, .32), (.1, .22), .4)):
        before = ore.field.copy()
        clipped = np.clip(before, -BAND, BAND)
        ridge = grid.blur(clipped, max(1, round(.09 / grid.voxel))) - clipped
        points, normals = grid.scatter(ore.field, spacing, rng)
        sharpness = grid.sample(ridge, points)
        for point, normal in zip(points[sharpness >= np.quantile(sharpness, 1 - sharpest)], normals[sharpness >= np.quantile(sharpness, 1 - sharpest)]):
            half = rng.uniform(*chord)
            ore.scoop(before, point, tilt(normal, 14, rng), half, half * rng.uniform(*depth))
    patches = np.maximum(ease(grid.noise(1.1), .6, 1.2), ease(grid.z, 2.4, 3.1) * .8)
    ore.field += patches * ((.6 - np.abs(grid.noise(.1))) * .028 + (.6 - np.abs(grid.noise(.05))) * .012)
    ore.polish *= 1 - patches
    return ore


def vein_slabs(grid, frame, joints, rng):
    """Sheets of metal in a few joints, each running from the pod out through the rock on one side."""
    field = grid.full(9.)
    center = np.array((*plan(.5, 0), .6))
    coordinate = [along(normal, (grid.x, grid.y, grid.z)) for normal in (frame.A, frame.B)]
    for axis in (0, 1):
        near = [line for line in joints[axis] if abs(line - frame.normals[axis] @ center) < 2.3]
        rng.shuffle(near)
        chosen = []
        for line in near:
            if len(chosen) < 2 and all(abs(line - other) > 2.2 for other in chosen):
                chosen.append(line)
        for line in chosen:
            side, start = rng.choice((-1, 1)), frame.normals[1 - axis] @ center
            wander = grid.noise(1.4) * .09
            slab = np.abs(coordinate[axis] - line + wander) - rng.uniform(.08, .12) * np.clip(.55 + .7 * grid.noise(1.1), -.2, 1.5)
            field = np.minimum(field, np.maximum(slab, side * (start + side * 1.2 - coordinate[1 - axis])))
    return field


# --- Bedrock -----------------------------------------------------------------

class Frame:
    """The rock's three fracture directions: bedding, dipping gently away from the camera so
    its ledges face the player, and two steep joint sets about seventy degrees apart."""

    def __init__(self, rng):
        dip, toward = math.radians(rng.uniform(7, 12)), math.pi / 2 + rng.uniform(-.6, .6)
        strike = rng.uniform(0, math.pi)
        steep = lambda bearing: tilt((math.cos(bearing), math.sin(bearing), 0), 7, rng)
        self.A, self.B = steep(strike), steep(strike + math.radians(rng.uniform(62, 80)))
        self.N = unit((math.sin(dip) * math.cos(toward), math.sin(dip) * math.sin(toward), math.cos(dip)))
        self.normals = np.array((self.A, self.B, self.N))


def joint_lines(rng, low, high, spacing):
    lines = [low]
    while lines[-1] < high:
        lines.append(lines[-1] + rng.uniform(*spacing))
    return lines


def rock_mass(grid, rng, alcoves, ore):
    """The outcrop before it broke up: a horseshoe of rounded sandstone masses around the
    ore, tall behind it, lower at its sides and down to a low sill either side of the
    camera's view. Alcoves low in its flanks open onto the ore, and a few fallen blocks
    lie in the sand at its foot."""
    field, u = grid.full(9.), rng.uniform
    # Bearing from the camera's side in degrees, distance out, radial and tangential radius, top.
    masses = [(180 - u(25, 40), u(2.95, 3.05), u(2., 2.1), u(2.5, 3.), u(2.1, 2.5)),
              (180 + u(25, 40), u(2.95, 3.05), u(2., 2.1), u(2.5, 3.), u(1.8, 2.2)),
              (u(98, 108), u(3.3, 3.45), u(1.5, 1.7), u(2., 2.4), u(1.6, 2.)),
              (-u(98, 108), u(3.3, 3.45), u(1.5, 1.7), u(2., 2.4), u(1.6, 2.)),
              (u(56, 64), u(3.6, 3.7), u(1.3, 1.45), u(1.6, 1.9), u(1.7, 2.)),
              (-u(56, 64), u(3.6, 3.7), u(1.3, 1.45), u(1.6, 1.9), u(1.7, 2.))]
    for bearing, distance, radial, tangential, top in masses:
        add_lobe(grid, field, (*polar(bearing, distance), -.9), (radial, tangential, top + .9),
                 FRONT_BEARING + math.radians(bearing) + u(-.3, .3), blend=.5)
    # The floor the pod rests on: under the ore everywhere, so mining leaves a pit in rock.
    add_lobe(grid, field, (*plan(-.3, 0), -.6), (u(3.3, 3.5), u(3.3, 3.5), u(1.8, 2.)), 0, blend=.5)
    # Away from the camera's side, wherever neither rock nor ore would meet a Scout's tool far enough out, the collar gets another mass.
    for step in range(72):
        bearing = math.tau * step / 72
        along_ray = lambda distances, height: [(math.cos(bearing) * r, math.sin(bearing) * r, height) for r in distances]
        if (abs(wrap(bearing - FRONT_BEARING)) > math.radians(48) and grid.sample(field, along_ray(np.arange(4.1, 5.2, .15), 1.3)).min() > -.1
                and grid.sample(ore, along_ray(np.arange(3.6, 5.2, .15), .9)).min() > 0):
            add_lobe(grid, field, (math.cos(bearing) * 3.8, math.sin(bearing) * 3.8, -.9), (1.2, 1.1, u(2.3, 2.6)), bearing, blend=.5)
    # Each alcove is low enough to leave the rock above it standing, so the collar stays in one piece.
    for bearing in alcoves:
        alcove = grid.full(9.)
        add_lobe(grid, alcove, (*polar(bearing, 4.9), .35), (1.5, u(.85, 1.), u(.68, .74)), FRONT_BEARING + math.radians(bearing), blend=.05)
        field = np.maximum(field, -alcove)
    for _ in range(rng.randint(5, 7)):
        size = u(.22, .45)
        add_lobe(grid, field, (*polar(u(-150, 150), u(4.4, 5.) - size), u(-.05, .12)),
                 (size * u(1., 1.5), size, size * u(.6, .9)), u(0, math.pi), u(0, .5), u(0, math.tau), blend=.05)
    return field


def pluck(grid, field, frame, rng):
    """Break the rounded masses along the frame. Each pluck lifts one joint-bounded block
    off the surface: its floor follows whichever of the three directions the surface faces
    most, its walls the other two, so slopes turn into ledges that step back along the bedding."""
    whole = field.copy()
    for spacing, size, depth, share in ((1.1, (.5, 1.05), (.1, .35), 1), (.55, (.25, .6), (.05, .16), 1), (.35, (.1, .25), (.025, .06), .5)):
        points, normals = grid.scatter(field, spacing, rng)
        for point, normal in zip(points, normals):
            if rng.random() > share:
                continue
            facing = frame.normals @ normal
            floor = rng.choices(range(3), weights=facing ** 4)[0]
            direction = tilt(frame.normals[floor] * (np.sign(facing[floor]) if floor < 2 else 1), 4, rng)
            wide = [rng.uniform(*size) for _ in range(2)]
            reach = math.hypot(*wide) + .1
            s, coords = grid.box(point - reach, point + reach)
            deep = rng.uniform(*depth)
            bite = along(direction, coords) - direction @ point + deep
            for wall, half in zip((axis for axis in range(3) if axis != floor), wide):
                across = tilt(frame.normals[wall], 4, rng)
                bite = np.minimum(bite, half - np.abs(along(across, coords) - across @ point - half * rng.uniform(-.5, .5)))
            # Only a shell under the surface comes away, so no pluck leaves a deep slot.
            field[s] = np.maximum(field[s], np.minimum(bite, field[s] + 1.8 * deep))
    # No mass loses more than its outer 40 cm.
    return without_fins(grid, np.minimum(field, whole + .4))


def without_fins(grid, field):
    """The field without slivers too thin to stand: about a hand's width or less."""
    clipped = np.clip(field, -BAND, BAND)
    return np.maximum(field, grid.blur(clipped, max(1, round(.12 / grid.voxel))) - .04)


def excavation(grid, ore, rock):
    """What mining removes from the rock: an open pit under the ore that shows from above,
    cut down in benches that step in toward the floor. Positive inside."""
    top = lambda field: np.where(field < 0, grid.z, np.float32(-9)).max(axis=2)
    shows = grid.blur((top(ore) > top(rock) + .1).astype(np.float32), round(.7 / grid.voxel))[:, :, None]
    return np.max([np.minimum(grid.z - level, shows - inset)
                   for level, inset in ((-.3, .8), (.55, .7), (.95, .61), (1.35, .54), (1.75, .5))], axis=0)


def nearest(lines, coordinate):
    """Distance from each sample's coordinate to the nearest of the chosen lines."""
    lines = np.array([-1e3, *sorted(lines), 1e3], np.float32)
    index = np.searchsorted(lines, coordinate)
    return np.minimum(coordinate - lines[index - 1], lines[index] - coordinate)


def weather(grid, frame, rock, joints, cut, rng):
    """Age the bare blocks, except where mining has cut them: lumpy flanks, recessed beds,
    worn edges, cracks along the joints and bedding, and a few pits."""
    natural = 1 - cut
    flank = 1 - .65 * np.clip(np.gradient(np.clip(rock, -BAND, BAND), grid.voxel, axis=2), 0, 1)
    u, v, w = (along(normal, (grid.x, grid.y, grid.z)) for normal in frame.normals)
    # A random stack of thin beds; the softer ones are recessed.
    beds = []
    while len(beds) < 520:
        beds += [rng.choice((0, 0, .5, 1)) * rng.uniform(.015, .05)] * int(rng.uniform(.04, .2) / .01)
    beds = np.convolve(beds, np.hanning(7) / np.hanning(7).sum(), 'same').astype(np.float32)
    relief = flank * (grid.noise(1.3) * .04 + grid.noise(.45) * .024) + grid.noise(.15) * .01
    relief += beds[np.clip(((w + grid.noise(1.5) * .03 + 1.6) / .01).astype(int), 0, len(beds) - 1)] * (.8 + .4 * grid.noise(.9))
    rock = rock + relief * natural
    clipped = np.clip(rock, -BAND, BAND)
    wear = np.maximum(grid.blur(clipped, max(1, round(.06 / grid.voxel))) - clipped, 0)
    rock = rock + wear * np.clip(.3 + .7 * grid.noise(.8), 0, 2) * natural
    for coordinate, lines, share, width, depth in ((u, joints[0], .55, .034, .22), (v, joints[1], .55, .034, .22),
                                                   (w, joints[2], .7, .028, .12)):
        chosen = [line for line in lines if rng.random() < share]
        open_ = depth * np.clip(grid.noise(1.6) + .2, 0, 1) * natural
        crack = np.minimum(width - nearest(chosen, coordinate + grid.noise(.8) * .04), rock + open_)
        rock = np.maximum(rock, crack)
    return rock + ease(grid.noise(.22), 1.3, 2.2) * .08 * flank * natural


def sand_surface(grid, rock, solid):
    """Height of the blown sand. It stays under the game's ground, so the terrain itself is
    the floor around and inside the outcrop, except where it is banked against the rock's
    foot; away from the outcrop it dives, so no skirt shows on a slope."""
    plan_blur = lambda mask, metres: grid.blur(mask.astype(np.float32), round(metres / grid.voxel))
    level = int((.15 - GRID_LO[2]) / grid.voxel)
    near = plan_blur(np.where(solid < 0, grid.z, np.float32(-9)).max(axis=2) > .05, .3)
    foot = plan_blur(rock[:, :, level] < 0, .3)
    banks = .32 * ease(foot, .04, .5) * np.clip(.75 + .6 * grid.noise(1.6, 1.6), 0, 1.4)
    return (-.75 + .72 * ease(near, .06, .7) + banks)[:, :, None]


# --- Meshes ------------------------------------------------------------------

def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def to_object(name, points, quads):
    data = bpy.data.meshes.new(name)
    data.vertices.add(len(points))
    data.vertices.foreach_set('co', points.astype(np.float32).ravel())
    data.loops.add(quads.size)
    data.loops.foreach_set('vertex_index', quads.astype(np.int32).ravel())
    data.polygons.add(len(quads))
    data.polygons.foreach_set('loop_start', np.arange(0, quads.size, quads.shape[1], dtype=np.int32))
    data.polygons.foreach_set('use_smooth', np.ones(len(quads), bool))
    data.update(calc_edges=True)
    data.validate()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return obj


def highpoly(name, grid, field, masks, wear_scale):
    """The detailed source mesh, with three shader masks per vertex and how worn (convex) or
    sheltered (concave) the surface is there."""
    points, quads = grid.mesh(field)
    obj = to_object(name, points, quads)
    colors = np.ones((len(points), 4), np.float32)
    for channel, mask in enumerate(masks):
        colors[:, channel] = np.clip(grid.sample(mask, points), 0, 1)
    obj.data.color_attributes.new('Masks', 'FLOAT_COLOR', 'POINT').data.foreach_set('color', colors.ravel())
    clipped = np.clip(field, -BAND, BAND)
    wear = grid.sample(grid.blur(clipped, max(1, round(.06 / grid.voxel))) - clipped, points)
    obj.data.attributes.new('Wear', 'FLOAT', 'POINT').data.foreach_set('value', np.clip(.5 + wear / wear_scale, 0, 1))
    log(f'{name}: {len(quads) * 2} triangles')
    return obj


def vertices(obj):
    points = np.empty(len(obj.data.vertices) * 3, np.float32)
    obj.data.vertices.foreach_get('co', points)
    return points.reshape(-1, 3)


def lowpoly(name, grid, field, hidden, triangles):
    """The runtime mesh: the same surface at half resolution, without what no one can see,
    reduced to its triangle budget."""
    points, quads = grid.mesh(field, step=1 if args.draft else 2)
    obj = to_object(name, points, quads)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    gone = hidden(points)
    bmesh.ops.delete(bm, geom=[face for face in bm.faces if all(gone[vertex.index] for vertex in face.verts)], context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.calc_loop_triangles()
    activate(obj)
    modifier = obj.modifiers.new('Runtime budget', 'DECIMATE')
    modifier.ratio = min(1, triangles / len(obj.data.loop_triangles))
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    # Specks that float clear of the ground go; fallen blocks, which touch it, stay.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    seen, floating = set(), []
    for start in bm.verts:
        if start in seen:
            continue
        island = [start]
        seen.add(start)
        for vertex in island:
            for edge in vertex.link_edges:
                other = edge.other_vert(vertex)
                if other not in seen:
                    seen.add(other)
                    island.append(other)
        if min(vertex.co.z for vertex in island) > .3 or len(island) < 6:
            floating += island
    bmesh.ops.delete(bm, geom=floating, context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.polygons.foreach_set('use_smooth', np.ones(len(obj.data.polygons), bool))
    obj.data.set_sharp_from_angle(angle=math.radians(62))
    return obj


def set_state(obj, grid, ore=None):
    """Mark which state shows each face. Rock that the ore covers completely is seen only once it is mined."""
    states = np.full(len(obj.data.polygons), FULL if ore is None else BOTH, np.int32)
    if ore is not None:
        inside = grid.sample(ore, vertices(obj)) < -.05
        for polygon in obj.data.polygons:
            if all(inside[index] for index in polygon.vertices):
                states[polygon.index] = DEPLETED
    obj.data.attributes.new('state', 'INT', 'FACE').data.foreach_set('value', states)


# --- Materials ---------------------------------------------------------------

class Graph:
    """Small helpers for the procedural source materials."""

    def __init__(self, name):
        self.material = bpy.data.materials.new(name)
        self.material.use_nodes = True
        self.nodes, self.links = self.material.node_tree.nodes, self.material.node_tree.links
        self.shader = self.nodes.get('Principled BSDF')
        geometry = self.nodes.new('ShaderNodeNewGeometry')
        self.position, self.normal = geometry.outputs['Position'], geometry.outputs['Normal']
        self.height, self.up = self.axis(self.position, 'Z'), self.axis(self.normal, 'Z')

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

    def centered(self, value, amount):
        return self.math('MULTIPLY', self.math('SUBTRACT', value, .5), amount)

    def axis(self, vector, name):
        node = self.nodes.new('ShaderNodeSeparateXYZ')
        self.links.new(vector, node.inputs[0])
        return node.outputs[name]

    def dot(self, vector, direction):
        node = self.nodes.new('ShaderNodeVectorMath')
        node.operation = 'DOT_PRODUCT'
        self.links.new(vector, node.inputs[0])
        node.inputs[1].default_value = tuple(float(c) for c in direction)
        return node.outputs['Value']

    def scale(self, color, factor):
        node = self.nodes.new('ShaderNodeVectorMath')
        node.operation = 'SCALE'
        self.set(color, node.inputs[0])
        self.set(factor, node.inputs['Scale'])
        return node.outputs['Vector']

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

    def noise(self, scale, detail=3., stretch=None, along=None):
        """Noise over the surface; `stretch` scales its axes, `along` makes it vary with one value only."""
        node = self.nodes.new('ShaderNodeTexNoise')
        node.inputs['Scale'].default_value = scale
        node.inputs['Detail'].default_value = detail
        node.inputs['Roughness'].default_value = .62
        if along is not None:
            node.noise_dimensions = '1D'
            self.links.new(along, node.inputs['W'])
        elif stretch:
            mapping = self.nodes.new('ShaderNodeMapping')
            mapping.inputs['Scale'].default_value = stretch
            self.links.new(self.position, mapping.inputs['Vector'])
            self.links.new(mapping.outputs['Vector'], node.inputs['Vector'])
        else:
            self.links.new(self.position, node.inputs['Vector'])
        return node.outputs['Fac']

    def jitter(self, value, scale, amount):
        """Offset a mask by centered noise, so thresholds wander naturally."""
        return self.math('ADD', value, self.centered(self.noise(scale, 4), amount))

    def box_image(self, path, meters):
        """A seamless object-space projection of one of the terrain's photographs."""
        coordinates = self.nodes.new('ShaderNodeTexCoord')
        mapping = self.nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = (1 / meters,) * 3
        image = self.nodes.new('ShaderNodeTexImage')
        image.image = bpy.data.images.load(str(ROOT / path), check_existing=True)
        image.projection, image.projection_blend = 'BOX', .3
        self.links.new(coordinates.outputs['Object'], mapping.inputs['Vector'])
        self.links.new(mapping.outputs['Vector'], image.inputs['Vector'])
        return image.outputs['Color']

    def luma(self, color):
        node = self.nodes.new('ShaderNodeRGBToBW')
        self.links.new(color, node.inputs[0])
        return node.outputs[0]

    def masks(self):
        attribute = self.nodes.new('ShaderNodeAttribute')
        attribute.attribute_name = 'Masks'
        channels = self.nodes.new('ShaderNodeSeparateColor')
        self.links.new(attribute.outputs['Color'], channels.inputs['Color'])
        wear = self.nodes.new('ShaderNodeAttribute')
        wear.attribute_name = 'Wear'
        return channels.outputs['Red'], channels.outputs['Green'], channels.outputs['Blue'], wear.outputs['Fac']

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

    def low(self, top):
        """One near the ground, fading out by `top` metres."""
        return self.invert(self.remap(self.height, .2, top))


def rock_material(frame):
    graph = Graph('Pod / bedrock, cut rock and sand')
    drift, cut, stain, wear = graph.masks()
    steep = graph.invert(graph.remap(graph.up, .3, .8))
    # Strata: beds of different tone along the bedding, with thin dark partings on the steep faces.
    bed = graph.dot(graph.position, frame.N)
    rock = graph.mix(1, graph.host(), graph.ramp(graph.noise(2.4, 4, along=bed),
                                                 [(.3, (.6, .52, .47)), (.5, (.84, .75, .68)), (.72, (1.05, .95, .84))]), 'MULTIPLY')
    parting = graph.times(graph.remap(graph.noise(9, 2, along=bed), .6, .68), steep, .3)
    rock = graph.mix(parting, rock, (.1, .07, .05))
    # Worn edges are paler, sheltered creases darker, and rock against the ore is stained by it.
    rock = graph.mix(graph.times(graph.remap(wear, .58, .85), .3), rock, (.5, .33, .2))
    rock = graph.mix(graph.times(graph.remap(graph.invert(wear), .54, .78), .8), rock, (.05, .03, .02))
    rock = graph.mix(graph.times(graph.remap(graph.jitter(stain, 4, .4), .3, .9), .6), rock, (.06, .052, .05))
    # Mined faces: flat, dark and matte, with the faint level lines of the cutting passes.
    sawn = graph.ramp(graph.noise(1, 3, stretch=(1.5, 1.5, 16)), [(.3, (.055, .045, .04)), (.7, (.115, .092, .078))])
    color = graph.mix(graph.remap(cut, .35, .65), rock, sawn)
    # Sand lies where the drift is, dusts level ground near the foot, and has begun to settle on the mined benches.
    dust = graph.times(graph.remap(graph.up, .75, .97), graph.remap(graph.noise(1.4, 3), .5, .7), graph.low(1.5), .55)
    settled = graph.times(cut, graph.remap(graph.up, .8, .97), graph.remap(graph.noise(.9, 3), .4, .62))
    sandy = graph.math('MAXIMUM', graph.remap(graph.jitter(drift, 3.5, .3), .4, .6), graph.math('MAXIMUM', dust, settled))
    graph.set(graph.mix(sandy, color, graph.sand()), graph.shader.inputs['Base Color'])
    graph.shader.inputs['Metallic'].default_value = 0
    graph.shader.inputs['Roughness'].default_value = .9
    grain = graph.bump(graph.luma(graph.box_image(CLIFF_GRAIN, 2.4)), graph.math('SUBTRACT', .8, graph.math('MULTIPLY', sandy, .65)), .03)
    graph.links.new(graph.bump(graph.noise(38, 2), .12, .01, grain), graph.shader.inputs['Normal'])
    return graph.material


def metal_material():
    graph = Graph('Pod / raw titanium')
    tone, polish, crust, wear = graph.masks()
    streak = graph.noise(7, 3, stretch=(1, 1, 5))
    # Each fracture face has its own tone; faces turned to the sun-camera half-vector carry a
    # broad sheen, baked because the game has no environment for the metal to reflect.
    sheen = graph.remap(graph.dot(graph.normal, GLINT), .6, .97)
    value = graph.add(.06, graph.math('MULTIPLY', tone, .62), graph.math('MULTIPLY', sheen, .5),
                      graph.centered(graph.noise(.9, 3), .25), graph.centered(streak, .12))
    shown = graph.ramp(value, [(0, GRAPHITE), (.45, STEEL), (1, BRIGHT)])
    # Measured in game: light multiplies base color by about .3 in shade and 2.5 facing the sun.
    # Dividing part of that out keeps sunlit faces from going pale and shaded ones from going black.
    light = graph.add(.3, graph.math('MULTIPLY', graph.math('MAXIMUM', graph.dot(graph.normal, SUN), 0), 2.2))
    metal = graph.scale(shown, graph.math('POWER', light, -.55))
    metal = graph.mix(graph.times(graph.remap(wear, .78, .97), graph.remap(graph.dot(graph.normal, GLINT), .3, .85), .5), metal, EDGE)
    # Host rock still clings near the contact, and sand dusts the low, level and sheltered metal.
    crusted = graph.remap(graph.jitter(crust, 5, .5), .45, .7)
    dusted = graph.math('MAXIMUM',
                        graph.times(graph.remap(graph.up, .6, .95), graph.remap(graph.noise(1.6, 3), .5, .72), graph.low(1.6), .7),
                        graph.times(graph.remap(graph.invert(wear), .58, .78), graph.low(2.2), .5))
    color = graph.mix(crusted, graph.mix(dusted, metal, graph.sand()), graph.host())
    graph.set(color, graph.shader.inputs['Base Color'])
    bare = graph.times(graph.invert(crusted), graph.invert(dusted))
    graph.set(graph.math('MULTIPLY', bare, METALNESS), graph.shader.inputs['Metallic'])
    # Polished faces are smooth enough for the fixed sun to glint on them (about .28); the rest only gleam.
    rough = graph.add(.52, graph.centered(streak, .12), graph.math('MULTIPLY', polish, -.23))
    graph.set(graph.add(rough, graph.math('MULTIPLY', graph.invert(bare), .4)), graph.shader.inputs['Roughness'])
    graph.links.new(graph.bump(graph.noise(40, 2), .3, .01, graph.bump(streak, .2, .015)), graph.shader.inputs['Normal'])
    return graph.material


# --- Bake, split and export --------------------------------------------------

def pixels(image, size):
    data = np.empty(size * size * 4, np.float32)
    image.pixels.foreach_get(data)
    return data.reshape(-1, 4)


def seam_charts(obj, size):
    """Seam the mesh into compact patches about `size` metres across for unwrapping. Patches
    grow from evenly spread faces and crossing a sharp edge costs extra, so their borders
    settle on the edges where a seam shows least."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    centers = np.array([face.calc_center_median() for face in bm.faces])
    normals = np.array([face.normal for face in bm.faces])
    owner = np.full(len(bm.faces), -1)
    spread = np.linalg.norm(centers - centers[0], axis=1)
    seeds = [0]
    for _ in range(int(sum(face.calc_area() for face in bm.faces) / size ** 2)):
        seeds.append(int(spread.argmax()))
        spread = np.minimum(spread, np.linalg.norm(centers - centers[seeds[-1]], axis=1))
    # Faces no seed can reach (small loose pieces) start patches of their own.
    queue = [(0., seed, chart) for chart, seed in enumerate(seeds)] + [(1e6 + index, index, len(seeds) + index) for index in range(len(owner))]
    heapq.heapify(queue)
    while queue:
        cost, index, chart = heapq.heappop(queue)
        if owner[index] >= 0:
            continue
        owner[index] = chart
        for edge in bm.faces[index].edges:
            for other in edge.link_faces:
                if owner[other.index] < 0:
                    step = np.linalg.norm(centers[index] - centers[other.index]) * (1 + 4 * (1 - normals[index] @ normals[other.index]))
                    heapq.heappush(queue, (cost + step, other.index, chart))
    for edge in bm.edges:
        edge.seam = len({owner[face.index] for face in edge.link_faces}) > 1
    bm.to_mesh(obj.data)
    bm.free()
    log(f'atlas: {len(set(owner))} charts')
    return owner


def tidy_charts(obj, chart_of, shrink):
    """Lay any chart the unwrap could not solve flat along its average normal. With `shrink`,
    also shrink the charts whose faces all look away from the game's fixed camera."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv.active
    seen = {chart_of[face.index] for face in bm.faces if np.array(face.normal) @ VIEW > -.05}
    for chart in set(chart_of):
        faces = [face for face in bm.faces if chart_of[face.index] == chart]
        loops = [loop for face in faces for loop in face.loops]
        # An unsolved chart comes back empty or blown up: far longer in UV than in space once scaled to its area.
        flat = sum(abs((face.loops[1][uv].uv - face.loops[0][uv].uv).cross(face.loops[2][uv].uv - face.loops[0][uv].uv)) for face in faces) / 2
        long = np.linalg.norm(np.ptp([tuple(loop[uv].uv) for loop in loops], axis=0))
        reach = np.linalg.norm(np.ptp([tuple(loop.vert.co) for loop in loops], axis=0))
        if not np.isfinite(long) or flat < 1e-12 or long * math.sqrt(sum(face.calc_area() for face in faces) / flat) > 3 * reach:
            normal = sum((face.normal * face.calc_area() for face in faces), Vector()).normalized()
            side = normal.orthogonal().normalized()
            for loop in loops:
                loop[uv].uv = (loop.vert.co @ side, loop.vert.co @ normal.cross(side))
        if shrink and chart not in seen:
            middle = sum((loop[uv].uv for loop in loops), Vector((0, 0))) / len(loops)
            for loop in loops:
                loop[uv].uv = middle + (loop[uv].uv - middle) * .45
    bm.to_mesh(obj.data)
    bm.free()


def bake(low, sources, output, size=1024):
    """Bake each high-poly source onto the low-poly faces it owns and give the low-poly one
    material with the three runtime maps. `sources` maps a set of states to a high-poly object.

    Rays start on a cage 10 cm outside the low-poly and look inward for the high-poly
    surface. Each source is baked alone into its own images, so the ore cannot print
    onto the pit under it; an ownership mask then picks, per texel, the right one."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.world.light_settings.distance = 1.4
    chart_of = seam_charts(low, 1.5)
    activate(low)
    atlas = low.data.uv_layers.new(name='RuntimeUV')
    low.data.uv_layers.active = atlas
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.unwrap(method='ANGLE_BASED', margin=.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    tidy_charts(low, chart_of, shrink=False)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    tidy_charts(low, chart_of, shrink=True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.pack_islands(margin=.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    states = np.empty(len(low.data.polygons), np.int32)
    low.data.attributes['state'].data.foreach_get('value', states)

    def target(name, obj, color=False):
        """A material whose active image receives the bake."""
        image = bpy.data.images.new(name, width=size, height=size, alpha=False, float_buffer=True)
        if not color:
            image.colorspace_settings.name = 'Non-Color'
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        node = material.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = image
        material.node_tree.nodes.active = node
        return image, material

    def expose(material, kind):
        """Route one of a source material's inputs to its surface as emission; returns the undo."""
        nodes, links = material.node_tree.nodes, material.node_tree.links
        shader = nodes.get('Principled BSDF')
        surface = next(node for node in nodes if node.type == 'OUTPUT_MATERIAL').inputs['Surface']
        original = surface.links[0].from_socket
        emit = nodes.new('ShaderNodeEmission')
        if kind == 'color':
            links.new(shader.inputs['Base Color'].links[0].from_socket, emit.inputs['Color'])
        else:
            channels = nodes.new('ShaderNodeCombineColor')
            channels.inputs['Red'].default_value = 1
            for name, channel in (('Roughness', 'Green'), ('Metallic', 'Blue')):
                source = shader.inputs[name]
                if source.is_linked:
                    links.new(source.links[0].from_socket, channels.inputs[channel])
                else:
                    channels.inputs[channel].default_value = source.default_value
            links.new(channels.outputs[0], emit.inputs['Color'])
        links.new(emit.outputs[0], surface)
        return lambda: links.new(original, surface)

    # Which source owns each texel, padded past the island edges like the bakes themselves.
    low.data.materials.clear()
    owner_image = None
    for index, part_states in enumerate(sources):
        owner_image, material = target('owner', low) if owner_image is None else (owner_image, bpy.data.materials.new('owner'))
        material.use_nodes = True
        nodes = material.node_tree.nodes
        emit = nodes.new('ShaderNodeEmission')
        emit.inputs['Color'].default_value = (index, index, index, 1)
        material.node_tree.links.new(emit.outputs[0], next(n for n in nodes if n.type == 'OUTPUT_MATERIAL').inputs['Surface'])
        if nodes.active is None or nodes.active.type != 'TEX_IMAGE':
            node = nodes.new('ShaderNodeTexImage')
            node.image = owner_image
            nodes.active = node
        low.data.materials.append(material)
    low.data.polygons.foreach_set('material_index', np.array(
        [next(index for index, part_states in enumerate(sources) if state in part_states) for state in states], np.int32))
    highs = list(sources.values())
    for high in highs:
        high.hide_render = True
    activate(low)
    bpy.ops.object.bake(type='EMIT', margin=10, margin_type='EXTEND', use_clear=True, uv_layer='RuntimeUV')
    owner = np.rint(pixels(owner_image, size)[:, 0]).astype(int)
    low.hide_render = True

    maps = {kind: np.zeros((size * size, 4), np.float32) for kind in ('color', 'normal', 'occlusion', 'surface')}
    for index, (part_states, high) in enumerate(sources.items()):
        part = low.copy()
        part.data = low.data.copy()
        bpy.context.collection.objects.link(part)
        bm = bmesh.new()
        bm.from_mesh(part.data)
        layer = bm.faces.layers.int['state']
        bmesh.ops.delete(bm, geom=[face for face in bm.faces if face[layer] not in part_states], context='FACES')
        bm.to_mesh(part.data)
        bm.free()
        part.hide_render = False
        # The mined rock is baked without the ore over it; the ore is baked resting in the rock.
        for other in highs:
            other.hide_render = other is not high and FULL not in part_states
        for kind, bake_type in (('color', 'EMIT'), ('surface', 'EMIT'), ('normal', 'NORMAL'), ('occlusion', 'AO')):
            log(f'bake {high.name} {kind}')
            image, material = target(f'{kind} {index}', part, kind == 'color')
            part.data.materials.clear()
            part.data.materials.append(material)
            part.data.polygons.foreach_set('material_index', np.zeros(len(part.data.polygons), np.int32))
            undo = [expose(m, kind) for m in high.data.materials] if bake_type == 'EMIT' else []
            bpy.ops.object.select_all(action='DESELECT')
            high.select_set(True)
            part.select_set(True)
            bpy.context.view_layer.objects.active = part
            bpy.ops.object.bake(type=bake_type, use_selected_to_active=True, use_cage=True, cage_extrusion=.1,
                                max_ray_distance=.3, margin=10, margin_type='EXTEND', use_clear=True,
                                normal_space='TANGENT', uv_layer='RuntimeUV')
            for restore in undo:
                restore()
            maps[kind][owner == index] = pixels(image, size)[owner == index]
            bpy.data.images.remove(image)
        bpy.data.objects.remove(part)

    # The game has no ambient occlusion pass, so creases are darkened in the color itself.
    contact = np.clip(maps['occlusion'][:, 0], 0, 1)
    depth = np.array([.25 if FULL in part_states else .6 for part_states in sources])[owner]
    maps['color'][:, :3] *= (1 - depth * (1 - contact))[:, None]
    maps['surface'][:, 0] = 1
    images = {}
    for kind in ('color', 'normal', 'surface'):
        image = bpy.data.images.new(f'runtime-{kind}', width=size, height=size, alpha=False, float_buffer=True)
        if kind != 'color':
            image.colorspace_settings.name = 'Non-Color'
        maps[kind][:, 3] = 1
        image.pixels.foreach_set(maps[kind].ravel())
        image.filepath_raw = str(output / f'{image.name}.png')
        image.file_format = 'PNG'
        image.save()
        image.pack()
        images[kind] = image

    runtime = bpy.data.materials.new(f'{low.name} / baked PBR')
    runtime.use_nodes = True
    nodes, links = runtime.node_tree.nodes, runtime.node_tree.links
    shader = nodes.get('Principled BSDF')

    def texture(image):
        node = nodes.new('ShaderNodeTexImage')
        node.image = image
        return node.outputs['Color']

    links.new(texture(images['color']), shader.inputs['Base Color'])
    normal = nodes.new('ShaderNodeNormalMap')
    links.new(texture(images['normal']), normal.inputs['Color'])
    links.new(normal.outputs['Normal'], shader.inputs['Normal'])
    separate = nodes.new('ShaderNodeSeparateColor')
    links.new(texture(images['surface']), separate.inputs['Color'])
    links.new(separate.outputs['Green'], shader.inputs['Roughness'])
    links.new(separate.outputs['Blue'], shader.inputs['Metallic'])
    low.data.materials.clear()
    low.data.materials.append(runtime)
    low.data.polygons.foreach_set('material_index', np.zeros(len(low.data.polygons), np.int32))
    low.hide_render = False


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
                              export_yup=True, export_image_format='WEBP', export_image_quality=80,
                              export_vertex_color='NONE')
    return obj


def mining_contact(obj):
    """Where a Scout's tool lands from every bearing, by the game's own rule: a ray
    from 1 m up just outside the footprint toward the center at three heights."""
    points = [vertex.co.copy() for vertex in obj.data.vertices]
    tree = BVHTree.FromPolygons(points, [list(polygon.vertices) for polygon in obj.data.polygons])
    states = [item.value for item in obj.data.attributes['state'].data]
    reaches, ore = [], 0
    for step in range(72):
        bearing = math.tau * step / 72
        origin = Vector((math.cos(bearing) * (FOOTPRINT_RADIUS + .7), math.sin(bearing) * (FOOTPRINT_RADIUS + .7), 1))
        for height in (.65, .35, 1.1):
            hit, _, index, _ = tree.ray_cast(origin, (Vector((0, 0, height)) - origin).normalized())
            if hit:
                reaches.append(math.hypot(hit.x, hit.y))
                ore += states[index] == FULL
                break
        else:
            reaches.append(0)
    short = {step * 5: round(reach, 1) for step, reach in enumerate(reaches) if reach < 3.5}
    return dict(nearest_contact=round(min(reaches), 2), ore_bearings=round(ore / 72, 3), short_bearings=short)


def describe(obj, path):
    obj.data.calc_loop_triangles()
    points = vertices(obj)
    return dict(path=str(path.relative_to(OUT)), bytes=path.stat().st_size,
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(), triangles=len(obj.data.loop_triangles),
                radius=round(float(np.hypot(points[:, 0], points[:, 1]).max()), 3),
                height=round(float(points[:, 2].max()), 3), **mining_contact(obj))


def preview(path):
    """A quick render of the high-poly source from the game's camera, under the game's sun."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, .05))
    ground = Graph('Preview ground')
    ground.set(ground.sand(), ground.shader.inputs['Base Color'])
    bpy.context.object.data.materials.append(ground.material)
    bpy.ops.object.light_add(type='SUN')
    sun = bpy.context.object
    sun.data.energy, sun.data.angle = 4, math.radians(2)
    sun.rotation_euler = Vector(SUN).to_track_quat('Z', 'Y').to_euler()
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (.55, .5, .45, 1)
    bpy.ops.object.camera_add(location=Vector(VIEW) * 30 + Vector((0, 0, 1)))
    camera = bpy.context.object
    camera.data.type, camera.data.ortho_scale = 'ORTHO', 14
    camera.rotation_euler = Vector(VIEW).to_track_quat('Z', 'Y').to_euler()
    scene.camera = camera
    scene.render.resolution_x, scene.render.resolution_y, scene.render.filepath = 1400, 1000, str(path)
    scene.view_settings.view_transform = 'Standard'
    bpy.ops.render.render(write_still=True)


def author(seed, suffix):
    bpy.ops.wm.read_factory_settings(use_empty=False)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    rng = random.Random(seed)
    grid = Grid(VOXEL, seed)
    output = OUT / f'seed-{seed}'
    output.mkdir(parents=True, exist_ok=True)
    log(f'seed {seed}: grid {grid.shape}')

    frame = Frame(rng)
    # Bearings, from the camera's side, of the alcoves that expose ore low in the rock's flanks.
    alcoves = [bearing + rng.uniform(-6, 6) for bearing in (-170, -136, -102, 102, 136, 170)]
    ore_body = pod(grid, rng, alcoves)
    pod_field, tone, polish = ore_body.field, ore_body.tone, ore_body.polish
    log('pod fractured')
    rock = pluck(grid, rock_mass(grid, rng, alcoves, pod_field), frame, rng)
    log('rock plucked')
    joints = [joint_lines(rng, -7, 7, spacing) for spacing in ((.5, 1.15), (.55, 1.3), (.32, .7))]
    solid = np.minimum(rock, pod_field)
    # Mining takes the open pit and, to a tool's reach, the rock that stood inside the alcoves' ore,
    # which leaves each alcove a slightly deeper cut recess.
    rock = np.maximum(rock, excavation(grid, pod_field, rock))
    rock = without_fins(grid, np.maximum(rock, np.minimum(-ore_body.pockets - .1, rock + .35)))
    # A vein fills its joint just short of flush with a hackly break; mining empties the
    # joint to a tool's reach below the surface.
    slabs = vein_slabs(grid, frame, joints, rng)
    veins = np.maximum(slabs + .012, rock - .005 + np.abs(grid.noise(.16)) * .018)
    rock = np.maximum(rock, np.minimum(-slabs, rock + .4))
    ore = np.minimum(pod_field, veins)
    mined = np.minimum(pod_field + .05, slabs - .04)
    cut = np.clip(-mined / .05, 0, 1)
    rock = weather(grid, frame, rock, joints, cut, rng)
    log('rock weathered')
    reach = np.hypot(grid.x, grid.y)
    sand = (grid.z - sand_surface(grid, rock, solid)) * .75
    host = np.maximum(smooth_min(rock, sand, .22), reach - FOOTPRINT_RADIUS)
    ore = np.maximum(ore, reach - FOOTPRINT_RADIUS)

    host_high = highpoly('host / high', grid, host, (.5 + (rock - sand) / .08, cut, 1 - mined / .3), .05)
    ore_high = highpoly('ore / high', grid, ore, (tone, polish, 1 - rock / .14), .035)
    host_high.data.materials.append(rock_material(frame))
    ore_high.data.materials.append(metal_material())
    if args.draft:
        bpy.ops.wm.save_as_mainfile(filepath=str(output / 'source.blend'))
        preview(output / 'preview.png')
        return []

    buried = lambda points: points[:, 2] < -.5
    host_low = lowpoly('host / low', grid, host, buried, TRIANGLES['host'])
    ore_low = lowpoly('ore / low', grid, ore, lambda points: buried(points) | (grid.sample(host, points) < -.12),
                      TRIANGLES['ore'])
    set_state(host_low, grid, ore)
    set_state(ore_low, grid)
    activate(host_low)
    ore_low.select_set(True)
    bpy.ops.object.join()
    low = bpy.context.object
    low.name = f'Titanium pod {seed}'
    bake(low, {(BOTH, DEPLETED): host_high, (FULL,): ore_high}, output)
    # The game scales the model until its widest reach meets the deposit's blocked radius; export it at that size.
    low.data.transform(Matrix.Scale(FOOTPRINT_RADIUS / float(np.hypot(*vertices(low)[:, :2].T).max()), 4))
    for high in (host_high, ore_high):
        bpy.data.objects.remove(high)
    entries = []
    for name, states in (('full', (BOTH, FULL)), ('depleted', (BOTH, DEPLETED))):
        path = OUT / f'{name}{suffix}.glb'
        entries.append(dict(seed=seed, state=name, **describe(split(low, states, path), path)))
        print('POD_EXPORT', json.dumps(entries[-1]), flush=True)
    return entries


exports = [entry for index, seed in enumerate(args.seed)
           for entry in author(seed, '-' + chr(ord('a') + index) if index else '')]
if exports:
    (OUT / 'export.json').write_text(json.dumps(dict(
        generator='tools/assets/build_titanium_pod.py',
        format='1 mesh, 1 standard PBR material, 1024px WebP color/normal/roughness-metallic per seed, shared by both states',
        coordinates='Y-up, centered X/Z, ground pivot Y=0', assets=exports), indent=2) + '\n')
log('done')
