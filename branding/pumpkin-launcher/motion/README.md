# Buddy motion

Twelve animations for each of the five Buddy variants: 60 SVG files, plus one static `poster.svg` per season. Assets use a fixed 48×48 canvas with the 32×32 mascot anchored at 8/8. Native SVG-SMIL switches pixel-grid poses without an external runtime library.

## Assets

Season directories are `standard/`, `spring/`, `summer/`, `halloween/` and `winter/`.

| File | Motion | Playback |
|---|---|---|
| `idle.svg` | Floating and blinking | Loop |
| `hello.svg` | Hop and wave | Once |
| `loading.svg` | Glance and three progress pixels | Loop |
| `success.svg` | Jump and confetti | Once |
| `oops.svg` | Head shake | Once |
| `sleep.svg` | Closed eyes and rising Z | Loop |
| `curious.svg` | Tilt and question mark | Loop |
| `nod.svg` | Two nods | Once |
| `giggle.svg` | Laugh and small wobble | Once |
| `surprise.svg` | Wide eyes and short recoil | Once |
| `pout.svg` | Drooping leaf and half-closed eyes | Once |
| `love.svg` | Wink and rising heart | Once |

One-shot reactions end in the original resting pose. `manifest.json` contains paths, durations and loop behavior. Animations do not replace textual status or error messages.

## Usage

Use an image for autonomous playback:

```html
<img src="motion/standard/idle.svg" width="96" height="96" alt="Buddy">
```

For playback control, load the same-origin SVG as an `<object>` and access its root after `load`. The root provides `setCurrentTime(0)`, `pauseAnimations()` and `unpauseAnimations()`. Class `is-static` forces the poster state. `prefers-reduced-motion: reduce` always shows the static version.

App integration should pause playback while hidden, offscreen or during a running game. The preview already pauses hidden cards/tabs; once-only reactions repeat only when explicitly enabled there.

## Preview and regeneration

`index.html` exposes season selection, pause/replay and a time scrubber. The GIF previews and `qa/` pose sheets are visual aids, not runtime assets.

Run from the repository root after installing Pillow (`python -m pip install Pillow`).
The external Pixel Art Studio toolkit is **not included in this repository**, and no
acquisition URL or pinned toolkit version is recorded here. Set `PIXEL_ART_STUDIO_PATH`
to its root containing `scripts/pixelstudio` (a Python module/package exporting `Sprite`);
the generator adds `<root>/scripts` to Python's import path. Without an override it uses
`~/.codex/skills/pixel-art-studio`. The environment variable must not point directly to
`scripts/` or to the `pixelstudio` module.

Without that toolkit, motion regeneration cannot be reproduced from this repository alone.
Use the shipped seasonal SVGs/posters for app and website consumption; no toolkit or Python
is required for playback. After regeneration, run the final static build in the
[branding sequence](../README.md#regeneration) to refresh the combined asset ZIP.

```sh
python branding/pumpkin-launcher/motion/build.py
```

The generator reads the approved [branding SVGs](../README.md), checks their pixel hashes, validates pose dimensions, safety margins, binary alpha and loop/resting endpoints, then packages assets and sources in `pumpkin-mascot-motion.zip`.
