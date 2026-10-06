"""Prepare matched scanned scree and weathered rock surfaces for the terrain study."""
from pathlib import Path
import hashlib
import json
import subprocess
from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'art/workbench/terrain-composite/textures'
SOURCE = ROOT / 'art/workbench/terrain-directions/textures/aerial_ground_rock.jpg'
NORMAL = WORK / 'aerial_ground_rock_nor_gl_1k.jpg'
NORMAL_URL = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/aerial_ground_rock/aerial_ground_rock_nor_gl_1k.jpg'
ROCK_SOURCE = ROOT / 'art/workbench/terrain-composite/basalt-source'
ROCK_MAPS = {
    'diff': '657add9e8a8dffaeed19bdfc58078b59',
    'nor_gl': '279b33e71ae6275cafa24e6597024c98',
    'rough': '8895a8b199487fd6cfeed2fed1fb39b4',
}


def grade(source, target, mean, contrast, chroma):
    image = Image.open(source).convert('RGB')
    averages = ImageStat.Stat(image).mean
    weights = (.2126, .7152, .0722)
    luminance = sum(a * b for a, b in zip(averages, weights))
    matrix = []
    for channel in range(3):
        matrix.extend((contrast-chroma)*weights[i]+(chroma if i == channel else 0) for i in range(3))
        matrix.append(mean[channel]-contrast*luminance-chroma*(averages[channel]-luminance))
    image.convert('RGB', tuple(matrix)).save(target, 'WEBP', quality=94, method=6)


if not NORMAL.exists():
    subprocess.run(['curl', '-fLsS', NORMAL_URL, '-o', str(NORMAL)], check=True)
grade(SOURCE, WORK/'oxide-scree-color.webp', (132, 92, 58), .92, .38)
Image.open(NORMAL).save(WORK/'oxide-scree-normal.webp', 'WEBP', quality=96, method=6)
cliff = WORK/'cliff_side_diff_2k.jpg'
# Keep the scan's colored strata, with less saturated orange between the dark
# exposed faces and the sunlit weathered shoulders.
grade(cliff, WORK/'oxide-cliff-color.webp', (117, 81, 55), .94, .74)
# Cliff Side supplies steep faces. This nondirectional scan supplies caprock
# fractures so cliff strata do not fold across upward-facing surfaces.
rock_maps = {}
ROCK_SOURCE.mkdir(parents=True, exist_ok=True)
for suffix, expected_md5 in ROCK_MAPS.items():
    name = f'rock_face_03_{suffix}_2k.jpg'
    path = ROCK_SOURCE / name
    url = f'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/rock_face_03/{name}'
    if not path.exists():
        subprocess.run(['curl', '-fLsS', url, '-o', str(path)], check=True)
    if hashlib.md5(path.read_bytes()).hexdigest() != expected_md5:
        raise ValueError(f'Unexpected Poly Haven source checksum: {path}')
    rock_maps[suffix] = {'source': str(path.relative_to(ROOT)), 'url': url,
                        'md5': expected_md5, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
grade(ROCK_SOURCE/'rock_face_03_diff_2k.jpg', WORK/'oxide-weathered-color.webp',
      (117, 81, 55), 1.0, .9)
Image.open(ROCK_SOURCE/'rock_face_03_nor_gl_2k.jpg').save(
    WORK/'oxide-weathered-normal.webp', 'WEBP', quality=96, method=6)
Image.open(ROCK_SOURCE/'rock_face_03_rough_2k.jpg').save(
    WORK/'oxide-weathered-roughness.webp', 'WEBP', quality=96, method=6)
records = [
    {'role':'oxide scree','source':str(SOURCE.relative_to(ROOT)),
     'page':'https://polyhaven.com/a/aerial_ground_rock','author':'Rob Tuytel','license':'CC0-1.0',
     'normal':NORMAL_URL,'meters':7,'mean_srgb':[132,92,58]},
    {'role':'oxide cliff','source':str(cliff.relative_to(ROOT)),
     'page':'https://polyhaven.com/a/cliff_side','license':'CC0-1.0',
     'meters':12,'mean_srgb':[117,81,55],
     'processing':'Restrained source chroma and contrast; original normal and roughness maps retained.'},
    {'role':'weathered oxide mountain','source':rock_maps['diff']['source'],
     'page':'https://polyhaven.com/a/rock_face_03','license':'CC0-1.0',
     'authors':{'Dario Barresi':'Photography','Rico Cilliers':'Processing'},
     'sourceWidthMeters':2.7,'meters':7,'mean_srgb':[117,81,55],
     'sourceMetadata':'https://api.polyhaven.com/info/rock_face_03',
     'sourceFiles':'https://api.polyhaven.com/files/rock_face_03','maps':rock_maps,
     'outputs':{'color':'oxide-weathered-color.webp','normal':'oxide-weathered-normal.webp',
                'roughness':'oxide-weathered-roughness.webp'},
     'processing':'Original 2K resolution and aligned PBR maps retained. Color mean matched to the existing oxide cliff; luminance contrast 1.0, chroma 0.9. No blur, sharpening, or synthetic strata.'},
]
for record in records:
    record['sourceSHA256'] = hashlib.sha256((ROOT/record['source']).read_bytes()).hexdigest()
(WORK/'geology-surface-sources.json').write_text(json.dumps(records, indent=2)+'\n')
print('Prepared scanned scree, legacy cliff, and matched weathered oxide rock maps.')
