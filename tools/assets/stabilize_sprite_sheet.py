#!/usr/bin/env python3

import argparse

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser(description="Align sprite frames to one ground baseline.")
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--cols", type=int, required=True)
    parser.add_argument("--rows", type=int, required=True)
    parser.add_argument("--alpha-threshold", type=int, default=32)
    args = parser.parse_args()

    sheet = Image.open(args.input).convert("RGBA")
    if sheet.width % args.cols or sheet.height % args.rows:
        raise SystemExit("Sheet dimensions must divide evenly into the requested grid.")

    frame_width = sheet.width // args.cols
    frame_height = sheet.height // args.rows
    frames: list[tuple[Image.Image, tuple[int, int, int, int]]] = []

    for row in range(args.rows):
        for col in range(args.cols):
            box = (
                col * frame_width,
                row * frame_height,
                (col + 1) * frame_width,
                (row + 1) * frame_height,
            )
            frame = sheet.crop(box)
            opaque = frame.getchannel("A").point(
                lambda alpha: 255 if alpha >= args.alpha_threshold else 0
            )
            bounds = opaque.getbbox()
            if bounds is None:
                raise SystemExit(f"Empty frame at column {col}, row {row}.")
            frames.append((frame, bounds))

    baseline = max(bounds[3] for _, bounds in frames)
    stabilized = Image.new("RGBA", sheet.size)

    for index, (frame, bounds) in enumerate(frames):
        col = index % args.cols
        row = index // args.cols
        frame_canvas = Image.new("RGBA", frame.size)
        frame_canvas.alpha_composite(frame, (0, baseline - bounds[3]))
        stabilized.alpha_composite(frame_canvas, (col * frame_width, row * frame_height))

    stabilized.save(args.output)
    print(f"Aligned {len(frames)} frames to baseline {baseline}px.")


if __name__ == "__main__":
    main()
