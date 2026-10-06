"""Small shared vocabulary for authored Blender buildings, with named editable parts.

BuildingParts owns the part list and material palette. Dimensions are Blender units;
solid() joins convex rings and panel() grows thickness behind its outward-facing sheet.
"""
import math

import bpy
import numpy as np
from mathutils import Vector

from building_materials import BuildingMaterials


def face_uv(data):
    # One tile per planar face prevents cube-unwrapping diagonals across large n-gons.
    uv = data.uv_layers.active or data.uv_layers.new(name='UVMap')
    for polygon in data.polygons:
        axes = [i for i in range(3) if i != max(range(3), key=lambda i: abs(polygon.normal[i]))]
        coords = [data.vertices[data.loops[i].vertex_index].co for i in polygon.loop_indices]
        lows = [min(v[a] for v in coords) for a in axes]
        spans = [max(v[a] for v in coords) - lows[j] for j, a in enumerate(axes)]
        for i, v in zip(polygon.loop_indices, coords):
            uv.data[i].uv = tuple(.015 + .97 * (v[a] - lows[j]) / max(spans[j], .001) for j, a in enumerate(axes))


def aligned_uv(obj, direction, repeats=(1, 1)):
    """Fit the tile to a part's own edge direction, so panel seams follow the plate instead of the world axes."""
    along = Vector((direction[0], direction[1], 0)).normalized()
    axes = (along, Vector((-along.y, along.x, 0)))
    coords = [(vertex.co.dot(axes[0]), vertex.co.dot(axes[1])) for vertex in obj.data.vertices]
    lows = [min(c[i] for c in coords) for i in range(2)]
    spans = [max(c[i] for c in coords) - lows[i] for i in range(2)]
    uv = obj.data.uv_layers.active
    for loop in obj.data.loops:
        c = coords[loop.vertex_index]
        uv.data[loop.index].uv = tuple(repeats[i] * (.015 + .97 * (c[i] - lows[i]) / max(spans[i], .001)) for i in range(2))


def outline(width, depth, cut):
    x, y = width / 2, depth / 2
    # Broader diagonal faces keep every nested shell visibly octagonal from above.
    cut *= 1.30
    return [(-x + cut, -y), (x - cut, -y), (x, -y + cut), (x, y - cut),
            (x - cut, y), (-x + cut, y), (-x, y - cut), (-x, -y + cut)]


def facet_normal(outline_points, side):
    a, b = Vector(outline_points[side]), Vector(outline_points[(side + 1) % 8])
    return Vector((b.y - a.y, a.x - b.x)).normalized()


def facet_point(outline_points, side, t, z, outward=0):
    a, b = Vector(outline_points[side]), Vector(outline_points[(side + 1) % 8])
    xy = a.lerp(b, t) + facet_normal(outline_points, side) * outward
    return Vector((xy.x, xy.y, z))


def facet_length(outline_points, side):
    return (Vector(outline_points[(side + 1) % 8]) - Vector(outline_points[side])).length


def filleted(corners, radii, steps=5):
    """Profile rows of (width, depth, cut, z) through straight runs, each interior corner rounded by its radius."""
    corners = np.array(corners)
    rows = [corners[0]]
    for prev, corner, nxt, radius in zip(corners, corners[1:], corners[2:], radii):
        def span(p):
            return math.hypot((p[0] - corner[0]) / 2, p[3] - corner[3])
        a = corner + (prev - corner) * min(.45, radius / span(prev))
        b = corner + (nxt - corner) * min(.45, radius / span(nxt))
        rows += [(1-s)**2 * a + 2*(1-s)*s * corner + s*s * b for s in np.linspace(0, 1, steps)]
    return rows + [corners[-1]]


def rounded_outline(width, depth, cut, radius, steps=2):
    """Octagon with rounded vertical corners, listed facet by facet from each corner's midpoint."""
    corners = np.array(outline(width, depth, cut))
    arcs = []
    for i, corner in enumerate(corners):
        def toward(p):
            return (p - corner) / np.linalg.norm(p - corner) * radius
        a, b = corner + toward(corners[i - 1]), corner + toward(corners[(i + 1) % 8])
        arcs.append([(1-s)**2 * a + 2*(1-s)*s * corner + s*s * b for s in np.linspace(0, 1, 2 * steps + 1)])
    return [p for i in range(8) for p in arcs[i][steps:] + arcs[(i + 1) % 8][:steps]]


