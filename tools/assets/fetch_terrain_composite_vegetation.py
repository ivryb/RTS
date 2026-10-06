#!/usr/bin/env python3
"""Prepare CC0 vegetation for the terrain study (Python + Pillow + npx).

Keeps downloaded source geometry/maps, repairs missing glTF leaf alpha from the
author's alpha map, and makes separate runtime GLBs. Never edits production assets.
"""

import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import struct
import subprocess

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
DESTINATION = ROOT / "art/workbench/terrain-composite/models"
ASSETS = {
    "tree_small_02": {"height": [7, 11], "role": "Full broadleaf canopy for sheltered savanna groves", "ratio": 0.12, "error": 0.002},
    "quiver_tree_02": {"height": [3.5, 5.5], "role": "Sparse upright desert aloe accent", "ratio": 0.24},
    "shrub_04": {"height": [0.7, 1.5], "role": "Silvery-green shrubs in small irregular groups", "ratio": 0.5, "error": 0.001},
    "grass_medium_02": {"height": [0.35, 0.8], "role": "Dry grass tufts around vegetation pockets"},
}


def split_shrub_variants(model, source):
    """Separate the source's four specimen plants without cutting any mesh islands."""
    binary = (source / model["buffers"][0]["uri"]).read_bytes()
    primitive = model["meshes"][0]["primitives"][0]

    def read_accessor(index):
        accessor = model["accessors"][index]
        view = model["bufferViews"][accessor["bufferView"]]
        format_code = {5126: "f", 5123: "H", 5125: "I"}[accessor["componentType"]]
        count = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[accessor["type"]]
        format_code = "<" + format_code * count
        offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        stride = view.get("byteStride", struct.calcsize(format_code))
        return [struct.unpack_from(format_code, binary, offset + row * stride) for row in range(accessor["count"])]

    attributes = {name: read_accessor(index) for name, index in primitive["attributes"].items()}
    indices = [row[0] for row in read_accessor(primitive["indices"])]
    positions = attributes["POSITION"]
    parents = list(range(len(positions)))

    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    for index in range(0, len(indices), 3):
        first, second, third = indices[index:index + 3]
        parents[root(second)] = root(first)
        parents[root(third)] = root(first)
    components = {}
    for index in range(len(positions)):
        components.setdefault(root(index), []).append(index)
    anchors = [-0.51, -0.34, -0.17, 0.0]
    component_plants = {}
    for key, vertices in components.items():
        center = sum(positions[index][0] for index in vertices) / len(vertices)
        component_plants[key] = min(range(4), key=lambda index: abs(anchors[index] - center))
    groups = [[] for _ in anchors]
    for index in range(0, len(indices), 3):
        triangle = indices[index:index + 3]
        groups[component_plants[root(triangle[0])]].extend(triangle)

    output = bytearray()
    views, accessors, meshes, nodes = [], [], [], []

    def append_accessor(rows, kind, is_index=False):
        while len(output) % 4:
            output.append(0)
        start = len(output)
        code = "I" if is_index else "f"
        for row in rows:
            output.extend(struct.pack("<" + code * len(row), *row))
        views.append({"buffer": 0, "byteOffset": start, "byteLength": len(output) - start})
        accessor = {"bufferView": len(views) - 1, "componentType": 5125 if is_index else 5126, "count": len(rows), "type": kind}
        if kind == "VEC3":
            accessor["min"] = [min(row[axis] for row in rows) for axis in range(3)]
            accessor["max"] = [max(row[axis] for row in rows) for axis in range(3)]
        accessors.append(accessor)
        return len(accessors) - 1

    for index, triangles in enumerate(groups):
        used = sorted(set(triangles))
        remap = {old: new for new, old in enumerate(used)}
        new_attributes = {}
        for name, rows in attributes.items():
            selected = [rows[vertex] for vertex in used]
            if name == "POSITION":
                selected = [(row[0] - anchors[index], row[1], row[2]) for row in selected]
            kind = model["accessors"][primitive["attributes"][name]]["type"]
            new_attributes[name] = append_accessor(selected, kind)
        new_indices = append_accessor([(remap[vertex],) for vertex in triangles], "SCALAR", True)
        name = "shrub_04_" + chr(97 + index)
        meshes.append({"name": name, "primitives": [{"attributes": new_attributes, "indices": new_indices, "material": primitive["material"]}]})
        nodes.append({"mesh": index, "name": name})
    (source / "shrub-variants.bin").write_bytes(output)
    model.update(buffers=[{"uri": "shrub-variants.bin", "byteLength": len(output)}], bufferViews=views, accessors=accessors, meshes=meshes, nodes=nodes, scenes=[{"nodes": list(range(4))}], scene=0)


