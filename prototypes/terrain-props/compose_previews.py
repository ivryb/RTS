#!/usr/bin/env python3
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "art" / "workbench" / "wip" / "terrain-props-v1"
ASSETS = ART / "assets"
PREVIEWS = ART / "previews"
GROUND = ROOT / "art" / "workbench" / "history" / "ground_screenshot.jpg"

CATEGORIES = {
    "bushes": [
        ("bush-01-thorn.png", "Thorn scrub"),
        ("bush-02-saltbush.png", "Saltbush"),
        ("bush-03-spindly.png", "Spindly brush"),
        ("bush-04-resinous.png", "Resinous shrub"),
        ("bush-05-half-dead.png", "Half-dead bush"),
    ],
    "trees": [
        ("tree-01-date-palm.png", "Date palm"),
        ("tree-02-fan-palm.png", "Fan palm"),
        ("tree-03-damaged-palm.png", "Damaged palm"),
        ("tree-04-acacia.png", "Desert acacia"),
        ("tree-05-dead.png", "Dead tree"),
    ],
    "rocks": [
        ("rock-01-sandstone.png", "Sandstone"),
        ("rock-02-stratified.png", "Stratified rock"),
        ("rock-03-basalt.png", "Basalt"),
        ("rock-04-wind-eroded-v2.png", "Wind-eroded"),
        ("rock-05-limestone.png", "Limestone"),
    ],
}

SIZES = {
    "bushes": (260, 310),
    "trees": (255, 590),
    "rocks": (270, 280),
}


def font(size: int):
    path = Path("/System/Library/Fonts/Supplemental/Arial.ttf")
    return ImageFont.truetype(path, size) if path.exists() else ImageFont.load_default()


def crop_subject(image: Image.Image):
    image = image.convert("RGBA")
    bounds = image.getchannel("A").point(lambda value: 255 if value > 10 else 0).getbbox()
    return image.crop(bounds) if bounds else image


def fit_subject(image: Image.Image, bounds: tuple[int, int]):
    image = crop_subject(image)
    scale = min(bounds[0] / image.width, bounds[1] / image.height)
    return image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)


def make_preview(category: str, entries: list[tuple[str, str]]):
    width, height = 1600, 900
    canvas = ImageOps.fit(Image.open(GROUND).convert("RGB"), (width, height), method=Image.Resampling.LANCZOS).convert("RGBA")
    shade = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shade_draw = ImageDraw.Draw(shade)
    shade_draw.rounded_rectangle((28, 24, 420, 94), 18, fill=(31, 26, 19, 205))
    shade_draw.text((52, 43), f"Dune77 · {category.title()} v1", fill=(244, 228, 192, 255), font=font(30))
    canvas.alpha_composite(shade)

    cell_width = width // len(entries)
    baseline = 755
    label_font = font(22)
    for index, (filename, label) in enumerate(entries):
        subject = fit_subject(Image.open(ASSETS / filename), SIZES[category])
        center_x = cell_width * index + cell_width // 2
        left = center_x - subject.width // 2
        top = baseline - subject.height

        shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow)
        radius_x = max(30, int(subject.width * 0.34))
        shadow_draw.ellipse(
            (center_x - radius_x, baseline - 18, center_x + radius_x, baseline + 15),
            fill=(50, 38, 24, 82),
        )
        canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(9)))
        canvas.alpha_composite(subject, (left, top))

        draw = ImageDraw.Draw(canvas)
        text_bounds = draw.textbbox((0, 0), label, font=label_font)
        label_width = text_bounds[2] - text_bounds[0]
        draw.rounded_rectangle(
            (center_x - label_width // 2 - 13, 790, center_x + label_width // 2 + 13, 830),
            11,
            fill=(42, 34, 24, 190),
        )
        draw.text((center_x - label_width // 2, 797), label, fill=(247, 232, 204, 255), font=label_font)

    output = PREVIEWS / f"{category}-ground-preview.png"
    canvas.convert("RGB").save(output, quality=94)
    print(output)


def main():
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    for category, entries in CATEGORIES.items():
        make_preview(category, entries)


if __name__ == "__main__":
    main()
