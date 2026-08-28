#!/usr/bin/env python3
"""Retarget the Creoplan robot-dog walk onto the rigid Dune77 quadruped rig."""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).parent))
from build_rigid_quadruped import action_fcurves, render_preview  # noqa: E402


SOURCE_LEGS = {
    "frontRight": ("Object_14", ("Joint_1_00", "Joint_2_01")),
    "rearRight": ("Object_23", ("Joint_1_2_03", "Joint_2_2_04")),
    "rearLeft": ("Object_32", ("Joint_1_3_07", "Joint_2_3_08")),
    "frontLeft": ("Object_41", ("Joint_2_4_010", "Joint_3_4_011")),
}
SOURCE_TO_TARGET = Matrix(((0, 1, 0), (-1, 0, 0), (0, 0, 1)))


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--blend", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--preview", required=True)
    parser.add_argument("--cycle-start", type=float, default=0.0)
    parser.add_argument("--cycle-end", type=float, default=21.6)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def set_frame(value):
    frame = math.floor(value)
    bpy.context.scene.frame_set(frame, subframe=value - frame)


def projected_direction(armature, bone_name, body_inverse):
    bone = armature.pose.bones[bone_name]
    head = body_inverse @ (armature.matrix_world @ bone.head)
    tail = body_inverse @ (armature.matrix_world @ bone.tail)
    direction = tail - head
    direction.x = 0.0
    return direction.normalized()


def signed_angle(first, second, axis):
    return math.atan2(axis.dot(first.cross(second)), first.dot(second))


def wrap_angle(value):
    return (value + math.pi) % math.tau - math.pi


def circular_mean(values):
    return math.atan2(sum(math.sin(value) for value in values), sum(math.cos(value) for value in values))


def quaternion_mean(values):
    reference = values[0]
    total = Vector((0, 0, 0, 0))
    for value in values:
        if reference.dot(value) < 0:
            value = -value
        total += Vector(value)
    return Quaternion(total.normalized())


def source_body_length(body):
    mesh = bpy.data.objects["SPOT_BODY__0"]
    inverse = body.matrix_world.inverted()
    points = [inverse @ (mesh.matrix_world @ vertex.co) for vertex in mesh.data.vertices]
    return max(point.y for point in points) - min(point.y for point in points)


def target_body_length(meshes):
    chassis = next(mesh for mesh in meshes if mesh.name == "chassis")
    points = [chassis.matrix_world @ vertex.co for vertex in chassis.data.vertices]
    return max(point.x for point in points) - min(point.x for point in points)


def source_pose(body, frame):
    set_frame(frame)
    body_inverse = body.matrix_world.inverted()
    pose = {}
    for leg, (armature_name, bone_names) in SOURCE_LEGS.items():
        armature = bpy.data.objects[armature_name]
        upper = projected_direction(armature, bone_names[0], body_inverse)
        lower = projected_direction(armature, bone_names[1], body_inverse)
        pose[leg] = {
            "upper": math.atan2(upper.z, upper.y),
            "knee": signed_angle(upper, lower, Vector((1, 0, 0))),
        }
    return pose


def target_rest_knees(armature):
    result = {}
    axis = Vector((0, 1, 0))
    for leg in SOURCE_LEGS:
        vectors = []
        for segment in ("upper", "lower"):
            bone = armature.data.bones[f"{leg}_{segment}"]
            vector = bone.tail_local - bone.head_local
            vector.y = 0.0
            vectors.append(vector.normalized())
        result[leg] = signed_angle(*vectors, axis)
    return result


def target_rest_uppers(armature):
    result = {}
    for leg in SOURCE_LEGS:
        bone = armature.data.bones[f"{leg}_upper"]
        vector = bone.tail_local - bone.head_local
        vector.y = 0.0
        result[leg] = math.atan2(vector.z, vector.x)
    return result


def export_target(path, armature, meshes):
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for mesh in meshes:
        mesh.select_set(True)
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


