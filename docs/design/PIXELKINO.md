# Pixelkino design reference

Last updated: 2026-10-09.

Pixelkino is Pumpkin Launcher's dark pixel interface, rendered in the **Inventar** style: a game-menu look made of recessed slots, bevelled stone plates with a hard text shadow, creative-inventory tabs, item-tooltip menus, XP-bar progress and hotbar-style selection. Scenes are the visually expressive layer; controls and page backgrounds stay flat and quiet. Current styles and components are authoritative. This document is the design language; the component kit (`src/ui`) and its API, rules and pitfalls are described in [`src/ui/README.md`](../../src/ui/README.md).

Static design references (not implemented code, open in a browser):

- [concepts/kit-concepts.html](concepts/kit-concepts.html): component languages side by side; Inventar is the adopted one.
- [concepts/launcher/launcher.html](concepts/launcher/launcher.html): the complete launcher (all screens, dialogs, menus, 8×8 icon set) as a static mockup. Open it with `?theme=slots#<screen>` for Inventar. Regenerate it with `node build.mjs` in `concepts/launcher/`.

The [`concepts/`](concepts/README.md) folder is design history; it is not edited when the app changes.

To open the component examples, follow [development setup](../../CONTRIBUTING.md#development-setup),
run `pnpm dev` from the repository root and visit
[`http://localhost:1420/_kit`](http://localhost:1420/_kit). This is the browser development
route with mock data (`src/ui/KitPage.tsx`), not a shipped player page.

## Source map

| Concern | Source, relative to repository root |
| --- | --- |
| Global colors, fonts, pixel unit default, notches, reset, scrollbars, focus, text helpers | `src/styles/base.css` |
| App shell (window bar, side bar, plate, scenes) and shared page frame | `src/styles/shell.css` |
| Page styles, next to their page | `src/pages/**/*.css` (for example `home/home.css`, `instances/library.css`, `detail/detail.css`, `discover.css`, `announcements.css`) |
| Dialog, onboarding, account and friends content | `src/components/dialogs.css`, `src/components/onboarding.css`, `src/components/accounts/accounts.css`, `src/components/friends/friends.css` |
| Kit components, look, tokens, Tailwind bridge, preview | `src/ui/` (`*.tsx`, `look.css` + `look/*.css`, `tokens.css`, `surface.css`, `theme.css`, `KitPage.tsx`); see `src/ui/README.md` |
| Pixel unit and icon cell sizes | `src/pixel/unit.ts` |
| Icon set (8×8 drawings) | `src/pixel/icon-data.ts`, rendered by `src/ui/Icon.tsx` |
| Scene generation/configuration | `src/pixel/{scene,sceneBuilder,sceneConfig}.ts`, `PixelScene.tsx` |
| Play/status controls | `src/components/play/`, `src/components/play.css` |
| Motion, accessibility and prose (Markdown) styles | `src/ui/motion.css`, `src/ui/a11y.css`, `src/ui/prose.css` |
| Appearance and shortcuts | `src/app/useAppearance.ts`, `shortcuts.ts`, `mainTabs.ts` |
| Command palette (Ctrl/Cmd+K) | `src/app/palette/` |
| Seasonal branding | `src/branding/` (`branding.css`), repository `branding/` assets |

`src/index.css` imports the base, shell, page, dialog, kit (`ui/ui.css`), play and branding stylesheets into `@layer components`; a few pages import their own stylesheet. Components never import CSS themselves. `index.html` establishes `theme, base, components, utilities`. Layer order and the rules for page CSS are in `src/ui/README.md`. Shared surfaces and kit components use `lk-` classes plus data attributes for variants. Class names must not accidentally collide with Tailwind utilities.

## Inventar style

One concept, one class: shared surfaces live in `src/ui/surface.css`; components add the class and set only size and state.

| Surface | Class | Recipe |
| --- | --- | --- |
| Recessed slot | `.lk-slot` | `--sunk` fill, 1-unit border `--slot-bd` (dark top/left `--edge`, light bottom/right `--ctl`, ≥ 3:1), inset shadow `--slot-sh` (2 units dark top/left, 1 unit light bottom/right). Used by fields, selects, checkboxes, slider/progress tracks, icon tiles, chips, image frames, `kbd` caps. Hover: border `--fg-2`. Focus: border `--focus` + `--ring-i`. |
| Recessed, not interactive | `.lk-pit` | Same look without hover/focus colouring: dialog bodies, note plates, progress tracks. |
| Raised stone plate | `.lk-stone` | Face `--face` (default `--panel-3`), 1-unit `--edge` border, bevel `--bv` = 2 units (`--hi` top/left, `--lo` bottom/right); `--bv` is 1 unit for size `s`. Pressed reverses the bevel and moves content down 1 unit. Disabled is flat (`--panel`, `--line`). Used by buttons, tab handles, slider grips, toasts, dialogs, sheets. |
| Hard text shadow | `.lk-text` | `text-shadow: var(--tsh)` = `0 var(--px) 0 #000`, on stone and slot labels. |

Components in this language:

- **Buttons** (`look.css`): secondary = stone; primary and danger = stone in the instance accent (`--acc`, `--acc-hi`, `--acc-lo`) or red; ghost is flat and becomes a slot on hover. Hover brightens face and border, press reverses the bevel, focus is the double ring. Over scenes, ghost/secondary use a dark plate (`--scene-plate`) and a hard shadow.
- **Tabs** (`look/tabs.css`): creative-inventory tabs. The bar variant rises from a baseline, the selected tab is taller, has an accent edge on top and no bottom border; vertical tabs are stacked plates and the selected one reaches the right edge; segments are a slot group whose selected item is a stone with an accent edge below.
- **Menus, popovers, select lists, tooltips** (`look/overlay.css`): item-tooltip frame: `--tip-bg` fill, `--tip-a` border, inner `--tip-b` ring, 2-unit hard drop shadow. Highlighted entries use `--hl` plus a 2-unit focus bar; `MenuHead` provides an account-style header row. Dialogs and side sheets are stone plates with a recessed (`.lk-pit`) body.
- **Overlay sizes** (`Dialog.tsx`, `Menu.tsx`, `Popover.tsx`, no pixel values at the call site): `Dialog size` s/m/l = 480/640/860 px wide, `Dialog height` s/m/l = 380/580/700 px fixed (always capped by the window; without it the dialog fits its content). Header 40 (title 26, close `IconButton` s), footer 52 (ghost cancel, primary right), body padding 16. Menus: min 240, `wide` 320, items 36, icons 16; `Popover size` m/l = 320/400. Toasts are 460 wide, 12 apart, 24 from the corner.
- **Progress** (`look/feedback.css`): XP bar. Track is a slot with grid ticks every 4 units; the fill is accent with light top and dark bottom row, segment gaps every 4 units, a highlight at the tip, rounded to whole segments. Sliders share the cell logic (16 cells, stone grip).
- **Toasts**: advancement plates (icon slot, text, action, close).
- **Selection**: chosen cards and tiles get an accent border and `--acc-dim` tint (choice rows add a ▶ arrow); chosen library rows get a hotbar notch (2-unit accent bar at the left); the current item is marked by an accent bar. Hover is a surface, never a line.
- **Chips and keys**: small slot in pixel font with a square pip in the tone colour; `kbd` caps (palette, shortcuts overview) are slots in pixel font.
- **Console**: warning/error lines carry a coloured 2-unit bar and tint, not colour alone.

## Tokens

Palette and geometry live in `src/styles/base.css`; the Inventar block in `src/ui/tokens.css` adds:

| Token | Meaning |
| --- | --- |
| `--slot-bd`, `--slot-sh` | Slot border colours and inset shadow |
| `--ring-i` | Focus ring: 1-unit `--edge` gap line inside, then `--focus` ring (2 units) |
| `--tsh` | Hard text shadow |
| `--nt`, `--nl` | Notched shapes: tabs (notched top corners) and vertical tabs (notched left corners) |
| `--dia`, `--arrow` | Stepped diamond (5×5 units) and arrow (3×5 units) shapes |
| `--u4` | 4 units (companion to `--u2`, `--u3` in base.css) |
| `--hv-*`, `--pr-*`, `--sel-*`, `--scene-*` | Hover/pressed/selection/scene-plate surfaces, one step lighter in overlay contexts |
| `--lk-h-*`, `--lk-ico-*`, `--hd-*` | Control heights, icon slots, heading sizes |
| `--tip-bg`, `--tip-a`, `--tip-b`, `--hl` | Item-tooltip frame colours and highlighted menu row (in base.css) |

## Pixel grid and geometry

The pixel unit `--px` is selected as 2/3/4 CSS pixels at 100% scale and rounded to whole device pixels:

```text
devicePixels = round(targetCssPixels × devicePixelRatio)
--px = devicePixels / devicePixelRatio
```

Recompute when display resolution/DPR changes. Borders, notches, bevels, rings and scene pixels are integer multiples of this unit (`--u2`/`--u3`/`--u4` are 2/3/4 units). Layout heights, spacing and columns are fixed CSS sizes, **not** multiples of the selected pixel size, so changing pixel appearance does not move controls. Icon slots use their own whole-device-pixel cell (`--ic-s/m/l/xl`); glyphs, avatars and the skin figure use the icon unit `--iu` (3 CSS px rounded to device pixels). Neither follows `--px`.

Corners use stepped clip paths (`--n1` one step, `--n2` two steps, `--nt`, `--nl`), not rounded radii. No blur shadows, no `border-radius`; transitions use `steps()` and movements jump whole units. Focus rings follow the same grid.

| Kit size | Control height | Icon slot |
| --- | --- | --- |
| Small | 32 px | 16 px, 8×8 glyph, 2 px cells |
| Medium | 40 px | 24 px, 8×8 glyph, 3 px cells |
| Large | 56 px | 32 px, 8×8 glyph, 4 px cells |
| Extra-large icon | — | 48 px, 8×8 glyph, 6 px cells |

### Icons

Every icon is a single 8×8 raster in `src/pixel/icon-data.ts` (`X` solid, `o` second tone at 50 % opacity, `.` empty). One icon pixel is one cell; the cell size per slot is a whole number of device pixels (`--ic-s/m/l/xl`, set in `pixel/unit.ts`), never scaled fractionally. Colour is `currentColor` unless `tone` is set. Only the canonical names exist (no aliases): `close`, `refresh` (again / reload), `undo` (revert / reset / restore), `update` (newer version), `chev-*` (disclosure, steps), `arrow-left` (back), `external`, `upload`/`download`, `settings`, `terminal`, `friends`. Slots: `s` 16 px in dense rows, chips, menus, tabs and fields; `m` 24 px in buttons and bars; `l` 32 px in the side bar and empty-state tiles; `xl` 48 px in hero and empty states. Trailing blank columns can be trimmed with `edge="end"` so the visible edge meets the padding. Larger 10×10 colour glyphs (projects, mods) and 8×8 avatars are separate components with their own fixed boxes.

Icon-only buttons use zero padding directly on the square control, independent
of the text-button padding for each size and variant. This keeps the icon slot
centered in small and large ghost controls as well as secondary/primary buttons.
Home's instance-menu button uses the same medium 40×40 control as the instance
detail header.

## Layout

`--gut` is the shared page gutter (16–40 px with window width). Page content uses
the available width; there is no global reading-width cap. `PageHeader` supplies a
compact title, small optional count, wrapping actions and a bottom divider.

The workspace (`Workspace`, `WorkspaceRail`, `WorkspaceContent`, `WorkspaceTabs` from `@/ui`; see `src/ui/README.md`) has a 280 px rail beside the content, which fills the remaining width; it stacks at a window width of 960 px and its tabs turn from vertical stone plates into horizontal segments. Use it for meaningful context/navigation, not as a mandatory two-column wrapper for every collection. Tabs follow the orientation with the keyboard, selected tabs remain visible while switching or resizing, and `TabPanel` has a visible keyboard focus outline.

The library uses full-width grouped lists, with no grid/list toggle. Settings
use responsive form groups while keeping individual controls at a usable width
and retaining their label/help associations.
Home and instance details keep their scenes and unrestricted content areas.
Home has no visible page header: New instance and Library sit beside the
instance-rail heading and wrap below it when space is limited. A screen-reader
page heading remains. Accent edges and selection states carry the color;
avoid oversized counter banners and generic explanatory introductions.

Home cards separate identity from scenery: the existing biome/seed supplies
a 16:9 landscape; the square modpack image or pixel glyph stays uncropped in a
44 px icon slot. The instance rail uses 256×144 wallpaper cards, with icon,
name and metadata over a dark lower caption. Low windows retain that shape and
scroll horizontally instead of shrinking the cards back to squares.

Library rows keep square instance icons, version and activity information,
selection controls, Play and menus in fixed columns. Below 640 px of library
container width, names move above metadata/actions so zoom and narrow windows
cannot hide the name or push Play and menus outside the row. Group collapsing,
ordering, search, filters, persisted sorting and keyboard navigation remain
available.

Other composed surfaces: the skins page shows the rotating figure on a stepped podium in a slot with an "Active" chip on the worn skin; Settings › Storage stacks hard segments with a legend; the friends page shows the relay connection as a status plate; the shortcuts overview is a two-column grid of key-cap rows.

## Color semantics

| Token | Baseline | Role |
| --- | --- | --- |
| `--bg`, `--bg-2` | `#070A11`, `#0A0E17` | Background/title bar |
| `--panel`, `--panel-2`, `--panel-3` | `#0F1521`, `#151D2C`, `#1D2739` | Surfaces and elevation |
| `--sunk` | `#0B1019` | Recessed controls |
| `--fg`, `--fg-2`, `--fg-3` | `#EBF0F8`, `#A9B4C8`, `#8491A8` | Text hierarchy |
| `--copper` | `#E39860`, seasonally overridden | Brand and selected state |
| `--acc` | Instance biome accent | This instance's primary action |
| `--ink` | `#120C07` | Text on accent |
| `--run`, `--warn`, `--bad` | `#8CC8F0`, `#FFD84A`, `#FF6D86` | Running, warning and error |
| `--focus` | `#F6E7C8` | Keyboard focus |

The accent identifies an instance/action; a status color describes a condition. Warning/error states also use symbols, text or form, never color alone. Biome accents are chosen away from warning/error/brand tones; the original design target is OKLab distance ×100 of at least 8, or 6 from running color because running also has text/icon. These are design targets, not a current accessibility certification.

Accent bevels mix with the dark base in OKLab, not brown. Recompute dependent values both at root and elements overriding `--acc`, so a biome does not inherit copper bevels. Seasonal copper likewise drives enabled checkbox/toggle bevels (`--copper-hi`, `--copper-lo`).

Hover is a surface, not an active-state line. `--hv-row`/`--hv-ctl` and pressed variants adapt to ordinary/overlay contexts. Selected means accent or copper border plus tint; current means accent bar. Text underline is reserved for prose, not hovered collection names.

## Typography and wording

Display headings use Big Shoulders Display 800, body/UI uses Hanken Grotesk (variable), pixel counters, chips, key caps, code and wordmark use Jersey 10 and logs use Cascadia Mono/system monospace (`--f-display`, `--f-body`, `--f-px`, `--f-mono`, bundled via `@fontsource`). Labels on stone and slots carry the hard text shadow. Body sizes respond to `--tz`; display/pixel sizes and explicitly fixed controls do not. Fonts are ready before the application is revealed to avoid layout movement.

German UI vocabulary distinguishes creating an instance (`Anlegen`), adding content (`Hinzufügen`), installation state (`Wird installiert`) and stopping the running game (`Beenden`, with confirmation). English equivalents live in the matching dictionaries rather than in component strings.

## Interaction and state

The Play button is the current action/state: play, install progress, starting, stop with elapsed time, or retry. Its dimensions stay stable. Do not duplicate its state in an adjacent chip; chips belong where no Play button already carries that information, such as unselected Home cards.

States of a stone control: rest, hover (brighter face and border), pressed (reversed bevel, content one unit lower), focus (`--ring-i`), disabled (flat, dimmed). `data-force="hover|press|focus"` pins a state for the `/_kit` specimens.

Menus/dialogs restore focus and support Escape/keyboard navigation. Dialog bodies scroll inside stable shells. Collections use one tab stop with directional navigation via `useRovingItems`; visible selection controls support multiselection. Toasts wrap text rather than cut it off and provide the applicable action/close control. Removed entries can keep same-height undo placeholders.

Overlays are positioned independently and animate with transform/opacity/visibility, not changing document flow. Reserve widths/heights for changing labels, counters, progress and account names; use tabular numbers and stable scrollbar gutters. Instance-bound content remounts by instance key instead of presenting stale content from the previous instance.

## Scenes and motion

Scenes render in world pixels, stay centered/bottom-anchored, crop instead of stretch and snap offsets to device pixels. They use layered sky/silhouettes, light-edge pixels and ordered Bayer dithering only near band boundaries, never as a full-page texture. Scene configuration owns biome palettes.

The scene clock is 12 fps. Animation pauses for running/starting Minecraft, hidden documents, disabled scene motion and reduced-motion preference; static images render once and are cached by size. Motion uses stepped transitions/whole pixel movement, not fractional pixel interpolation. CSS shading/vignettes provide a text-reading surface over the scene.

## Accessibility boundaries

`a11y.css` covers text scaling, reduced motion, the skip link, the shortcuts overview and forced colors. Forced-color mode replaces stepped focus rings and slot/stone shadows with system-color borders, outlines and `Highlight` focus, and suppresses scene imagery behind text. A component whose only visible boundary is a surface/shadow needs an explicit forced-color representation.

Keyboard focus is always visible and never colour-only: border change plus the double ring `--ring-i`. Control borders (slot light edge `--ctl`) keep at least 3:1 against their surfaces; text targets at least 4.5:1. UI text responds to normal/large/larger text preferences (1/1.125/1.25). Toolbars wrap instead of overflowing. Reduced-motion preference and the scene-motion switch disable decorative transitions, not just canvas animation. Status remains understandable without motion/color.

The first control is a skip link. Shortcut labels, `aria-keyshortcuts` and the overview share `src/app/shortcuts.ts`; do not duplicate bindings in tooltips. The frameless window still lacks keyboard move/resize controls. Bright scene areas under large text/error chips remain a contrast concern; the target is at least 4.5:1 text contrast against the actual shaded scene, not an unqualified claim that every composition passed.

Development's `/_kit` view provides component examples. It is not a test report or a guarantee that every page interaction or screen-reader flow is covered.
