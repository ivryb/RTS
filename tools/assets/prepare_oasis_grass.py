#!/usr/bin/env python3
"""Build smooth grass beds with the existing photographed leaf maps; no Blender.

The existing warm 1K color/alpha and original normal maps are copied unchanged.
Run from any directory with Python and Pillow. Outputs are separate from the
older straw-tussock assets so their appearance remains available for comparison.
"""

import copy
import hashlib
import io
import json
import math
from pathlib import Path
import random

from PIL import Image, ImageFilter

from grade_terrain_biome_vegetation import glb_chunks, image_bytes, write_glb
from prepare_savanna_vegetation import add_accessor, normalized, read_accessor


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "art/workbench/terrain-composite/models/grass_medium_02/model.glb"
COLOR_SOURCE = SOURCE.with_name("savanna.glb")
OUTPUT = ROOT / "art/workbench/terrain-composite/models/runtime/oasis-grass.glb"
LEDGER = ROOT / "tools/assets/oasis_grass.sources.json"
VERSION = "oasis-grass-bed-v10"
SECTIONS = 8
BLADE_WIDTH = (0.010, 0.040)


def photo_strips(encoded):
    """Use the padded interiors of three photographed leaves, not their edges."""
    alpha = Image.open(io.BytesIO(encoded)).getchannel("A")
    strips = []
    # Pixel boxes in the unchanged 1K atlas, from leaf tip toward its base.
    for x0, x1, y0, y1 in ((915, 1005, 540, 820), (345, 425, 470, 690), (18, 125, 560, 820)):
        sections = []
        for section in range(SECTIONS):
            y = round(y1 - (y1 - y0) * section / (SECTIONS - 1))
            runs, start = [], None
            for x in range(x0, x1 + 2):
                if x <= x1 and alpha.getpixel((x, y)) >= 250:
                    if start is None:
                        start = x
                elif start is not None:
                    runs.append((start, x - 1))
                    start = None
            left, right = max(runs, key=lambda run: run[1] - run[0])
            center = (left + right) * 0.5
            half_width = (right - left) * 0.18 if section < SECTIONS - 1 else 0
            sections.append(tuple(((x + 0.5) / alpha.width, (y + 0.5) / alpha.height) for x in (center - half_width, center + half_width)))
        strips.append(sections)
    return strips


def check_photo_strips(encoded, strips):
    """Check whole UV triangles and their filter margin, not just centerlines."""
    alpha = Image.open(io.BytesIO(encoded)).getchannel("A")
    samples = []
    for sections in strips:
        for (a, b), (c, d) in zip(sections, sections[1:]):
            for triangle in ((a, b, d), (a, d, c)):
                for i in range(17):
                    for j in range(17 - i):
                        weights = (i / 16, j / 16, 1 - (i + j) / 16)
                        samples.append(tuple(sum(point[axis] * weight for point, weight in zip(triangle, weights)) for axis in range(2)))

    def minimum(image):
        values = []
        pixels = image.load()
        for u, v in samples:
            x, y = u * image.width - 0.5, v * image.height - 0.5
            ix, iy = math.floor(x), math.floor(y)
            dx, dy = x - ix, y - iy
            values.append(sum(pixels[ix + a, iy + b] * (dx if a else 1 - dx) * (dy if b else 1 - dy) for a in (0, 1) for b in (0, 1)))
        return min(values) / 255

    mip_minima = {str(size): minimum(alpha.resize((size, size), Image.Resampling.LANCZOS)) for size in (1024, 512, 256, 128)}
    padded_minimum = minimum(alpha.filter(ImageFilter.MinFilter(11)))
    assert padded_minimum > 0.98, "Photographic UVs need five pixels of opaque padding."
    assert min(mip_minima.values()) > 0.85, "Filtered UVs reach the atlas background."
    return {"samplesPerMip": len(samples), "minimumPhotoAlphaByMip": mip_minima, "minimumAlphaWithin5PixelMargin": padded_minimum}


