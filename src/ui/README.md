# Interface kit

The Pixelkino interface kit (`@/ui`), split into independent layers. This file is the single description of the kit; the design language (palette, pixel grid, surfaces, motion, accessibility) is in [PIXELKINO.md](../../docs/design/PIXELKINO.md).

| Layer | Where | Contains |
| --- | --- | --- |
| Look | `look.css` + `look/*.css` (`lk-*` classes, `data-*` state) | colours, borders, bevels, shadows, fonts, hover/press/focus/disabled. No display, spacing or sizes. |
| Layout | Tailwind utilities in the components | display, gap, padding, sizes, grids, breakpoints, container queries. |
| Bridge | `theme.css` (`@theme inline`, `@custom-variant`) | kit tokens as utilities: `gap-pg-m`, `px-gut`, `h-ctl-m`, `text-ctl-m`, `text-hd-page`, `p-pg-pad`; window-width variants `le-720:` … `le-1280:`. |

## Rules

- Every component takes `className`; `cn` merges, so `<Button className="w-full h-20">` replaces the default size utilities.
- Look files contain no layout. Technical exceptions: `position: relative; isolation: isolate` where the surface lives on `::before` (notched plates, list rows, cards), and the dialog's `transform: translate(-50%,-50%)`, which its keyframe animation requires.
- The look is reusable without the components: put `lk-btn lk-stone lk-text` plus `data-variant`/`data-size` on any element.
- Sonner keeps one global toast store: mount only one `Toaster`.
- **Window-width breakpoints are inclusive**: `le-720:`, `le-820:`, `le-900:`, `le-960:` (workspace stacks), `le-1040:`, `le-1096:`, `le-1180:`, `le-1280:` (`@custom-variant` in `theme.css`) apply up to and including that width, like CSS `max-width: Npx`. Never use `max-[Npx]:` for window widths (Tailwind v4 compiles it to `width < N`) or `[@media(max-width:…)]:`; add a new step to `theme.css` instead. Container queries (`@max-[640px]/name:`) are a separate mechanism and stay as they are.
- **Layer order**: `src/index.css` puts all stylesheets into `@layer components`, in the order base, shell, pages, dialogs/onboarding/accounts/friends, kit (`ui/ui.css`), play, branding; Tailwind utilities (layer `utilities`) therefore beat all of them, which is what makes `className` overrides work. `theme.css` is imported at the top level without a layer. A page stylesheet imported by its page component (`discover.css`, `announcements.css`, `friends/friends.css`) is **unlayered** and beats utilities too: keep such files to page-owned classes and never use them to restyle kit internals.
- **`cn` merging**: components build their class list with `cn` (`@/lib/utils`, tailwind-merge). Conflicting utilities of the same group are resolved in favour of the caller (`w-full` replaces the default width). Two different size utilities that tailwind-merge does not recognise as one group (arbitrary `text-[…]` vs. `text-ctl-m`) have no guaranteed winner; use the component's `size` prop instead.
- **Page CSS and the kit**: layout is Tailwind in the page's own markup. Page CSS is for page-owned classes (scenes, sticky regions, bespoke shapes). It never selects `.lk-*`, never uses `!important`, and reaches into overlays only through `data-kit-overlay`/`data-kit-item`/`data-kit-part` (see Overlays below).

## Components