def main():
    args = parse_args()
    paths = {name: Path(getattr(args, name)).resolve() for name in ("target", "output", "blend", "report", "preview")}
    for name in ("output", "blend", "report", "preview"):
        paths[name].parent.mkdir(parents=True, exist_ok=True)

    source_objects = list(bpy.data.objects)
    body = bpy.data.objects["SPOT_BODY"]
    measurement_frames = [args.cycle_start + (args.cycle_end - args.cycle_start) * index / 128 for index in range(128)]
    measurements = [source_pose(body, frame) for frame in measurement_frames]
    source_upper_means = {
        leg: circular_mean([measurement[leg]["upper"] for measurement in measurements])
        for leg in SOURCE_LEGS
    }
    source_knee_means = {
        leg: circular_mean([measurement[leg]["knee"] for measurement in measurements])
        for leg in SOURCE_LEGS
    }
    body_transforms = [body.matrix_local.decompose()[:2] for frame in measurement_frames for _ in (set_frame(frame),)]
    body_origin = body_transforms[0][0]
    body_rotation_center = quaternion_mean([rotation for _, rotation in body_transforms])
    source_length = source_body_length(body)
    before_import = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(paths["target"]))
    imported = [obj for obj in bpy.data.objects if obj not in before_import]
    armatures = [obj for obj in imported if obj.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"Expected one target armature, found {len(armatures)}")
    target = armatures[0]
    meshes = [obj for obj in imported if obj.type == "MESH" and not obj.name.startswith("Icosphere")]
    helpers = [obj for obj in imported if obj.type == "MESH" and obj not in meshes]
    if target.animation_data:
        target.animation_data_clear()
    for bone in target.pose.bones:
        bone.matrix_basis.identity()

    rest_knees = target_rest_knees(target)
    rest_uppers = target_rest_uppers(target)
    translation_scale = target_body_length(meshes) / source_length
    target_origin = target.location.copy()
    target_rotation = target.rotation_quaternion.copy() if target.rotation_mode == "QUATERNION" else target.rotation_euler.to_quaternion()
    action = bpy.data.actions.new("Robot_Walk_Creoplan_Retarget")
    target.animation_data_create()
    target.animation_data.action = action
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 33
    scene.render.fps = 32

    ranges = {leg: {"upper": [], "lower": [], "foot": []} for leg in SOURCE_LEGS}
    for target_frame in range(1, 34):
        amount = (target_frame - 1) / 32
        pose = source_pose(body, args.cycle_start + (args.cycle_end - args.cycle_start) * amount)
        source_location, source_rotation, _ = body.matrix_local.decompose()
        mapped_location = SOURCE_TO_TARGET @ (source_location - body_origin) * translation_scale
        source_rotation_delta = body_rotation_center.inverted() @ source_rotation
        mapped_rotation = (
            SOURCE_TO_TARGET
            @ source_rotation_delta.to_matrix()
            @ SOURCE_TO_TARGET.inverted()
        ).to_quaternion()
        target.location = target_origin + mapped_location
        target.rotation_mode = "QUATERNION"
        target.rotation_quaternion = target_rotation @ mapped_rotation
        target.keyframe_insert("location", frame=target_frame, group="chassis")
        target.keyframe_insert("rotation_quaternion", frame=target_frame, group="chassis")
        for leg in SOURCE_LEGS:
            desired_upper = pose[leg]["upper"]
            if leg.startswith("front"):
                desired_upper = math.radians(-70.0) + 0.75 * wrap_angle(
                    pose[leg]["upper"] - source_upper_means[leg]
                )
                desired_upper = max(math.radians(-89.0), min(math.radians(-45.0), desired_upper))
            upper = wrap_angle(rest_uppers[leg] - desired_upper)
            desired_knee = -pose[leg]["knee"]
            if leg.startswith("front"):
                desired_knee = math.radians(-87.0) - wrap_angle(
                    pose[leg]["knee"] - source_knee_means[leg]
                )
                desired_knee = max(math.radians(-105.0), min(math.radians(-68.0), desired_knee))
                desired_knee = -desired_knee
            else:
                desired_knee = math.copysign(
                    min(math.radians(125.0), abs(desired_knee) + math.radians(18.0)),
                    desired_knee,
                )
            lower = wrap_angle(desired_knee - rest_knees[leg])
            foot = 0.0
            for segment, rotation in (("upper", upper), ("lower", lower), ("foot", foot)):
                bone = target.pose.bones[f"{leg}_{segment}"]
                bone.rotation_mode = "XYZ"
                bone.rotation_euler = (0.0, 0.0, rotation)
                bone.keyframe_insert("rotation_euler", frame=target_frame, group=leg)
                ranges[leg][segment].append(math.degrees(rotation))

    for curve in action_fcurves(action):
        for keyframe in curve.keyframe_points:
            keyframe.interpolation = "LINEAR"

    for obj in source_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    for obj in helpers:
        bpy.data.objects.remove(obj, do_unlink=True)
    for old_action in list(bpy.data.actions):
        if old_action != action:
            bpy.data.actions.remove(old_action)

    scene.frame_set(1)
    export_target(paths["output"], target, meshes)
    bpy.ops.wm.save_as_mainfile(filepath=str(paths["blend"]), check_existing=False)
    report = {
        "source": "Walking Robotic Dog by Creoplan, CC BY 4.0",
        "source_url": "https://sketchfab.com/3d-models/walking-robotic-dog-cb8157f40d39456d9f37865b4e6e7477",
        "target": str(paths["target"]),
        "output": str(paths["output"]),
        "source_cycle": [args.cycle_start, args.cycle_end],
        "target_frames": [1, 33],
        "fps": 32,
        "body_channels_copied": True,
        "body_motion": {
            "translation_scale": round(translation_scale, 8),
            "source_axis_mapping": "target(x,y,z) = source(y,-x,z)",
            "source_channels": ["translation", "rotation"],
            "target": target.name,
        },
        "mapping": {
            leg: {
                "source_armature": source[0],
                "source_bones": list(source[1]),
                "target_bones": [f"{leg}_{segment}" for segment in ("upper", "lower", "foot")],
            }
            for leg, source in SOURCE_LEGS.items()
        },
        "rotation_ranges_degrees": {
            leg: {segment: [round(min(values), 2), round(max(values), 2)] for segment, values in segments.items()}
            for leg, segments in ranges.items()
        },
    }
    paths["report"].write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    render_preview(paths["preview"], {mesh.name: mesh for mesh in meshes})


if __name__ == "__main__":
    main()