def make_variant(strips, variant, count):
    rng = random.Random(40217 + variant * 101)
    positions, roots, uv, colors, indices = [], [], [], [], []
    for blade_index in range(count):
        sections = strips[(blade_index * 37 + variant * 53) % len(strips)]
        angle = blade_index * 2.39996323 + variant * 0.7
        edge = 0.68 + 0.05 * math.sin(angle * 3 + variant) + 0.035 * math.sin(angle * 5 - variant * 0.8)
        radius = math.sqrt((blade_index + 0.2 + rng.random() * 0.6) / count) * edge
        root_x, root_z = math.cos(angle) * radius, math.sin(angle) * radius
        height_roll = rng.random()
        height = 0.28 + height_roll * 0.38
        if blade_index % 4 == 0:
            height *= 0.65
        if blade_index % 13 == 0:
            height = 0.82 + height_roll * 0.18
        # Roots fill a bed, and blades bend independently of its center. A
        # shared outward bearing recreated an ornamental fountain at each spot.
        facing = rng.random() * math.tau
        cosine, sine = math.cos(facing), math.sin(facing)
        width = (BLADE_WIDTH[0] + rng.random() * (BLADE_WIDTH[1] - BLADE_WIDTH[0])) * math.sqrt(height / 0.75)
        bend = 0.08 + 0.66 * (0.5 + 0.5 * math.sin(blade_index * 1.79 + variant))
        shade = 0.88 + rng.random() * 0.12
        first = len(positions)
        for section, textures in enumerate(sections):
            t = section / (SECTIONS - 1)
            drift = height * bend * t * t
            y = height * (1.45 * t - 0.45 * t * t)
            taper = (1 - t) ** 0.65 * (0.4 + 3 * t) / 1.222
            for side, texture in zip((-0.5, 0.5), textures):
                # A stable transverse frame keeps each quad planar. Scaled
                # scanned width vectors previously folded across the blade.
                offset = side * width * taper
                positions.append((drift * cosine - offset * sine, y, drift * sine + offset * cosine))
                roots.append((root_x, root_z))
                uv.append(texture)
                # A little basal shade grounds each blade; scanned green/dry
                # variation and all photographic surface detail remain intact.
                tone = shade * (0.77 + 0.23 * min(1, y / height / 0.25))
                colors.append((tone, tone, tone))
        for section in range(SECTIONS - 1):
            a = first + section * 2
            indices.extend(((a,), (a + 1,), (a + 3,), (a,), (a + 3,), (a + 2,)))
    max_height = max(point[1] for point in positions)
    positions = [(point[0] / max_height + root[0], point[1] / max_height, point[2] / max_height + root[1]) for point, root in zip(positions, roots)]
    normals = [[0.0, 0.0, 0.0] for _ in positions]
    visible_indices = []
    for start in range(0, len(indices), 3):
        a, b, c = (row[0] for row in indices[start:start + 3])
        ab = [positions[b][axis] - positions[a][axis] for axis in range(3)]
        ac = [positions[c][axis] - positions[a][axis] for axis in range(3)]
        cross = (ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0])
        if sum(value * value for value in cross) < 1e-18:
            continue
        visible_indices.extend(((a,), (b,), (c,)))
        for index in (a, b, c):
            for axis in range(3):
                normals[index][axis] += cross[axis]
    normals = [normalized(normal) if sum(value * value for value in normal) > 1e-18 else (0, 1, 0) for normal in normals]
    return positions, normals, uv, colors, visible_indices


