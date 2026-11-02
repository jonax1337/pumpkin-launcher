"""Generate committed NSIS art; normal app builds only copy these bitmaps.

Run: python branding/pumpkin-launcher/installer/build.py
Requires the existing branding Pillow dependency, Node, and sharp (or
PUMPKIN_SHARP_PATH), exactly as source/render-svg.cjs does.
"""

import base64
from io import BytesIO
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
BRAND = ROOT.parent
BACKGROUND = '#101521'
PANEL = '#171E2C'
GRID = '#202838'
ORANGE = '#E39860'
SCALE = 2


def load_wordmark() -> Image.Image:
    result = subprocess.run(
        ['node', str(ROOT / 'render-wordmark.cjs')],
        check=True, capture_output=True, text=True,
    )
    with Image.open(BytesIO(base64.b64decode(result.stdout))) as image:
        return image.convert('RGBA')


def paste_scaled(canvas: Image.Image, image: Image.Image, box: tuple[int, int, int, int]) -> None:
    x, y, width, height = box
    factor = min(width / image.width, height / image.height)
    if factor >= 1:
        factor = int(factor)
    scaled = image.resize((round(image.width * factor), round(image.height * factor)), Image.Resampling.NEAREST)
    canvas.paste(scaled, (x + (width - scaled.width) // 2, y + (height - scaled.height) // 2), scaled)


def sidebar(mark: Image.Image, wordmark: Image.Image, accent: str) -> Image.Image:
    canvas = Image.new('RGB', (164, 314), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((18, 24, 42, 26), fill=ORANGE)
    # Original repository wordmark and its original word boundaries.
    paste_scaled(canvas, wordmark.crop((0, 0, 156, 40)), (18, 39, 117, 30))
    paste_scaled(canvas, wordmark.crop((171, 0, 357, 40)), (18, 70, 130, 28))
    draw.rectangle((18, 119, 147, 252), fill=PANEL)
    for x in range(26, 147, 12):
        for y in range(127, 252, 12):
            draw.point((x, y), fill=GRID)
    draw.line((18, 134, 18, 119, 33, 119), fill=accent, width=2)
    draw.line((132, 252, 147, 252, 147, 237), fill=accent, width=2)
    draw.rectangle((46, 235, 117, 238), fill=BACKGROUND)
    paste_scaled(canvas, mark, (18, 122, 128, 128))
    draw.rectangle((18, 279, 145, 279), fill=GRID)
    draw.rectangle((18, 279, 49, 280), fill=accent)
    for index, color in enumerate((ORANGE, accent, '#F6E7C8')):
        draw.rectangle((18 + index * 8, 293, 21 + index * 8, 296), fill=color)
    return canvas


def header(mark: Image.Image, wordmark: Image.Image, accent: str) -> Image.Image:
    canvas = Image.new('RGB', (150, 57), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    paste_scaled(canvas, mark, (4, 9, 40, 40))
    paste_scaled(canvas, wordmark.crop((0, 0, 156, 40)), (50, 12, 78, 20))
    paste_scaled(canvas, wordmark.crop((171, 0, 357, 40)), (50, 31, 93, 20))
    draw.rectangle((50, 7, 66, 8), fill=accent)
    return canvas


def build() -> None:
    wordmark = load_wordmark()
    with Image.open(BRAND / "assets/32x32.png") as source:
        mark = source.convert("RGBA")
    for name, render in (("sidebar", sidebar), ("header", header)):
        image = render(mark, wordmark, ORANGE)
        size = (image.width * SCALE, image.height * SCALE)
        image.resize(size, Image.Resampling.NEAREST).save(ROOT / f"{name}.bmp")
    print("Generated Pumpkin Block installer artwork: sidebar 328x628, header 300x114.")


if __name__ == '__main__':
    build()
