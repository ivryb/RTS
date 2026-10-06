"""Deterministic hard-surface command center. Run with Blender --background --python."""
import argparse
from dataclasses import dataclass, replace
import json
import math
from pathlib import Path
import sys
from typing import Literal

import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
@dataclass(frozen=True)
class Design:
    hull_height: float
    taper: float
    bay_edge: float
    cabin_width: float
    cooling_fins: bool = False
    shoulder: Literal['covers', 'ivory', 'slot', 'grille'] = 'covers'


field_station = Design(.92, .07, .18, 1)
DESIGNS = {
    'field-station': field_station,
    'field-ivory': replace(field_station, shoulder='ivory'),
    'field-slots': replace(field_station, shoulder='slot'),
    'field-grilles': replace(field_station, shoulder='grille'),
    'compact-station': Design(.81, .055, .16, 1.07),
    'radiator-station': Design(.92, .08, .22, 1, cooling_fins=True),
}
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, help='defaults to the selected design’s workbench directory')
parser.add_argument('--seed', type=int, default=77)
parser.add_argument('--design', default='field-ivory', choices=DESIGNS)
parser.add_argument('--render', action='store_true')
parser.add_argument('--draft', action='store_true', help='export source materials without baking for shape review')
parser.add_argument('--texture-python', default='python3', help='Python interpreter with Pillow and NumPy')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
design = DESIGNS[args.design]
if args.output is None:
    args.output = ROOT / 'art/workbench/procedural-command-center/variants' / args.design
upper_drop = 2.55 * (design.hull_height - .94)
args.output.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
sys.path.insert(0, str(ROOT / 'tools/assets'))
from building_materials import create_materials

materials = create_materials(ROOT / 'art/workbench/building-materials/aged-desert', args.texture_python, args.seed)
armor, light_armor = materials.armor, materials.roof
# Roofs and shoulders retain the shared finish. Disconnecting their color maps erased
# edge wear and made the previous study look like smooth, freshly molded plastic.
metal, trim = materials.machinery, materials.structure
rubber, cyan, glass = materials.recess, materials.indicator, materials.glass
# This reference uses neutral smoked glass; the shared blue tint obscured the framing.
glass = glass.copy()
glass.name = 'Command center neutral smoked glass'
glass.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.055,.052,.045,1)
glass.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .29
from building_parts import BuildingParts, face_uv, aligned_uv, outline, facet_normal, facet_point, facet_length, filleted, rounded_outline

kit = BuildingParts(materials)
parts = kit.parts
finish, box, mesh = kit.finish, kit.box, kit.mesh
solid, hull, rod, ring = kit.solid, kit.hull, kit.rod, kit.ring
panel, strip, facet_box, rounded_shell = kit.panel, kit.strip, kit.facet_box, kit.rounded_shell


def lower_shell_point(point):
    """The lower-body fit also defines attachment coordinates for the upper service deck."""
    point = Vector(point)
    taper = 1 - design.taper * min(1, max(0, (point.z - .35) / 2.43))
    return Vector((point.x * taper * 1.04, point.y * taper * 1.10, point.z * design.hull_height))


def screw(name, point, direction=(0, 0, 1), radius=.024):
    point = Vector(point)
    rod(name, point, point + Vector(direction) * .015, radius, trim, 8)


# The lower assembly is transformed as a whole. Attachments use the same transform,
# while the cabin keeps its height and sits lower in the compact study.
lower = outline(7.95, 7.46, 1.78)
waist = outline(7.88, 7.38, 1.78)


def foundation():
    rounded_shell('Foundation plinth',[(8.26,7.80,1.83,0),(8.38,7.92,1.86,.08),
                                         (8.28,7.82,1.83,.18)],rubber,.34,4)
    rounded_shell('Foundation machinery band',[(8.18,7.72,1.81,.12),(8.26,7.80,1.82,.22),
                                                  (8.08,7.62,1.80,.35)],metal,.34,4)


def compact_footings():
    """Four low landing shoes under the diagonal equipment bays; no exposed ankles."""
    band = outline(8.22, 7.76, 1.82)
    for side in [1, 3, 5, 7]:
        center = (Vector(band[side]) + Vector(band[(side+1) % 8])) / 2
        outward = facet_normal(band, side)
        tangent = Vector((-outward.y, outward.x))
        center -= outward * .28

        def loop(plan, z):
            return [(*(center + outward*u + tangent*v), z) for u, v in plan]

        bottom = [(-.65,-.79),(.46,-.79),(.72,-.51),(.72,.51),(.46,.79),(-.65,.79)]
        top = [(-.60,-.73),(.43,-.73),(.66,-.47),(.66,.47),(.43,.73),(-.60,.73)]
        tread = [(-.25,-.51),(.31,-.51),(.46,-.33),(.46,.33),(.31,.51),(-.25,.51)]
        solid(f'Landing shoe sole {side}',loop(bottom,0),loop(bottom,.065),rubber,.018)
        solid(f'Landing shoe armor {side}',loop(bottom,.06),loop(top,.29),armor,.085)
        solid(f'Landing shoe tread {side}',loop(tread,.283),loop(tread,.299),metal,.018)
        for v in [-.49,.49]:
            screw('Landing shoe anchor',(* (center + outward*.31 + tangent*v),.309))


MODULAR_SHOULDER = filleted([(7.88, 7.38, 1.78, 1.71), (7.87, 7.37, 1.78, 2.18),
                               (7.46, 6.96, 1.65, 2.55), (6.26, 5.76, 1.36, 2.55)], [.11, .10])


