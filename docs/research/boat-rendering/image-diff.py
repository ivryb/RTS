# Mean absolute per-pixel difference (0-255) between same-named images in two folders.
import sys, os
from PIL import Image, ImageChops, ImageStat
a, b = sys.argv[1], sys.argv[2]
for name in sorted(os.listdir(a)):
    pb = os.path.join(b, name.replace("before-", "after-"))
    if not os.path.exists(pb) or name.startswith("run-"): continue
    x, y = Image.open(os.path.join(a, name)).convert("RGB"), Image.open(pb).convert("RGB")
    if x.size != y.size: print(name, "size differs", x.size, y.size); continue
    d = ImageStat.Stat(ImageChops.difference(x, y)).mean
    print(f"{name:45s} {sum(d)/3:5.2f}")
