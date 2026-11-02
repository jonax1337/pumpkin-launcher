# Pumpkin Launcher launch video

A 44-second, 60 fps continuous camera move through a pixel world, with Pumpkin Block and a synthesized chiptune soundtrack. HyperFrames renders the HTML/GSAP composition into landscape and portrait MP4s.

## Sources

| Path | Purpose |
|---|---|
| `src/film.js` | World, camera and timeline |
| `src/pixel.js` | Seeded pixel-art generators |
| `src/film.css` | Composition styling |
| `audio/music.py` | Deterministic music and sound-effect synthesis |
| `build.mjs` | Stage composition sources, the fixed Pumpkin Block, logos, fonts and audio |
| `yt/` | 1920×1080 HyperFrames project |
| `tiktok/` | 1080×1920 project for Shorts/Reels/TikTok |

`yt/src`, `yt/assets`, `tiktok/src`, `tiktok/assets` and `audio/soundtrack.wav` are generated. The build reads Pumpkin Block assets from `branding/` and fonts from the root dependencies; branding edits flow into the next render.

## Usage

Requires root dependencies (`pnpm install`), Node 24 and Python 3 with NumPy and SciPy. Package scripts pin HyperFrames CLI 0.8.138 through `npx`.

The [package scripts](package.json) invoke **`python`**, so install into that same
interpreter before building:

```sh
python --version
python -m pip install numpy scipy
```

Confirm that `python --version` reports Python 3. If your system provides Python 3 only
as `python3`, check `python3 --version` and use `python3 -m pip install numpy scipy`,
but also arrange for the scripts' `python` command to resolve to that same interpreter
(for example, activate its virtual environment). Installing into an unrelated Python
does not satisfy the build.

From this directory:

```sh
npm run build
npm run preview:yt       # or preview:tiktok
npm run render
```

Render output goes to `yt/renders/pumpkin-launcher-yt-16x9.mp4` and `tiktok/renders/pumpkin-launcher-tiktok-9x16.mp4`. Generated exports remain outside the tracked source tree. `npm run check` is the optional HyperFrames layout/contrast tool for both compositions.

## Composition

At 120 BPM, each bar lasts two seconds. The Pumpkin Block appears under an aurora, visits the Modrinth/CurseForge/FTB/Technic islands, gathers their content, reveals the launcher and launches into a world before the wordmark outro.

Camera position and log-zoom use monotone cubic interpolation, with banking, parallax and beat-synced motion. Seeded graphics and timeline-based `render(t)` make frames reproducible. The Pumpkin Block is the same fixed SVG used by the launcher; the composition moves the mark without changing its artwork. World text uses `data-layout-allow-occlusion` because the effect canvas is treated as opaque by the layout tool; foreground text remains included in its analysis.