def main():
    source = SOURCE.read_bytes()
    source_hash = hashlib.sha256(source).hexdigest()
    source_document, source_binary = glb_chunks(source)
    color_source = COLOR_SOURCE.read_bytes()
    color_document, color_binary = glb_chunks(color_source)
    color_texture = color_document["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    color_image = color_document["textures"][color_texture]["source"]
    source_texture = source_document["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    source_color_image = source_document["textures"][source_texture]["source"]
    # Record the immutable input before writing the separate derivative.
    record = {"version": VERSION, "recipe": str(Path(__file__).relative_to(ROOT)), "source": {"path": str(SOURCE.relative_to(ROOT)), "sha256": source_hash, "bytes": len(source)}, "colorSource": {"path": str(COLOR_SOURCE.relative_to(ROOT)), "sha256": hashlib.sha256(color_source).hexdigest(), "bytes": len(color_source)}, "license": "CC0-1.0", "sourceURL": "https://polyhaven.com/a/grass_medium_02", "status": "preparing"}
    LEDGER.write_text(json.dumps(record, indent=2) + "\n")
    document = {"asset": {"version": "2.0", "generator": VERSION}, "buffers": [{"byteLength": 0}], "bufferViews": [], "accessors": [], "materials": copy.deepcopy(source_document["materials"]), "textures": copy.deepcopy(source_document["textures"]), "samplers": copy.deepcopy(source_document["samplers"]), "images": [], "meshes": [], "nodes": [], "scenes": [{"nodes": [0, 1, 2]}], "scene": 0}
    binary = bytearray()
    image_records = []
    preserved_images = []
    for index, original_image in enumerate(source_document["images"]):
        encoded = image_bytes(color_document, color_binary, color_image) if index == source_color_image else image_bytes(source_document, source_binary, index)
        preserved_images.append(encoded)
        binary.extend(b"\x00" * (-len(binary) % 4))
        document["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(encoded)})
        document["images"].append({**original_image, "bufferView": len(document["bufferViews"]) - 1})
        binary.extend(encoded)
        image_records.append({"name": original_image["name"], "input": str((COLOR_SOURCE if index == source_color_image else SOURCE).relative_to(ROOT)), "sha256": hashlib.sha256(encoded).hexdigest(), "bytes": len(encoded)})
    material = document["materials"][0]
    # Geometry owns the outline. Atlas alpha cutout created holes where sparse
    # source-UV chords crossed the edge of a curved photographed leaf.
    material.update(name="dusty_olive_grass", alphaMode="OPAQUE")
    material.pop("alphaCutoff", None)
    material["normalTexture"]["scale"] = 0.7
    pbr = material["pbrMetallicRoughness"]
    pbr.update(baseColorFactor=[0.52, 0.58, 0.96, 1], roughnessFactor=0.94)
    pbr.pop("metallicRoughnessTexture")
    strips = photo_strips(preserved_images[source_color_image])
    photo_checks = check_photo_strips(preserved_images[source_color_image], strips)
    variants = []
    for variant, count in enumerate((96, 108, 102)):
        positions, normals, uv, colors, indices = make_variant(strips, variant, count)
        attributes = {name: add_accessor(document, binary, rows, kind) for name, rows, kind in (("POSITION", positions, "VEC3"), ("NORMAL", normals, "VEC3"), ("TEXCOORD_0", uv, "VEC2"), ("COLOR_0", colors, "VEC3"))}
        name = "oasis_grass_" + chr(97 + variant)
        document["meshes"].append({"name": name, "primitives": [{"attributes": attributes, "indices": add_accessor(document, binary, indices, "SCALAR", 5123), "material": 0}]})
        document["nodes"].append({"name": name, "mesh": variant})
        blade_widths = [max(math.dist(positions[start + section * 2], positions[start + section * 2 + 1]) for section in range(SECTIONS)) for start in range(0, len(positions), SECTIONS * 2)]
        variants.append({"name": name, "blades": count, "triangles": len(indices) // 3, "height": max(point[1] for point in positions), "rootRadius": max(math.hypot(point[0], point[2]) for point in positions if point[1] < 0.02), "crownRadius": max(math.hypot(point[0], point[2]) for point in positions), "bladeWidthRange": [min(blade_widths), max(blade_widths)], "bounds": {"min": [min(point[axis] for point in positions) for axis in range(3)], "max": [max(point[axis] for point in positions) for axis in range(3)]}})
    write_glb(OUTPUT, document, bytes(binary))
    checked, checked_binary = glb_chunks(OUTPUT.read_bytes())
    assert SOURCE.read_bytes() == source
    assert COLOR_SOURCE.read_bytes() == color_source
    assert all(image_bytes(checked, checked_binary, index) == encoded for index, encoded in enumerate(preserved_images))
    original_alpha = Image.open(io.BytesIO(image_bytes(source_document, source_binary, source_color_image))).getchannel("A")
    graded_alpha = Image.open(io.BytesIO(preserved_images[source_color_image])).getchannel("A")
    assert original_alpha.tobytes() == graded_alpha.tobytes()
    for mesh in checked["meshes"]:
        primitive = mesh["primitives"][0]
        for name in ("POSITION", "NORMAL", "TEXCOORD_0", "COLOR_0"):
            assert all(math.isfinite(value) for row in read_accessor(checked, checked_binary, primitive["attributes"][name]) for value in row)
        assert all(abs(sum(value * value for value in row) - 1) < 1e-5 for row in read_accessor(checked, checked_binary, primitive["attributes"]["NORMAL"]))
        vertex_count = checked["accessors"][primitive["attributes"]["POSITION"]]["count"]
        assert all(0 <= row[0] < vertex_count for row in read_accessor(checked, checked_binary, primitive["indices"]))
    assert all(1100 <= variant["triangles"] <= 2500 and variant["rootRadius"] <= 0.75 for variant in variants)
    assert all(variant["bladeWidthRange"][1] < 0.08 for variant in variants)
    record.update(status="prepared", output={"path": str(OUTPUT.relative_to(ROOT)), "sha256": hashlib.sha256(OUTPUT.read_bytes()).hexdigest(), "bytes": OUTPUT.stat().st_size}, photographicStrips=len(strips), sectionsPerBlade=SECTIONS, bladeWidth=BLADE_WIDTH, variants=variants, images=image_records, treatment="Smooth tapered blades with planar quads and gentle independent bends, full-circle bearings and varied blade widths. The irregular root spread is retained with fewer, finer blades for open ground cover; mostly low blades are interspersed with occasional taller leaves. UV triangles stay within padded opaque photographic leaf bodies instead of crossing scanned silhouettes. Geometry owns the outline; OPAQUE material prevents alpha cutoff holes at smaller mips. Reuses the existing warm savanna 1K color/alpha map and original 1K normal/packed maps byte-for-byte. A darker, less yellow base-color factor mutes the photographed straw; neutral basal vertex shading, normal strength and matte roughness are unchanged. No raster edits.", checks={"sourceUnchanged": True, "colorSourceUnchanged": True, "allSelectedImageBytesUnchanged": True, "alphaMatchesOriginal": True, "finiteVertexAttributes": True, "unitNormals": True, "photoUVs": photo_checks})
    LEDGER.write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({"output": record["output"], "photoUVs": photo_checks, "variants": variants}, indent=2))


if __name__ == "__main__":
    main()
