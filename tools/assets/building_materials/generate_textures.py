"""Authored, seeded hard-surface texture tiles. Uses Pillow; no generated imagery."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def chamfered(x0, y0, x1, y1, cut=14):
    return [(x0 + cut, y0), (x1 - cut, y0), (x1, y0 + cut), (x1, y1 - cut),
            (x1 - cut, y1), (x0 + cut, y1), (x0, y1 - cut), (x0, y0 + cut)]


def generate(output, seed):
    rng = np.random.default_rng(seed)
    size = 1024
    palette = json.loads(Path(__file__).with_name('palette.json').read_text())
    wear = palette['weathering']
    for kind, spec in palette['materials'].items():
        if not spec['textured']:
            continue
        rgb = tuple(spec['color'])
        dark = kind in ('machinery', 'structure')
        image = Image.new('RGB', (size, size), rgb)
        height = Image.new('L', (size, size), 145)
        paint, relief = ImageDraw.Draw(image), ImageDraw.Draw(height)

        def line(points, fill, width=2, depth=110):
            paint.line(points, fill=fill, width=width, joint='curve')
            relief.line(points, fill=depth, width=width, joint='curve')

        def border(bounds, cut=14, width=3):
            polygon = chamfered(*bounds, cut)
            line(polygon + [polygon[0]], tuple(wear['panel_shadow']) if not dark else tuple(wear['exposed_metal']), width + 1, 85)
            polygon = [(x + 3, y + 3) for x, y in polygon]
            line(polygon + [polygon[0]], tuple(wear['paint_highlight']) if not dark else (122, 98, 68), 2, 162)

        def bolt(x, y, radius=5):
            paint.ellipse((x - radius - 2, y - radius - 2, x + radius + 2, y + radius + 2), fill=(83, 78, 65))
            paint.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(167, 155, 125))
            relief.ellipse((x - radius, y - radius, x + radius, y + radius), fill=183)
            line([(x - 2, y), (x + 2, y)], (68, 67, 56), 2, 75)

        border((18, 18, 1006, 1006), 28)
        border((33, 33, 991, 991), 22, 1)
        # Geometry owns panel layout. A reusable finish must not print unrelated
        # nested machinery or access hatches onto every window, corner, and pipe.
        if not dark:
            for x in [58, 966]:
                for y in [61, 964]:
                    bolt(x, y)

        # Abrasion follows exposed panel borders and joints; large faces stay quieter.
        seams = [18, 33, 991, 1006]
        for _ in range(wear['metal_chip_count'] if dark else wear['paint_chip_count']):
            x, y = rng.integers(10, 1014, 2)
            if rng.random() < .55:
                x = int(rng.choice([20, 35, 989, 1004]) + rng.normal(0, 7))
            else:
                y = int(rng.choice(seams) + rng.normal(0, 6))
            length, width = int(rng.integers(3, 24)), int(rng.integers(1, 4))
            color = tuple(wear['panel_shadow']) if not dark else tuple(wear['exposed_metal'])
            line([(x, y), (x + length, y + int(rng.integers(-2, 3)))], color, width, 111)
            if not dark:
                paint.line([(x, y + width + 1), (x + length // 2, y + width + 1)], fill=(225, 207, 168), width=1)

        stains = Image.new('L', (size, size))
        stain_paint = ImageDraw.Draw(stains)
        for _ in range(wear['streak_count']):
            x = int(rng.integers(32, 992))
            y = int(rng.choice(seams))
            length = int(rng.integers(22, 170))
            stain_paint.line([(x, y), (x + int(rng.integers(-4, 5)), min(1023, y + length))],
                             fill=int(rng.integers(20, 75)), width=int(rng.integers(3, 12)))
        streaks = np.asarray(stains.filter(ImageFilter.GaussianBlur(5))).astype(float) / 255
        pixels = np.asarray(image).astype(float)
        yy, xx = np.mgrid[:size, :size]
        edge = np.minimum.reduce([xx, yy, size - 1 - xx, size - 1 - yy])
        noise = rng.normal(0, .45 if not dark else 1.0, (size, size))
        # Seeded broad paint variation avoids the repeated sinusoidal pattern of the first study.
        coarse = Image.fromarray(rng.integers(0, 256, (24, 24), dtype=np.uint8))
        cloud = (np.asarray(coarse.resize((size, size), Image.Resampling.BICUBIC)).astype(float) / 255 - .5) * wear.get(f'{kind}_variation', wear['metal_variation' if dark else 'paint_variation'])
        seam_distance = np.minimum.reduce([abs(yy - y) for y in seams])
        grime = (22 * np.exp(-edge / 20) if not dark else 16 * np.exp(-edge / 28)) + 8 * np.exp(-seam_distance / 9)
        pixels += (noise + cloud)[:, :, None]
        patina = np.clip(grime / 130 + streaks * .35, 0, .48)
        if not dark:
            # Plate UVs run upward with the wall: the image's bottom is its lower edge.
            # Broad, uneven lower-edge aging gives volume without dirtying the ivory center.
            edge_field = Image.fromarray(rng.integers(0, 256, (1, 20), dtype=np.uint8))
            uneven = np.asarray(edge_field.resize((size, 1), Image.Resampling.BICUBIC)).astype(float)[0] / 255
            side_distance = np.minimum(xx, size - 1 - xx)
            depth = size * wear['armor_age_depth'] * (.5 + uneven)
            lower_age = np.exp(-(size - 1 - yy) / depth[None, :])
            side_age = np.exp(-side_distance / (size * .045))
            edge_age = wear[f'{kind}_lower_age'] * lower_age + wear[f'{kind}_side_age'] * side_age
            if kind == 'roof':
                # Roof caps are seen from above, so their rims collect grime as well as their lower edges.
                edge_age += wear['roof_edge_age'] * np.exp(-edge / (size * .04))
            # Soft brown blotches read as uneven staining, the way sun and dust age a large plate.
            blotch_field = Image.new('L', (size, size))
            blotch_paint = ImageDraw.Draw(blotch_field)
            for _ in range(wear.get(f'{kind}_blotches', 0)):
                bx, by, radius = (int(rng.integers(0, size)), int(rng.integers(0, size)), int(rng.integers(70, 200)))
                blotch_paint.ellipse((bx - radius, by - radius // 2, bx + radius, by + radius // 2), fill=int(rng.integers(60, 140)))
            edge_age = edge_age + np.asarray(blotch_field.filter(ImageFilter.GaussianBlur(40))).astype(float) / 255
            patina = np.clip(patina + edge_age, 0, .76)
        pixels = pixels * (1 - patina[:, :, None]) + np.array(wear['stain']) * patina[:, :, None]
        if dark:
            # Dust sits on the lower lips of mechanical panels, breaking up empty black bays.
            dust = np.exp(-np.minimum(edge, seam_distance) / 24) * .16
            pixels = pixels * (1 - dust[:, :, None]) + np.array(wear['dust']) * dust[:, :, None]
        Image.fromarray(np.uint8(np.clip(pixels, 0, 255))).save(output / f'{kind}-color.png')
        heights = np.asarray(height.filter(ImageFilter.GaussianBlur(.8))).astype(float) / 255
        dy, dx = np.gradient(heights)
        normal = np.stack([-dx * 2.6, -dy * 2.6, np.ones_like(dx)], axis=-1)
        normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
        # Image rows run downward; this produces the glTF/OpenGL +Y tangent convention.
        normal[:, :, 1] *= -1
        Image.fromarray(np.uint8(np.clip((normal * .5 + .5) * 255, 0, 255))).save(output / f'{kind}-normal.png')
        rough = np.clip(spec['roughness'] * 255 + noise * 2 + grime + streaks * 40 + (145 - np.asarray(height).astype(float)) * .15, 90, 235)
        Image.fromarray(np.uint8(rough)).save(output / f'{kind}-roughness.png')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    parser.add_argument('--seed', type=int, default=77)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    generate(args.output, args.seed)