def armor_corner(index):
    """One ivory module wraps an octagon vertex from the wall base to the terrace rim."""
    rows = [(7.95, 7.46, 1.78, .34)]
    for z in [.53,1.50,1.62,1.66]:
        t=(z-.34)/(1.71-.34)
        rows.append((7.95+(7.88-7.95)*t,7.46+(7.38-7.46)*t,1.78,z))
    rows += MODULAR_SHOULDER
    paths = []
    for w, d, cut, z in rows:
        perimeter = outline(w, d, cut)
        corner = Vector((*perimeter[index], z))
        # Each pair meets across a cardinal face, forming one broad rounded armor module.
        # Diagonal equipment bays remain separate and visibly lower.
        start = facet_point(perimeter, (index - 1) % 8, .80 if index == 1 else (1-design.bay_edge if index % 2 == 0 else .505), z)
        end = facet_point(perimeter, index, .20 if index == 0 else (.495 if index % 2 == 0 else design.bay_edge), z)
        a = corner + (start - corner).normalized() * .26
        b = corner + (end - corner).normalized() * .26
        arc = [(1-t)**2 * a + 2*(1-t)*t * corner + t*t * b for t in (i/6 for i in range(7))]
        path=[start,*arc,end]
        if index in [2,4,6]:
            path.insert(-1,facet_point(perimeter,index,.32,z))
        elif index in [3,5,7]:
            path.insert(1,facet_point(perimeter,index-1,.68,z))
        paths.append(path)
    columns = len(paths[0])
    faces=[]
    face_rows=[]
    for r in range(len(paths)-1):
        for c in range(columns-1):
            opening_column = columns-2 if index in [2,4,6] else 0
            if 1.62 <= rows[r][3] < 1.66:
                continue
            if index>=2 and c==opening_column and rows[r][3]>=.53 and rows[r+1][3]<=1.50:
                continue
            faces.append((r*columns+c,r*columns+c+1,(r+1)*columns+c+1,(r+1)*columns+c))
            face_rows.append(r)
    obj = mesh(f'Ivory corner module {index}', [point for path in paths for point in path], faces, armor, closed=False)
    obj.data.materials.append(light_armor)
    for polygon,r in zip(obj.data.polygons,face_rows):
        if rows[r][3] >= 1.66:
            polygon.material_index = 1
    uv = obj.data.uv_layers.active
    around = [np.cumsum([0]+[np.linalg.norm(b-a) for a,b in zip(path,path[1:])]) for path in paths]
    upward = [np.cumsum([0]+[np.linalg.norm(b[c]-a[c]) for a,b in zip(paths,paths[1:])]) for c in range(columns)]
    lower_end = next(i for i,row in enumerate(rows) if row[3] == 1.62)
    upper_start = lower_end+1
    # Height-only UVs collapse a horizontal shoulder cap onto the dirty border of its
    # texture tile. Follow the surface distance, with a separate tile across the seam.
    for polygon in obj.data.polygons:
        start,end = (upper_start,len(rows)-1) if polygon.material_index else (0,lower_end)
        for loop_index in polygon.loop_indices:
            row,column = divmod(obj.data.loops[loop_index].vertex_index,columns)
            u=around[row][column]/around[row][-1]
            v=(upward[column][row]-upward[column][start])/(upward[column][end]-upward[column][start])
            uv.data[loop_index].uv = (.02+.96*u,.02+.96*v)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.modifiers.new('Corner armor thickness', 'SOLIDIFY').thickness = .14
    bevel = obj.modifiers.new('Corner module edge radius', 'BEVEL')
    bevel.width, bevel.segments = .028, 3
    obj.modifiers.new('Corner module normals', 'WEIGHTED_NORMAL').keep_sharp = True
    for column in [0,columns-1]:
        # Paired halves meet here; a return through the middle would bisect the grille.
        if index>=2 and column==(columns-1 if index%2==0 else 0):
            continue
        edge = [path[column] for path in paths]
        edge.append(Vector((edge[-1].x,edge[-1].y,.34)))
        if column == 0:
            edge.reverse()
        cap = mesh(f'Armor module side return {index}.{column}',edge,[tuple(range(len(edge)))],
                   light_armor,closed=False)
        cap.modifiers.new('Side return thickness','SOLIDIFY').thickness=.035


