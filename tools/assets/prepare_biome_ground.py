"""Prepare warm scanned ground textures that sit inside the accepted desert palette."""

import colorsys
import hashlib
import json
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageStat


REPO = Path(__file__).resolve().parents[2]
OUTPUT = REPO / "art/workbench/terrain-composite/textures"
OUTPUT.mkdir(parents=True, exist_ok=True)


def fetch_scan(asset, suffix):
    filename = f"{asset}_{suffix}_2k.jpg"
    target = OUTPUT / filename
    url = f"https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/{asset}/{filename}"
    if not target.exists():
        subprocess.run(["curl", "-LsSf", "-A", "Dune77 terrain study", url, "-o", str(target)], check=True)
    return target, {"source": filename, "url": url, "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}


def graded_image(source, mean, contrast, chroma, center_chroma=False):
    image = Image.open(source).convert("RGB")
    weights = (0.2126, 0.7152, 0.0722)
    channel_means = ImageStat.Stat(image).mean
    source_mean = sum(v * w for v, w in zip(channel_means, weights))
    matrix = []
    for channel in range(3):
        matrix.extend((contrast - chroma) * weights[i] + (chroma if i == channel else 0) for i in range(3))
        # Centering each source channel keeps warm scans from shifting the chosen
        # mean palette. The approved summit grade retains its previous behavior.
        chroma_mean = chroma * (channel_means[channel] - source_mean) if center_chroma else 0
        matrix.append(mean[channel] - contrast * source_mean - chroma_mean)
    return image.convert("RGB", tuple(matrix))


def grade(source, target, mean, contrast, chroma, center_chroma=False):
    image = graded_image(source, mean, contrast, chroma, center_chroma)
    image.save(OUTPUT / target, "WEBP", quality=94, method=6)
    return image


def accepted_sand():
    """Show the real base albedo: normalized sand multiplied by the linear tint."""
    source = Image.open(REPO / "assets/textures/terrain/sand-scan.webp").convert("RGB")

    def linear(value):
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    def srgb(value):
        return value * 12.92 if value <= 0.0031308 else 1.055 * value ** (1 / 2.4) - 0.055

    tint = colorsys.hls_to_rgb(29 / 360, 0.75, 0.94)
    lookup = [round(255 * srgb(linear(value / 255) * linear(channel))) for channel in tint for value in range(256)]
    return source.point(lookup)


sources = []
swatches = {}
for biome, asset, mean, contrast, chroma, meters, catalog_meters in (
    ("basalt", "gravelly_sand", (82, 73, 59), 1.05, 0.28, 7, 2.48),
    ("oasis", "mud_cracked_dry_03", (108, 78, 52), 0.65, 0.25, 6.8, 1.5),
):
    color, color_source = fetch_scan(asset, "diff")
    normal, normal_source = fetch_scan(asset, "nor_gl")
    swatches[biome] = grade(color, f"biome-{biome}-color.webp", mean, contrast, chroma, center_chroma=True)
    previous_grade = ((86, 79, 67), 1.00, 0.10) if biome == "basalt" else ((126, 112, 83), 0.70, 0.15)
    swatches[f"previous {biome}"] = graded_image(color, *previous_grade)
    Image.open(normal).convert("RGB").save(OUTPUT / f"biome-{biome}-normal.webp", "WEBP", quality=96, method=6)
    authors={"Dario Barresi":"All"} if biome=="basalt" else {"Dario Barresi":"Processing","Dimitrios Savva":"Photography"}
    sources.append({"biome": biome, "version": "warm-desert-ground-v3", "page": f"https://polyhaven.com/a/{asset}", "license": "CC0-1.0", "authors":authors,
                    "meters": meters, "source_maps": [color_source, normal_source],
                    "catalog_meters": catalog_meters,
                    "output_mean_srgb": [round(value, 2) for value in ImageStat.Stat(Image.open(OUTPUT / f"biome-{biome}-color.webp").convert("RGB")).mean],
                    "luminance_contrast": contrast, "retained_chroma": chroma,
                    "processing": "Warm source grade anchored near the accepted sand albedo. Original scanned grain, relief alignment, and normal map preserved; no synthetic noise or mismatched surface composite.",
                    "placement": "Local sand-filled rock aprons only; this scan was rejected as a broad repeating terrain base." if biome == "basalt" else "Subtle alluvial pockets and dry drainage beds; retain accepted sand between pockets."})

summit = REPO / "assets/source/polyhaven/dirt-aerial-03-diffuse-2k.jpg"
grade(summit, "biome-summit-dust.webp", (124, 79, 47), 0.55, 0.08)
sources.append({"biome": "summit dust", "page": "https://polyhaven.com/a/dirt_aerial_03", "license": "CC0-1.0",
                "source": str(summit.relative_to(REPO)), "sha256": hashlib.sha256(summit.read_bytes()).hexdigest(),
                "output_mean_srgb": [124, 79, 47], "luminance_contrast": 0.55, "retained_chroma": 0.08,
                "processing": "Fine rust-colored dust from the existing dirt scan; restrained contrast prevents gray blotches."})
(OUTPUT / "biome-ground-sources.json").write_text(json.dumps(sources, indent=2) + "\n")

base = accepted_sand()
contact = Image.new("RGB", (1200, 830), (37, 32, 25))
draw = ImageDraw.Draw(contact)
for index, (label, image) in enumerate((
    ("Accepted sand / actual base tint", base),
    ("Previous basalt / neutral gray", swatches["previous basalt"]),
    ("Previous oasis / pale khaki", swatches["previous oasis"]),
    ("Accepted sand / actual base tint", base),
    ("Warm charcoal gravel / broken rock aprons", swatches["basalt"]),
    ("Alluvial earth / sheltered understory", swatches["oasis"]),
)):
    thumbnail = image.copy()
    thumbnail.thumbnail((400, 380))
    x, y = index % 3 * 400, index // 3 * 415
    contact.paste(thumbnail, (x, y + 30))
    draw.text((x + 10, y + 8), label, fill=(239, 228, 208))
contact.save(OUTPUT / "biome-ground-contact.jpg", quality=94)
print(f"Prepared basalt gravel, dry oasis soil and oxide summit dust in {OUTPUT}")
