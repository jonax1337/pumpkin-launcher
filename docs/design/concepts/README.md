# Design concepts

Static design history for the Pumpkin Launcher interface. These files are mockups, not part of the app or its build; open them directly in a browser. The implemented system is described in [PIXELKINO.md](../PIXELKINO.md); the code in `src/` is authoritative.

| File | What it is |
| --- | --- |
| `pixelkino.html` | The original Pixelkino composition (scenes, flat dark controls) that the app's palette, pixel grid and scenes came from. |
| `kit-concepts.html` | Overview page showing the four component languages side by side. |
| `kit-klassik.html` + `.css`, `kit-schiefer.html` + `.css`, `kit-sandstein.html` + `.css` | Three alternative component styles (Klassik, Schiefer, Sandstein). Not implemented. |
| `kit-slots.html` + `.css` | **Inventar**, the adopted style: recessed slots, bevelled stone plates with hard text shadow, creative-inventory tabs, item-tooltip menus. |
| `base.css`, `fonts/` | Palette, fonts, pixel grid and notches shared by all `kit-*` pages (same values as `src/styles/base.css`). |
| `launcher/` | Static full-app mockup (all screens, dialogs, menus, the 8×8 icon set) in all four styles. |

## launcher/

`launcher/launcher.html` is generated; do not edit it. `node build.mjs` (run inside `docs/design/concepts/launcher/`) assembles it from `shell.html`, `app.css`, `app.js`, the screen fragments in `screens/` (`*.html`, `*.css`) and the icon drawings in `icons/set-a.mjs` and `set-b.mjs`.

Open a screen with the style and state in the URL, for example `launcher/launcher.html?theme=slots#home`:

- `theme=slots` selects Inventar (the others are `klassik`, `schiefer`, `sandstein`).
- Screens: `#home`, `#library`, `#discover`, `#instance`, `#skins`, `#friends`, `#news`, `#settings`.
- `&open=ov-…` opens a dialog (for example `ov-palette`, `ov-new`, `ov-shortcuts`), `&menu=m-…` opens a menu (`m-account`, `m-tasks`, `m-instance`), `&tab=<group>:<tab>` selects a tab (for example `inst:log`, `set:storage`).

## Adopted style

Inventar (`slots`) was implemented across the whole app. Its tokens and surface classes are in `src/ui/tokens.css` and `src/ui/surface.css`; the 8×8 icon drawings were ported to `src/pixel/icon-data.ts`. The other three styles remain here as reference only.