def ventilation_cassette(side):
    """An open armor frame around a recessed, removable equipment cassette."""
    length = facet_length(lower, side)
    width, bottom, top = length * (1-2*design.bay_edge), .34, 2.10
    center_z, opening_width, opening_height = 1.01, width-.26, 1.06

    def on_wall(u, z, depth=0):
        t = (z - .50) / 1.21
        perimeter = [Vector(a).lerp(Vector(b), t) for a, b in zip(lower, waist)]
        return facet_point(perimeter, side, .5 + u / length, z, depth - .10)

    # Both loops use the same eight-corner ordering, so the surround is continuous around
    # the opening. A plate behind an applied black rectangle would flatten the recess.
    outer = [(u, v + (bottom + top)/2) for u, v in outline(width, top-bottom, .025)]
    aperture = [(u, v + center_z) for u, v in outline(opening_width, opening_height, .065)]
    faces = [(i, (i+1)%8, (i+1)%8+8, i+8) for i in range(8)]
    obj = mesh(f'Vent cassette armor {side}', [on_wall(u, z) for u, z in outer + aperture], faces, armor, closed=False)
    for loop in obj.data.loops:
        u, z = (outer + aperture)[loop.vertex_index]
        obj.data.uv_layers.active.data[loop.index].uv = (.02 + .96 * (u/width + .5), .02 + .96 * (z-bottom)/(top-bottom))
    obj.modifiers.new('Cassette armor thickness', 'SOLIDIFY').thickness = .12
    bevel = obj.modifiers.new('Cassette soft edges', 'BEVEL')
    bevel.width, bevel.segments = .035, 3
    obj.modifiers.new('Cassette weighted normals', 'WEIGHTED_NORMAL').keep_sharp = True

    # The dark socket fits behind the cut edge. Its bevel catches light without a bronze outline.
    inner = [(u, v + center_z) for u, v in outline(opening_width-.14, opening_height-.14, .055)]
    socket = mesh(f'Vent cassette socket {side}',
                  [on_wall(u, z, -.018) for u, z in aperture] + [on_wall(u, z, -.13) for u, z in inner],
                  faces, metal, closed=False)
    socket.modifiers.new('Socket liner', 'SOLIDIFY').thickness = .04
    back = mesh(f'Vent cassette recess {side}', [on_wall(u, z, -.14) for u, z in inner],
                [tuple(range(8))], rubber, closed=False)
    back.modifiers.new('Recess back', 'SOLIDIFY').thickness = .04
    half = (opening_width-.22)/2
    equipment_insert(f'Diagonal equipment {side}', on_wall, -half, half, .58, 1.42)
    for u in [-width*.40,width*.40]:
        normal=facet_normal(lower,side)
        screw('Cassette fastening',on_wall(u,1.77,.014),(normal.x,normal.y,0))


def equipment_insert(name, point, left, right, bottom, top):
    """Dark framed service doors or open cooling louvers, within an already cut socket."""
    if design.cooling_fins:
        for i,z in enumerate(np.linspace(bottom+.04,top-.12,6)):
            panel(f'{name} louver {i}',
                  [point(left,z,-.045),point(right,z,-.045),
                   point(right,z+.075,-.115),point(left,z+.075,-.115)],metal,.025,.008)
        return
    # A broad recessed hatch, separate hinges, and a latch give these openings a purpose.
    panel(name+' door',[point(left,bottom,-.108),point(right,bottom,-.108),
                       point(right,top,-.108),point(left,top,-.108)],metal,.03,.012)
    dx=(right-left)*.12
    inner=[(left+dx,bottom+.10),(right-dx,bottom+.10),(right-dx,top-.10),(left+dx,top-.10)]
    panel(name+' inset',[point(x,z,-.094) for x,z in inner],rubber,.012,.005)
    for a,b in zip(inner,inner[1:]+inner[:1]):
        rod(name+' hatch lip',point(*a,-.076),point(*b,-.076),.012,metal,6)
    middle=(left+right)/2
    rod(name+' divider',point(middle,bottom+.11,-.067),point(middle,top-.11,-.067),.014,metal,6)
    rod(name+' latch',point(middle+.025,(bottom+top)/2-.07,-.038),
        point(middle+.025,(bottom+top)/2+.07,-.038),.024,trim,8)
    for z in [bottom+.16,top-.16]:
        rod(name+' hinge',point(left+dx*.5,z-.045,-.06),point(left+dx*.5,z+.045,-.06),.022,metal,8)


# The cooling insert and its ivory border share one sampled surface. Separate curves
# previously intersected along the bend, especially after the lower-body taper.
BAY_PROFILE = filleted([(7.66,7.16,1.72,2.10),(7.35,6.85,1.64,2.39),
                        (6.26,5.76,1.36,2.39)],[.07])


def cooling_shoulder(side):
    if design.shoulder != 'covers':
        shoulder_panel(side)
        return
    rows = [BAY_PROFILE[0], *BAY_PROFILE[1:-1],
            np.array(BAY_PROFILE[-2])*.15+np.array(BAY_PROFILE[-1])*.85, BAY_PROFILE[-1]]
    edge = design.bay_edge
    columns = [edge,edge+.026,1-edge-.026,1-edge]
    vertices = []
    for row,(w,d,cut,z) in enumerate(rows):
        for column,t in enumerate(columns):
            point = facet_point(outline(w,d,cut),side,t,z)
            if 0 < row < len(rows)-1 and column in (1,2):
                point.z -= .018
            vertices.append(point)
    faces = [(r*4+c,r*4+c+1,(r+1)*4+c+1,(r+1)*4+c)
             for r in range(len(rows)-1) for c in range(3)]
    obj = mesh(f'Joined cooling shoulder {side}',vertices,faces,light_armor,closed=False)
    obj.data.materials.append(metal)
    for polygon in obj.data.polygons:
        row,column = divmod(polygon.index,3)
        polygon.material_index = int(column == 1 and 0 < row < len(rows)-2)
        for loop in polygon.loop_indices:
            r,c = divmod(obj.data.loops[loop].vertex_index,4)
            obj.data.uv_layers.active.data[loop].uv = (.02+.96*(columns[c]-edge)/(1-2*edge), .02+.96*r/(len(rows)-1))
    obj.modifiers.new('Continuous shoulder backing','SOLIDIFY').thickness=.10
    bevel = obj.modifiers.new('Shoulder edge radius','BEVEL')
    bevel.width,bevel.segments=.012,3
    obj.modifiers.new('Shoulder normals','WEIGHTED_NORMAL')
    # Cooling inserts follow the exact shoulder surface; fine fins or two raised cover
    # ribs articulate the dark band without adding another armor tier.
    for index,t in enumerate(np.linspace(edge+.065,1-edge-.065,11 if design.cooling_fins else 3)):
        path=[facet_point(outline(w,d,cut),side,t,z+.025) for w,d,cut,z in BAY_PROFILE]
        for a,b in zip(path,path[1:]):
            rod(f'Cooling {"fin" if design.cooling_fins else "cover rib"} {side}.{index}',a,b,
                .021 if design.cooling_fins else .013,metal,6)


