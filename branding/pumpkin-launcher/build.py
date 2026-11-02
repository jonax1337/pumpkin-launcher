"""Build clean Pumpkin Block pixel-grid artwork. Run --check to verify grid integrity."""
import base64
from hashlib import sha256, sha1
from io import BytesIO
import json
from pathlib import Path
import shutil
import subprocess
import sys

from PIL import Image

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'source'
sys.path.insert(0, str(SOURCE))
from pixel_art import INK, PAPER, mark_image, reference_info, source_assets

ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)
PNG_FILES = {'16x16.png': 16, '32x32.png': 32, '128x128.png': 128, '128x128@2x.png': 256}


def render_sources():
    result = subprocess.run(['node', str(SOURCE / 'render-svg.cjs')], check=True, capture_output=True, text=True)
    encoded = json.loads(result.stdout)
    decode = lambda value: Image.open(BytesIO(base64.b64decode(value))).convert('RGBA')
    return ({int(size): decode(png) for size, png in encoded['frames'].items()},
            {name: decode(png) for name, png in encoded['wordmarks'].items()})


def verify(frames, wordmarks):
    for path, expected in source_assets(ROOT).items():
        assert path.read_text(encoding='utf-8') == expected, f'Stale grid source: {path}'
        assert '<image' not in expected and '<text' not in expected, f'Not vector-only: {path}'
    reference = mark_image()
    assert frames[16].tobytes() == reference.tobytes(), 'SVG changed the logical 16x16 grid'
    assert frames[256].tobytes() == reference.resize((256, 256), Image.Resampling.NEAREST).tobytes(), 'SVG introduced subpixel edges'
    assert len(reference.getcolors()) <= 13, 'Unexpected texture noise or extra colors'
    for name in ('light', 'dark'):
        raw = (ROOT / 'wordmark' / f'{name}.svg').read_bytes()
        expected_sha = reference_info()['wordmarkOrigin'][name]['gitBlobSha']
        assert sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest() == expected_sha, 'Original GitHub wordmark changed'
        assert wordmarks[name].size == (357, 40), 'Original wordmark proportions changed'
    for filename, size in PNG_FILES.items():
        with Image.open(ROOT / 'assets' / filename) as image:
            assert image.size == (size, size) and image.convert('RGBA').tobytes() == frames[size].tobytes(), filename
    with Image.open(ROOT / 'assets/icon.ico') as ico:
        assert ico.ico.sizes() == {(s, s) for s in ICO_SIZES}
        for size in ICO_SIZES:
            assert ico.ico.getimage((size, size)).convert('RGBA').tobytes() == frames[size].tobytes()
    with Image.open(ROOT / 'assets/icon.icns') as icns:
        for size in icns.info['sizes']:
            assert icns.icns.getimage(size).convert('RGBA').tobytes() == frames[size[0] * size[2]].tobytes()
    assert (ROOT / 'web/favicon.svg').read_bytes() == (ROOT / 'assets/mark.svg').read_bytes()
    with Image.open(ROOT / 'web/favicon.ico') as ico:
        assert ico.ico.sizes() == {(s, s) for s in (16, 32, 48)}
        for size in (16, 32, 48):
            assert ico.ico.getimage((size, size)).convert('RGBA').tobytes() == frames[size].tobytes()
    for filename, expected in [('sidebar.bmp', (328, 628)), ('header.bmp', (300, 114))]:
        with Image.open(ROOT / 'installer' / filename) as image:
            assert image.size == expected and image.mode == 'RGB', filename
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    assert manifest['identity'] == 'Pumpkin Block'
    assert manifest['reference'] == reference_info()
    for path, info in manifest['files'].items():
        data = (ROOT / path).read_bytes()
        assert len(data) == info['bytes'] and sha256(data).hexdigest() == info['sha256'], path
    print('Pumpkin Block verified: 16x16 mark, unchanged original GitHub wordmarks, native exports and manifest.')


def build():
    if '--check' in sys.argv:
        verify(*render_sources())
        return
    for path, content in source_assets(ROOT).items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8', newline='\n')
    frames, wordmarks = render_sources()
    for filename, size in PNG_FILES.items():
        frames[size].save(ROOT / 'assets' / filename)
    frames[256].save(ROOT / 'assets/icon.ico', sizes=[(s, s) for s in ICO_SIZES], append_images=[frames[s] for s in ICO_SIZES])
    frames[1024].save(ROOT / 'assets/icon.icns', append_images=[frames[s] for s in (32, 64, 128, 256, 512, 1024)])
    (ROOT / 'web').mkdir(exist_ok=True)
    frames[48].save(ROOT / 'web/favicon.ico', sizes=[(s, s) for s in (16, 32, 48)], append_images=[frames[s] for s in (16, 32, 48)])
    shutil.copyfile(ROOT / 'assets/mark.svg', ROOT / 'web/favicon.svg')
    shutil.copyfile(ROOT / 'assets/mark.svg', ROOT.parents[1] / 'app-icon.svg')
    subprocess.run([sys.executable, str(ROOT / 'installer/build.py')], check=True)
    paths = [p for folder in ('assets', 'wordmark', 'web') for p in (ROOT / folder).rglob('*') if p.is_file()]
    paths += [ROOT / 'installer' / f for f in ('sidebar.bmp', 'header.bmp')]
    manifest = {'brand': 'Pumpkin Launcher', 'identity': 'Pumpkin Block', 'sourceFormat': 'SVG paths',
                'canvas': [16, 16], 'grid': 16, 'reference': reference_info(),
                'mark': 'assets/mark.svg', 'wordmark': 'wordmark/light.svg',
                'palette': {'ink': INK, 'primary': '#C77829', 'highlight': '#E8AE4C', 'leaf': '#68763C', 'paper': PAPER},
                'files': {p.relative_to(ROOT).as_posix(): {'bytes': p.stat().st_size, 'sha256': sha256(p.read_bytes()).hexdigest()} for p in sorted(paths)}}
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    verify(frames, wordmarks)
    print(f'Built clean Pumpkin Block grid artwork: {len(paths)} assets.')


if __name__ == '__main__':
    build()