def fetch(url, path, md5=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and (not md5 or hashlib.md5(path.read_bytes()).hexdigest() == md5):
        return
    subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error", "--retry", "3", "--user-agent", "Mozilla/5.0", url, "--output", str(path)], check=True)
    if md5 and hashlib.md5(path.read_bytes()).hexdigest() != md5:
        raise ValueError(f"Source checksum mismatch: {path}")


def prepare(asset_id):
    settings = ASSETS[asset_id]
    directory = DESTINATION / asset_id
    source = directory / "source"
    manifest_path = source / "polyhaven-files.json"
    info_path = source / "polyhaven-info.json"
    fetch(f"https://api.polyhaven.com/files/{asset_id}", manifest_path)
    fetch(f"https://api.polyhaven.com/info/{asset_id}", info_path)
    files = json.loads(manifest_path.read_text())
    info = json.loads(info_path.read_text())
    gltf_file = files["gltf"]["1k"]["gltf"]
    fetch(gltf_file["url"], source / "original.gltf", gltf_file["md5"])
    includes = gltf_file["include"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        futures = [pool.submit(fetch, record["url"], source / path, record["md5"]) for path, record in includes.items()]
        for future in futures:
            future.result()

    model = json.loads((source / "original.gltf").read_text())
    repairs = []
    for material in model["materials"]:
        if material.get("alphaMode", "OPAQUE") == "OPAQUE":
            continue
        alpha_key = "leaves_alpha" if "leaves" in material["name"] else "Alpha"
        alpha_record = files[alpha_key]["1k"]["png"]
        alpha_path = source / "textures" / f"{alpha_key}.png"
        fetch(alpha_record["url"], alpha_path, alpha_record["md5"])
        texture_index = material["pbrMetallicRoughness"]["baseColorTexture"]["index"]
        image = model["images"][model["textures"][texture_index]["source"]]
        diffuse = Image.open(source / image["uri"]).convert("RGBA")
        alpha = Image.open(alpha_path).convert("L")
        if diffuse.size != alpha.size:
            alpha = alpha.resize(diffuse.size, Image.Resampling.LANCZOS)
        diffuse.putalpha(alpha)
        prepared_uri = str(Path(image["uri"]).with_suffix(".png"))
        diffuse.save(source / prepared_uri, optimize=True)
        image["uri"] = prepared_uri
        image["mimeType"] = "image/png"
        # The upstream JPEG glTF loses the alpha channel: repair the asset once,
        # then use alpha testing to preserve leaf silhouettes and correct shadows.
        material["alphaMode"] = "MASK"
        material["alphaCutoff"] = 0.38 if asset_id == "grass_medium_02" else 0.45
        material["doubleSided"] = True
        repairs.append({"material": material["name"], "alphaUrl": alpha_record["url"], "alphaMD5": alpha_record["md5"], "alphaCutoff": material["alphaCutoff"]})

    if asset_id == "shrub_04":
        split_shrub_variants(model, source)
    prepared = source / "alpha-repaired.gltf"
    prepared.write_text(json.dumps(model, separators=(",", ":")) + "\n")
    runtime = directory / "model.glb"
    cli = ["npx", "--yes", "@gltf-transform/cli@4.2.1"]
    if "ratio" in settings:
        subprocess.run(cli + ["simplify", str(prepared), str(runtime), "--ratio", str(settings["ratio"]), "--error", str(settings.get("error", 0.012))], check=True)
    else:
        subprocess.run(cli + ["copy", str(prepared), str(runtime)], check=True)
    runtime_json = json.loads(runtime.read_bytes()[20:20 + int.from_bytes(runtime.read_bytes()[12:16], "little")])
    triangles = sum(runtime_json["accessors"][primitive["indices"]]["count"] // 3 for mesh in runtime_json["meshes"] for primitive in mesh["primitives"])
    record = {
        "id": asset_id,
        "name": info["name"],
        "source": f"https://polyhaven.com/a/{asset_id}",
        "authors": info.get("authors", {}),
        "license": "CC0-1.0",
        "originalGLTF": gltf_file["url"],
        "originalMD5": gltf_file["md5"],
        "runtime": str(runtime.relative_to(ROOT)),
        "runtimeBytes": runtime.stat().st_size,
        "runtimeTriangles": triangles,
        "recommendedHeight": settings["height"],
        "role": settings["role"],
        "sourceFiles": includes,
        "alphaRepairs": repairs,
        "geometryTreatment": f"Separate runtime simplification, ratio {settings['ratio']}, maximum error {settings.get('error', 0.012)}; original retained" if "ratio" in settings else "Source geometry retained",
        "specimenTreatment": "Four independently root-centered variants; source mesh islands preserved" if asset_id == "shrub_04" else "Use each named grass node as an independent tuft" if asset_id == "grass_medium_02" else "Single tree",
    }
    (directory / "source-ledger.json").write_text(json.dumps(record, indent=2) + "\n")
    print(f"Prepared {asset_id}: {triangles:,} triangles; {runtime.stat().st_size / 1e6:.2f} MB", flush=True)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assets", nargs="*", metavar="ASSET", help="Specific Poly Haven IDs; defaults to all four study assets")
    args = parser.parse_args()
    selected = args.assets or list(ASSETS)
    unknown = set(selected) - ASSETS.keys()
    if unknown:
        parser.error(f"Unknown vegetation assets: {', '.join(sorted(unknown))}")
    for asset_id in selected:
        prepare(asset_id)
    records = [json.loads(path.read_text()) for path in sorted(DESTINATION.glob("*/source-ledger.json")) if path.parent.name in ASSETS]
    (DESTINATION / "vegetation-sources.json").write_text(json.dumps({"license": "CC0-1.0", "assets": records}, indent=2) + "\n")


if __name__ == "__main__":
    main()
