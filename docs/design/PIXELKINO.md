# Pixelkino: Umsetzungsspezifikation

Referenz-Mockup: `docs/design/concepts/pixelkino.html` (eine Datei, Mockup-Schalter oben in der Fensterleiste).
Idee: Die Szene ist die einzige laute Stelle. Alles andere ist flach, ruhig und folgt einem einzigen Pixelraster.

## 1. Tokens

### Farben (nur dunkles Schema, `color-scheme: dark`)
| Token | Wert | Rolle |
|---|---|---|
| `--bg` | `#070A11` | Grund, flach, kein Raster |
| `--bg-2` | `#0A0E17` | Fensterleiste |
| `--panel` / `--panel-2` / `--panel-3` | `#0F1521` / `#151D2C` / `#1D2739` | Platten, Hover, erhöht |
| `--sunk` | `#0B1019` | eingelassene Flächen (Eingaben, Schalterbahn) |
| `--line` / `--line-2` / `--edge` | `#232E42` / `#33415C` / `#03050A` | 1-Einheit-Rahmen, stark, Außenkante |
| `--fg` / `--fg-2` / `--fg-3` | `#EBF0F8` / `#A9B4C8` / `#8491A8` | Text (alle AA auf `--panel`) |
| `--copper` | `#E39860` | Marke, globaler Akzent, Auswahl |
| `--acc` | pro Instanz (Biom) | Spielen-Knopf, Poster-Ring, Kopf |
| `--ink` | `#120C07` | Schrift auf Akzent |
| `--run` / `--warn` / `--bad` | `#8CC8F0` / `#FFD84A` / `#FF6D86` | läuft, Warnung (Zitronengelb), Fehler (Rosenrot); kein Grün |
| `--focus` | `#F6E7C8` | Fokusring |
| `--tip-bg` / `--tip-a` / `--tip-b` | `#0C0A18` / `#54409A` / `#2A2156` | Item-Tooltip |

Instanz-Akzente (`BIOMES[…].acc` in `pixel/scene.ts`): Wald `#EB85D6` (Abendorchidee), Nether `#FF7447`, End `#DCD394`, Schnee `#F4B4A8`, Höhle `#C8ABEE` (Amethyst), Küste `#4FD8E6`, Ebene `#98B0FF`.
Abgeleitet: `--acc-hi` (Licht, Mischung mit Weiß), `--acc-mid` (Schatten, 76 %) und `--acc-lo` (Sockel, 50 %) mischen **in OKLab mit `--bg`** (`#070A11`), nie mit Braun: der Farbton bleibt, kühle Biome bekommen keine orangen Ränder. Die Ableitung steht auf `:root` **und** auf jedem Element mit `style="--acc: …"` (sonst erben alle die Kupfer-Werte von `:root`).

**Farbsemantik (Regel).** Akzent heißt „diese Instanz, hier handeln“, Status heißt „etwas ist so“. Deshalb:
- Kein Biom-Akzent liegt näher als ΔE<sub>OK</sub> 8 an `--warn`, `--bad` oder `--copper` (ΔE<sub>OK</sub> = OKLab-Abstand × 100; ab etwa 8 nebeneinander klar verschieden). Zu `--run` gilt 6, weil „Läuft“ immer als Text mit Symbol erscheint.
- Warnungen und Fehler tragen **immer** ein Symbol oder eine Form (Warnsymbol, Punkt-Chip, Rahmen), nie nur Farbe.
- Text in `--ink` auf jedem Akzent ≥ 4,5:1 (tatsächlich ≥ 7,2:1).

| Akzent | ΔE Kupfer | ΔE Warnen | ΔE Fehler | ΔE Läuft | `--ink` darauf |
|---|---|---|---|---|---|
| Wald `#EB85D6` | 18,2 | 30,5 | 11,4 | 19,5 | 8,2:1 |
| Nether `#FF7447` | 8,3 | 23,4 | 8,1 | 27,5 | 7,3:1 |
| End `#DCD394` | 14,2 | 8,5 | 24,0 | 16,3 | 12,8:1 |
| Schnee `#F4B4A8` | 10,1 | 15,5 | 15,2 | 15,8 | 11,0:1 |
| Höhle `#C8ABEE` | 18,4 | 26,8 | 18,3 | 10,1 | 9,7:1 |
| Küste `#4FD8E6` | 23,5 | 24,2 | 30,9 | 6,7 | 11,4:1 |
| Ebene `#98B0FF` | 22,4 | 30,1 | 23,7 | 7,4 | 9,2:1 |

