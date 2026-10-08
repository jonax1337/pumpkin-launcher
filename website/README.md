# Pumpkin Launcher website

Standalone English-language static marketing site built with HTML, CSS, GSAP and ScrollTrigger, independently of Tauri. It uses the launcher's original fonts, pixel icons, seasonal Buddy logos and landscape artwork.

## Development and deployment

From the repository root, after installing the root dependencies:

```sh
pnpm dev:website       # http://127.0.0.1:1430
pnpm build:website     # website/dist
pnpm preview:website   # http://127.0.0.1:1431
```

`website/dist/` is the deployment output. Relative paths (`base: "./"`) support subdirectory hosting. `.github/workflows/website.yml` deploys GitHub Pages; the desktop launcher build stays separate. `pnpm check:website` is the local asset/link reference tool.

Fonts, images and animation scripts are served locally. The site has no trackers or release-metadata requests. GitHub and official installation-support pages are contacted only when visitors follow their links.

## Files and behavior

- `index.html`: English landing page, features, FAQ and platform download links. Main sections use a viewport-height minimum and grow with content on smaller screens. The beta is not tied to a displayed version. No app screenshots, trailer, download-verification disclosure or seasonal-logo strip.
- `main.js`: seasonal branding and initialization of navigation, downloads, icons and motion.
- `motion.js`: a one-time page-load entrance with masked headline reveals, landscape zoom and staggered content; focus, pointer activation or wheel input completes it immediately. Desktop scenes add scroll-driven card entrances, deeper parallax and pointer-responsive card tilt, followed by a staged outro. Effects use transforms and opacity, without scroll snapping or pinning. Reduced motion disables these effects; touch/mobile layouts use lighter entrances without parallax or tilt.
  Scroll reveals prepare offscreen start states before entering the viewport. Visible/restored content skips entrance setup, and entered containers remain recorded across breakpoint and reduced-motion changes so completed text does not disappear and replay.
- `disclosures.js`: reversible height transitions for native FAQ disclosures. Reduced motion opens/closes instantly; resize or a preference change finishes an active transition. Completed transitions clear fixed heights and refresh scroll positions. The FAQ heading stays top-aligned.
- `icons.js`: renders the shared launcher pixel icons, including the icon-only back-to-top control on all pages.
- `navigation.js`: normal same-page link activation scrolls smoothly and moves keyboard focus without adding a URL fragment or history entry. Reduced motion uses instant scrolling. The marketing header overlays the hero, then gains a background after scrolling; legal headers remain opaque and sticky. Back-to-top uses the existing button styles and returns to document top. Modified clicks retain native behavior; without JavaScript, anchor links and native disclosures remain available and the header stays opaque.
- `download.js`: local platform detection, download-card ordering and button labels, without network requests. Unknown/mobile systems retain neutral labels.
- `install-guides.js`: OS-specific installation and first-launch instructions in a shared native dialog. Info buttons reuse launcher icons and button styles; keyboard focus stays in the guide and returns to its opener. Escape, the close button and a backdrop click dismiss it. The document stays still while the guide scrolls. Without JavaScript, a README link supplies installation instructions.
- `privacy/index.html`, `legal-notice/index.html`: English privacy and operator information at `/privacy/` and `/legal-notice/`, with no `.html` in navigation URLs. Directory-index output works on static hosting, including GitHub Pages subdirectories. Both share `style.css`, fonts, icons and navigation through `legal.js`.
- `style.css`: global square, beveled pixel scrollbars adapted from the launcher's scrollbar styles (`src/styles/base.css`) for Chromium/WebKit, with standard scrollbar colors for other engines and system colors in forced-color mode. Scrolling stays browser-managed. Download dividers span the full page width; hero type and spacing respond to viewport height rather than fixed desktop minimums.
  Header navigation and footer copy use equal-width side columns to stay centered independently of adjacent content. World-card frames render in a foreground layer above the transformed art. Button hover feedback changes colors and shadows without moving icons; the hero has a single download action.
- `vite.config.mjs`: build inputs and staging of approved branding SVGs.

Download links use `/releases/latest/download/<name>` with stable names created by the release workflow: `Pumpkin.Launcher_x64-setup.exe`, `Pumpkin.Launcher_universal.dmg`, `Pumpkin.Launcher_amd64.AppImage` and `Pumpkin.Launcher_amd64.deb`. Changing names requires corresponding updates in the workflow, `index.html` and `check.mjs` (`STABLE_ASSETS`). These links require a published release containing the named assets. Checksums and attestations remain available through GitHub releases; the website no longer has a separate verification disclosure. See [release packaging](../CONTRIBUTING.md#release-packaging).

## Asset sources

| Asset | Source |
|---|---|
| `assets/brand/` | Staged by Vite from `branding/pumpkin-launcher/assets/*/mark.svg` and `web/favicon.svg`; not versioned |
| Pixel icons | `src/pixel/icon-data.ts` |
| `assets/world-*.png` | `SceneHost` / `src/pixel/scene.ts`: seed 27, flat mode, standard sun anchor, forest/nether/snow/sea biomes |
| `assets/platform-windows.svg` | Pixel treatment of the square symbol from the [Windows 11 logo source](https://upload.wikimedia.org/wikipedia/commons/e/e6/Windows_11_logo.svg), with original blue scenery |
| `assets/platform-macos.svg` | Pixel treatment of the [Apple vector from Simple Icons](https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/apple.svg), with original purple scenery |
| `assets/platform-linux.svg` | Original pixel penguin and teal scenery; the penguin appears only on Linux |
| Fonts | Latin Hanken Grotesk variable, Big Shoulders Display 800 and Jersey 10; unused weights/subsets are excluded |

Landscape images below the hero load lazily. Seasonal primary branding uses the same local-date calendar as the app (`src/branding/calendar.ts`); only the footer's seasonal collection has been removed. See [branding](../branding/pumpkin-launcher/README.md).

Existing screenshot and trailer source assets are not referenced by the website and do not enter `dist/`. The repository's main README still uses `assets/launcher-home.png`.

For browser verification, use Playwright against `pnpm preview:website`: check desktop/mobile layouts, sticky navigation, icon-only back-to-top, keyboard focus, FAQ disclosures, OS guide selection/focus cycling/closing, legal routes and download targets. Ensure opening a guide does not move the page or download cards, and mobile guides scroll without hiding the close control. Exercise rapid section jumps, resize and reduced-motion changes with GSAP enabled. Preview with `--base /pumpkin-launcher/` to verify subdirectory links. Compare initial resource transfer sizes in fresh browser contexts at the same viewport; local measurements do not establish production load times.