def shoulder_panel(side):
    """Ivory armor, optionally cut for a slim intake or a folded-louver cooling cassette."""
    edge = design.bay_edge
    profile = np.array(BAY_PROFILE)
    centerline = [facet_point(outline(w,d,cut),side,.5,z) for w,d,cut,z in profile]
    distances = np.cumsum([0]+[(b-a).length for a,b in zip(centerline,centerline[1:])])
    distances /= distances[-1]

    def point(t, v, depth=0):
        w,d,cut,z = [float(np.interp(v,distances,profile[:,i])) for i in range(4)]
        perimeter = outline(w,d,cut)
        surface = facet_point(perimeter,side,t,z)
        if depth:
            tangent = facet_point(perimeter,side,t+.01,z)-surface
            slope = point(t,min(1,v+.001))-point(t,max(0,v-.001))
            surface += tangent.cross(slope).normalized()*depth
        return surface

    vent = design.shoulder != 'ivory'
    start, end = (.16,.27) if design.shoulder == 'slot' else (.26,.85)
    left, right = edge+.065, 1-edge-.065
    columns = [edge,left,right,1-edge]
    rows = sorted(set([*distances, *([start,end] if vent else [])]))
    faces = []
    for r in range(len(rows)-1):
        for c in range(3):
            if vent and c == 1 and start <= rows[r] < end:
                continue
            faces.append((r*4+c,r*4+c+1,(r+1)*4+c+1,(r+1)*4+c))
    obj = mesh(f'Joined cooling shoulder {side}', [point(t,v) for v in rows for t in columns],
               faces,light_armor,closed=False)
    for loop in obj.data.loops:
        r,c = divmod(loop.vertex_index,4)
        obj.data.uv_layers.active.data[loop.index].uv = (.02+.96*(columns[c]-edge)/(1-2*edge),.02+.96*rows[r])
    obj.modifiers.new('Shoulder armor thickness','SOLIDIFY').thickness=.045
    bevel = obj.modifiers.new('Shoulder soft edge','BEVEL')
    bevel.width,bevel.segments=.012,3
    obj.modifiers.new('Shoulder normals','WEIGHTED_NORMAL')
    if not vent:
        return

    # Follow the same curved surface as the cutout. The backing clears the service
    # deck below; the ivory cut edge and liner give the dark opening actual depth.
    vent_rows = [v for v in rows if start <= v <= end]
    back = mesh(f'Shoulder vent backing {side}',
                [point(t,v,-.04) for v in vent_rows for t in [left,right]],
                [(r*2,r*2+1,r*2+3,r*2+2) for r in range(len(vent_rows)-1)],rubber,closed=False)
    back.modifiers.new('Vent backing thickness','SOLIDIFY').thickness=.012
    border = [(left,start),(right,start),*[(right,v) for v in vent_rows[1:]],
              (left,end),*[(left,v) for v in reversed(vent_rows[1:-1])]]
    count = len(border)
    mesh(f'Shoulder vent liner {side}',
         [point(t,v,depth) for depth in [-.008,-.04] for t,v in border],
         [(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)],metal,closed=False)
    if design.shoulder == 'slot':
        for t in [left+(right-left)/3,left+2*(right-left)/3]:
            rod(f'Intake bridge {side}',point(t,start,.004),point(t,end,.004),.012,metal,6)
    else:
        # Broad folded blades read as an exhaust grille at gameplay distance, while
        # their gaps remain visible in a close inspection.
        pitch = (end-start)/6
        for i in range(6):
            v = start+i*pitch+.012
            panel(f'Shoulder louver {side}.{i}',
                  [point(left+.008,v,.014),point(right-.008,v,.014),
                   point(right-.008,v+pitch*.64,-.018),point(left+.008,v+pitch*.64,-.018)],metal,.015,.006)


def side_grille(side):
    """A real opening in the broad side armor, replacing the small applied viewport."""
    def point(t,z,depth=0):
        k=(z-.34)/(1.71-.34)
        perimeter=[Vector(a).lerp(Vector(b),k) for a,b in zip(lower,waist)]
        return facet_point(perimeter,side,t,z,depth)
    outer=[(.32,.53),(.68,.53),(.68,1.50),(.32,1.50)]
    inner=[(.34,.60),(.66,.60),(.66,1.43),(.34,1.43)]
    mesh(f'Side grille socket {side}',[point(t,z) for t,z in outer]+[point(t,z,-.12) for t,z in inner],
         [(i,(i+1)%4,(i+1)%4+4,i+4) for i in range(4)],metal,closed=False)
    panel(f'Side grille recess {side}',[point(t,z,-.14) for t,z in inner],rubber,.03,.008)
    equipment_insert(f'Side equipment {side}',point,.345,.655,.63,1.40)