Status untereinander: Kupfer–Warnen 17,7, Kupfer–Fehler 12,7. Vorher lagen Wald `#F2B84B` und Warnen `#F2C14E` bei 2,2 (nicht unterscheidbar), Nether–Fehler bei 5,4, Ebene/Höhle–Läuft bei 2,6/3,8, Höhle–Ebene bei 2,7. Nachrechnen: OKLab-Abstand der Hex-Werte, Kontrast nach WCAG.

### Pixeleinheit `--px`
- Stufen: klein/mittel/groß = 2/3/4 CSS-px bei 100 %.
- DPR-Regel: `dev = round(ziel * devicePixelRatio)`, `--px = dev / devicePixelRatio`. Bei 125 % wird aus 3 px also 4 Gerätepixel = 3,2 CSS-px, bei 150 % 5 Gerätepixel. Neu berechnen bei `matchMedia('(resolution: …dppx)')`-Wechsel.
- Aus `--px` abgeleitet: `--u2`, `--u3`, Kerben, Bevel, Rahmen, Fokusring, Fortschrittszellen, Icon-Pixel, Szenenpixel.
- Icons: Box fest (28/20/40/64 px), Glyphe = ganzzahliges Vielfaches von `--px`, das in die Box passt (`--pis`, `--piss`, `--mis`, `--mil`, `--avs` per JS).
- Layout-Maße (Höhen, Abstände, Spalten) sind feste CSS-px und hängen **nie** von `--px` ab.

### Seitenrahmen und Formularraster
- `--gut` (16–40 px, mit der Fensterbreite) ist der einzige Seitenrand: Fensterleiste (Marke sitzt auf `--gut`), Start, Bibliothek, Entdecken, Einstellungen, Instanzkopf.
- `--page-max` (1240 px): Höchstbreite des Inhalts auf allen Listen- und Formularseiten (`.page`, `.set`), links bündig. Szenen (Start, Instanzkopf) reichen weiter bis an den Rand.
- Seitentitel (`.h-page`, 40 px) steht überall in einem 44 px hohen Kopf (`.page-h`, Entdecken `.disc-top`) auf gleicher Höhe.
- Alle Seiten enden rechts an derselben Kante: `--gut` + `--page-max` (bei 1440 px Fensterbreite x = 1277, bei 1100 px x = 1071). Das gilt auch für Formulare, Tab-Leisten und Trennlinien.
- Formularraster für globale und Instanz-Einstellungen gleich (`.form`, Container-Abfrage auf die Formularbreite): Label `--form-lab` (220 px, unter 900 px 170) | Steuerelement bis `--form-ctl` (560 px) | Hilfe `.fh` als rechte Spalte (höchstens 60 Zeichen, 1-Einheit-Linie links). Unter 1100 px Formularbreite rutscht `.fh` unter das Steuerelement (dann bis 640 px breit). Breite Inhalte (Bildwahl) spannen mit `.fc.wide` über Steuer- und Hilfespalte.

### Kerben und Radien
Kein `border-radius`. Ecken nur als Stufen-`clip-path`: `--n1` (1 Stufe, alle kleinen Bausteine), `--n2` (2 Stufen, Dialog, Panel, Popover, Toast), `--ring` (Fokus/Auswahl: 1 Einheit breit, 1 Einheit Abstand, `evenodd`-Polygon auf `::after`).

### Typo
| Rolle | Schrift | Größe |
|---|---|---|
| Display | Big Shoulders Display 800, Versalien | Start `clamp(52px, 5.2vw + 20px, 112px)`, Kopf `clamp(40px, 3.4vw + 14px, 72px)`, Seite 40, Abschnitt 20–22, Poster 21, Mini 18 |
| Lesetext/UI | Hanken Grotesk 400–700 | 14/1.45, klein 12–13, Label 12.5/600 |
| Pixel | Jersey 10 | nur Zahlen, Prozent, Zähler, Code, Wortzeichen (18–44) |
| Konsole | Cascadia Mono (System) | 12.5/1.65 |
Schriften mit `display=block`; die App wird erst nach `document.fonts.ready` sichtbar (kein Nachrutschen).

