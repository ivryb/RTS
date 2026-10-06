#!/usr/bin/env python3
"""Make separate dusty-olive vegetation GLBs; keep source geometry and maps intact.

Requires Pillow. Reads the prepared model.glb assets from the vegetation fetch
recipe and writes sibling biome.glb files. The source binary remains an unchanged
prefix, so all geometry, normals, roughness maps, and alpha masks are preserved.
"""

import hashlib
import io
import json
from pathlib import Path
import struct

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "art/workbench/terrain-composite/models"
ASSETS = ["tree_small_02", "shrub_04", "quiver_tree_02"]
PALETTE = {"version": "desert-olive-v2", "brightness": 0.80, "sourceChroma": 0.22, "dustTint": [1.02, 1.08, 0.73]}


def glb_chunks(blob):
    json_length = struct.unpack_from("<I", blob, 12)[0]
    document = json.loads(blob[20:20 + json_length])
    binary = blob[28 + json_length:]
    return document, binary


def image_bytes(document, binary, image_index):
    view = document["bufferViews"][document["images"][image_index]["bufferView"]]
    offset = view.get("byteOffset", 0)
    return binary[offset:offset + view["byteLength"]]


def smoothstep(low, high, value):
    weight = max(0, min(1, (value - low) / (high - low)))
    return weight * weight * (3 - 2 * weight)


def dusty_olive(source, selective):
    rgba = source.convert("RGBA")
    output = []
    for red, green, blue, alpha in rgba.getdata():
        luminance = (54 * red + 183 * green + 19 * blue) / 256
        # The aloe uses a shared trunk/leaves atlas. Restrict its grade to green
        # foliage pixels so pale scanned bark and dry leaf tips retain their color.
        strength = smoothstep(-0.015, 0.07, (green - red) / max(1, green)) if selective else 1
        adjusted = []
        for channel, tint in zip((red, green, blue), PALETTE["dustTint"]):
            dusty = (luminance * tint * (1 - PALETTE["sourceChroma"]) + channel * PALETTE["sourceChroma"]) * PALETTE["brightness"]
            adjusted.append(round(max(0, min(255, channel + (dusty - channel) * strength))))
        output.append((*adjusted, alpha))
    result = Image.new("RGBA", rgba.size)
    result.putdata(output)
    return result


def write_glb(path, document, binary):
    document["buffers"][0]["byteLength"] = len(binary)
    encoded = json.dumps(document, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary += b"\x00" * (-len(binary) % 4)
    size = 12 + 8 + len(encoded) + 8 + len(binary)
    path.write_bytes(struct.pack("<III", 0x46546C67, 2, size) + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + struct.pack("<II", len(binary), 0x004E4942) + binary)


def main():
    swatches = Image.new("RGB", (1200, 800), (137, 113, 78))
    draw = ImageDraw.Draw(swatches)
    records = []
    for index, asset in enumerate(ASSETS):
        directory = MODELS / asset
        source_path = directory / "model.glb"
        source = source_path.read_bytes()
        document, original_binary = glb_chunks(source)
        binary = bytearray(original_binary)
        textures = directory / "biome-source"
        textures.mkdir(exist_ok=True)
        edits = []
        for material in document["materials"]:
            if asset == "tree_small_02" and "leaves" not in material["name"]:
                continue
            texture_index = material["pbrMetallicRoughness"]["baseColorTexture"]["index"]
            image_index = document["textures"][texture_index]["source"]
            image = Image.open(io.BytesIO(image_bytes(document, original_binary, image_index)))
            graded = dusty_olive(image, selective=asset == "quiver_tree_02")
            assert image.convert("RGBA").getchannel("A").tobytes() == graded.getchannel("A").tobytes()
            original_path = textures / f"{material['name']}-original.png"
            graded_path = textures / f"{material['name']}-desert-olive.png"
            image.save(original_path)
            graded.save(graded_path, optimize=True)
            encoded = graded_path.read_bytes()
            binary.extend(b"\x00" * (-len(binary) % 4))
            document["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(encoded)})
            document["images"][image_index].update(bufferView=len(document["bufferViews"]) - 1, mimeType="image/png")
            binary.extend(encoded)
            edits.append({"material": material["name"], "originalMap": str(original_path.relative_to(ROOT)), "gradedMap": str(graded_path.relative_to(ROOT)), "alphaPreserved": True, "selectiveGreenMask": asset == "quiver_tree_02"})
            for row, preview in enumerate((image, graded)):
                preview = preview.convert("RGBA")
                preview.thumbnail((380, 345))
                swatches.paste(preview, (index * 400 + 10, row * 400 + 30), preview)
                draw.text((index * 400 + 10, row * 400 + 380), asset + (" / SOURCE" if row == 0 else " / DUSTY OLIVE"), fill=(245, 238, 220))
        output = directory / "biome.glb"
        write_glb(output, document, bytes(binary))
        _, checked_binary = glb_chunks(output.read_bytes())
        assert checked_binary[:len(original_binary)] == original_binary
        assert source_path.read_bytes() == source
        record = {"id": asset, "source": f"https://polyhaven.com/a/{asset}", "license": "CC0-1.0", "input": str(source_path.relative_to(ROOT)), "inputSHA256": hashlib.sha256(source).hexdigest(), "output": str(output.relative_to(ROOT)), "outputSHA256": hashlib.sha256(output.read_bytes()).hexdigest(), "palette": PALETTE, "geometryAndOtherMapsPreserved": True, "edits": edits}
        (directory / "biome-source-ledger.json").write_text(json.dumps(record, indent=2) + "\n")
        records.append(record)
        print(f"{asset}: source geometry and alpha verified; {output.stat().st_size / 1e6:.2f} MB", flush=True)
    swatches.save(MODELS.parent / "vegetation-biome-swatches.jpg", quality=93)
    ledger = {"recipe": "python3 tools/assets/grade_terrain_biome_vegetation.py", "assets": records}
    (MODELS / "biome-vegetation-sources.json").write_text(json.dumps(ledger, indent=2) + "\n")
    (ROOT / "tools/assets/terrain_biome_vegetation.sources.json").write_text(json.dumps(ledger, indent=2) + "\n")


if __name__ == "__main__":
    main()