def exterior_modular():
    """Rounded armor modules around lower equipment bays and an open front passage."""
    foundation()
    # Keep the established outer envelope. Move only the hidden core inward to make room
    # for actual inset sockets; widening the armor would repeat the generated concepts' bulk.
    core_lower, core_upper = outline(7.49,7.00,1.67), outline(7.10,6.61,1.55)
    # Leave the front center open so the entrance can be an actual recessed passage.
    mesh('Wall core with entrance opening',[(x,y,.30) for x,y in core_lower]+[(x,y,2.32) for x,y in core_upper],
         [tuple(reversed(range(8))),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(1,8)],
         rubber,closed=False)
    for a,b in [(0,.21),(.79,1)]:
        strip('Core entrance side',core_lower,core_upper,.30,2.32,0,a,b,rubber,.04,.01)
    for index in range(8):
        armor_corner(index)
    for side in [1, 3, 5, 7]:
        ventilation_cassette(side)
        cooling_shoulder(side)
        # A narrow lower lip protects the hatch without dividing the wall into courses.
        facet_box(f'Equipment bay lower sill {side}',side,.5,.40,
                  facet_length(lower,side)*(1-2*design.bay_edge),.09,.12,metal,lower,-.06,.025)
    for side in [2, 4, 6]:
        side_grille(side)
    compact_footings()


exterior_modular()
shell_parts = list(parts)

# Dark channel floor under the terrace, with two conduits around its rear half.
deck_start = len(parts)
deck_outer, deck_inner = outline(7.40, 6.86, 1.57), outline(3.90, 3.46, .78)
for side in range(8):
    plate = [facet_point(deck_outer, side, .012, 0), facet_point(deck_outer, side, .988, 0),
             facet_point(deck_inner, side, .988, 0), facet_point(deck_inner, side, .012, 0)]
    # Diagonal trays sit below the shoulder intake cavities; a level deck here slices
    # through the curved vents. The exposed cardinal service runs keep their height.
    bottom,top = (2.06,2.13) if side%2 else (2.26,2.33)
    deck = hull(f'Trench deck plate {side}', [p.xy for p in plate], [p.xy for p in plate], bottom, top, metal, .015)
    # Two radial panels per plate, each tile aligned to the plate edge.
    aligned_uv(deck, plate[1] - plate[0], (1, 2))
shell_parts.extend(parts[deck_start:])

# The cabin is nested inside the outer shoulder. Its slanted framed panes begin below
# the parapet top; a raised cylindrical window band changes the building's silhouette.
cabin_start = len(parts)
cb = outline(5.96, 5.46, 1.19)
rounded_shell('Cabin foundation collar', [(5.86,5.36,1.17,2.30),(5.86,5.36,1.17,2.46)],metal,.42,4)
CABIN_SILL = filleted([(5.96,5.46,1.19,2.36),(5.88,5.38,1.17,2.55),
                       (5.81,5.31,1.15,2.65)],[.025])
rounded_shell('Cabin lower armor sill',CABIN_SILL,armor,.42,4)
hull('Cabin recessed core', outline(5.72, 5.22, 1.13), outline(5.12, 4.62, 1.02), 2.53, 3.25, rubber, .02)
window_lower, window_upper = outline(5.84,5.34,1.16), outline(5.24,4.74,1.05)
wide_corners = {2, 3, 6, 7}
for side in range(8):
    start = .15 if side in wide_corners else .008
    end = .85 if (side+1)%8 in wide_corners else .992
    divisions = [(0,.22),(.23,.77),(.78,1)] if side%2 == 0 else [(0,1)]

    def window_point(t,v,depth=0):
        lo=facet_point(window_lower,side,t,2.65)
        hi=facet_point(window_upper,side,t,3.24)
        point=lo.lerp(hi,v)
        n=facet_normal(window_lower,side)
        return point+Vector((n.x,n.y,0))*depth

    for index,(a,b) in enumerate(divisions):
        a,b=start+(end-start)*a,start+(end-start)*b
        outer=[(a,0),(b,0),(b,1),(a,1)]
        # Frame thickness is measured along each face, not through separate shell profiles.
        border=.025
        aperture=[(a+border,.085),(b-border,.085),(b-border,.915),(a+border,.915)]
        frame=mesh(f'Window open graphite frame {side}.{index}',
                   [window_point(t,v,.02) for t,v in outer+aperture],
                   [(i,(i+1)%4,(i+1)%4+4,i+4) for i in range(4)],metal,closed=False)
        frame.modifiers.new('Window frame thickness','SOLIDIFY').thickness=.04
        bevel=frame.modifiers.new('Window frame bevel','BEVEL');bevel.width=.012;bevel.segments=2
        frame.modifiers.new('Window frame normals','WEIGHTED_NORMAL')
        panel(f'Window recessed glass {side}.{index}',[window_point(t,v,-.012) for t,v in aperture],glass,.012,.003)
    for a,b in ([(0,.135)] if side in wide_corners else []) + ([(.865,1)] if (side+1)%8 in wide_corners else []):
        strip(f'Cabin ivory corner {side}.{a}',cb,outline(5.33,4.83,1.07),2.55,3.27,side,a,b,armor,.10,.045)
rounded_shell('Cabin roof slab',filleted([(5.30,4.80,1.07,3.21),(5.46,4.96,1.10,3.25),
                                        (5.47,4.97,1.10,3.33),(5.02,4.52,1.02,3.47),
                                        (3.96,3.46,.81,3.50)],[.025,.05,.035]),light_armor,radius=.38,steps=5)
