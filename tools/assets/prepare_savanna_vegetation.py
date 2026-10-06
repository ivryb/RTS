#!/usr/bin/env python3
"""Author umbrella crowns, sage scrub, and straw tussocks from existing CC0 scans.

Requires Pillow and npx (only to pack the existing rooibos glTF). Source models and
earlier biome variants are retained. Every output is a separate savanna.glb.
"""

import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import struct
import subprocess

from PIL import Image, ImageStat

from grade_terrain_biome_vegetation import glb_chunks, image_bytes, write_glb


ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "art/workbench/terrain-composite/models"
VERSION = "savanna-vegetation-v1"
GRASS_VERSION = "savanna-tussocks-v2"
FORMATS = {5126: "f", 5125: "I", 5123: "H", 5121: "B"}
COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def accessor_layout(document, index):
    accessor = document["accessors"][index]
    view = document["bufferViews"][accessor["bufferView"]]
    fmt = "<" + FORMATS[accessor["componentType"]] * COMPONENTS[accessor["type"]]
    return accessor, fmt, view.get("byteOffset", 0) + accessor.get("byteOffset", 0), view.get("byteStride", struct.calcsize(fmt))


def read_accessor(document, binary, index):
    accessor, fmt, offset, stride = accessor_layout(document, index)
    return [struct.unpack_from(fmt, binary, offset + row * stride) for row in range(accessor["count"])]


def write_accessor(document, binary, index, rows):
    accessor, fmt, offset, stride = accessor_layout(document, index)
    for row, values in enumerate(rows):
        struct.pack_into(fmt, binary, offset + row * stride, *values)
    if accessor["type"] == "VEC3":
        accessor["min"] = [min(values[axis] for values in rows) for axis in range(3)]
        accessor["max"] = [max(values[axis] for values in rows) for axis in range(3)]


def normalized(vector):
    length = math.sqrt(sum(value * value for value in vector))
    return tuple(value / length for value in vector)


def crown_transform(position, normal):
    x, y, z = position
    # Keep the rooted trunk, then gradually fan the existing asymmetric branches.
    phase = max(0, min(1, (y - 1.35) / 1.8))
    spread = phase * phase * (3 - 2 * phase)
    derivative = 6 * phase * (1 - phase) / 1.8 if 0 < phase < 1 else 0
    sx, sz = 1 + 0.55 * spread, 1 + 0.15 * spread
    dx, dz = 0.55 * derivative * x, 0.15 * derivative * z
    # A smooth shoulder avoids a visible kink where the open trunk meets crown.
    transition = max(0, min(1, (y - 1.7) / 0.5))
    if y <= 1.7:
        height, dy = y * 1.08, 1.08
    elif y < 2.2:
        integral = transition ** 3 - 0.5 * transition ** 4
        height = 1.7 * 1.08 + 0.5 * (1.08 * transition - 0.65 * integral)
        dy = 1.08 - 0.65 * transition * transition * (3 - 2 * transition)
    else:
        height = 1.7 * 1.08 + 0.5 * (1.08 - 0.325) + (y - 2.2) * 0.43
        dy = 0.43
    nx, ny, nz = normal
    # Inverse-transpose of the deformation Jacobian, preserving scanned shading.
    corrected = normalized((nx / sx, (ny - dx * nx / sx - dz * nz / sz) / dy, nz / sz))
    return (x * sx, height, z * sz), corrected


def shape_tree(document, binary):
    for mesh in document["meshes"]:
        for primitive in mesh["primitives"]:
            attributes = primitive["attributes"]
            points = read_accessor(document, binary, attributes["POSITION"])
            normals = read_accessor(document, binary, attributes["NORMAL"])
            transformed = [crown_transform(point, normal) for point, normal in zip(points, normals)]
            write_accessor(document, binary, attributes["POSITION"], [point for point, _ in transformed])
            write_accessor(document, binary, attributes["NORMAL"], [normal for _, normal in transformed])
    document["nodes"][0]["name"] = "savanna_umbrella_tree"


def grade_image(image, target, contrast=0.8, chroma=0.2):
    rgba = image.convert("RGBA")
    source_mean = ImageStat.Stat(rgba.convert("RGB"), rgba.getchannel("A")).mean
    weights = (0.2126, 0.7152, 0.0722)
    mean_luminance = sum(value * weight for value, weight in zip(source_mean, weights))
    matrix = []
    for channel in range(3):
        matrix.extend((contrast - chroma) * weights[index] + (chroma if index == channel else 0) for index in range(3))
        matrix.append(target[channel] - contrast * mean_luminance - chroma * (source_mean[channel] - mean_luminance))
    result = rgba.convert("RGB").convert("RGB", tuple(matrix)).convert("RGBA")
    result.putalpha(rgba.getchannel("A"))
    return result


