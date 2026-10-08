"""Generate committed private installer TTFs from the locked Fontsource packages.

Run: python branding/pumpkin-launcher/installer/build-fonts.py
Generator only: pip install fonttools brotli. Ordinary builds use committed TTFs.
Latin subsets cover the installer's English and German strings. Both upstream
licenses are SIL OFL 1.1 without a declared Reserved Font Name. Fonts are rescaled to
1000 units per em because GDI DrawText (Uniscribe) rejects Big Shoulders at 2000 and
falls back to Arial.
"""

from pathlib import Path
import shutil

from fontTools.ttLib import TTFont
from fontTools.ttLib.scaleUpem import scale_upem
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[3]
DESTINATION = ROOT / 'src-tauri/installer/theme/fonts'
PACKAGES = ROOT / 'node_modules'


def convert(package: str, source: str, filename: str, family: str, weight: int) -> None:
    with TTFont(PACKAGES / package / 'files' / source, recalcTimestamp=False) as font:
        if 'fvar' in font:
            instantiateVariableFont(font, {'wght': weight}, inplace=True)
        font.flavor = None
        if font['head'].unitsPerEm != 1000:
            scale_upem(font, 1000)
        # GDI line height comes from the win metrics; Big Shoulders' are ~40% taller than hhea and clip fixed-height labels.
        font['OS/2'].usWinAscent = font['hhea'].ascent
        font['OS/2'].usWinDescent = -font['hhea'].descent
        font['OS/2'].usWeightClass = weight
        bold = weight >= 700
        font['OS/2'].fsSelection = (font['OS/2'].fsSelection & ~(1 << 5 | 1 << 6)) | (1 << (5 if bold else 6))
        font['head'].macStyle = (font['head'].macStyle & ~1) | int(bold)
        style = 'Bold' if bold else 'Regular'
        names = {1: family, 2: style, 3: f'{family}-{style}-PumpkinInstaller',
                 4: f'{family} {style}', 6: f'{family.replace(" ", "")}-{style}',
                 16: family, 17: style}
        for name_id, value in names.items():
            font['name'].removeNames(nameID=name_id)
            font['name'].setName(value, name_id, 3, 1, 0x409)
        font.save(DESTINATION / filename, reorderTables=True)
        print(f'Generated {filename}: {family} {style}')


def build() -> None:
    DESTINATION.mkdir(parents=True, exist_ok=True)
    hanken = '@fontsource-variable/hanken-grotesk'
    heading = '@fontsource/big-shoulders-display'
    for weight, style in ((400, 'Regular'), (700, 'Bold')):
        convert(hanken, 'hanken-grotesk-latin-wght-normal.woff2',
                f'HankenGrotesk-{style}.ttf', 'Hanken Grotesk', weight)
    convert(heading, 'big-shoulders-display-latin-700-normal.woff',
            'BigShouldersDisplay-Bold.ttf', 'Big Shoulders Display', 700)
    for package, name in ((hanken, 'HankenGrotesk'), (heading, 'BigShouldersDisplay')):
        shutil.copyfile(PACKAGES / package / 'LICENSE', DESTINATION / f'{name}-OFL.txt')


if __name__ == '__main__':
    build()
