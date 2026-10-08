# Pumpkin Launcher branding

Buddy and four seasonal variants share a 32×32 design grid. The approved `mark.svg` in each season directory is the source of truth: the UI scales SVG directly, and native icons are rendered from the same artwork. There are no separate miniature or monochrome tray designs.

## Assets and calendar

| Directory | Variant | Automatic local-date window |
|---|---|---|
| `assets/standard/` | Buddy | September and November 3–30; fallback outside seasonal windows |
| `assets/spring/` | Bloom Buddy | March 1–May 31 |
| `assets/summer/` | Sunny Buddy | June 1–August 31 |
| `assets/halloween/` | Hex Buddy | October 1–November 2 |
| `assets/winter/` | Frost Buddy | December 1–end of February |

`seasons.mjs` defines the calendar used by the preview and app integration. Each directory contains `mark.svg`, outlined `lockup.svg`, `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico` and `icon.icns`. Raster files are native-system exports, not UI sources.

- `wordmark/`: light/dark outlined wordmarks.
- `web/`: standard SVG/ICO favicon.
- `index.html`: seasonal preview with date selection.
- `overview.png`: asset-family overview.
- `manifest.json`: asset paths, byte sizes and hashes.
- [`motion/`](motion/README.md): animated SVGs and static posters.
- `source/FONT-LICENSE.txt`: Jersey 10 font license.
- `pumpkin-launcher-assets.zip`: generated asset/source package.

The shared palette uses orange `#E9904D`, highlight `#F8BD72`, plum shadow `#784153` and outline `#2B2433`, with leaf greens `#69866E` and `#ADC795`. Seasonal accessories change the expression without replacing Buddy's base shape. Jersey 10 is the wordmark font; the app also uses Big Shoulders Display and Hanken Grotesk.

## Regeneration

**Consumers do not regenerate.** App/website builds stage committed `assets/`, `web/`
and `motion/` files without running either Python generator.

**Static regeneration prerequisites:** install Pillow into the Python interpreter used
below (`python -m pip install Pillow`) and install Node.js. The renderer
[`source/render-svg.cjs`](source/render-svg.cjs) first tries `require('sharp')`; if unavailable,
it uses `PUMPKIN_SHARP_PATH` or, when unset, a machine-specific Codex runtime cache.
Sharp is not a root package dependency: `pnpm install` alone does not set up this generator.
For example, install it outside the repository and point to the **package directory**,
not the Node executable:

```powershell
npm install --prefix "$HOME/pumpkin-branding-tools" sharp
$env:PUMPKIN_SHARP_PATH = "$HOME/pumpkin-branding-tools/node_modules/sharp"
```

On a POSIX shell the corresponding environment assignment is
`export PUMPKIN_SHARP_PATH="$HOME/pumpkin-branding-tools/node_modules/sharp"`.
Then regenerate static native icons from the repository root:

```sh
python branding/pumpkin-launcher/build.py
```

**Motion-inclusive packaging has an additional prerequisite:** an external Pixel Art
Studio toolkit that is **not bundled**, with no acquisition URL or pinned version recorded
in this repository. Read [its exact path requirement and reproducibility limit](motion/README.md#preview-and-regeneration)
before attempting the full sequence. Without it, use the committed motion assets; a fresh
checkout cannot reproduce motion generation alone.

Once both static and motion prerequisites are available, run from the repository root:

```sh
python branding/pumpkin-launcher/build.py
python branding/pumpkin-launcher/motion/build.py
python branding/pumpkin-launcher/build.py
```

The sequence is **static → motion → static**: the first step refreshes native exports,
the motion step consumes the approved SVGs, and the final static build incorporates the
new motion hashes/files into `manifest.json` and `pumpkin-launcher-assets.zip`.

`build.py --check` compares native icon sizes with direct SVG renders; `node branding/pumpkin-launcher/seasons.mjs --check` is the calendar-boundary tool. These are developer references, not installation tasks.

## App integration

`src/branding/Brand.tsx` connects seasonal assets to the UI and runtime window/taskbar icon; `src/branding/calendar.ts` selects by local date. `scripts/sync-branding.mjs` stages native package icons during `pnpm dev` and `pnpm build`. Installed executable/installer icons reflect the build season; the running app can update its window icon.

Buddy animations respect reduced motion and pause for running games, hidden windows and offscreen content. The website uses the same calendar and approved SVGs. See [website assets](../../website/README.md).

## Windows installer artwork

`installer/{season}/` contains committed, uncompressed 24-bit BMPs: a 328×628 sidebar
and a 300×114 header (2× the NSIS reference sizes). The artwork reuses the approved
Buddy and outlined wordmark; no translated text is baked into the images.
The installer has no left stripe or decorative side bar beyond this artwork.
`scripts/sync-branding.mjs` stages the build season into `src-tauri/installer/`
alongside the native icons. Regular builds do not need Python or Sharp.

To regenerate all five seasons, use the same Pillow/Node/Sharp prerequisites
described above:

```sh
python branding/pumpkin-launcher/installer/build.py
```

The native theme uses `#101521` for its dark surfaces; keep that background
consistent with the bitmap generator. The theme draws the original bitmaps
proportionally inside NSIS's font-scaled image controls, with unused space filled
by the surrounding surface. Artwork never stretches or overlaps labels.

`src-tauri/installer/theme/PumpkinTheme.cpp` paints the existing native controls:
dark navigation, inputs, checkboxes, progress and title bar, with a copper primary
action and visible keyboard focus. Control IDs, keyboard handling and accessibility
remain native. The installer renders text in Hanken Grotesk (body) and Big Shoulders
Display (larger, uppercase headings), loaded privately from fonts embedded in the theme DLL;
the committed subsets live in `src-tauri/installer/theme/fonts/` with their SIL OFL 1.1
notices. `build-fonts.py` rescales them to 1000 units/em and aligns the Windows
metrics to hhea. Regenerate them with `python branding/pumpkin-launcher/installer/build-fonts.py`
(`pip install fonttools brotli`; Fontsource packages from `pnpm install`), then rebuild the DLL.
Decorative beveled dividers and repeated footer branding are omitted.
System high-contrast palettes take precedence; external Windows dialogs follow
the OS theme. See [theme rebuild instructions](../../CONTRIBUTING.md#windows-installer-template).

