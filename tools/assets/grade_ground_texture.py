from argparse import ArgumentParser
from pathlib import Path

from PIL import Image, ImageMath


parser = ArgumentParser(description="Normalize a ground texture for runtime tinting.")
parser.add_argument("input", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--chroma", type=float, default=0)
brightness = parser.add_mutually_exclusive_group()
brightness.add_argument("--gamma", type=float)
brightness.add_argument("--target-mean", type=float)
parser.add_argument("--quality", type=int, default=90)
args = parser.parse_args()

source = Image.open(args.input).convert("RGB")
red, green, blue = source.split()
luminance = ImageMath.unsafe_eval(
    "convert((red * 54 + green * 183 + blue * 19) / 256, 'L')",
    red=red,
    green=green,
    blue=blue,
)


def mean_for_gamma(gamma: float) -> float:
    histogram = luminance.histogram()
    total = sum(histogram)
    return sum(
        count * 255 * (value / 255) ** gamma
        for value, count in enumerate(histogram)
    ) / total


gamma = args.gamma
target_mean = args.target_mean
if gamma is None and target_mean is None:
    target_mean = 128
if target_mean is not None:
    low, high = 0.1, 4.0
    for _ in range(24):
        middle = (low + high) / 2
        if mean_for_gamma(middle) > target_mean:
            low = middle
        else:
            high = middle
    gamma = (low + high) / 2

adjusted = luminance.point(
    tuple(round(255 * (value / 255) ** gamma) for value in range(256))
)
if args.chroma == 0:
    result = adjusted
else:
    adjusted_float = adjusted.convert("F")
    luminance_float = luminance.convert("F")
    result = Image.merge(
        "RGB",
        tuple(
            ImageMath.unsafe_eval(
                "convert(adjusted + chroma * (channel - luminance), 'L')",
                adjusted=adjusted_float,
                chroma=args.chroma,
                channel=channel.convert("F"),
                luminance=luminance_float,
            )
            for channel in (red, green, blue)
        ),
    )
result.save(args.output, "WEBP", quality=args.quality, method=6)
print(f"{args.output.name}: gamma={gamma:.3f}")