for side in [2,6]:
    rib = box('Roof longitudinal armor rib',(0,0,3.49),(.095,2.7,.055),light_armor,.023)
    rib.location.x = -1.90 if side == 6 else 1.90
box('Roof hatch apron',(0,-1.27,3.50),(1.52,1.00,.085),light_armor,.055)
# One inset roof hatch; no extra raised central lid or round vent competing with the dish.
box('Roof hatch gasket',(0,-1.31,3.502),(1.25,.80,.04),rubber,.04)
box('Roof hatch metal frame',(0,-1.31,3.53),(1.13,.68,.045),metal,.035)
box('Roof hatch inset leaf',(0,-1.31,3.553),(.96,.52,.025),rubber,.02)
for obj in parts[cabin_start:]:
    # Match the original's near-square cabin; the previous uniform scale retained a wide oval.
    obj.matrix_world = Matrix.Translation((0,0,upper_drop)) @ Matrix.Diagonal((.69*design.cabin_width,.76*design.cabin_width,1,1)) @ obj.matrix_world

# Each ledge starts at the cooling shoulder's actual inner edge after the shell fit,
# and terminates at the cabin sill. Neither edge is an independently guessed octagon.
sill_rows = np.array(CABIN_SILL)
ledge_height = 2.39
sill_size = [np.interp(ledge_height,sill_rows[:,3],sill_rows[:,i]) for i in range(3)]
# Join the flat portion of the rounded sill, stopping before its corner arcs.
ledge_inner = [(x*.69*design.cabin_width,y*.76*design.cabin_width) for x,y in rounded_outline(*sill_size,.42,4)]
ledge_outer = outline(*BAY_PROFILE[-1][:3])
for side in [1,3,5,7]:
    outside = [lower_shell_point(facet_point(ledge_outer,side,t,BAY_PROFILE[-1][3]))
               for t in [design.bay_edge,1-design.bay_edge]]
    inside = [Vector((*ledge_inner[side*9+column],ledge_height+upper_drop)) for column in [4,5]]
    panel(f'Fitted cabin service ledge {side}',[outside[0],outside[1],inside[1],inside[0]],
          light_armor,.10,.012)
# Mechanical runs stay within the cardinal service bays, below the adjacent ledges.
service_ring = outline(4.95,4.65,1.10)
for side in [0,2,4,6]:
    for offset in [0,.20]:
        a=facet_point(service_ring,side,.15,2.32+upper_drop,offset)
        b=facet_point(service_ring,side,.85,2.32+upper_drop,offset)
        rod(f'Service bay conduit {side}',a,b,.048,metal,12)
        for point in [a,b]:
            box(f'Service conduit saddle {side}',point-Vector((0,0,.055)),(.14,.14,.15),metal,.02)
entry_start = len(parts)
box('Entrance rear bulkhead',(0,-3.08,1.24),(1.68,.12,1.77),rubber,.025)
box('Entrance passage floor',(0,-3.60,.39),(1.65,1.18,.15),metal,.025)
box('Entrance passage ceiling',(0,-3.60,2.12),(1.65,1.18,.10),rubber,.025)
for sign in [-1,1]:
    box('Entrance inner jamb',(sign*.79,-3.60,1.24),(.10,1.18,1.70),metal,.025)
    box('Recessed door leaf',(sign*.35,-3.17,1.23),(.64,.075,1.34),metal,.03)
    box('Recessed door panel',(sign*.35,-3.22,1.23),(.47,.025,1.12),rubber,.025)
for sign in [-1,1]:
    solid('Entrance tapered cheek',[(sign*.85,-4.12,.30),(sign*1.28,-4.12,.30),
                                  (sign*1.28,-3.49,.30),(sign*.85,-3.49,.30)],
                                 [(sign*.83,-4.06,2.03),(sign*1.14,-4.06,2.03),
                                  (sign*1.14,-3.46,2.03),(sign*.83,-3.46,2.03)],armor,.055)
    box('Entry indicator recess',(sign*1.045,-4.14,1.00),(.145,.05,.37),rubber,.035)
    for z in [.94,1.07]:
        box('Entry cyan indicator',(sign*1.045,-4.17,z),(.047,.012,.09),cyan,.004)
# The U-shaped lintel has clipped corners and short returns down the jambs.
outer=[(-1.21,1.85),(-1.21,2.37),(-.99,2.60),(.99,2.60),(1.21,2.37),(1.21,1.85)]
inner=[(.85,1.85),(.85,2.12),(.67,2.29),(-.67,2.29),(-.85,2.12),(-.85,1.85)]
contour=outer+inner
solid('Chamfered entrance hood',[(x,-3.18,z) for x,z in contour],[(x,-4.20,z) for x,z in contour],light_armor,.045)
for sign in [-1,1]:
    rod('Entrance shoulder coupling',(sign*1.16,-3.59,2.31),(sign*1.61,-3.59,2.31),.15,metal,24)
ramp=[(-.87,-3.92,0),(.87,-3.92,0),(.87,-5.19,0),(-.87,-5.19,0),
      (-.87,-3.92,.48),(.87,-3.92,.48),(.87,-5.19,.08),(-.87,-5.19,.08)]
mesh('Solid ramp foundation',ramp,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],rubber,.025)
panel('Ramp inset deck',[(-.70,-5.11,.115),(.70,-5.11,.115),(.70,-3.98,.476),(-.70,-3.98,.476)],metal,.035,.018)
for sign in [-1,1]:
    beam=box('Ramp armored side rail',(sign*.795,-4.56,.32),(.14,1.30,.15),metal,.035)
    beam.rotation_euler.x=math.atan(.40/1.27)