def grade_material(document, binary, material, target, destination, alpha=None, sage_leaf_region=False):
    texture_info = material["pbrMetallicRoughness"]["baseColorTexture"]
    texture = document["textures"][texture_info["index"]]
    image_index = texture["source"]
    source = Image.open(io.BytesIO(image_bytes(document, binary, image_index))).convert("RGBA")
    if alpha is not None:
        source.putalpha(alpha.resize(source.size, Image.Resampling.LANCZOS))
    result = grade_image(source, target)
    if sage_leaf_region:
        # The photographed leaf sprays occupy the atlas's upper-left quarter;
        # twig cards and woody surfaces occupy the remaining authored regions.
        leaf_grade = grade_image(source, [132, 136, 111])
        leaf_box = (0, 0, round(source.width * 0.646), round(source.height * 0.25))
        result.paste(leaf_grade.crop(leaf_box), (0, 0))
    assert source.getchannel("A").tobytes() == result.getchannel("A").tobytes()
    path = destination / f"{material['name']}-savanna.png"
    result.save(path, optimize=True)
    encoded = path.read_bytes()
    binary.extend(b"\x00" * (-len(binary) % 4))
    document["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(encoded)})
    # Several rooibos materials share an atlas; each receives its own grade while
    # every other material continues to read the unchanged original source map.
    document["images"].append({**document["images"][image_index], "bufferView": len(document["bufferViews"]) - 1, "mimeType": "image/png"})
    document["textures"].append({**texture, "source": len(document["images"]) - 1})
    texture_info["index"] = len(document["textures"]) - 1
    binary.extend(encoded)
    return {"material": material["name"], "targetMeanSRGB": target, "baseMap": str(path.relative_to(ROOT)), "alphaPreserved": True}


def add_accessor(document, binary, rows, kind, component_type=5126):
    binary.extend(b"\x00" * (-len(binary) % 4))
    start = len(binary)
    fmt = "<" + FORMATS[component_type] * COMPONENTS[kind]
    for row in rows:
        binary.extend(struct.pack(fmt, *row))
    document["bufferViews"].append({"buffer": 0, "byteOffset": start, "byteLength": len(binary) - start})
    accessor = {"bufferView": len(document["bufferViews"]) - 1, "componentType": component_type, "count": len(rows), "type": kind}
    if kind == "VEC3":
        accessor.update(min=[min(row[axis] for row in rows) for axis in range(3)], max=[max(row[axis] for row in rows) for axis in range(3)])
    document["accessors"].append(accessor)
    return len(document["accessors"]) - 1


def broaden_grass_blades(specimen, width_scale=1.85):
    """Widen each scanned blade around its curved centerline, keeping its UVs."""
    points, uv = specimen["positions"], specimen["uv"]
    triangles = [tuple(row[0] for row in specimen["indices"][index:index + 3]) for index in range(0, len(specimen["indices"]), 3)]
    parents = list(range(len(points)))

    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    for a, b, c in triangles:
        parents[root(b)] = root(a)
        parents[root(c)] = root(a)
    islands, edges = {}, {}
    for index in range(len(points)):
        islands.setdefault(root(index), []).append(index)
    for triangle in triangles:
        blade_edges = edges.setdefault(root(triangle[0]), set())
        for a, b in zip(triangle, triangle[1:] + triangle[:1]):
            blade_edges.add(tuple(sorted((a, b))))

    broadened = list(points)
    for blade, vertices in islands.items():
        spans = [max(uv[index][axis] for index in vertices) - min(uv[index][axis] for index in vertices) for axis in range(2)]
        length_axis = 0 if spans[0] > spans[1] else 1
        width_axis = 1 - length_axis
        for index in vertices:
            section, at = [], uv[index][length_axis]
            for a, b in edges[blade]:
                start, end = uv[a][length_axis], uv[b][length_axis]
                if abs(end - start) < 1e-8:
                    if abs(at - start) < 1e-7:
                        section.extend((uv[i][width_axis], points[i]) for i in (a, b))
                elif min(start, end) - 1e-7 <= at <= max(start, end) + 1e-7:
                    t = max(0, min(1, (at - start) / (end - start)))
                    cross_point = tuple(points[a][axis] * (1 - t) + points[b][axis] * t for axis in range(3))
                    section.append((uv[a][width_axis] * (1 - t) + uv[b][width_axis] * t, cross_point))
            if not section:
                continue
            left, right = min(section, key=lambda row: row[0])[1], max(section, key=lambda row: row[0])[1]
            center = tuple((a + b) * 0.5 for a, b in zip(left, right))
            broadened[index] = tuple(mid + (value - mid) * width_scale for value, mid in zip(points[index], center))

    # Recalculate smooth normals after changing the blade cross-sections. The
    # photographed normal map still contributes its original surface detail.
    normals = [[0.0, 0.0, 0.0] for _ in broadened]
    for a, b, c in triangles:
        ab = [broadened[b][axis] - broadened[a][axis] for axis in range(3)]
        ac = [broadened[c][axis] - broadened[a][axis] for axis in range(3)]
        cross = (ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0])
        for index in (a, b, c):
            for axis in range(3):
                normals[index][axis] += cross[axis]
    specimen["positions"] = broadened
    specimen["normals"] = [normalized(normal) if sum(value * value for value in normal) > 1e-20 else specimen["normals"][index] for index, normal in enumerate(normals)]