| Area | Components |
| --- | --- |
| Actions | `Button`, `ButtonLink`, `BackLink`, `BarButton`, `IconButton`, `Actions` |
| Status | `Chip`, `ChipButton`, `ChipLink`, `Count`, `Meta`, `StatusPanel`, `Progress`, `JobProgress`, `Steps`, `Skel`, `Empty` |
| Navigation | `Tabs`, `TabsSkel`, `TabPanel`, `Segmented` |
| Forms | `Input`, `TextArea`, `SearchField`, `Select`, `Switch`, `Checkbox`, `Radio`, `SegSlider`, `Field`, `Form`, `FormSection`, `FormRow`, `Hint`, `Disclosure`, `DropZone` |
| Lists | `List`, `ListHeader`, `ListRow`, `TileRow`, `RowTitle`, `Cell`, `GhostRow`, `SkelRow`, `LinkList`, `LinkRow`, `DescriptionList` |
| Cards | `CardGrid`, `CardStrip`, `SceneCard`, `SceneCardSkel`, `ThumbCard`, `AddCard`, `PickTile`, `PickCard`, `Choice`, `SceneThumb`, `Panel` |
| Overlays | `Dialog`, `DialogActions`, `ConfirmDialog`, `Scrim`, `Sheet`, `Menu`, `ContextMenu`, `MenuItem`/`MenuSep`/`MenuLabel`/`MenuHead`/`MenuNote`/`MenuScroll`, `Popover`, `Tip`, `TipTitle`/`TipLine`, `Trunc`, `Toaster`, `Listbox`/`ListboxGroup`/`ListboxOption` |
| Keys | `Kbd`, `KeyCombo`, `ShortcutList` |
| Images | `Art`, `ArtFrame`, `ArtImage`, `ArtGlyph`, `ImageGallery`, `PhotoTile` |
| Page | `Page`, `PageHeader`, `SectionHeader`, `Toolbar`, `Spacer`, `Workspace`, `WorkspaceRail`, `WorkspaceContent`, `WorkspaceTabs`, `Heading`, `HeroTitle`, `HeroTitleSkel`, `HeroMeta`, `HeroShade`, `SkipLink`, `Surface`, `Scrollbar` |
| Tables | `Table`, `Th`, `Tr`, `Td` |
| Shared | `Icon`, `Glyph`, `Avatar` (`box` 28/32/48), `StatusDot`, `ProjectIcon`, `TipProvider`, `useRoving`, types |

Menu and tooltip behavior (context menu, keyboard, host tooltips) lives in `menuBase.tsx` / `tipBase.tsx`, parameterised by class names (`MenuSkin`, `TipBase`); `Menu.tsx` and `Tooltip.tsx` are the skins over it.

## Usage notes