## 2. Bausteine und Zustände
| Baustein | Aufbau | Zustände |
|---|---|---|
| Knopf primär | Sockel `::before` (`--acc-lo`) + Fläche `.bf` (Licht oben/links, Schatten unten/rechts, je 1 Einheit) | Hover: Fläche +1 Einheit hoch; gedrückt: Fläche sinkt, Bevel kehrt sich um, Inhalt +1 Einheit (alles `transform`); deaktiviert: flach ohne Bevel |
| Knopf sekundär | dunkle Platte, 1-Einheit-Rahmen, Bevel | Hover heller; gedrückt Bevel invers + Inhalt 1 Einheit tiefer |
| Knopf Geist | nur Text | Hover: Pixel-Unterstrich (1 Einheit) |
| Höhen | 32 / 40 / 56 px | Symbolknopf quadratisch; kleine Knöpfe nutzen 5×5-Icons, große 7×7 |
| Spielen | 272×56 (`m` 176×40, `i` 32×32), feste Größe | Spielen (Unterzeile „Installiert beim ersten Start“, wenn nötig) · Wird installiert x % (Segmentbalken statt Unterzeile) · Startet (laufender Balken) · BEENDEN mit Unterzeile „Läuft seit …“ (dunkel, Akzentrahmen; Klick fragt nach) · Erneut versuchen / Erneut starten (Fehlerrot) · Kann nicht starten (flach) |
| Tab | Platte nur aktiv, 1-Einheit-Akzentstrich unten | Hover Platte `--panel`; Zähler in Pixelschrift mit fester Breite |
| Chip | 28 px (22 klein), 1-Einheit-Rahmen, Kerbe | neutral, `acc`, `warn`, `bad`, `run`; Status-Chip mit fester Breite |
| Schalter | 40×22, Bahn eingelassen, Knauf als Block | an: Kupfer, Knauf rechts (`transform`, `steps(3)`); „Bewegte Szenen“ ist bei `prefers-reduced-motion` aus und gesperrt, mit Grund daneben |
| Checkbox | 20×20, eingelassen | an: Kupferblock + 5×5-Haken; teilweise: Strich |
| Radio | 20×20, zweistufig gekerbt | an: 2×2-Kern |
| Slider | 16 Zellen (1 bis 16 GB) auf dunklem Grund + Griffblock; Breite ~400 px, auf ganze Zellen gerundet (Zelle = Vielfaches von `--px`) | Tastatur Pfeile/Home/End; deaktiviert bei „Automatisch“; Zellen über dem, was der PC übrig hat: flach und dunkler, ohne Umriss, darunter „max. N GB“ an der Grenze. Warnung (zu viel für den PC) mit Warnsymbol |
| Fortschritt | Zellen 2 Einheiten, Lücke 1 Einheit; Füllung per `clip-path` auf ganze Zellen gerundet (`round(down, …)`) | bestimmt, unbestimmt (`steps`), Fehler |
| Tooltip | Item-Tooltip: dunkler Grund, 1-Einheit-Verlaufsrahmen | 450 ms Verzögerung; weg bei Klick, Scroll, Rad, Esc, Fokusverlust, DOM-Wechsel |
| Menü | Popover `--n2`, Einträge 36 px | Pfeiltasten, Esc, Fokus zurück zum Auslöser |
| Dialog | fest positioniert, **feste Höhe** pro Dialog, Kopf/Körper/Fuß | Körper scrollt; Fokusfalle; Esc |
| Toast | 56 px, gestapelt per `translateY` | Aktion (Rückgängig, Öffnen, Spielen), 6,5 s |
| Poster | 4:5, Szene + Rahmen (1 Einheit dunkel, Licht oben/links) | Hover: Aktionen; Kontextmenü; Status-Chip oben links |
| Listenzeile | Instanzen 56 px, Inhalte 48 px, Welten 64 px, feste Spalten | Hover-Platte; Auswahl kupfern; entfernt = Platzhalterzeile gleicher Höhe mit „Rückgängig“ |