def assemble_grass(document, binary):
    source_meshes = document["meshes"]
    specimens = []
    for mesh in source_meshes:
        primitive = mesh["primitives"][0]
        specimens.append({"positions": read_accessor(document, binary, primitive["attributes"]["POSITION"]), "normals": read_accessor(document, binary, primitive["attributes"]["NORMAL"]), "uv": read_accessor(document, binary, primitive["attributes"]["TEXCOORD_0"]), "indices": read_accessor(document, binary, primitive["indices"])})
        broaden_grass_blades(specimens[-1])
    meshes, nodes = [], []
    for variant, count in enumerate((5, 7, 6)):
        positions, normals, uv, indices = [], [], [], []
        for index in range(count):
            specimen = specimens[(index + variant * 2) % len(specimens)]
            angle = index * 2.39996323 + variant * 0.6
            cosine, sine = math.cos(angle), math.sin(angle)
            low = min(row[1] for row in specimen["positions"])
            height = max(row[1] for row in specimen["positions"]) - low
            # Lower outer fans overlap the upright middle to give each tussock
            # a substantial base without adding geometry or new texture cards.
            scale = (0.20 + 0.08 * ((index * 3 + variant) % 4) / 3) / height
            radius = 0.018 + 0.012 * (index % 3)
            offset = len(positions)
            for x, y, z in specimen["positions"]:
                positions.append((scale * (x * cosine + z * sine) + radius * cosine, (y - low) * scale, scale * (-x * sine + z * cosine) + radius * sine))
            normals.extend((x * cosine + z * sine, y, -x * sine + z * cosine) for x, y, z in specimen["normals"])
            uv.extend(specimen["uv"])
            indices.extend((row[0] + offset,) for row in specimen["indices"])
        attributes = {"POSITION": add_accessor(document, binary, positions, "VEC3"), "NORMAL": add_accessor(document, binary, normals, "VEC3"), "TEXCOORD_0": add_accessor(document, binary, uv, "VEC2")}
        name = "savanna_tussock_" + chr(97 + variant)
        meshes.append({"name": name, "primitives": [{"attributes": attributes, "indices": add_accessor(document, binary, indices, "SCALAR", 5125), "material": 0}]})
        nodes.append({"name": name, "mesh": variant})
    document.update(meshes=meshes, nodes=nodes, scenes=[{"nodes": list(range(len(nodes)))}], scene=0)


def merge_rooibos_parts(document, binary):
    # Twig, leaf and stem primitives use the same authored atlas and PBR maps.
    # A specimen must remain one selectable/instanced mesh in the terrain loader.
    for index, mesh in enumerate(document["meshes"]):
        positions, normals, uv, indices = [], [], [], []
        for primitive in mesh["primitives"]:
            attributes = primitive["attributes"]
            offset = len(positions)
            positions.extend(read_accessor(document, binary, attributes["POSITION"]))
            normals.extend(read_accessor(document, binary, attributes["NORMAL"]))
            uv.extend(read_accessor(document, binary, attributes["TEXCOORD_0"]))
            indices.extend((row[0] + offset,) for row in read_accessor(document, binary, primitive["indices"]))
        attributes = {"POSITION": add_accessor(document, binary, positions, "VEC3"), "NORMAL": add_accessor(document, binary, normals, "VEC3"), "TEXCOORD_0": add_accessor(document, binary, uv, "VEC2")}
        mesh.update(name="savanna_rooibos_" + chr(97 + index), primitives=[{"attributes": attributes, "indices": add_accessor(document, binary, indices, "SCALAR", 5125), "material": 0}])
    document["materials"] = [document["materials"][0]]
    document["materials"][0].update(name="savanna_rooibos", alphaMode="MASK", alphaCutoff=0.4)


