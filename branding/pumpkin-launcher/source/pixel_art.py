"""Approved pixel-grid artwork and original repository wordmark."""
import json
from hashlib import sha256
from pathlib import Path
from PIL import Image, ImageColor
SOURCE=Path(__file__).resolve().parent
INK="#191A16"
PAPER="#E9DFC7"

def mark_image():
    data = json.loads((SOURCE / 'pumpkin-block.json').read_text(encoding='utf-8'))
    size = data['grid']
    rows = data['pixels']
    assert len(rows) == size and all(len(row) == size for row in rows)
    image = Image.new('RGBA', (size, size))
    palette = {key: ImageColor.getrgb(color) + (255,) for key, color in data['palette'].items()}
    for y, row in enumerate(rows):
        for x, cell in enumerate(row):
            if cell != '.':
                image.putpixel((x, y), palette[cell])
    return image



def to_svg(image):
    """Emit only complete grid cells, merging adjacent cells of the same color."""
    width, height = image.size
    pixels = image.load()
    rectangles = []
    for y in range(height):
        x = 0
        while x < width:
            rgba = pixels[x, y]
            if rgba[3] == 0:
                x += 1
                continue
            end = x + 1
            while end < width and pixels[end, y] == rgba:
                end += 1
            r, g, b, a = rgba
            assert a == 255
            rectangles.append(f'<rect x="{x}" y="{y}" width="{end - x}" height="1" fill="#{r:02x}{g:02x}{b:02x}"/>')
            x = end
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}" shape-rendering="crispEdges" data-pixel-grid="1">'
            + ''.join(rectangles) + '</svg>\n')


def source_assets(root):
    mark = to_svg(mark_image())
    light = (root / 'wordmark/light.svg').read_text(encoding='utf-8')
    dark = (root / 'wordmark/dark.svg').read_text(encoding='utf-8')
    mark_inner = mark.split('>', 1)[1].rsplit('</svg>', 1)[0]
    wordmark_inner = light.split('>', 1)[1].rsplit('</svg>', 1)[0]
    lockup = ('<svg xmlns="http://www.w3.org/2000/svg" width="443" height="64" viewBox="0 0 443 64" shape-rendering="crispEdges">'
              '<svg x="0" y="0" width="64" height="64" viewBox="0 0 16 16">' + mark_inner + '</svg>'
              '<svg x="86" y="12" width="357" height="40" viewBox="0 0 357 40">'
              + wordmark_inner + '</svg></svg>\n')
    return {root / 'assets/mark.svg': mark,
            root / 'assets/lockup.svg': lockup,
            root / 'wordmark/light.svg': light,
            root / 'wordmark/dark.svg': dark}


def reference_info():
    return {'construction': 'approved 16x16 pumpkin grid and original GitHub wordmark',
            'markGrid': [16, 16], 'wordmarkViewBox': [357, 40],
            'gridSha256': sha256((SOURCE / 'pumpkin-block.json').read_bytes()).hexdigest(),
            'wordmarkOrigin': json.loads((SOURCE / 'wordmark-origin.json').read_text(encoding='utf-8')),
            'replacementFonts': False}
