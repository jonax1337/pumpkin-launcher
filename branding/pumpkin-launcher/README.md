# Pumpkin Launcher branding

The approved identity is Pumpkin Block: a shaded 16×16 carved pumpkin with twelve solid colors. The original pre-branding wordmark is unchanged.

## Sources

- source/pumpkin-block.json: editable pixels and palette.
- source/pixel_art.py: SVG generation from whole pixel cells.
- wordmark/light.svg and dark.svg: approved original SVGs.
- source/wordmark-origin.json: original GitHub commit and blob hashes.
- source/FONT-LICENSE.txt: original wordmark font license.

## Exports

assets/ contains the canonical SVG mark, lockup and PNG/ICO/ICNS exports. web/ contains favicons. installer/ contains committed Windows artwork. manifest.json records source and export hashes.

The title bar displays only the original wordmark. The pumpkin is used for app/window icons and other brand slots. There are no seasonal variants or mascot animations.

## Regeneration

Normal builds use committed exports. Regeneration requires requirements.txt, Node.js and Sharp (local, PUMPKIN_SHARP_PATH, or the existing Codex runtime cache).

    python branding/pumpkin-launcher/build.py
    node scripts/sync-branding.mjs
    python branding/pumpkin-launcher/build.py --check
    pnpm check:branding

The generator preserves the approved wordmarks and verifies their GitHub blob hashes. It checks pixel-grid integrity, native formats and manifest hashes.

Windows icons are explicit Cargo build dependencies. Each native window also receives the current PNG icon when created, including during development.

The native installer theme and UI fonts are unchanged. See [theme rebuild instructions](../../CONTRIBUTING.md#windows-installer-template).
