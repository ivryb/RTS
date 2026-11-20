import sys
from PIL import Image, ImageDraw
# usage: strip.py <frames dir> <out> <crop x0,y0,x1,y1> <cols> <frame indexes...>
frames, out, crop, cols = sys.argv[1], sys.argv[2], [int(v) for v in sys.argv[3].split(",")], int(sys.argv[4])
indexes = [int(v) for v in sys.argv[5:]]
tiles = []
for index in indexes:
    im = Image.open(f"{frames}/{index:04d}.jpg").crop(crop)
    ImageDraw.Draw(im).text((6, 6), f"{index} · {index/30:.2f}s", fill=(255, 255, 255))
    tiles.append(im)
w, h = tiles[0].size
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w, rows * h))
for i, tile in enumerate(tiles):
    sheet.paste(tile, ((i % cols) * w, (i // cols) * h))
sheet.save(out)
print(sheet.size)
