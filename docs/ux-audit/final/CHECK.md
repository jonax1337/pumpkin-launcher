# Layout-Prüfung Voxlet – Endstand

Stand 29.09.2026 · Browser-Build (`vite`, Browser-Mock aus `src/lib/api.ts`), Chromium über Playwright.
Skripte: `shots.playwright.js` (Screenshots + Prüfung), `hidpi.playwright.js` (Hi-DPI-Stichprobe).
Screenshots: `browser/<Breite>x<Höhe>/<ansicht>.png`, Hi-DPI unter `browser/hidpi-1.25x/` und `browser/hidpi-1.5x/`.

## Was geprüft wird (je Größe und Ansicht)

| Kennung | Bedeutung |
|---|---|
| doc | `document.documentElement.scrollWidth > innerWidth` (horizontaler Scrollbalken der Seite) |
| clipped | Element mit `overflow: hidden/clip`, dessen Inhalt breiter ist, ohne Ellipse (abgeschnittener Inhalt) |
| spill | Element mit `overflow: visible`, dessen Inhalt breiter ist (ragt sichtbar heraus) |
| untitled | per `truncate` gekürzter Text ohne `title` am Element oder einem Vorfahren |

Nicht gezählt: bewusst scrollende Bereiche (`overflow-x: auto/scroll`), `sr-only`-Texte, Toasts, unsichtbare Klickflächen aus `::before/::after` (während der Messung ausgeschaltet).

## Ergebnis

Ansichten: spielen, bibliothek, instanz-inhalte, instanz-einstellungen, instanz-protokoll, entdecken, entdecken-details, einstellungen, dialog-neu, fortschritt, leerzustand, onboarding.

| Größe | doc | clipped | spill | untitled |
|---|---|---|---|---|
| 800×600 | 0 / 12 | 0 | 1 (dialog-neu, s. u.) | 0 |
| 1024×768 | 0 / 12 | 0 | 1 (dialog-neu) | 1 → behoben |
| 1280×800 | 0 / 12 | 0 | 1 (dialog-neu) | 0 |
| 1440×900 | 0 / 12 | 0 | 1 (dialog-neu) | 0 |
| 1920×1080 | 0 / 12 | 0 | 1 (dialog-neu) | 0 |
| 2560×1440 | 0 / 12 | 0 | 1 (dialog-neu) | 0 |

- **Kein horizontaler Scrollbalken** in allen 72 Kombinationen.
- **dialog-neu, spill 20 px:** die Fußzeile des Dialogs reicht per `-mx-5` bewusst bis an die Dialogränder (klebt unten, bleibt bei 800×600 sichtbar). Sie liegt im Innenabstand des Dialogs, nichts wird verdeckt oder abgeschnitten. Gewollt.
- **untitled 1024×768:** Meta-Zeile „Vanilla 1.21.5 · Noch nie gespielt“ in „Weitere Instanzen“ (Spielen) hatte keinen `title`. Nachträglich ergänzt und bei 1024×768 erneut geprüft: 0.
- Vorher gefundene und behobene Fälle: Menüknopf der Instanzkarte mit negativem Rand (6 px), Suchleiste in Entdecken mit `-mx-1` (4 px), Meta-Zeile der Instanzkarte ohne `title`, Register „Entdecken“ mit eigenem Scrollbalken.

## Raster (Bibliothek) je Fenster

| Fenster | Spalten | Seitenleiste |
|---|---|---|
| 800×600 | 2 | schmal (64 px, Tooltips) |
| 1024×768 | 3 | ausgeklappt (224 px) |
| 1280×800 | 3 | ausgeklappt |
| 1440×900 | 4 | ausgeklappt, Inhalt max. 1200 px |
| 1920×1080 | 5 | ausgeklappt, max. 1440 px |
| 2560×1440 | 6 | ausgeklappt, max. 1600 px |

Entdecken: 1 Spalte bis 1024, 2 ab 1280, 3 ab 1920, 4 bei 2560 (Kacheln `minmax(24rem, 1fr)`).

## Hi-DPI (1280×800)

| deviceScaleFactor | Spielen | Bibliothek |
|---|---|---|
| 1.25 | doc: kein Überlauf, scharf | doc: kein Überlauf, scharf |
| 1.5 | doc: kein Überlauf, scharf | doc: kein Überlauf, scharf |

Alle Icons sind SVG, Instanzkacheln CSS-Raster; es gibt keine Bitmaps unter 2×.

## Weitere Prüfungen

- Tastatur: Tab-Reihenfolge Navigation → Einklappen → Kontowechsler → Suche → Neu → Karte → Menü → Spielen-Icon; jedes Ziel hat einen sichtbaren Fokusring (`ring-2 ring-ring`), das Spielen-Icon der Karte erscheint bei Fokus.
- `prefers-reduced-motion: reduce`: Übergänge auf 0,01 ms (gemessen an Knopf und Seitenleiste), Seitenwechsel ohne Überblendung; Fortschrittsbalken ausgenommen.
- Browser-Konsole während aller Läufe: keine Fehler.
- `pnpm build` (tsc strict + vite) grün.

## Nachlauf Review-Befunde (29.09.2026)

Neu erzeugt in allen sechs Größen: spielen, instanz-protokoll, entdecken-details, einstellungen (einstellungen bytegleich, keine sichtbare Änderung). Prüfung: 24 / 24 ohne doc/clipped/spill/untitled.

- **Spielen:** ab 1280 px zweite Hero-Spalte mit Inhalte-Anzahl, Loader-Version, Erstelldatum und den vier zuletzt selbst hinzugefügten Inhalten; ab 1920 px größere Kachel und Überschrift. „Weitere Instanzen“ zeigt bis zu 8. Bei 800×600 bleibt „Spielen“ ohne Scrollen sichtbar (Hero-Spalte erst ab xl). Der Leerraum darunter bei 2560×1440 kommt aus den Mock-Daten (6 weitere Instanzen = eine Reihe); es gibt bewusst keine Füllflächen.
- **Entdecken-Details:** Reihen verlinkter Bild-Knöpfe (z. B. „How to install“, „Discord“) erscheinen als Textlinks in Primärfarbe; einzelne verlinkte Bilder (Video, Screenshots) bleiben.
- **Protokoll-Last:** `voxletMock.logBurst("inst-vanilla")` (5000 Zeilen in ≈2 s, Dev-Build 1280×800): Median-Frame 4 ms, 3 Frames über 50 ms (max. 100 ms), 2000 Zeilen im Puffer, bleibt unten angeheftet.