- Sizes by location (page header = 40, section header = 32) are not applied automatically; pass `size`.
- `List` has no fixed columns: pass them once as properties, e.g. `<List cols={{ base: "44px minmax(0,1fr) 150px", 1180: "44px minmax(0,1fr)" }} density="compact" />`. Pages never write `--l-*` variables (they stay the kit's internal mechanism). `ListLayout` (spread it onto `List` and `ListHeader` to share it): **`cols`** (`grid-template-columns` with spaces), **`gap`** (px, default 12), **`pad`** (row padding, default `0 8px`), **`rowHeight`** (px, default 56; also the reserved height of `lazy` rows), **`headHeight`** (px, default 32), **`density="compact"`** (rows that end in an icon button: padding `0 6px 0 8px`; an explicit `pad` wins). Each value may be `{ base, 720 | 900 | 1040 | 1180 }`: from that window width downwards the other value applies (the smallest matching one wins). A row that lays itself out differently in a narrow container uses Tailwind on its own root (`@max-[640px]/library:grid-cols-[44px_minmax(0,1fr)_32px_32px] @max-[640px]/library:gap-x-2 @max-[640px]/library:min-h-22`). `Cell hide` hides a cell; the column list must drop that column too. `SkelRow` takes `compact` instead of a list variant. Ready-made list forms, so pages never rebuild them by hand:
  - **`List flat`** — flat entries (versions, backups, disk usage): two columns `1fr · auto`, rows 44 px, hairline below (not under the last), no hover, text 13, `RowTitle` name 13. Override columns with `cols`.
  - **`List framed`** — inset table surface with a dark header bar (content, worlds, servers). **`ListHeader bar`** — the same bar for a header above several lists (library groups).
  - **`List divided`** — hairline between rows (`divided="strong"`: full line colour). **`List spaced`** — 8 px between rows (plate rows). **`List tiles`** — rows become tiles in an `auto-fill` grid (min column `--tile-min`, 300 px) → use `TileRow`.
  - **`ListRow plate="row"`** — plate row for accounts, codes, requests: flex row, 60 px, left gutter that carries the arrow of a `selected` row, `RowTitle` fills the rest. Override the layout with `className` (`flex-wrap items-start p-3` for a narrow card).
  - **`ListRow still`** (no hover), **`tone="run|warn|bad"`** (8 % tinted notice row, no hover, `RowTitle` sub one step brighter) + **`bar`** (stripe on the left), **`selected="bar"`** (selection as a left notch instead of a frame), **`current`** (`aria-current` on the hit area: the open entry of a list), **`lazy`** (not rendered outside the window, height `rowHeight` reserved).
  - **`TileRow`** (`List tiles`): named slots `media`, `check` (selection box on the media corner, shown on hover/focus/selected/touch), `title`, `actions` (top right), `meta` (bottom line; first chip shrinks, buttons keep size) and `footer` (bottom right; empty → `meta` spans the width). Takes the `ListRow` props (`selected`, `off`, `lazy`, `menu` …).
  - **`List feed`** — feed of selectable posts on a panel (announcements): rows with 12 × `--pg-pad` padding, content stacked (gap 6), full hairline under every row (also the last), hover `--panel-2`, `selected` = accent tint (`--acc` 10 %) with a notch on the left. Use `ListRow hit selected current` + `RowTitle size="display" eyebrow={…}`; scrolling is the page's wrapper.
  - **`RowTitle`**: `size="xs|s|m|l|display"` (13/14/15/16/display 800 at card size; flat lists default to `xs`; `display` always wraps and dims the sub), `eyebrow` (line above the name: date and state, min 22 px), `wrap` (name, aside, sub and meta wrap instead of ellipsis; `clamp={2|3}` limits the sub), `asideClassName` (e.g. `le-720:hidden`). `GhostRow lazy` as for rows.
  - Hooks for pages: `ListRow` is `group/row` (colour parts with `group-hover/row:`, `group-focus-within/row:`, `group-data-[off]/row:`, `group-data-[selected]/row:`), sets `data-kit-item="row"` (`ListHeader`: `"head"`) for `useRovingItems`, and `data-selected`/`data-off`. Name a page container with `@container/name` and use `@max-[640px]/name:` utilities on rows and cells for a narrow layout; never `!important`, never `.lk-*` selectors.
- **`Avatar box="28|32|48"`** (`className` places it, e.g. `justify-self-center`; app wrappers `AccountAvatar`/`FriendAvatar` pass `box` and `className` through). **`StatusDot tone="run"`**: status square (6 units, panel-coloured edge) at the lower right corner of the nearest positioned parent, for a `relative` wrapper around an `Avatar`; the row also states the status in text.
- Widths are classes (`w-64`, `w-full`), not `width` props. Dialog width/height: `size`/`height` or `className="[--dw:520px] h-[400px]"`. `CardGrid` min column: `[--card-min:220px]`.
- **`CardStrip`** (`CardStrip.tsx`, look `.lk-strip` in `look/card.css`): horizontally scrolling strip of cards (children are `<li>`: `SceneCard`, `AddCard`), no scrollbar, fade at edges with more cards behind them, and scroll arrows over it (`prevLabel`/`nextLabel` = arrow names; both omitted = no arrows, e.g. skeleton). Arrows show only where more cards wait, sit centred on the card image and page by whole cards. `itemCount` re-measures, `listRef` gives access to the scrolling `<ul>`, other props (`aria-labelledby`) go to the `<ul>`, `className` to the host. The arrow height follows the card width `--mini` (default 256); other cards: `className="[--strip-media:120px]"` (image height).
- **`Cell align="switch"`**: for a header cell over a right-aligned `Switch` with a reserved state word: centred over the switch box, shifted by the state word width (`--sw-gap` + `--sw-st-w`). Plain `align="end"` for ordinary numbers.
- `FormRow` and `FormSection` use container queries: use `FormRow` inside `FormSection` (or any `@container`).
- `Chip` always shows the pixel square unless `icon` is set (no `dot` prop). `Popover`/`Menu` do not emit `data-size`/`data-pad`/`data-wide`; sizes are classes.
- Page-specific overrides (for example for the project page in the side panel) belong in the page CSS, selected through `data-kit-overlay` (see below), not in the kit.
- No Buddy in the kit: `Empty` shows `ill` only if given, and toasts use kit icons in the `[data-icon]` slot for every type. The app wraps `Empty` as `EmptyState` (`@/components/EmptyState`, with `mood`; shows the Buddy unless `ill` is passed) and `ErrorBox` (`@/components/ErrorBox`) puts the Buddy into a `StatusPanel`.

### Forms, buttons, status, page, tables

- **`Form flat`** — body of a settings-style form (also the `@container` for rows). Every `FormSection` and `FormRow` inside gets the flat look through context: sections without frame or line (28 above, not for the first), title muted at card size; rows with a hairline below (not the last), 16 padding (4 above the first row under the title) and an emphasised label (15 px, bold). A nested `Form` without `flat` (dialogs rendered inside a flat form) restores the default. `FormSection flat` / `FormRow divided` work without a `Form` too (`divided` alone keeps the normal label). `FormSection danger` — danger zone (red frame with `plate`, red title). `FormRow dense` — the first control is 32 high (label 4 px higher).
- **`Select labelClassName`** (e.g. `le-1280:hidden`: hide the prefix up to and including a 1280 px window, the name stays), **`Disclosure summaryClassName`** (replaces the default `-ml-1.5 h-ctl-s pl-1.5`), **`Steps current total label`** (wizard progress, role=img).
- **`Button`**: `wrap` (label wraps, height grows beyond the size, width at most 100 %), `onScene="strong"` (secondary with clear hover/press states over scenes), `fill` (children are laid out by the caller inside a shell that fills the plate; disabled does not dim them), `busy` (running process: bevel permanently inverted, no hover/press, `aria-busy`; use on a button that is not `disabled`), `tinted` (secondary with `tone`: the light bevel carries 40 % of the tone). **`IconButton solid="bad"`** — ghost whose hover/press is a solid red fill (close window), neutral at rest.
- **`Chip onScene`** (full text colour, bold, hard shadow over scenes), **`ChipButton tone`**, **`Panel active`** (frame and bevel in the selection colour: the plate that applies now).
- **Hero** (`Layout.tsx`): `HeroTitle size="xl"` brings its own two-line box, **`HeroTitleSkel`** is its placeholder, **`HeroMeta outline`** (semi-bold, outlined text, brighter separators), **`HeroShade side`** (dense from the left and bottom, scene stays bright on the right). **`TabsSkel`** — placeholder of the underline tab strip (42 px). **`Tabs gutter`** — side margins of the strip like the page header (`--gut`), the baseline runs only between them (instance page).
- **`Toolbar searchWrap`** — below 900 px the search field takes its own row.
- **`DropZone over overlay`** — drop area for files (pit with dashed edge, content centred; height from `className`). `over`: a file is above it; `overlay`: covers the surrounding `relative` container (content starts at the top, a `sticky` hint stays in view).
- **`Table`**, `Th`, `Tr`, `Td` — real data table (13 px, pixel-font header, hairline rows, hover plate). `Tr sub` is a follow-up row that belongs to the previous one (expanded details: no hover, the previous row loses its line). Columns that drop in narrow containers get `className="@max-[600px]:hidden"` on header and data cell.
- **`Surface kind="slot|pit|stone" as text deep`** — the inventory surfaces for elements the page owns (an inset path, a code plate, a log body). `slot` = inset with hover/focus edge, `pit` = inset without interaction, `stone` = raised; `as` picks the element (`div`, `span`, `code`, `dl`, `button` …), `text` adds the hard text shadow, `deep` a deeper ground (log console). Layout is `className` Tailwind; apps never write `lk-slot|lk-pit|lk-stone|lk-text` themselves.
- **`Scrollbar target ref className`** (`Scrollbar.tsx`, look `look/scrollbar.css`) — slim 12 px pixel scrollbar laid over an element that scrolls without its own track (`scrollbar-width: none`): nothing is reserved, content reaches the edge. The thumb is a stone plate with the bevel inside the box, lifted on hover and while dragging (`--line-2`), `ButtonText` in forced-colors; dragging the thumb and clicking the track (pages by 90 %) work as usual. The track is `absolute` (default: right edge, full height of the positioned parent): place it as sibling of the target, position with `className` (`top-(--bar)`). It observes nothing itself: call `ref.current.update()` (`ScrollbarHandle`) when size, content or scroll position of `target` change. The app wrapper `ViewScrollbar` only observes the `#view` element for that.
- **`Heading`**: `level` sets element and size. `plain` — like running text (no letter-spacing, no shadow, numerals as the surroundings; titles on bars and surfaces). `size="bar"` (24 px) and `size="title"` (44 px, line height .95) replace the level size (`--hd-bar`, `--hd-title`); `size="xl"` is the hero title. `zoom` — the level size follows the text-size setting (`--tz`). `trunc` — one line with ellipsis, a text child shows its full text as tooltip when cut. Other sizes/line heights/tracking: Tailwind in `className` (`leading-[1.3]`, `tracking-[.02em]`, `tabular-nums`; for a size override of a level prefer `size` — two `text-*` size utilities on one element have no guaranteed winner).
- **`DescriptionList items size end framed`** — `dl` of label/value rows: `items: ({ label, value, valueClassName? } | false)[]` (falsy rows are skipped), `size="s"` 13 px with tight gaps · `"m"` 14 px (default), `end` right-aligns the values, `framed` sets the list on a slot surface with padding. Values wrap anywhere and may shrink; `valueClassName` is for `truncate`, `min-h-[…]` and the like.
- **`LinkList` + `LinkRow icon label hint external onClick`** — framed list of link rows (icon, name with hint, arrow out or forward); hairline between rows, hover and focus lift the row. **`SkipLink`** (`Layout.tsx`) — the first control of the app, visible only on keyboard focus; `onClick` moves focus to the content.
- **`Count strong`** — full text colour with the hard shadow (large readout of a value), sizes 16–32 incl. 24. **`ArtImage crisp`** / **`ArtGlyph tile tileHi`** — image or pixel glyph on a gradient filling an `ArtFrame`/`Art` (instance icons; scale the glyph with `[--icon-k:2]` on the frame).
- **`cssVars`** (`@/ui`) types own CSS variables for `style`; **`.fx`** (`styles/base.css` gives it `position: relative`, `ui/a11y.css` draws the stepped focus ring) is the opt-in focus ring for elements without their own ring. Controls (`button`, `a`, inputs) are `-webkit-app-region: no-drag` everywhere (`ui/a11y.css`), so they work inside the draggable window bar.

### Overlays, key caps, lists of options, images

- **Overlay attribute.** Overlays set `data-kit-overlay="dialog|sheet|popover"` on their surface (`Dialog`/`ConfirmDialog`, `Sheet`, `Popover`). This is the only hook for code outside the kit (`app/dialogOpen.ts`, page CSS such as `[data-kit-overlay="sheet"] .proj-h`); never select `.lk-dlg`, `.lk-sheet` or `.lk-pop`. `dialogBehavior.ts` finds head/body/foot through `data-kit-part="dialog-head|dialog-body|dialog-foot"`.
- **`Dialog fill`** (needs `height`): the body does not scroll, it is a flex column the content fills; the content scrolls itself (`min-h-0 flex-1`). Used by the command palette.
- **`Scrim`**: the dimming layer behind a modal surface. `Dialog` includes it; a full-window view built directly on Radix `Dialog.Root` (lightbox) places `<Scrim />` before its content.
- **`Kbd`** (`size="s"` square, 20 px, inside rows and dialog footers; `"m"` notched, 24 px, in overviews), **`KeyCombo keys={["Strg", "K"]}`** (one cap per key), **`ShortcutList title rows`** (`rows: { label, combos: string[][] }[]`, label left and combinations right with a hairline between rows). Grid and notes around the lists are page layout.
- **`Listbox label`** + **`ListboxGroup label`** + **`ListboxOption`** (combobox pattern: focus stays in the input, the caller keeps `active` and sets the option `id` as `aria-activedescendant`). `ListboxOption` props: `icon`, `sub` (second line), `trail` (right, e.g. `Kbd`s, hidden from screen readers), `active`, `disabled` (dimmed but still selectable, `sub` gives the reason), `onActivate` (real pointer movement only), plus native div props (`onClick`, `id`). Give the `Listbox` its size with `className` (`min-h-0 flex-1`).
- **`Art`** / `ART` (class string) and **`ArtFrame`**: scene or image surface that fills its frame (canvases inside are absolute); `ArtFrame` adds the slot border and takes the size from `className` (`size-[72px]`). A default instance icon (`IconView`) inside scales with `[--icon-k:2]` (cells per glyph pixel, default 1).
- **`ImageGallery label items`** (`items: { src, alt, caption?, thumbLabel }[]`): large image in a pit, thumbnails below, the chosen one with accent edge. Holds its own selection; the caller filters trusted image hosts first. Images load lazily without referrer.
- **`PhotoTile src label caption selecting? selected?`**: screenshot tile, a plate with the image (16:9, slot) and a caption below. `label` is the accessible name (image and caption are decoration), the image loads lazily. `selecting` = selection mode (`aria-pressed`, check mark top-left; `selected` fills it copper and tints the plate with the selection frame). Native button props (`onClick`, `data-*`) go to the button; the grid and tile width belong to the caller (`CardGrid`).
- **`TipTitle`** and **`TipLine tone="muted|update|bad|desc"`**: content of rich tooltips (`<Tip label={<><TipTitle>Name</TipTitle><TipLine>Detail</TipLine></>}>`).
- Roving keyboard navigation (`useRovingItems`, `hooks/`) selects kit items through `data-kit-item="row|card|pick"`, not through classes.

## Files

| File | Role |
| --- | --- |
| `index.ts` | the public API, imported as `@/ui` |
| `ui.css` | single CSS entry: `tokens.css`, `surface.css`, `icon.css`, `motion.css`, `prose.css`, `a11y.css`, `look.css` |
| `theme.css` | Tailwind bridge, imported at the top level of `src/index.css` (no `layer()`) |
| `Icon.tsx`, `Hit.tsx`, `types.ts`, `util.ts` | icons, hit areas, shared types and helpers |
| `menuBase.tsx`, `menuOrigin.ts`, `textMenu.ts` | menu mechanics (keyboard, focus return, text context menu), skinned by `Menu.tsx` |
| `tipBase.tsx` | tooltip mechanics (`TipBase`, `TruncBase`, `TipProvider`), skinned by `Tooltip.tsx` |
| `dialogBehavior.ts` | focus return and autofocus priority for `Dialog.tsx` and `Sheet.tsx` (finds the dialog's head/body/foot through `data-kit-part`) |
| `Kbd.tsx`, `Listbox.tsx`, `Art.tsx`, `ImageGallery.tsx`, `PhotoTile.tsx` | key caps and shortcut list, combobox list, art surface/frame, image gallery, photo tile (look: `look/keys.css`, `look/listbox.css`, `look/card.css`, `look/gallery.css`, `look/photo.css`) |
| `Surface.tsx`, `DescriptionList.tsx`, `LinkRow.tsx` | `Surface`, key/value list, link rows (look: `surface.css`, `look.css` `.lk-dl`, `look/link.css`) |
| `roving.ts` | `useRoving` (arrow-key navigation in tabs, segments, radios) |
| `KitPage.tsx` | development preview (`/_kit`) |

The preview page `/_kit` (`KitPage.tsx`, route registered only when `import.meta.env.DEV`) shows the components with mock data and pins states through `data-force="hover|press|focus"`; start it with `pnpm dev` and open `http://localhost:1420/_kit`. It is a visual aid, not a test report.

## Adding or changing a component

1. Look goes into `look.css` or the matching `look/*.css` as `lk-*` classes with `data-*` state; no display, spacing or sizes (see Rules). Colours and sizes come from the tokens in `tokens.css`/`surface.css`.
2. Layout goes into the component as Tailwind utilities merged with `cn`, with `className` last so callers can override it.
3. Export the component and its prop types from `index.ts`, add it to the component table above, and show it in `KitPage.tsx`.
4. Pages import from `@/ui` only, never from a kit file or a `look/*.css` file, and components do not import CSS themselves (`ui.css` collects it).
