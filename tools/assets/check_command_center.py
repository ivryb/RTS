"""Check source assemblies after a build. Run through Blender with -- <design> [...]."""
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector


root = Path(__file__).resolve().parents[2] / 'art/workbench/procedural-command-center/variants'
designs = sys.argv[sys.argv.index('--')+1:]
for design in designs:
    output = root / design
    bpy.ops.wm.open_mainfile(filepath=str(output / 'command-center.blend'))
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    checks = []
    objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    for obj in objects:
        if obj.name.startswith(('Window recessed glass', 'Recessed door panel')):
            center = sum((obj.matrix_world @ v.co for v in obj.data.vertices), Vector()) / len(obj.data.vertices)
            normal = (obj.matrix_world.to_3x3().inverted().transposed() @ obj.data.polygons[0].normal).normalized()
            if obj.name.startswith('Recessed door panel'):
                normal = Vector((0, -1, 0))
            distance = 3 if obj.name.startswith('Recessed door panel') else .3
            hit, _, _, _, other, _ = bpy.context.scene.ray_cast(deps, center + normal*distance, -normal, distance=distance+.05)
            checks.append({'part': obj.name, 'visible': other.name if hit else None, 'pass': hit and other == obj})

        if obj.name.startswith('Side grille recess'):
            side = obj.name.split()[-1]
            corners = [obj.matrix_world @ v.co for v in obj.data.vertices]
            normal = (obj.matrix_world.to_3x3().inverted().transposed() @ obj.data.polygons[0].normal).normalized()
            # A corner module's hidden return once crossed the center of these openings.
            # Sample both halves and the center so a narrow strip of armor cannot pass.
            for u in [.25, .5, .75]:
                for v in [.25, .5, .75]:
                    point = corners[0].lerp(corners[1], u).lerp(corners[3].lerp(corners[2], u), v)
                    hit, _, _, _, other, _ = bpy.context.scene.ray_cast(deps, point + normal, -normal, distance=1.05)
                    checks.append({'part': f'side opening {side} at {u},{v}',
                                   'visible': other.name if hit else None,
                                   'pass': hit and other.name.startswith((f'Side equipment {side}', obj.name))})

        if obj.name.startswith('Shoulder vent backing'):
            for face in obj.data.polygons:
                center = obj.matrix_world @ face.center
                normal = (obj.matrix_world.to_3x3().inverted().transposed() @ face.normal).normalized()
                hit, _, _, _, other, _ = bpy.context.scene.ray_cast(deps, center + normal*.25, -normal, distance=.30)
                checks.append({'part': f'{obj.name} opening {face.index}', 'visible': other.name if hit else None,
                               'pass': hit and other.name.startswith(('Shoulder vent backing', 'Shoulder louver', 'Intake bridge'))})

        if obj.name.startswith('Fitted cabin service ledge'):
            side = int(obj.name.split()[-1])
            shoulder = bpy.data.objects[f'Joined cooling shoulder {side}']
            for ledge_i, shoulder_i in [(0, -4), (1, -1)]:
                a = obj.matrix_world @ obj.data.vertices[ledge_i].co
                b = shoulder.matrix_world @ shoulder.data.vertices[shoulder_i].co
                checks.append({'part': f'ledge {side} join {ledge_i}', 'gap': (a-b).length, 'pass': (a-b).length < 1e-5})

        if obj.name.startswith('Ivory corner module'):
            uv = obj.data.uv_layers.active
            areas = []
            for face in obj.data.polygons:
                points = [uv.data[i].uv for i in face.loop_indices]
                areas.append(abs(sum(a.x*b.y-b.x*a.y for a,b in zip(points, points[1:]+points[:1])))/2)
            # Collapsed cap UVs sample a single dirty edge of the tile in the final bake.
            checks.append({'part': obj.name+' surface UVs', 'minimum_area': min(areas), 'pass': min(areas) > 1e-9})

    shoes = [obj for obj in objects if obj.name.startswith('Landing shoe armor')]
    checks.append({'part': 'four inset landing shoes', 'count': len(shoes), 'pass': len(shoes) == 4})
    minimum_z = min((obj.matrix_world @ v.co).z for obj in objects for v in obj.data.vertices)
    checks.append({'part': 'foundation ground contact', 'minimum_z': minimum_z, 'pass': abs(minimum_z) < .001})
    report = {'design': design, 'checks': checks, 'passed': sum(c['pass'] for c in checks), 'total': len(checks)}
    (output / 'assembly-checks.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report), flush=True)
    assert report['passed'] == report['total'], report
