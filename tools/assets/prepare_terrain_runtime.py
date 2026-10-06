#!/usr/bin/env python3
"""Build separate gameplay terrain assets, preserving approved source GLBs.

Run with Python + Pillow; Blender is used only for offline mesh simplification.
The side-by-side inspection renders compare identical source/runtime transforms.
"""

import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import shutil
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "art/workbench/terrain-composite/models"
OUTPUT = MODELS / "runtime"
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
ASSETS = {
    "tree": ("tree_small_02/savanna.glb", None, 1024),
    "grass": ("grass_medium_02/savanna.glb", 0.07, 512),
    "aloe": ("quiver_tree_02/biome.glb", 0.10, 1024),
    "sage": ("shrub_04/savanna.glb", 0.14, 512),
    "rooibos": ("wild_rooibos_bush/savanna.glb", 0.10, 512),
    "pebbles": ("oxide-pebbles.glb", None, 512),
    "talus": ("oxide-talus.glb", None, 1024),
}
TREE_LEAF_ROUGHNESS = {"version": "dusty-leaves-v1", "minimum": 0.74, "sourceRange": 0.24}


def read_glb(path):
    blob = path.read_bytes()
    length = struct.unpack_from("<I", blob, 12)[0]
    return json.loads(blob[20:20 + length]), blob[28 + length:]


