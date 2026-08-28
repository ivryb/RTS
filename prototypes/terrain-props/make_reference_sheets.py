#!/usr/bin/env python3
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "art" / "workbench" / "wip" / "terrain-props-v1"
ASSETS = ART / "assets"
SHEETS = ART / "reference-sheets"

GROUPS = {
    "bushes": [f"bush-0{i}-{name}.png" for i, name in enumerate(("thorn", "saltbush", "spindly", "resinous", "half-dead"), 1)],
    "trees": [
        "tree-01-date-palm.png",
        "tree-02-fan-palm.png",
        "tree-03-damaged-palm.png",
        "tree-04-acacia.png",
        "tree-05-dead.png",
    ],
    "rocks": [
        "rock-01-sandstone.png",
        "rock-02-stratified.png",
        "rock-03-basalt.png",
        "rock-04-wind-eroded-v2.png",
        "rock-05-limestone.png",
    ],
}


def crop(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    bounds = image.getchannel("A").getbbox()
    return image.crop(bounds) if bounds else image


def make_sheet(name: str, files: list[str]) -> None:
    canvas = Image.new("RGBA", (1200, 800), (245, 241, 232, 255))
    slots = ((0, 0), (400, 0), (800, 0), (200, 400), (600, 400))
    for filename, (x, y) in zip(files, slots):
        image = crop(Image.open(ASSETS / filename))
        image.thumbnail((350, 350), Image.Resampling.LANCZOS)
        canvas.alpha_composite(image, (x + (400 - image.width) // 2, y + 380 - image.height))
    output = SHEETS / f"{name}-reference-sheet.png"
    canvas.convert("RGB").save(output, quality=95)
    print(output)


SHEETS.mkdir(parents=True, exist_ok=True)
for group, filenames in GROUPS.items():
    make_sheet(group, filenames)
