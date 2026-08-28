#!/usr/bin/env python3
"""Turn Meshy's organic quadruped skin into a rigid mechanical walk.

The source GLB is preserved. The script keeps Meshy's leg skeleton and walk
rotations, assigns each disconnected mesh island to one bone, freezes the body,
and exports a separate GLB plus a small diagnostic report and preview video.
"""

import argparse
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Vector


LEG_FAMILIES = {
    "frontleg": ("frontleg", "frontleg0", "frontleg1", "frontleg2"),
    "R_frontleg": ("R_frontleg", "R_frontleg0", "R_frontleg1", "R_frontleg2"),
    "backleg": ("backleg", "backleg0", "backleg1", "backleg2"),
    "R_backleg": ("R_backleg", "R_backleg0", "R_backleg1", "R_backleg2"),
}
LEG_BONES = {bone for family in LEG_FAMILIES.values() for bone in family}
BODY_BONE = "Hips"
MIN_LEG_SHARE = 0.18


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--blend", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--preview", required=True)
    parser.add_argument("--mode", choices=("freeze-only", "rigid-islands"), default="freeze-only")
    parser.add_argument("--preview-scale", type=float, default=1.4)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_model(filepath):
    bpy.ops.import_scene.gltf(filepath=str(filepath))
    armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    mesh = next(
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and any(mod.type == "ARMATURE" for mod in obj.modifiers)
    )
    if not armature.animation_data or not armature.animation_data.action:
        raise RuntimeError("Imported armature has no active animation action")
    return armature, mesh, armature.animation_data.action


def connected_components(mesh):
    parent = list(range(len(mesh.data.vertices)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left, right):
        left, right = find(left), find(right)
        if left != right:
            parent[right] = left

    for edge in mesh.data.edges:
        union(*edge.vertices)

    # glTF duplicates vertices at UV and hard-normal seams. Treat vertices at
    # the same position as connected for classification, without changing the
    # source mesh or welding any geometry.
    first_at_position = {}
    for vertex in mesh.data.vertices:
        key = tuple(round(value, 8) for value in vertex.co)
        if key in first_at_position:
            union(vertex.index, first_at_position[key])
        else:
            first_at_position[key] = vertex.index

    components = defaultdict(list)
    for vertex in mesh.data.vertices:
        components[find(vertex.index)].append(vertex.index)
    return list(components.values())


def current_weights(mesh, vertex_indices):
    weights = defaultdict(float)
    for index in vertex_indices:
        for assignment in mesh.data.vertices[index].groups:
            weights[mesh.vertex_groups[assignment.group].name] += assignment.weight
    return weights


def choose_bone(weights, vertex_count):
    family_weights = {
        name: sum(weights.get(bone, 0.0) for bone in bones)
        for name, bones in LEG_FAMILIES.items()
    }
    family, family_weight = max(family_weights.items(), key=lambda item: item[1])
    share = family_weight / max(vertex_count, 1)
    if share < MIN_LEG_SHARE:
        return BODY_BONE, share, family_weights
    bone = max(LEG_FAMILIES[family], key=lambda name: weights.get(name, 0.0))
    return bone, share, family_weights


def rigidify_weights(mesh):
    components = connected_components(mesh)
    assignments = []
    by_bone = defaultdict(list)

    for component in components:
        weights = current_weights(mesh, component)
        bone, share, family_weights = choose_bone(weights, len(component))
        by_bone[bone].extend(component)
        positions = [mesh.data.vertices[index].co for index in component]
        minimum = Vector((min(v[i] for v in positions) for i in range(3)))
        maximum = Vector((max(v[i] for v in positions) for i in range(3)))
        assignments.append(
            {
                "vertices": len(component),
                "bone": bone,
                "leg_share": round(share, 4),
                "center": [round(value, 7) for value in ((minimum + maximum) * 0.5)],
                "size": [round(value, 7) for value in (maximum - minimum)],
                "family_weights": {
                    name: round(value / max(len(component), 1), 4)
                    for name, value in family_weights.items()
                },
            }
        )

    all_vertices = list(range(len(mesh.data.vertices)))
    for group in mesh.vertex_groups:
        group.remove(all_vertices)
    for bone, indices in by_bone.items():
        mesh.vertex_groups[bone].add(indices, 1.0, "REPLACE")

    mesh.data.update()
    return assignments, {bone: len(indices) for bone, indices in sorted(by_bone.items())}


def action_fcurves(action):
    if hasattr(action, "fcurves"):
        return action.fcurves
    if action.layers:
        strip = action.layers[0].strips[0]
        return strip.channelbag(action.slots[0]).fcurves
    raise RuntimeError("Unsupported Blender action format")


def keep_only_leg_rotations(armature, action):
    curves = action_fcurves(action)
    removed = 0
    for curve in list(curves):
        match = re.search(r'pose\.bones\["([^"]+)"\]\.(.+)', curve.data_path)
        keep = bool(match and match.group(1) in LEG_BONES and match.group(2).startswith("rotation_"))
        if not keep:
            curves.remove(curve)
            removed += 1

    for pose_bone in armature.pose.bones:
        pose_bone.location = (0.0, 0.0, 0.0)
        pose_bone.scale = (1.0, 1.0, 1.0)
        if pose_bone.name not in LEG_BONES:
            pose_bone.rotation_mode = "QUATERNION"
            pose_bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)

    action.name = "Walk_Rigid"
    start, end = (int(math.floor(value)) for value in action.frame_range)
    bpy.context.scene.frame_start = start
    bpy.context.scene.frame_end = end
    bpy.context.scene.frame_set(start)
    return removed, start, end