class BuildingParts:
    def __init__(self, materials: BuildingMaterials):
        self.materials = materials
        self.parts = []

    def finish(self, obj, name, mat, bevel=0):
        obj.name = name
        obj.data.materials.append(mat)
        if bevel:
            modifier = obj.modifiers.new('Machined edge radius', 'BEVEL')
            # Moderate radii read as machined armor; wider rounding made the plates look inflated.
            modifier.width = min(bevel * 1.1, .13) if mat in (self.materials.armor, self.materials.roof) else bevel
            modifier.segments = 4 if bevel >= .08 else 3
            if mat in (self.materials.armor, self.materials.roof):
                modifier.harden_normals = True
                for polygon in obj.data.polygons:
                    polygon.use_smooth = True
            modifier = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
            modifier.keep_sharp = True
        self.parts.append(obj)
        return obj

    def box(self, name, location, scale, mat, bevel=.04, rotation=0):
        bpy.ops.mesh.primitive_cube_add(size=1, location=location)
        obj = bpy.context.object
        obj.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.rotation_euler.z = rotation
        face_uv(obj.data)
        return self.finish(obj, name, mat, bevel)

    def mesh(self, name, vertices, faces, mat, bevel=0, closed=True):
        """Closed meshes get recalculated normals; open sheets keep their authored winding."""
        bpy.ops.object.select_all(action='DESELECT')
        data = bpy.data.meshes.new(name)
        data.from_pydata(vertices, [], faces)
        data.update()
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        # Recalculating an open sheet flips it unpredictably, so solidified plates would grow
        # outward on some facets and inward on others.
        if closed:
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.normals_make_consistent(inside=False)
            bpy.ops.object.mode_set(mode='OBJECT')
        obj.select_set(False)
        face_uv(data)
        return self.finish(obj, name, mat, bevel)

    def solid(self, name, lower, upper, mat, bevel=.04):
        """Closed prism between two matching convex rings of 3D points."""
        n = len(lower)
        faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
        faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        return self.mesh(name, [*lower, *upper], faces, mat, bevel)

    def hull(self, name, lower, upper, z0, z1, mat, bevel=.04):
        return self.solid(name, [(x, y, z0) for x, y in lower], [(x, y, z1) for x, y in upper], mat, bevel)

    def rod(self, name, start, end, radius, mat, vertices=12):
        delta = Vector(end) - Vector(start)
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=delta.length,
                                           location=(Vector(start) + Vector(end)) / 2)
        obj = bpy.context.object
        obj.rotation_euler = delta.to_track_quat('Z', 'Y').to_euler()
        # Small fasteners and cooling ribs are already below a gameplay pixel. Beveling
        # every short segment triples their geometry without changing the silhouette.
        return self.finish(obj, name, mat, .012 if radius >= .035 else 0)

    def ring(self, name, center, radius, thickness, mat, rotation=None):
        bpy.ops.mesh.primitive_torus_add(major_segments=64, minor_segments=8,
                                        location=center, major_radius=radius, minor_radius=thickness)
        obj = bpy.context.object
        if rotation:
            obj.rotation_euler = rotation
        return self.finish(obj, name, mat)

    def lathe(self, name, profile, mat, segments=48, closed_profile=False):
        """Turn (radius, height) rows around Z; a closed profile makes a hollow tube."""
        vertices = [(radius*math.cos(i*math.tau/segments), radius*math.sin(i*math.tau/segments), z)
                    for radius,z in profile for i in range(segments)]
        row_count = len(profile) if closed_profile else len(profile)-1
        faces = [(r*segments+i, r*segments+(i+1)%segments,
                  ((r+1)%len(profile))*segments+(i+1)%segments, ((r+1)%len(profile))*segments+i)
                 for r in range(row_count) for i in range(segments)]
        if not closed_profile:
            faces += [tuple(reversed(range(segments))), tuple(range(len(vertices)-segments,len(vertices)))]
        obj = self.mesh(name, vertices, faces, mat)
        distances = np.cumsum([0]+[math.dist(a,b) for a,b in zip(profile,profile[1:])])
        if closed_profile:
            distances = np.append(distances,distances[-1]+math.dist(profile[-1],profile[0]))
        for face in obj.data.polygons[:row_count*segments]:
            row,column = divmod(face.index,segments)
            face.use_smooth = True
            for loop,(u,v) in zip(face.loop_indices,[(column,row),(column+1,row),(column+1,row+1),(column,row+1)]):
                obj.data.uv_layers.active.data[loop].uv = (.02+.96*u/segments,.02+.96*distances[v]/distances[-1])
        # Smooth around a turned surface, but keep steep profile steps machined.
        # Smoothing across every row turns barrel collars and races into bulges.
        sharp_rows = set()
        for row, point in enumerate(profile):
            if not closed_profile and row in (0,len(profile)-1):
                sharp_rows.add(row)
                continue
            before = Vector(point)-Vector(profile[row-1])
            after = Vector(profile[(row+1)%len(profile)])-Vector(point)
            if before.angle(after) > math.pi/4:
                sharp_rows.add(row)
        for edge in obj.data.edges:
            a,b = edge.vertices
            edge.use_edge_sharp = a//segments == b//segments and a//segments in sharp_rows
        return obj

    def panel(self, name, corners, mat, thickness=.07, bevel=.025):
        """Counter-clockwise corners, seen from outside, are the outer face; thickness grows behind it."""
        obj = self.mesh(name, corners, [(0, 1, 2, 3)], mat, closed=False)
        solid = obj.modifiers.new('Plate thickness', 'SOLIDIFY')
        solid.thickness = thickness
        if bevel:
            modifier = obj.modifiers.new('Soft armor edges', 'BEVEL')
            modifier.width = bevel
            modifier.segments = 3
            obj.modifiers.new('Plate normals', 'WEIGHTED_NORMAL')
        return obj

    def strip(self, name, lower, upper, z0, z1, side, t0, t1, mat, thickness=.1, bevel=.04):
        return self.panel(name, [facet_point(lower, side, t0, z0), facet_point(lower, side, t1, z0),
                            facet_point(upper, side, t1, z1), facet_point(upper, side, t0, z1)], mat, thickness, bevel)

    def facet_box(self, name, side, t, z, width, height, depth, mat, outline_points, offset=.05, bevel=.025):
        a, b = Vector(outline_points[side]), Vector(outline_points[(side + 1) % 8])
        direction = b - a
        p = facet_point(outline_points, side, t, z, offset)
        return self.box(name, p, (width, depth, height), mat, bevel, math.atan2(direction.y, direction.x))

    def rounded_shell(self, name, rows, mat, radius=.4, steps=2):
        """Smooth closed shell through rounded-octagon rows, with one texture tile per facet."""
        rings = [rounded_outline(w, d, cut, radius, steps) for w, d, cut, _ in rows]
        n, per_facet = len(rings[0]), 2 * steps + 1
        vertices = [(x, y, row[3]) for ring, row in zip(rings, rows) for x, y in ring]
        sides = [(r * n + i, r * n + (i + 1) % n, (r + 1) * n + (i + 1) % n, (r + 1) * n + i)
                 for r in range(len(rows) - 1) for i in range(n)]
        caps = [tuple(reversed(range(n))), tuple(range(len(vertices) - n, len(vertices)))]
        obj = self.mesh(name, vertices, sides + caps, mat)
        uv = obj.data.uv_layers.active
        for polygon in obj.data.polygons[:len(sides)]:
            columns = [obj.data.loops[i].vertex_index % n for i in polygon.loop_indices]
            # The face closing the ring spans columns n-1 and 0; unwrap 0 to n there.
            first = min(columns) if max(columns) - min(columns) == 1 else n - 1
            facet = first // per_facet
            for i in polygon.loop_indices:
                row, column = divmod(obj.data.loops[i].vertex_index, n)
                column += n if column < first else 0
                uv.data[i].uv = (.02 + .96 * (column - facet * per_facet) / per_facet, .02 + .96 * row / (len(rows) - 1))
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        obj.modifiers.new('Weighted shell normals', 'WEIGHTED_NORMAL').keep_sharp = True
        return obj
