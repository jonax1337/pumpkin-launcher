# Voxlet – Designrichtung

Stand 2026-09-29. Verbindlich für alle Ansichten. Maßstab: Modrinth App, Prism, Lunar – ein Werkzeug, das man täglich öffnet, kein Marketing-Template.

## Design Read

Desktop-App für Spieler, täglicher Gebrauch, ein Ziel pro Ansicht. Modus: **Redesign – Preserve** (Marke „Deepslate & Emerald“, Geist + Bricolage bleiben). Regler: Varianz 4, Motion 3, Dichte 6.

Leitsatz: **Ruhige Fläche, eine starke Aktion.** Pro Ansicht genau eine Primäraktion in Smaragd; alles andere ist neutral.

## Theme: nur Dunkel

Das halbe Light-Theme wird **entfernt**, nicht ausgebaut. Gründe: Spiele-Launcher laufen neben einem dunklen Spiel und werden abends benutzt; Modrinth, Lunar und Prism starten dunkel; ein zweites Theme verdoppelt die Prüffläche (6 Fenstergrößen × jede Ansicht) ohne Nutzen für Jonas. Die Tokens sitzen direkt auf `:root`, `color-scheme: dark`, keine `.dark`-Klasse, keine hartkodierten `white/…`- oder `emerald-…`-Farben in Komponenten – nur Tokens.

## Farbe (Tokens in `src/index.css`)

| Token | Rolle |
|---|---|
| `--background` | Fenstergrund, grünstichiges Anthrazit |
| `--sidebar` | eine Stufe dunkler als der Grund |
| `--card` | erhöhte Fläche (Hero, Dialog, Liste) – eine Stufe heller |
| `--muted` / `--accent` | Hover, Auswahl, Eingabefelder |
| `--primary` | Smaragd. Nur: Spielen-Knopf, Primäraktion einer Ansicht, aktive Navigation (Icon), Fokusring, Fortschritt |
| `--gold` | sparsam: aktiver Spieler, Hinweise „Update“ |
| `--destructive` | Löschen, Fehler, Absturz |

Regeln: ein Akzent. Keine Verläufe außer dem Hero-Hintergrund (Instanzfarbe, max. 12 % Deckkraft). Kein Glow, keine äußeren Schatten mit Farbe. Text auf `--primary` erfüllt AA (Kontrast ≥ 4.5:1).

## Typografie

Zwei Familien: **Bricolage Grotesque** nur für Seitentitel und den Instanznamen im Hero, **Geist** für alles andere; Monospace nur im Protokoll.

| Stufe | Klasse | Einsatz |
|---|---|---|
| Display | `text-3xl` → ab `xl` `text-4xl`, `font-semibold tracking-tight` | Instanzname im Hero |
| H1 | `text-2xl font-semibold` | Seitentitel |
| H2 | `text-base font-semibold` | Abschnitte |
| Body | `text-sm` | Standard |
| Meta | `text-xs text-muted-foreground` | Version, Loader, Zeiten |

Keine Eyebrows (Großbuchstaben-Labels) außer höchstens einer im Hero. Zahlen mit `tabular-nums`. Lange Namen: `truncate` plus `title`.

## Abstände, Radius, Elevation

- Raster 4 px. Seitenrand `px-6` (< 1280), `px-8` (≥ 1280), `px-10` (≥ 1920). Abschnitte `gap-8`.
- Radius: Karten und Dialoge `rounded-xl` (12 px), Knöpfe und Eingaben `rounded-lg` (8 px), Chips `rounded-md`. Keine Pillen außer Status-Punkten.
- Elevation über Helligkeit, nicht Schatten: Grund → Karte → Popover. Genau eine Randfarbe `--border`. Keine Karte in einer Karte; Listen sind `divide-y` in einer Fläche.

## Layout und Breakpoints

Fenster-Mindestgröße 800×600 (`tauri.conf.json`). Getestete Größen und Verhalten:

| Fenster | Seitenleiste | Inhalt | Raster Bibliothek / Entdecken |
|---|---|---|---|
| 800×600 | Leiste (64 px, nur Icons + Tooltip) | volle Breite | 2 Spalten / 1 Spalte Liste |
| 1024×768 | ausgeklappt (224 px) | volle Breite | 3 / Liste + Filter oben |
| 1280×800 | ausgeklappt | volle Breite | 3 |
| 1440×900 | ausgeklappt | max. 1200 px, zentriert | 4 |
| 1920×1080 | ausgeklappt | max. 1440 px | 5 |
| 2560×1440 | ausgeklappt | max. 1600 px | 6 |

- Raster per `grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]` statt fester Spaltenzahlen, gedeckelt durch die Max-Breite.
- Keine horizontalen Scrollbalken: jeder Flex-Text-Container hat `min-w-0`, Toolbars brechen um (`flex-wrap`).
- Dialoge: `max-h-[calc(100dvh-4rem)]`, Inhalt scrollt innen, Fußzeile bleibt sichtbar. Breite `min(40rem, 100vw-2rem)`.
- Hi-DPI: nur rem/px aus Tailwind, keine Bitmap-Grafiken unter 2×; Icons als SVG.

## Komponentenregeln

- **Spielen-Knopf**: größter Knopf der App (`h-12 px-8 text-base`), Smaragd, zeigt Fortschritt im Knopf; laufend → „Stoppen“ neutral mit rotem Icon. Nur einmal pro Ansicht.
- **Instanzkarte**: Kachel + Name + Meta, ganzer Bereich klickbar; Spielen erscheint als Icon-Knopf bei Hover/Fokus (Tastatur erreichbar), nicht als großer grüner Knopf pro Karte.
- **Leerzustand**: Icon, ein Satz, eine Aktion. **Laden**: Skelett in Form des Ergebnisses. **Fehler**: Satz in Alltagssprache + „Erneut versuchen“; technische Details einklappbar.
- **Toasts**: unten rechts, nur für vorübergehende Meldungen; Fehler mit Aktion.
- **Fortschritt**: Balken + Schritt in Alltagssprache („Lade Spieldateien … 312 von 3 480“) + „Abbrechen“.
- Fokus: `focus-visible:ring-2 ring-ring` überall; Ziele ≥ 32 px.

## Motion

Nur Zustandswechsel: 150–200 ms, `ease-out`. Seitenwechsel Überblendung 120 ms. Kein Parallax, kein Hüpfen. `prefers-reduced-motion` schaltet alles außer Fortschritt ab.

## Verboten

Glow um Knöpfe, Verlaufstext, Karten-in-Karten, drei gleiche Karten als Deko, Emoji, Eyebrows über jedem Abschnitt, Entwicklerjargon im UI, Gedankenstrich-Ketten im Fließtext.