def summary(path):
    document, _ = read_glb(path)
    return {
        "path": str(path.relative_to(ROOT)),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "bytes": path.stat().st_size,
        "meshes": [{"name": mesh.get("name"), "triangles": sum(document["accessors"][part["indices"]]["count"] // 3 for part in mesh["primitives"])} for mesh in document["meshes"]],
    }


def tree_leaf_roughness_view(document):
    for material in document["materials"]:
        if material["name"] == "tree_small_02_leaves":
            texture = document["textures"][material["pbrMetallicRoughness"]["metallicRoughnessTexture"]["index"]]
            image = texture.get("source", texture.get("extensions", {}).get("EXT_texture_webp", {}).get("source"))
            return document["images"][image]["bufferView"]
    return None


def dusty_leaf_roughness(image):
    # Scanned waxy leaves gave the dry grove silver highlights. Retain their
    # roughness variation, with a matte floor, without recoloring the foliage.
    channels = list(image.split())
    channels[1] = channels[1].point(lambda value: round(255 * TREE_LEAF_ROUGHNESS["minimum"] + value * TREE_LEAF_ROUGHNESS["sourceRange"]))
    from PIL import Image
    return Image.merge(image.mode, channels)


def prepare_tree_material(source, output):
    """Regrade a preserved runtime tree without rebuilding or recompressing it."""
    from PIL import Image
    from grade_terrain_biome_vegetation import write_glb

    document, original = read_glb(source)
    leaf_view = tree_leaf_roughness_view(document)
    if leaf_view is None:
        raise ValueError("Source has no tree leaf roughness material")
    if document.get("asset", {}).get("extras", {}).get("dune77TreeLeafRoughness"):
        raise ValueError("Use the preserved ungraded tree as source; do not compound the roughness remap")
    binary = bytearray()
    for index, view in enumerate(document["bufferViews"]):
        start = view.get("byteOffset", 0)
        data = original[start:start + view["byteLength"]]
        if index == leaf_view:
            image = dusty_leaf_roughness(Image.open(io.BytesIO(data)))
            encoded = io.BytesIO()
            image.save(encoded, format="WEBP", lossless=True, method=6)
            data = encoded.getvalue()
        binary.extend(b"\x00" * (-len(binary) % 4))
        view.update(byteOffset=len(binary), byteLength=len(data))
        binary.extend(data)
    document["asset"].setdefault("extras", {})["dune77TreeLeafRoughness"] = TREE_LEAF_ROUGHNESS
    write_glb(output, document, bytes(binary))


def pack_textures(path, size):
    from PIL import Image
    from grade_terrain_biome_vegetation import write_glb

    document, original = read_glb(path)
    images = {image["bufferView"]: image for image in document["images"]}
    leaf_view = tree_leaf_roughness_view(document)
    binary = bytearray()
    texture_sizes = []
    for index, view in enumerate(document["bufferViews"]):
        start = view.get("byteOffset", 0)
        data = original[start:start + view["byteLength"]]
        if index in images:
            image = Image.open(io.BytesIO(data))
            image.thumbnail((size, size), Image.Resampling.LANCZOS)
            if index == leaf_view:
                image = dusty_leaf_roughness(image)
            encoded = io.BytesIO()
            image.save(encoded, format="WEBP", quality=85, lossless=index == leaf_view, method=6)
            data = encoded.getvalue()
            images[index]["mimeType"] = "image/webp"
            texture_sizes.append(list(image.size))
        binary.extend(b"\x00" * (-len(binary) % 4))
        view.update(byteOffset=len(binary), byteLength=len(data))
        binary.extend(data)
    for texture in document["textures"]:
        texture.setdefault("extensions", {})["EXT_texture_webp"] = {"source": texture.pop("source")}
    for key in ("extensionsUsed", "extensionsRequired"):
        document.setdefault(key, []).append("EXT_texture_webp")
    if leaf_view is not None:
        document["asset"].setdefault("extras", {})["dune77TreeLeafRoughness"] = TREE_LEAF_ROUGHNESS
    write_glb(path, document, bytes(binary))
    return texture_sizes


def simplify_tree(obj):
    """Reduce each scanned leaf separately, retaining every foliage island."""
    import bpy
    import numpy as np

    mesh = obj.data
    parents = list(range(len(mesh.vertices)))

    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    leaf_materials = {index for index, material in enumerate(mesh.materials) if "leaves" in material.name}
    leaves = [face for face in mesh.polygons if face.material_index in leaf_materials]
    shared_positions = {}
    for face in leaves:
        for index in face.vertices:
            key = tuple(round(value, 6) for value in mesh.vertices[index].co)
            if key in shared_positions:
                parents[root(index)] = root(shared_positions[key])
            else:
                shared_positions[key] = index
        for index in face.vertices[1:]:
            parents[root(index)] = root(face.vertices[0])
    islands = {}
    for face in leaves:
        islands.setdefault(root(face.vertices[0]), []).append(face)
    vertices, faces, face_uvs, materials = [], [], [], []

    def add_face(points, uvs, material):
        start = len(vertices)
        vertices.extend(points)
        faces.append(tuple(range(start, len(vertices))))
        face_uvs.append(uvs)
        materials.append(material)

    def preserve(face):
        add_face([tuple(mesh.vertices[index].co) for index in face.vertices],
            [tuple(mesh.uv_layers.active.data[index].uv) for index in face.loop_indices], face.material_index)

    replaced = 0
    for group in islands.values():
        if len(group) < 6:
            for face in group:
                preserve(face)
            continue
        points = np.array([tuple(mesh.vertices[index].co) for face in group for index in face.vertices])
        uvs = np.array([tuple(mesh.uv_layers.active.data[index].uv) for face in group for index in face.loop_indices])
        centered = points - np.mean(points, axis=0)
        _, axes = np.linalg.eigh(centered.T @ centered)
        projected = centered @ axes[:, 1:]
        ordered = sorted(set((float(point[0]), float(point[1]), index) for index, point in enumerate(projected)))

        def cross(a, b, c):
            return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

        lower, upper = [], []
        for point in ordered:
            while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
                lower.pop()
            lower.append(point)
        for point in reversed(ordered):
            while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
                upper.pop()
            upper.append(point)
        hull = lower[:-1] + upper[:-1]
        while len(hull) > 6:
            remove = min(range(len(hull)), key=lambda index: abs(cross(hull[index - 1], hull[index], hull[(index + 1) % len(hull)])))
            hull.pop(remove)
        positions = [tuple(points[point[2]]) for point in hull]
        corners = [tuple(uvs[point[2]]) for point in hull]
        if len(positions) < 3:
            for face in group:
                preserve(face)
            continue
        first = group[0]
        a, b, c = (np.array(mesh.vertices[index].co) for index in first.vertices[:3])
        normal = np.cross(b - a, c - a)
        normal_new = np.cross(np.array(positions[1]) - positions[0], np.array(positions[2]) - positions[0])
        if np.dot(normal, normal_new) < 0:
            positions.reverse()
            corners.reverse()
        add_face(positions, corners, first.material_index)
        replaced += len(group) - (len(hull) - 2)
    for face in mesh.polygons:
        if face.material_index not in leaf_materials:
            preserve(face)
    result = bpy.data.meshes.new("Scanned crown with preserved leaf silhouettes")
    result.from_pydata(vertices, [], faces)
    for material in mesh.materials:
        result.materials.append(material)
    uv = result.uv_layers.new(name="UVMap")
    for face, values, material in zip(result.polygons, face_uvs, materials):
        face.material_index = material
        face.use_smooth = material not in leaf_materials
        for index, value in zip(face.loop_indices, values):
            uv.data[index].uv = value
    obj.data = result
    print(f"Tree leaf reduction removed {replaced:,} triangles; all {len(islands):,} foliage islands retained", flush=True)


def weld_seams(obj):
    """Rejoin exported UV-seam vertices before collapsing the continuous surface."""
    import bmesh

    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    extent = max(obj.dimensions)
    bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=extent * 0.000001)
    mesh.to_mesh(obj.data)
    mesh.free()


def simplify_asset(asset, compare=False):
    import bpy
    from mathutils import Vector

    source, ratio, _ = ASSETS[asset]
    if asset in ("pebbles", "talus") and not compare:
        # The border-aware simplifier runs after texture packing, outside Blender.
        shutil.copyfile(MODELS / source, OUTPUT / f"{asset}.glb")
        return
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(MODELS / source))
    originals = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    # Retain a duplicate for the comparison render before any destructive modifier.
    references = []
    for obj in originals:
        reference = obj.copy()
        reference.data = obj.data.copy()
        bpy.context.collection.objects.link(reference)
        reference.hide_render = True
        references.append(reference)
    if compare:
        for obj in originals:
            bpy.data.objects.remove(obj, do_unlink=True)
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(OUTPUT / f"{asset}.glb"))
        originals = [obj for obj in bpy.context.scene.objects if obj not in before and obj.type == "MESH"]
    for obj in [] if compare else originals:
        weld_seams(obj)
        if asset == "tree":
            simplify_tree(obj)
            weld_seams(obj)
            continue
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        modifier = obj.modifiers.new("Gameplay simplification", "DECIMATE")
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.data.validate(clean_customdata=False)
    if not compare:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in originals:
            obj.select_set(True)
        destination = OUTPUT / f"{asset}.glb"
        bpy.ops.export_scene.gltf(filepath=str(destination), export_format="GLB", use_selection=True,
            export_yup=True, export_animations=False, export_cameras=False, export_lights=False,
            export_materials="EXPORT", export_image_format="AUTO", export_attributes=False)
        return

    # Use the first specimen of multi-variant assets, and compare the entire tree.
    for obj in originals[1:] if asset != "tree" else []:
        obj.hide_render = True
    for obj in references:
        obj.hide_render = False
    for obj in references[1:] if asset != "tree" else []:
        obj.hide_render = True
    visible = originals if asset == "tree" else originals[:1]
    points = [obj.matrix_world @ Vector(corner) for obj in visible for corner in obj.bound_box]
    low = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    high = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    center = (low + high) / 2
    extent = max(high - low)
    for obj in originals:
        obj.location.x += extent * 0.64
    for obj in references:
        obj.location.x -= extent * 0.64
    bpy.ops.mesh.primitive_plane_add(size=extent * 20, location=(center.x, center.y, low.z - extent * 0.004))
    ground = bpy.context.object
    material = bpy.data.materials.new("Warm desert inspection ground")
    material.diffuse_color = (0.29, 0.185, 0.09, 1)
    ground.data.materials.append(material)
    bpy.ops.object.light_add(type="SUN", location=(-6, -9, 14))
    bpy.context.object.data.energy = 2.3
    bpy.context.object.data.angle = 0.05
    bpy.context.object.rotation_euler = (0.35, -0.5, -0.35)
    bpy.ops.object.camera_add(location=center + Vector((0, -extent * 2, extent * 1.7)))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = extent * 2.75
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 650
    scene.render.resolution_percentage = 100
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.7, 0.76, 0.83, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.5
    scene.view_settings.view_transform = "AgX"
    scene.render.filepath = str(OUTPUT / f"{asset}-comparison.png")
    bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", nargs="+", choices=list(ASSETS), default=list(ASSETS))
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--blender", action="store_true")
    parser.add_argument("--compare", action="store_true")
    parser.add_argument("--tree-material-source", type=Path, help="Preserved ungraded runtime tree; update only its leaf roughness, without Blender")
    parser.add_argument("--tree-material-output", type=Path, help="Destination for the material-only tree update")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else None)
    if bool(args.tree_material_source) != bool(args.tree_material_output):
        parser.error("Provide both --tree-material-source and --tree-material-output")
    if args.tree_material_source:
        source, output = args.tree_material_source.resolve(), args.tree_material_output.resolve()
        if source == output:
            parser.error("Source and output must differ; preserve the ungraded runtime tree")
        prepare_tree_material(source, output)
        ledger_path = OUTPUT / "sources.json"
        ledger = json.loads(ledger_path.read_text())
        ledger["assets"]["tree"].update(runtime=summary(output), materialTreatment={**TREE_LEAF_ROUGHNESS, "input": summary(source), "preserved": "Every geometry buffer and all other embedded images are byte-identical"})
        ledger_path.write_text(json.dumps(ledger, indent=2) + "\n")
        (ROOT / "tools/assets/terrain_runtime.sources.json").write_text(json.dumps(ledger, indent=2) + "\n")
        print(json.dumps(ledger["assets"]["tree"]["runtime"]), flush=True)
        return
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if args.blender:
        for asset in args.assets:
            simplify_asset(asset, args.compare)
        return
    command = [BLENDER, "--background", "--python-exit-code", "1", "--python", str(Path(__file__).resolve()), "--", "--blender", "--assets", *args.assets]
    subprocess.run(command, check=True)
    ledger_path = OUTPUT / "sources.json"
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {"recipe": str(Path(__file__).relative_to(ROOT)), "license": "CC0-1.0", "assets": {}}
    meshoptimizer = MODELS / ".runtime-tools/node_modules/meshoptimizer/meshopt_simplifier.module.js"
    if any(asset in ("pebbles", "talus") for asset in args.assets) and not meshoptimizer.exists():
        subprocess.run(["npm", "install", "--prefix", str(MODELS / ".runtime-tools"), "--no-save", "--no-package-lock", "--ignore-scripts", "meshoptimizer@0.24.0"], check=True)
    for asset in args.assets:
        source, ratio, size = ASSETS[asset]
        output = OUTPUT / f"{asset}.glb"
        textures = pack_textures(output, size)
        if asset in ("pebbles", "talus"):
            target = 450 if asset == "pebbles" else 1900
            subprocess.run(["node", str(Path(__file__).with_suffix(".mjs")), str(meshoptimizer), str(output), str(target)], check=True)
        treatment = "Each leaf island reduced to its six-vertex convex silhouette, preserving all crown islands, original UV samples, branches and trunk" if asset == "tree" else f"UV seam vertices rejoined before quadric surface collapse to {ratio or 1:.0%}; material UV loops retained"
        if asset in ("pebbles", "talus"):
            treatment = "Meshoptimizer 0.24.0 index-only simplification with locked open boundaries; original positions, UVs and normals retained; UV/normal error weights 0.3/0.1, maximum relative error 0.025; embedded textures resized and encoded as WebP"
        ledger["assets"][asset] = {"source": summary(MODELS / source), "runtime": summary(output), "textures": textures, "treatment": treatment}
        if asset == "tree":
            ledger["assets"][asset]["materialTreatment"] = TREE_LEAF_ROUGHNESS
        print(json.dumps(ledger["assets"][asset]), flush=True)
    ledger_path.write_text(json.dumps(ledger, indent=2) + "\n")
    (ROOT / "tools/assets/terrain_runtime.sources.json").write_text(json.dumps(ledger, indent=2) + "\n")
    if args.preview:
        subprocess.run([*command, "--compare"], check=True)


if __name__ == "__main__":
    main()