def export_glb(output, armature, mesh):
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_skins=True,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
    )


def world_bounds(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    evaluated_mesh = evaluated.to_mesh()
    points = [evaluated.matrix_world @ vertex.co for vertex in evaluated_mesh.vertices]
    minimum = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    maximum = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    evaluated.to_mesh_clear()
    return minimum, maximum


def add_preview_scene(mesh, preview_path, start, end, preview_scale):
    minimum, maximum = world_bounds(mesh)
    center = (minimum + maximum) * 0.5
    size = maximum - minimum
    radius = max(size) * 0.5

    bpy.ops.mesh.primitive_plane_add(size=max(size.x, size.y) * 4.0, location=(center.x, center.y, minimum.z))
    ground = bpy.context.object
    ground.name = "Preview Ground"
    material = bpy.data.materials.new("Preview Ground Material")
    material.diffuse_color = (0.045, 0.035, 0.025, 1.0)
    material.roughness = 0.9
    ground.data.materials.append(material)

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(size.x, size.y, size.z) * preview_scale
    camera.data.clip_start = max(radius / 100.0, 0.000001)
    camera.data.clip_end = max(radius * 100.0, 1.0)
    camera.location = center + Vector((2.5, -3.5, 2.2)).normalized() * radius * 5.0
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = camera

    bpy.ops.object.light_add(type="AREA", location=center + Vector((radius * 2.5, -radius * 2.0, radius * 4.0)))
    key = bpy.context.object
    key.data.energy = 900
    key.data.shape = "DISK"
    key.data.size = radius * 4.0

    bpy.ops.object.light_add(type="AREA", location=center + Vector((-radius * 3.0, radius * 1.5, radius * 2.0)))
    fill = bpy.context.object
    fill.data.energy = 450
    fill.data.size = radius * 3.0

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.fps = max(1, end - start)
    frames_dir = preview_path.parent / f"{preview_path.stem}-frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(frames_dir / "frame_")
    scene.world = scene.world or bpy.data.worlds.new("Preview World")
    scene.world.color = (0.008, 0.006, 0.004)
    bpy.ops.render.render(animation=True)
    print(f"PREVIEW_FRAMES: {frames_dir}")


def main():
    args = parse_args()
    paths = {name: Path(getattr(args, name)).resolve() for name in ("input", "output", "blend", "report", "preview")}
    for name in ("output", "blend", "report", "preview"):
        paths[name].parent.mkdir(parents=True, exist_ok=True)

    reset_scene()
    armature, mesh, action = import_model(paths["input"])
    if args.mode == "rigid-islands":
        assignments, vertices_by_bone = rigidify_weights(mesh)
    else:
        assignments, vertices_by_bone = [], {}
    removed_curves, start, end = keep_only_leg_rotations(armature, action)

    export_glb(paths["output"], armature, mesh)
    bpy.ops.wm.save_as_mainfile(filepath=str(paths["blend"]))

    report = {
        "input": str(paths["input"]),
        "output": str(paths["output"]),
        "mode": args.mode,
        "action": action.name,
        "frames": [start, end],
        "component_count": len(assignments),
        "removed_animation_curves": removed_curves,
        "vertices_by_bone": vertices_by_bone,
        "components": assignments,
    }
    paths["report"].write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "components"}, indent=2))

    add_preview_scene(mesh, paths["preview"], start, end, args.preview_scale)


if __name__ == "__main__":
    main()
