"""Prepare the CC0 Cliff Side scan for the optional terrain-hub oxide study."""
import hashlib
import json
from pathlib import Path
import subprocess

from PIL import Image


ROOT = Path(__file__).resolve().parents[2] / 'art/workbench/terrain-composite/textures'
SOURCE = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/cliff_side/'
MAPS = [
    ('diff', 'color', '6d129836144e271b30071281241e237d'),
    ('nor_gl', 'normal', '8209033c3ad15185977d91c92cf5866f'),
    ('rough', 'roughness', '44abb195b6c4c7b6da902e97e5bbbef2'),
]

ROOT.mkdir(parents=True, exist_ok=True)
files = []
for source_name, role, digest in MAPS:
    name = f'cliff_side_{source_name}_2k.jpg'
    source = ROOT / name
    url = SOURCE + name
    if not source.exists() or hashlib.md5(source.read_bytes()).hexdigest() != digest:
        subprocess.run(['curl', '-fsSL', '-A', 'Dune77 terrain study', url, '-o', str(source)], check=True)
    if hashlib.md5(source.read_bytes()).hexdigest() != digest:
        raise ValueError(f'Source checksum mismatch: {name}')
    destination = ROOT / f'cliff-side-{role}.webp'
    # Cliff color is authored mineral color, not a grayscale ground-detail map.
    Image.open(source).convert('RGB').save(destination, 'WEBP', quality=95 if role != 'color' else 92, method=6)
    files.append({'role': role, 'source': name, 'url': url, 'md5': digest, 'runtime': destination.name})

(ROOT / 'cliff-side-source.json').write_text(json.dumps({
    'asset': 'Cliff Side',
    'page': 'https://polyhaven.com/a/cliff_side',
    'license': 'CC0-1.0',
    'authors': {'Dario Barresi': 'Photography', 'James Ray Cock': 'Photography', 'Jenelle van Heerden': 'Processing'},
    'sourceWidthMeters': 1.8,
    'processing': '2048px WebP; preserve source color, normal vectors and roughness; no grayscale or hue grade.',
    'files': files,
}, indent=2) + '\n')
print(f'Prepared Cliff Side color, normal and roughness in {ROOT}')
