# Pixelkino design reference

Last updated: 2026-10-06.

Pixelkino is Pumpkin Launcher's dark pixel interface. Scenes are the visually expressive layer; controls and page backgrounds stay flat and quiet. The [concept mockup](concepts/pixelkino.html) explains the original composition, but current styles and components are authoritative.

To open the component examples, follow [development setup](../../CONTRIBUTING.md#development-setup),
run `pnpm dev` from the repository root and visit
[`http://localhost:1420/_kit`](http://localhost:1420/_kit). This is the browser development
route with mock data, not a shipped player page.

## Source map

| Concern | Source, relative to repository root |
| --- | --- |
| Global colors, fonts, shell and page layout | `src/styles/pixelkino.css` |
| Kit tokens and components | `src/ui/`, collected by `src/ui/ui.css`, imported through `@/ui` |
| Pixel sizing | `src/pixel/unit.ts` |
| Scene generation/configuration | `src/pixel/{scene,sceneBuilder,sceneConfig}.ts`, `PixelScene.tsx` |
| Play/status controls | `src/components/play/`, `src/components/play.css` |
| Motion and accessibility styles | `src/ui/motion.css`, `src/ui/a11y.css` |
| Appearance and shortcuts | `src/app/useAppearance.ts`, `shortcuts.ts`, `mainTabs.ts` |
| Seasonal branding | `src/branding/`, repository `branding/` assets |

Kit classes use `vx-` and data attributes for variants. Component styles are collected centrally; avoid per-component CSS imports that alter layer order. `index.html` establishes `theme, base, components, utilities` before stylesheets. Class names must not accidentally collide with Tailwind utilities.

## Pixel grid and geometry

The pixel unit `--px` is selected as 2/3/4 CSS pixels at 100% scale and rounded to whole device pixels:

```text
devicePixels = round(targetCssPixels × devicePixelRatio)
--px = devicePixels / devicePixelRatio
```

Recompute when display resolution/DPR changes. Borders, notches, bevels, icon glyphs and scene pixels are integer multiples of this unit. Layout heights, spacing and columns are fixed CSS sizes, **not** multiples of the selected pixel size, so changing pixel appearance does not move controls.

Corners use stepped clip paths (`--n1`, `--n2`), not rounded radii. Focus/selection rings follow the same grid. Glyphs have fixed slots and integer cell sizes rather than arbitrary image scaling.

| Kit size | Control height | Icon slot |
| --- | --- | --- |
| Small | 32 px | 20 px, 5×5 glyph |
| Medium | 40 px | 24 px, 7×7 or 5×5 according to pixel size |
| Large | 56 px | 28 px, 7×7 glyph |
| Extra-large icon | — | 56 px, doubled glyph cells |

`--gut` is the shared page gutter (16-40 px with window width); `--page-max` is 1240 px for ordinary list/form content. Library posters fill the collection area and its toolbar wraps. Global/instance forms share label/control/help alignment and move help below controls at narrow widths.

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

Accent bevels mix with the dark base in OKLab, not brown. Recompute dependent values both at root and elements overriding `--acc`, so a biome does not inherit copper bevels. Seasonal copper likewise drives enabled checkbox/toggle bevels.

Hover is a surface, not an active-state line. `--hv-row`/`--hv-ctl` and pressed variants adapt to ordinary/overlay contexts. Selected means copper ring plus tint; current means accent underline/bar. Text underline is reserved for prose, not hovered collection names.

## Typography and wording

Display headings use Big Shoulders Display 800, body/UI uses Hanken Grotesk, pixel counters/code/wordmark use Jersey 10 and logs use Cascadia Mono/system monospace. Body sizes respond to `--tz`; display/pixel sizes and explicitly fixed controls do not. Fonts are ready before the application is revealed to avoid layout movement.

German UI vocabulary distinguishes creating an instance (`Anlegen`), adding content (`Hinzufügen`), installation state (`Wird installiert`) and stopping the running game (`Beenden`, with confirmation). English equivalents live in the matching dictionaries rather than in component strings.

## Interaction and state

The Play button is the current action/state: play, install progress, starting, stop with elapsed time, or retry. Its dimensions stay stable. Do not duplicate its state in an adjacent chip; chips belong where no Play button already carries that information, such as unselected posters.

Menus/dialogs restore focus and support Escape/keyboard navigation. Dialog bodies scroll inside stable shells. Collections use one tab stop with directional navigation via `useRovingItems`; visible selection controls support multiselection. Toasts wrap text rather than cut it off and provide the applicable action/close control. Removed entries can keep same-height undo placeholders.

Overlays are positioned independently and animate with transform/opacity/visibility, not changing document flow. Reserve widths/heights for changing labels, counters, progress and account names; use tabular numbers and stable scrollbar gutters. Instance-bound content remounts by instance key instead of presenting stale content from the previous instance.

## Scenes and motion

Scenes render in world pixels, stay centered/bottom-anchored, crop instead of stretch and snap offsets to device pixels. They use layered sky/silhouettes, light-edge pixels and ordered Bayer dithering only near band boundaries, never as a full-page texture. Scene configuration owns biome palettes.

The scene clock is 12 fps. Animation pauses for running/starting Minecraft, hidden documents, disabled scene motion and reduced-motion preference; static images render once and are cached by size. Motion uses stepped transitions/whole pixel movement, not fractional pixel interpolation. CSS shading/vignettes provide a text-reading surface over the scene.

## Accessibility boundaries

`a11y.css` covers text scaling, reduced motion and forced colors. Forced-color mode replaces pixel shadows/clips with system-color boundaries/focus states and suppresses scene imagery behind text. A component whose only visible boundary is a surface/shadow needs an explicit forced-color representation.

UI text responds to normal/large/larger text preferences (1/1.125/1.25). Toolbars wrap instead of overflowing. Reduced-motion preference and the scene-motion switch disable decorative transitions, not just canvas animation. Status remains understandable without motion/color.

The first control is a skip link. Shortcut labels, `aria-keyshortcuts` and the overview share `src/app/shortcuts.ts`; do not duplicate bindings in tooltips. The frameless window still lacks keyboard move/resize controls. Bright scene areas under large text/error chips remain a contrast concern; the target is at least 4.5:1 text contrast against the actual shaded scene, not an unqualified claim that every composition passed.

Development's `/_kit` view provides component examples. It is not a test report or a guarantee that every page interaction or screen-reader flow is covered.