### Statusmodell
- Der große Spielen-Knopf ist immer die **Aktion** für den jetzigen Zustand: Spielen, Wird installiert x %, Startet, BEENDEN (Unterzeile „Läuft seit …“), Erneut starten. Der Zustand steht damit im Knopf selbst.
- Ein Status-Chip („Läuft“, „Wird installiert“ …) erscheint nur dort, wo kein Spielen-Knopf den Zustand schon zeigt (z. B. Poster). Nie Chip und Knopf mit derselben Aussage nebeneinander.

### Glossar (UI-Wörter)
| Handlung / Zustand | Wort |
|---|---|
| Neue Instanz erzeugen | „Anlegen“ („Instanz anlegen“, „Als neue Instanz anlegen“); nie „Erstellen“ oder „Installieren“ |
| Inhalt (Mod, Shader, Paket) zu einer Instanz | „Hinzufügen“ |
| Herunterladen/Einrichten als Zustand | „Wird installiert x %“ |
| Laufendes Spiel stoppen | „Beenden“ (mit Rückfrage) |
| Reparieren als Zustand | „Wird repariert“ |
| Warnung | immer Warnsymbol oder Form, nie nur Farbe |

## 3. Szenen-Engine
- Canvas in Welt-Pixeln (`W = ceil(breite / --px)`), `image-rendering: pixelated`, CSS-Größe `W * --px`, zentriert und unten verankert, Versatz auf Gerätepixel gerundet. Nie verzerrt, nur beschnitten.
- Pro Biom 4 bis 7 Himmelsbänder, die zum Horizont schmaler werden; 3 bis 4 Silhouetten-Ebenen (Tiefe 1 hinten bis 4 vorn) mit Luftperspektive; Licht als 1-Pixel-Kante auf der Seite zur Sonne.
- **Dithering-Regel:** nur als geordnete Bayer-4×4-Kante an einer Bandgrenze, 4 Welt-Pixel hoch (2 bei kleinen Szenen, 0 bei Miniaturen). Nie flächig, nie im Seitenhintergrund.
- Lebenszeichen mit 12 fps: Sterne funkeln, ein Wolkenband zieht, Glut/Schnee/Partikel, Fackel flackert, Glitzern auf Wasser/Lava. Parallax nur auf der Startseite, in ganzen Welt-Pixeln.
- Szenenwechsel: Bayer-Auflösung in 8 Schritten.
- **Pausen:** Spiel startet/läuft, `document.hidden`, „Bewegte Szenen“ aus, `prefers-reduced-motion`. Dann ein ruhiges Standbild.
- Vignette und Lesbarkeits-Verläufe per CSS über der Szene. Statische Szenen (Poster, Miniaturen, Galerie) werden einmal gerendert und nach Größe gecacht.
- Paletten und Aufbau je Biom: `buildScene()` im Mockup (Wald, Nether, End, Schnee, Höhle, Küste, Ebene).

## 4. Layoutshift-Regeln
1. Wechselnde Elemente haben feste Maße: Spielen-Knopf, Statuszeile (32 px), Status-Chip, Update-Knopf, Zellen mit vertikaler Zentrierung (feste Höhe), Zählerbreiten, Kontoname.
2. Overlays (Menü, Tooltip, Toast, Panel, Dialog, Aufgaben, Konto) sind `fixed` und nur per `transform`/`opacity`/`visibility` animiert.
3. Inhalt, der zu einer anderen Instanz gehört, wird neu gemountet (`key`), nicht umgeschrieben.
4. Entfernen hinterlässt einen Platzhalter gleicher Höhe; neue Einträge werden unten angehängt.
5. Instanzkopf: `position: sticky; top: calc(64px - var(--dh))`; groß und kompakt liegen übereinander und wechseln per Klasse und `opacity`.
6. `scrollbar-gutter: stable`, `tabular-nums`, `display: flow-root` für Tab-Inhalte (keine Margin-Kollaps-Sprünge).
7. Messung: `PerformanceObserver('layout-shift')` in `window.__cls`, Anzeige per `?cls=1`.

## 5. Umsetzung in der React-App (Stand 2026-09-30)
Das vorherige Design („Deepslate & Emerald“, shadcn/ui, Seitenleiste) ist vollständig ersetzt.

