# Pumpkin Launcher Website

Eigenständige Marketing-Website im Launcher-Repo. Dunkle Pixelkino-Gestaltung mit den Originalfarben, Schriften, Icons und Landschaften der Desktop-App. HTML, CSS, GSAP und ScrollTrigger; unabhängig von Tauri gebaut.

```sh
pnpm dev:website       # http://127.0.0.1:1430
pnpm build:website     # website/dist
pnpm check:website     # lokale Links und finale Assets prüfen
pnpm preview:website   # http://127.0.0.1:1431
```

`website/dist/` ist ein eigenständiges statisches Deployment. Relative Asset-Pfade (`base: "./"`) erlauben auch ein Unterverzeichnis; GitHub Pages deployed per Workflow `.github/workflows/website.yml` auf `jonax1337.github.io/pumpkin-launcher/`. Der normale Launcher-Build bleibt separat. Schriftdateien, Bilder und GSAP werden lokal ausgeliefert; keine externen Anfragen oder Tracker. Der einzige externe Verweis ist ein Link zum Quellcode auf GitHub.

## Gestaltung und Bewegung

- Bildschirmfüllender Wald-Hero, gestaffelte Typografie und eine dezente Fahrt durch die Landschaft beim Scrollen.
- Auf großen Bildschirmen führt eine gepinnte GSAP-Timeline durch vier echte App-Ansichten (Start, Bibliothek, Instanz, Entdecken). Die Screens wechseln mit Perspektivbewegung; es gibt keine simulierten App-Steuerelemente.
- Nach der Tour füllt der Launch-Trailer die ganze Sektion: stummes MP4 in Endlosschleife (animiertes WebP wäre rund siebenmal so groß). Es lädt beim Heranscrollen, startet von vorn, sobald die Sektion erreicht ist, und pausiert, wenn sie den Bildschirm verlässt. Beim Hereinscrollen öffnet sich das Bild per Clip-Path und bewegt sich mit Parallax. Auf großen Bildschirmen bleibt die Sektion per CSS Sticky stehen, und ScrollTrigger rastet richtungsabhängig ins geöffnete Bild ein und von dort direkt in die nächste Sektion. Ein Knopf hält das Video an. Bei reduzierter Bewegung startet es angehalten; ohne JavaScript bleibt das Poster stehen. Der Outro-Knopf führt dorthin.
- Gestaffelt einfahrende Landschaftsposter und Überschriften. Native FAQs, klare Informationen zum Entwicklungsstand.
- Auf Mobilgeräten und bei reduzierter Bewegung stehen alle vier App-Ansichten normal untereinander. `gsap.matchMedia()` entfernt Animationen und Pinning beim Wechsel der Systemeinstellung. Ohne JavaScript bleiben Inhalte und Navigation nutzbar.
- Buddy ist ein Markenzeichen. Die fünf Varianten erscheinen dezent im Branding; es gibt keine Auswahl oder Animations-Spielwiese.
- Maskottchen und Favicon wechseln automatisch anhand des lokalen Datums. Die Website verwendet dafür denselben Kalender wie die App (`src/branding/calendar.ts`), prüft spätestens jede Minute sowie bei Fokus-/Sichtbarkeitswechseln und berücksichtigt lokale Mitternacht. Die vier Saisonbeispiele im Footer bleiben als Übersicht unverändert. Ohne JavaScript bleibt Standard-Buddy sichtbar.

## Quellen der Assets

- `branding/pumpkin-launcher/assets/*/mark.svg`: unveränderte Originale, beim Start/Build nach `website/assets/brand/` kopiert. Der Zwischenordner wird nicht versioniert. Nur tatsächlich verwendete Dateien gelangen in den Build.
- `src/pixel/icon-data.ts`: gemeinsame Pixel-Icons.
- `assets/world-*.png`: direkt mit `SceneHost` aus `src/pixel/scene.ts` gerenderte Original-Landschaften, Seed 27, Modus `flat`, Sonnenanker `std`, Zeichenfläche 1920×1080 CSS-Pixel bei Rastergröße 3. Die daraus entstandenen 640×360-PNGs werden mit `image-rendering: pixelated` dargestellt. Biome: `forest`, `nether`, `snow`, `sea`. Keine KI-generierten Ersatzlandschaften.
- `assets/launcher-*.png` (home, library, instance, discover): echte Browser-Aufnahmen der aktuellen App (Dev-Server mit Beispielinstanzen, 1280×720 bei Gerätefaktor 2, Seitenleisten-Layout) vom 30.09.2026. Der Katalog zeigt die zum Aufnahmezeitpunkt geladenen Modrinth-Inhalte. Bei größeren Layoutänderungen neu aufnehmen.
- `assets/trailer.mp4` und `assets/trailer-poster.jpg`: Web-Fassung von `media/launch-video/videos/pumpkin-launcher-yt-16x9.mp4` (`ffmpeg -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -an -movflags +faststart`, ≈ 9 MB, ohne Ton), Poster bei Sekunde 22,5. Nach einem neuen Render des Videos neu erzeugen.
- Schriften: Big Shoulders Display, Hanken Grotesk und Jersey 10 aus den vorhandenen Font-Paketen.

Der Name ist überall **Pumpkin Launcher** (früher stand auf der Seite versehentlich „Pumkpin“). Die FAQ nennt die Beta und verweist für die Installer auf die Releases im GitHub-Repository (Stand wie im Haupt-README). `datenschutz.html` (Hostliste, keine Tracker) und `impressum.html` nennen den Betreiber mit Name, Anschrift und E-Mail; `pnpm check:website` warnt, falls dort wieder Platzhalter (`[NAME]`, `[ANSCHRIFT]`, `[E-MAIL]`) stehen. Beide Seiten sind in `vite.config.mjs` als weitere Eingänge eingetragen und teilen sich `style.css`; ihre Schriften lädt `legal.js`.

## Prüfung

Der Produktionsbuild wurde bei 1440×900 sowie 390×844 und 320×780 im Browser geprüft: keine horizontale Überbreite, native FAQ per Tastatur bedienbar, alle App-Ansichten bei reduzierter Bewegung sichtbar. Die komplette Scrollsequenz mit CSS Sticky und GSAP zeigte im lokalen Browserlauf CLS 0. Keine Konsolenfehler. `pnpm build:website`, `pnpm check:website` und `pnpm exec tsc --noEmit` bestanden.
