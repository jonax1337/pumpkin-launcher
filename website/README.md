# Pumpkin Launcher website

Standalone static marketing site built with HTML, CSS, GSAP and ScrollTrigger, independently of Tauri. It uses the launcher's original fonts, pixel icons, seasonal Buddy logos and landscape artwork.

## Development and deployment

From the repository root, after installing the root dependencies:

```sh
pnpm dev:website       # http://127.0.0.1:1430
pnpm build:website     # website/dist
pnpm preview:website   # http://127.0.0.1:1431
```

`website/dist/` is the deployment output. Relative paths (`base: "./"`) support subdirectory hosting. `.github/workflows/website.yml` deploys GitHub Pages; the desktop launcher build stays separate. `pnpm check:website` is the local asset/link reference tool.

Fonts, images and GSAP are served locally. The site has no trackers and does not fetch release metadata. External GitHub navigation occurs only when visitors follow a link.

## Files and behavior

- `index.html`: landing page, app tour, trailer, FAQ and platform download links.
- `main.js`: scroll animation, trailer playback and seasonal branding. Mobile and reduced-motion layouts show the app views without the pinned tour; without JavaScript, content and navigation remain available.
- `download.js`: local platform detection, download-card ordering and button labels, without network requests. Unknown/mobile systems retain neutral labels.
- `datenschutz.html`, `impressum.html`: privacy and operator information, built as separate pages sharing `style.css` and `legal.js`.
- `vite.config.mjs`: build inputs and staging of approved branding SVGs.

Download links use `/releases/latest/download/<name>` with stable names created by the release workflow: `Pumpkin.Launcher_x64-setup.exe`, `Pumpkin.Launcher_universal.dmg`, `Pumpkin.Launcher_amd64.AppImage`, `Pumpkin.Launcher_amd64.deb` and `SHA256SUMS`. Changing names requires corresponding updates in the workflow, `index.html` and `check.mjs` (`STABLE_ASSETS`). These links require a published release containing the named assets. See [release packaging](../CONTRIBUTING.md#release-packaging).

## Asset sources

| Asset | Source |
|---|---|
| `assets/brand/` | Staged by Vite from `branding/pumpkin-launcher/assets/*/mark.svg` and `web/favicon.svg`; not versioned |
| Pixel icons | `src/pixel/icon-data.ts` |
| `assets/world-*.png` | `SceneHost` / `src/pixel/scene.ts`: seed 27, flat mode, standard sun anchor, forest/nether/snow/sea biomes |
| `assets/launcher-*.png` | Desktop-app browser captures for home, library, instance and discovery; replace when their layout changes |
| `assets/trailer.mp4` | Silent web encoding of `media/launch-video/videos/pumpkin-launcher-yt-16x9.mp4` |
| `assets/trailer-poster.jpg` | Trailer frame at 22.5 seconds |
| Fonts | Root Big Shoulders Display, Hanken Grotesk and Jersey 10 packages |

The trailer loads near its section, pauses out of view and starts paused for reduced motion; without JavaScript its poster remains. Seasonal branding uses the same local-date calendar as the app (`src/branding/calendar.ts`). See [branding](../branding/pumpkin-launcher/README.md) and [video sources](../media/launch-video/README.md).

The repository records the source video and poster time above, but contains no encoding/
frame-extraction script or pinned command/codec settings for these two website files.
`pnpm build:website` stages existing assets; it does not re-encode the retained video or
extract a new poster. The video project's render scripts likewise stop at composition
exports. Consequently the exact compressed trailer/poster cannot be regenerated from a
repository command alone. Retain the existing web assets unless deliberately replacing
both `assets/trailer.mp4` (silent MP4) and `assets/trailer-poster.jpg` (22.5-second frame)
from the updated landscape export; changing only `media/launch-video/videos/` does not
propagate to the website.