for y in np.linspace(-5.05,-4.04,11):
    z=.08+(y+5.19)/1.27*.40
    box('Ramp tread',(0,y,z+.03),(1.32,.024,.018),metal,.005)

# The reference doorway occupies roughly one fifth of the body width. The earlier
# full-width vestibule and ramp dominated the front even after the exterior was changed.
bpy.context.view_layer.update()
for obj in parts[entry_start:]:
    # Restored body depth must not lengthen the vestibule and ramp with it.
    obj.matrix_world = Matrix.Translation((0,.32,0)) @ Matrix.Diagonal((.94,1,1,1)) @ obj.matrix_world
shell_parts.extend(parts[entry_start:])

def reflector_material():
    """A polar finish for the dish, independent of the clean roof's rectangular panel tile."""
    size=1024
    y,x=np.mgrid[0:size,0:size].astype(float)
    x=(x/(size-1)-.5)/.47
    y=(y/(size-1)-.5)/.47
    radial=np.hypot(x,y)
    angle=np.arctan2(y,x)
    rng=np.random.default_rng(args.seed)
    grain=rng.normal(0,.012,(size//4,size//4)).repeat(4,axis=0).repeat(4,axis=1)
    grain+=rng.normal(0,.003,(size,size))
    # Distances are in dish radii: narrow radial joints and one concentric assembly seam.
    spoke=np.abs(np.sin(angle*6))*radial/6
    seam=np.maximum(np.exp(-(spoke/.007)**2)*(radial>.23),
                    np.exp(-((radial-.65)/.006)**2))
    rim=np.exp(-((radial-.985)/.013)**2)
    rim_dust=np.exp(-((radial-.94)/.065)**2)
    petal=.018*np.cos(np.floor((angle+np.pi)/math.tau*12)*2.4)
    variation=1+grain+petal-.48*seam-.20*rim-.10*rim_dust
    mat=bpy.data.materials.new('Reflector ivory / fine grain and assembly joints')
    mat.use_nodes=True
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    shader=nodes.get('Principled BSDF')
    color=np.array(light_armor.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value[:3])
    shader.inputs['Metallic'].default_value=.04
    shader.inputs['Roughness'].default_value=.65
    pixels=np.ones((size,size,4),dtype=np.float32)
    pixels[:,:,:3]=color[None,None,:]*variation[:,:,None]
    image=bpy.data.images.new('Reflector radial finish',width=size,height=size,float_buffer=True)
    image.colorspace_settings.name='Non-Color'
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    texture=nodes.new('ShaderNodeTexImage');texture.image=image
    links.new(texture.outputs['Color'],shader.inputs['Base Color'])
    return mat


dish_start = len(parts)
# Compact stepped azimuth base and a slim mast lift the dish clear of the roof, as on the reference.
for z0, z1, r0, r1 in [(3.46, 3.60, .91, .91), (3.60, 3.94, .91, .73), (3.94, 4.04, .73, .54)]:
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=r0, radius2=r1, depth=z1 - z0, location=(0, .28, (z0 + z1) / 2))
    obj = finish(bpy.context.object, 'Dish pedestal stepped housing', metal, .018)
    face_uv(obj.data)
    ring('Pedestal machined seam', (0, .28, z0 + .01), r0, .012, metal)
mount_start = len(parts)
box('Dish yoke base', (0, .40, 4.10), (.80, .44, .12), metal, .04)
for x in [-.29, .29]:
    obj = box('Dish elevation armored fork', (x, .36, 4.66), (.18, .36, 1.10), metal, .05)
    obj.rotation_euler.x = math.radians(-21)
rod('Dish elevation axle', (-.50, .47, 5.10), (.50, .47, 5.10), .24, metal, 32)
for x in [-.51, .51]:
    rod('Elevation drive end cap', (x, .47, 5.10), (x + math.copysign(.055, x), .47, 5.10), .185, trim, 32)
    rod('Elevation drive inner cap', (x + math.copysign(.06, x), .47, 5.10), (x + math.copysign(.07, x), .47, 5.10), .105, metal, 24)
# At the default building rotation the game camera faces the entrance from about 42 degrees
# above the ground. A dish about 40 degrees off that line of sight reads as a turned bowl:
# at 66 degrees (side-facing) it looked edge-on, and at 16 degrees it looked flat and frontal.
dish_turn, dish_elevation = math.radians(-50), math.radians(45)
# The mount follows the dish azimuth; rotating only the reflector crosses its bowl.
mount_pivot = Matrix.Translation((0, .34, 0))
mount_rotation = mount_pivot @ Matrix.Rotation(dish_turn, 4, 'Z') @ mount_pivot.inverted()
for obj in parts[mount_start:]:
    obj.matrix_world = mount_rotation @ obj.matrix_world

# Radial and one concentric seam split the reflector into regular petals; no tripod struts.
dish_center = Vector((0, .34, 5.32))
dish_facing = Matrix.Rotation(dish_turn, 3, 'Z') @ Vector((0, -math.cos(dish_elevation), math.sin(dish_elevation)))
dish_rotation = dish_facing.to_track_quat('Z', 'Y')
radius = 1.25


def dish_point(r, angle, offset=0):
    local = Vector((r * math.cos(angle), r * math.sin(angle), .46 * (r / radius) ** 2 + offset))
    return dish_center + dish_rotation @ local


segments, rings = 96, 16
verts=[dish_point(0,0)]
for row in range(1,rings+1):
    verts.extend(dish_point(radius*row/rings,col*math.tau/segments) for col in range(segments))
faces=[(0,1+c,1+(c+1)%segments) for c in range(segments)]
for row in range(rings-1):
    for col in range(segments):
        a=1+row*segments+col;b=1+row*segments+(col+1)%segments
        faces.append((a,a+segments,b+segments,b))
bowl=mesh('Continuous dish reflector',verts,faces,reflector_material(),closed=False)
for poly in bowl.data.polygons:poly.use_smooth=True
bowl.modifiers.new('Reflector skin','SOLIDIFY').thickness=.045
for loop in bowl.data.loops:
    point=dish_rotation.inverted()@(bowl.data.vertices[loop.vertex_index].co-dish_center)
    bowl.data.uv_layers.active.data[loop.index].uv=(.5+point.x/radius*.47,.5+point.y/radius*.47)
for sector in range(8):
    for row in range(8):
        rod('Reflector rear rib',dish_point(radius*row/8,sector*math.tau/8,-.055),
            dish_point(radius*(row+1)/8,sector*math.tau/8,-.055),.015,metal,6)
ring('Reflector rolled rim',dish_point(0,0,.46),radius,.022,light_armor,dish_rotation.to_euler())
# A tapered feed horn is visibly different from the previous narrow cylindrical pin.
start,end=dish_point(0,0,.02),dish_point(0,0,.56)
bpy.ops.mesh.primitive_cone_add(vertices=32,radius1=.23,radius2=.085,depth=(end-start).length,location=(start+end)/2)
obj=bpy.context.object;obj.rotation_euler=(end-start).to_track_quat('Z','Y').to_euler()
finish(obj,'Tapered receiver horn',metal,.008)

# Synchronize the last horn rotation before applying transforms; otherwise its local Z
# remains vertical instead of following the reflector normal.
bpy.context.view_layer.update()
# The dish mount sits on the revised cabin crown.
for obj in parts[dish_start:]:
    obj.matrix_world = Matrix.Translation((0, 0, .01+upper_drop)) @ obj.matrix_world

# Taper the complete lower assembly together so hatches, entrance, and footings
# follow the wall slope instead of floating in front of a narrowed shell.
for obj in shell_parts:
    inverse = obj.matrix_world.inverted()
    for vertex in obj.data.vertices:
        vertex.co = inverse @ lower_shell_point(obj.matrix_world @ vertex.co)
    obj.data.update()

# Retain the study's fixed world scale. All parts remain individually editable.
for obj in parts:
    obj.matrix_world = Matrix.Diagonal((1.03, 1.03, 1, 1)) @ obj.matrix_world
# Keep the named source parts; the browser gets a single baked material.
bpy.ops.object.select_all(action='DESELECT')
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.wm.save_as_mainfile(filepath=str(args.output / 'command-center.blend'))
# Apply bevels before joining so each named part keeps its own edge treatment.
for obj in parts:
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)
sys.path.insert(0, str(Path(__file__).parent))
from building_bake import bake_runtime
if not args.draft:
    bake_runtime(parts, args.output, name='Command center')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(args.output / 'command-center.glb'), export_format='GLB',
                          use_selection=True, export_apply=True, export_yup=True,
                          export_image_format='WEBP', export_image_quality=85)
