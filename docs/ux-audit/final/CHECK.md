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

## Echte App (Release-Build, installiert) – 29.09.2026

Screenshots: `app/<Breite>x<Höhe>/<ansicht>.png` mit Jonas' echten (Test-)Daten, Innenmaß des Fensters exakt per `SetWindowPos`, aufgenommen per `PrintWindow` (so auch 1920×1080 und 2560×1440 auf einem 1920×1080-Bildschirm). Ansichten: spielen, bibliothek, instanz-inhalte (50 Einträge, migriertes Pack), instanz-protokoll, instanz-einstellungen, entdecken, entdecken-details, einstellungen, dialog-neu, onboarding, spiel-laeuft.

In der installierten App durchgespielt:

| Pfad | Ergebnis |
|---|---|
| Start ohne weißen Blitz (Fenster-Hintergrund dunkel) | ok |
| Migration alter Pack-Instanzen | „Ember QA Local/API Pack“ zeigen 50 statt 0 Inhalte, Icons von Modrinth |
| Vanilla 26.3 anlegen, installieren, starten, stoppen | ok (Titelbildschirm) |
| NeoForge 1.21.1: Installation abbrechen | neutraler Hinweis „… abgebrochen“, Instanz bleibt „Nicht installiert“ |
| NeoForge 1.21.1 installieren und starten | ok, „Sound engine started“, Atlanten erzeugt |
| Iris über „Hinzufügen“ in NeoForge-Instanz | Iris + Sodium („benötigt von Iris Shaders“), beide im Log geladen |
| Spielprozess von außen beendet | Banner + dauerhafter Toast „… ist abgestürzt“, „Protokoll anzeigen“ |
| Quilt 1.21.1 anlegen und starten | ok, „Loading Minecraft 1.21.1 with Quilt Loader 0.30.1“ |
| Fabric 1.21.11 mit Iris/Sodium starten | ok |
| Modpack „NeoFine Optimized“ (NeoForge 1.20.1, 19 Mods) über Entdecken | zuerst abgelehnt → NeoForge 1.20.1 nachgerüstet → startet bis Titelbildschirm |
| Neu › Datei › nativer Dateidialog (.mrpack) | ok, Name vorbelegt, Import inkl. „benötigt von“ |
| Neu › Datei › Drag&Drop aus dem Explorer | ok, Datei erkannt, Name vorbelegt |
| Microsoft-Anmeldung ohne Client-ID | klare Meldung „… noch nicht eingerichtet (es fehlt die Client-ID)“ |
| Microsoft-Anmeldung mit Platzhalter-Client-ID | Anfrage erreicht Microsoft, Ablehnung wird angezeigt (echte Anmeldung braucht Azure-App, s. `docs/ACCOUNT-SETUP.md`) |
| Onboarding „Mit Mods“ bei leerer Bibliothek | legt Fabric 26.3 + Sodium an und startet direkt; Sodium im Log geladen |