def mesh_summary(document):
    result = []
    for mesh in document["meshes"]:
        positions = [document["accessors"][primitive["attributes"]["POSITION"]] for primitive in mesh["primitives"]]
        result.append({"name": mesh["name"], "triangles": sum(document["accessors"][primitive["indices"]]["count"] // 3 for primitive in mesh["primitives"]), "bounds": {"min": [min(accessor["min"][axis] for accessor in positions) for axis in range(3)], "max": [max(accessor["max"][axis] for accessor in positions) for axis in range(3)]}})
    return result


def prepare(asset):
    directory = MODELS / asset
    destination = directory / "savanna-source"
    destination.mkdir(parents=True, exist_ok=True)
    if asset == "wild_rooibos_bush":
        source_path = ROOT / "art/workbench/terrain-directions/models/wild_rooibos_bush/model.gltf"
        packed = destination / "packed-original.glb"
        subprocess.run(["npx", "--yes", "@gltf-transform/cli@4.2.1", "copy", str(source_path), str(packed)], check=True)
        source = packed.read_bytes()
    else:
        source_path = directory / "model.glb"
        source = source_path.read_bytes()
    document, original_binary = glb_chunks(source)
    binary = bytearray(original_binary)
    edits = []
    if asset == "tree_small_02":
        shape_tree(document, binary)
        for material in document["materials"]:
            if "leaves" in material["name"]:
                edits.append(grade_material(document, binary, material, [108, 113, 80], destination))
        treatment = "Asymmetric scanned crown spread and flattened above the rooted trunk. All original triangles retained; normals transformed by the exact inverse-transpose deformation Jacobian."
    elif asset == "grass_medium_02":
        assemble_grass(document, binary)
        edits.append(grade_material(document, binary, document["materials"][0], [183, 151, 91], destination))
        document["materials"][0]["alphaCutoff"] = 0.3
        treatment = "Three root-centered golden-straw tussocks assembled from five, seven, and six source scan tufts. Each existing curved blade widened 1.85x across its UV cross-sections, retaining its irregular arc and photographed silhouette; smooth normals recomputed. Tufts overlap around a tighter, fuller base. Original triangle count, UVs, alpha pixels, normal and roughness maps preserved. Alpha cutoff 0.30 retains more narrow blade coverage at small mip levels."
    elif asset == "wild_rooibos_bush":
        alpha = Image.open(source_path.parent / "textures/alpha.png").convert("L")
        merge_rooibos_parts(document, binary)
        edits.append(grade_material(document, binary, document["materials"][0], [126, 115, 89], destination, alpha, sage_leaf_region=True))
        for node in document["nodes"]:
            node.pop("translation", None)
        treatment = "Existing desert bush scan, five separate root-centered single-material specimens. Original alpha restored for twig and leaf silhouettes; authored atlas leaf region graded sage with warm dry wood. Source geometry retained."
    else:
        edits.append(grade_material(document, binary, document["materials"][0], [130, 134, 110], destination))
        treatment = "Pale dusty-sage herb accents. Original specimen geometry and alpha preserved."
    output = directory / "savanna.glb"
    write_glb(output, document, bytes(binary))
    for mesh in document["meshes"]:
        for primitive in mesh["primitives"]:
            for normal in read_accessor(document, binary, primitive["attributes"]["NORMAL"]):
                assert all(math.isfinite(value) for value in normal)
                assert abs(sum(value * value for value in normal) - 1) < 0.01
    record = {"id": asset, "version": GRASS_VERSION if asset == "grass_medium_02" else VERSION, "source": f"https://polyhaven.com/a/{asset}", "license": "CC0-1.0", "input": str(source_path.relative_to(ROOT)), "inputSHA256": hashlib.sha256(source_path.read_bytes()).hexdigest(), "output": str(output.relative_to(ROOT)), "outputSHA256": hashlib.sha256(output.read_bytes()).hexdigest(), "outputBytes": output.stat().st_size, "treatment": treatment, "meshes": mesh_summary(document), "textureEdits": edits}
    (directory / "savanna-source-ledger.json").write_text(json.dumps(record, indent=2) + "\n")
    print(f"Prepared {asset}: {sum(mesh['triangles'] for mesh in record['meshes']):,} triangles, {output.stat().st_size / 1e6:.2f} MB", flush=True)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--grass-only", action="store_true", help="Rebuild tussocks while retaining all other prepared assets")
    args = parser.parse_args()
    if args.grass_only:
        assets = json.loads((MODELS / "savanna-vegetation-sources.json").read_text())["assets"]
        grass = prepare("grass_medium_02")
        assets = [grass if asset["id"] == "grass_medium_02" else asset for asset in assets]
    else:
        assets = [prepare(asset) for asset in ("tree_small_02", "shrub_04", "grass_medium_02", "wild_rooibos_bush")]
    ledger = {"version": VERSION, "recipe": "python3 tools/assets/prepare_savanna_vegetation.py", "assets": assets}
    (ROOT / "tools/assets/savanna_vegetation.sources.json").write_text(json.dumps(ledger, indent=2) + "\n")
    (MODELS / "savanna-vegetation-sources.json").write_text(json.dumps(ledger, indent=2) + "\n")


if __name__ == "__main__":
    main()