objects = list(bpy.context.selected_objects)
triangles = 0
for obj in objects:
    obj.data.calc_loop_triangles()
    triangles += len(obj.data.loop_triangles)
report = {'seed': args.seed, 'design': args.design, 'shoulder': design.shoulder, 'feet': 'four inset landing shoes', 'geometry_source': 'fully procedural; no imported mesh', 'meshes': len(objects), 'triangles': triangles,
          'glb_bytes': (args.output / 'command-center.glb').stat().st_size,
          'ground_contact': 'Closed continuous foundation at z=0', 'license': 'CC BY-SA 4.0'}
(args.output / 'build-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))

if args.render:
    ground = bpy.data.materials.new('Preview sand')
    ground.use_nodes = True
    ground.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.24, .19, .125, 1)
    ground.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .92
    box('Preview ground', (0, 0, -.13), (200, 200, .20), ground, 0)
    world = bpy.context.scene.world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.32, .39, .49, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .45
    bpy.ops.object.light_add(type='AREA', location=(-6, -8, 12))
    bpy.context.object.data.energy = 2100
    bpy.context.object.data.shape = 'DISK'
    bpy.context.object.data.size = 7
    bpy.context.object.rotation_euler = (Vector((0, 0, 2)) - bpy.context.object.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.object.light_add(type='AREA', location=(5, 3, 9))
    bpy.context.object.data.energy = 1400
    bpy.context.object.data.size = 6
    bpy.context.object.rotation_euler = (Vector((0, 0, 2)) - bpy.context.object.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = 'ORTHO'
    bpy.context.scene.camera = camera
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 1100
    scene.render.resolution_percentage = 100
    for name, position, scale in [('hero', (11, -15, 12), 13.7), ('rear', (-11, 15, 10), 13.7),
                                  ('ground-contact', (10, -16, 5), 13.7)]:
        camera.location = position
        camera.rotation_euler = (Vector((0, -.25, 2.40)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.ortho_scale = scale
        scene.render.filepath = str(args.output / (name + '.png'))
        bpy.ops.render.render(write_still=True)
