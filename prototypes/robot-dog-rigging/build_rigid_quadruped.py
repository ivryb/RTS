#!/usr/bin/env python3
"""Build a rigid mechanical quadruped rig and procedural walk from a GLB + rig JSON."""

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


LEG_KEYS = ("frontLeft", "frontRight", "rearLeft", "rearRight")
SEGMENTS = ("upper", "lower", "foot")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--rig", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--blend", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--preview", required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def three_to_blender(values):
    x, y, z = values
    return Vector((x, -z, y))


def load_rig(path):
    data = json.loads(path.read_text())
    if data.get("type") != "dune77-rigid-quadruped":
        raise RuntimeError("Unsupported rig JSON")
    points = {"root": three_to_blender(data["root"]), "legs": {}}
    for leg_key in LEG_KEYS:
        leg = data["legs"][leg_key]
        points["legs"][leg_key] = {
            name: three_to_blender(leg[name])
            for name in ("hip", "knee", "ankle", "foot")
        }
    return data, points


def import_mesh(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"Expected one mesh, found {len(meshes)}")
    return meshes[0]


def connected_components(mesh):
    parent = list(range(len(mesh.vertices)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left, right):
        left, right = find(left), find(right)
        if left != right:
            parent[right] = left

    for edge in mesh.edges:
        union(*edge.vertices)

    first_at_position = {}
    for vertex in mesh.vertices:
        key = tuple(round(value, 7) for value in vertex.co)
        if key in first_at_position:
            union(vertex.index, first_at_position[key])
        else:
            first_at_position[key] = vertex.index

    groups = defaultdict(list)
    for vertex in mesh.vertices:
        groups[find(vertex.index)].append(vertex.index)
    return list(groups.values())


def point_segment_distance(point, start, end):
    segment = end - start
    if segment.length_squared < 1e-12:
        return (point - start).length
    amount = max(0.0, min(1.0, (point - start).dot(segment) / segment.length_squared))
    return (point - (start + segment * amount)).length


def bounds_for_vertices(mesh, indices):
    points = [mesh.vertices[index].co for index in indices]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum


def classify_components(obj, rig_points):
    mesh = obj.data
    all_points = [vertex.co for vertex in mesh.vertices]
    model_min = Vector(tuple(min(point[axis] for point in all_points) for axis in range(3)))
    model_max = Vector(tuple(max(point[axis] for point in all_points) for axis in range(3)))
    longest = max(model_max - model_min)
    hip_height = max(leg["hip"].z for leg in rig_points["legs"].values())
    threshold = longest * 0.18
    large_component = longest * 0.34

    paths = {}
    for leg_key, points in rig_points["legs"].items():
        paths[f"{leg_key}.upper"] = (points["hip"], points["knee"])
        paths[f"{leg_key}.lower"] = (points["knee"], points["ankle"])
        paths[f"{leg_key}.foot"] = (points["ankle"], points["foot"])

    by_semantic = defaultdict(list)
    report = []
    for component_id, indices in enumerate(connected_components(mesh)):
        minimum, maximum = bounds_for_vertices(mesh, indices)
        center = (minimum + maximum) * 0.5
        size = maximum - minimum
        distances = {name: point_segment_distance(center, *segment) for name, segment in paths.items()}
        nearest, distance = min(distances.items(), key=lambda item: item[1])
        leg_key, segment = nearest.split(".")
        hip = rig_points["legs"][leg_key]["hip"]
        inboard_shoulder = (
            segment == "upper"
            and center.z > rig_points["legs"][leg_key]["knee"].z
            and abs(center.y) < abs(hip.y) - longest * 0.04
        )
        forced_body = (
            max(size) > large_component
            or center.z > hip_height + longest * 0.14
            or inboard_shoulder
        )
        semantic = "body" if forced_body or distance > threshold else nearest
        by_semantic[semantic].extend(indices)
        report.append({
            "component": component_id,
            "vertices": len(indices),
            "semantic": semantic,
            "nearest_segment": nearest,
            "distance": round(distance, 6),
            "center": [round(value, 6) for value in center],
            "size": [round(value, 6) for value in size],
        })

    required = {"body", *(f"{leg}.{segment}" for leg in LEG_KEYS for segment in SEGMENTS)}
    missing = sorted(required - set(by_semantic))
    if missing:
        raise RuntimeError(f"No geometry assigned to: {', '.join(missing)}")
    return by_semantic, report


def copy_piece(source, name, keep_indices):
    piece = source.copy()
    piece.data = source.data.copy()
    piece.name = name
    piece.data.name = f"{name}_mesh"
    source.users_collection[0].objects.link(piece)

    keep = set(keep_indices)
    bm = bmesh.new()
    bm.from_mesh(piece.data)
    bm.verts.ensure_lookup_table()
    remove = [vertex for vertex in bm.verts if vertex.index not in keep]
    bmesh.ops.delete(bm, geom=remove, context="VERTS")
    bm.to_mesh(piece.data)
    bm.free()
    piece.data.update()
    return piece


def create_pieces(source, assignments):
    pieces = {semantic: copy_piece(source, semantic.replace(".", "_"), indices) for semantic, indices in assignments.items()}
    source_data = source.data
    bpy.data.objects.remove(source, do_unlink=True)
    if source_data.users == 0:
        bpy.data.meshes.remove(source_data)
    return pieces


def create_armature(rig_points):
    armature_data = bpy.data.armatures.new("RobotRig")
    armature = bpy.data.objects.new("RobotRig", armature_data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    root = armature_data.edit_bones.new("root")
    root.head = rig_points["root"]
    root.tail = rig_points["root"] + Vector((0, 0, 0.08))

    for leg_key, points in rig_points["legs"].items():
        previous = root
        for name, start_name, end_name in (
            ("upper", "hip", "knee"),
            ("lower", "knee", "ankle"),
            ("foot", "ankle", "foot"),
        ):
            bone = armature_data.edit_bones.new(f"{leg_key}_{name}")
            bone.head = points[start_name]
            bone.tail = points[end_name]
            bone.parent = previous
            bone.use_connect = name != "upper"
            bone.align_roll(Vector((0, 1, 0)))
            previous = bone

    bpy.ops.object.mode_set(mode="OBJECT")
    armature.show_in_front = True
    return armature


def parent_keep_world(obj, parent, bone_name=None):
    world = obj.matrix_world.copy()
    obj.parent = parent
    if bone_name:
        obj.parent_type = "BONE"
        obj.parent_bone = bone_name
    obj.matrix_world = world


def build_hierarchy(armature, pieces):
    parent_keep_world(pieces["body"], armature)
    pieces["body"].name = "chassis"
    for leg_key in LEG_KEYS:
        for segment in SEGMENTS:
            semantic = f"{leg_key}.{segment}"
            bone_name = f"{leg_key}_{segment}"
            parent_keep_world(pieces[semantic], armature, bone_name)
            pieces[semantic].name = bone_name


def action_fcurves(action):
    if hasattr(action, "fcurves"):
        return action.fcurves
    strip = action.layers[0].strips[0]
    return strip.channelbag(action.slots[0]).fcurves


def animate_walk(armature):
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 33
    scene.render.fps = 32
    action = bpy.data.actions.new("Robot_Walk")
    armature.animation_data_create()
    armature.animation_data.action = action

    phases = {
        "frontLeft": 0.0,
        "rearRight": 0.0,
        "frontRight": math.pi,
        "rearLeft": math.pi,
    }
    for frame in range(1, 34, 4):
        progress = (frame - 1) / 32.0
        for leg_key, offset in phases.items():
            phase = progress * math.tau + offset
            swing = math.sin(phase)
            lift = max(0.0, swing)
            upper = math.radians(22.0) * swing
            lower = math.radians(-(8.0 + 55.0 * lift))
            values = {
                "upper": upper,
                "lower": lower,
                "foot": -0.72 * (upper + lower),
            }
            for segment, rotation in values.items():
                pose_bone = armature.pose.bones[f"{leg_key}_{segment}"]
                pose_bone.rotation_mode = "XYZ"
                pose_bone.rotation_euler = (0.0, 0.0, rotation)
                pose_bone.keyframe_insert("rotation_euler", frame=frame, group=leg_key)

    for curve in action_fcurves(action):
        for keyframe in curve.keyframe_points:
            keyframe.interpolation = "LINEAR"
    scene.frame_set(1)
    return action


def export_glb(path, armature, pieces):
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for piece in pieces.values():
        piece.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_skins=True,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
    )


def world_bounds(objects):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points = []
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        points.extend(evaluated.matrix_world @ vertex.co for vertex in mesh.vertices)
        evaluated.to_mesh_clear()
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum


def render_preview(preview_path, pieces):
    scene = bpy.context.scene
    scene.frame_set(1)
    minimum, maximum = world_bounds(pieces.values())
    center = (minimum + maximum) * 0.5
    size = maximum - minimum
    radius = max(size) * 0.5

    bpy.ops.mesh.primitive_plane_add(size=max(size.x, size.y) * 4, location=(center.x, center.y, minimum.z - 0.002))
    ground = bpy.context.object
    material = bpy.data.materials.new("PreviewGround")
    material.diffuse_color = (0.045, 0.035, 0.025, 1)
    material.roughness = 0.95
    ground.data.materials.append(material)

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(size) * 1.5
    camera.location = center + Vector((-2.4, -3.2, 1.8)).normalized() * radius * 5
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera

    bpy.ops.object.light_add(type="AREA", location=center + Vector((radius * 2.5, -radius * 2, radius * 4)))
    bpy.context.object.data.energy = 900
    bpy.context.object.data.size = radius * 4
    bpy.ops.object.light_add(type="AREA", location=center + Vector((-radius * 3, radius * 1.5, radius * 2)))
    bpy.context.object.data.energy = 450
    bpy.context.object.data.size = radius * 3

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world = scene.world or bpy.data.worlds.new("PreviewWorld")
    scene.world.color = (0.008, 0.006, 0.004)
    frames_dir = preview_path.parent / f"{preview_path.stem}-frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(frames_dir / "frame_")
    bpy.ops.render.render(animation=True)
    print(f"PREVIEW_FRAMES: {frames_dir}")


def main():
    args = parse_args()
    paths = {name: Path(getattr(args, name)).resolve() for name in ("input", "rig", "output", "blend", "report", "preview")}
    for name in ("output", "blend", "report", "preview"):
        paths[name].parent.mkdir(parents=True, exist_ok=True)

    rig_data, rig_points = load_rig(paths["rig"])
    source = import_mesh(paths["input"])
    assignments, components = classify_components(source, rig_points)
    pieces = create_pieces(source, assignments)
    armature = create_armature(rig_points)
    build_hierarchy(armature, pieces)
    action = animate_walk(armature)
    export_glb(paths["output"], armature, pieces)
    bpy.ops.wm.save_as_mainfile(filepath=str(paths["blend"]), check_existing=False)

    report = {
        "input": str(paths["input"]),
        "rig": str(paths["rig"]),
        "output": str(paths["output"]),
        "model": rig_data.get("model"),
        "triangles": sum(len(piece.data.loop_triangles) for piece in pieces.values()),
        "pieces": {name: len(piece.data.vertices) for name, piece in sorted(pieces.items())},
        "action": action.name,
        "frames": [1, 33],
        "components": components,
    }
    paths["report"].write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "components"}, indent=2))
    render_preview(paths["preview"], pieces)


if __name__ == "__main__":
    main()