| Bereich | Datei(en) |
|---|---|
| Tokens, Bausteine, Mockup-Stile | `src/styles/pixelkino.css` (aus dem Mockup übernommen), Einbindung in `src/index.css`, Schriften per `@fontsource` |
| Zustände und Bewegung | `src/styles/states.css`: eigene Auswahlliste, Hover · Druck · Fokus je Baustein, Ein- und Ausblenden von Menü, Tooltip, Dialog, Seitenpanel, Seitenwechsel |
| Pixeleinheit | `src/pixel/unit.ts` (`usePixelUnit`, DPR-Regel aus Abschnitt 1) |
| Szenen-Engine | `src/pixel/scene.ts` (reines TS, `buildScene` aller 7 Biome, 12-fps-Takt, Pausenregeln, Bayer-Wechsel, Cache), `src/pixel/PixelScene.tsx` |
| Icons, Glyphen, Wortzeichen, Spielerkopf | `src/pixel/icons.tsx` |
| Bausteine | `src/components/px.tsx` (Radix für Menü, Kontextmenü, Auswahl, Tooltip, Dialog, Seitenpanel; Sonner für Toasts) |
| Fensterleiste | `src/app/Layout.tsx` (rahmenlos, Pixel-Tabs, Aufgaben-Menü, Kontomenü, Fensterknöpfe) |
| Spielen | `src/components/game.tsx` (`PlayButton`, `PlayStatus`, `StatusChip`, `LogConsole`) |
| Seiten | `pages/Home.tsx`, `Instances.tsx`, `InstanceDetail.tsx` + `pages/detail/`, `Discover.tsx`, `Settings.tsx`; `components/ContentBrowser.tsx`, `NewInstanceDialog.tsx`, `PlayerNames.tsx`, `Onboarding.tsx`, `instance.tsx` |
| Laufzeit | `store/look.ts` (Biom je Instanz), `store/tasks.ts` (Aufgaben-Verlauf), `store/game.ts` (Startzeit für „Läuft seit“) |

**Bewusst nicht umgesetzt** (kein Backend dafür): Welten-Tab, Launcher-Selbstupdate und dessen Hinweis, „Version ändern“, eigenes Bild, Galerie im Katalog, Export/Duplizieren im Instanz-Menü. Das Biom je Instanz liegt lokal statt im Datenmodell.

**Abweichungen vom Mockup:**
- Auswahlfelder öffnen eine eigene Pixel-Liste statt der nativen Liste; die Breite richtet sich nach der längsten Option.
- „Alle aktualisieren“ wird schon ab 1180 px kompakt (Symbol + Zahl), weil die Werkzeugleiste der echten App mehr Platz braucht.
- Einstellungen: echte Tabs waagerecht unter dem Titel statt Seitenspalte (Konten, Spiel, Darstellung, Erweitert, Über Voxlet; `role=tab`/`tabpanel`, Roving-Tabindex, Pfeile/Home/End). Zustand in `?tab=…`; `#konten` (Kontomenü) und die anderen Abschnitts-Anker öffnen ihren Tab. Je Tab nur dessen Inhalt; der Tab-Name ist die Überschrift (`h2` nur für Vorleser). Klebt die Leiste beim Wechsel oben, springt die Seite auf ihre Ruhelage zurück.
- Instanz- und Statusfarben weichen vom Mockup ab (Farbsemantik, Abschnitt 1).
- Hover, Druck und Ausblenden sind über das Mockup hinaus ergänzt (Abschnitt „Zustände“ in `states.css`): Übergänge laufen in ganzen Stufen (`steps`), nie über halbe Pixel.

**Stolperfallen:**
- Stylesheets aus Komponenten laden vor `index.css`. Die Schichtreihenfolge (`@layer theme, base, components, utilities`) steht deshalb in `index.html`, sonst gewinnt Tailwinds Reset über alle Pixelkino-Stile.
- Klassennamen dürfen nicht mit Tailwind-Utilities kollidieren (Beispiel: `ring` zeichnete einen Pixel an jedem Schalter; heißt jetzt `fring`).

## 6. Offen
1. **Abnahme:** Layoutshift-Skript (Playwright, `element.click()`), 100/125/150 %, Tastatur, reduzierte Bewegung.
2. **Backend:** Welten-API, Biom im Datenmodell, Launcher-Update, Versionswechsel mit Prüfung.
