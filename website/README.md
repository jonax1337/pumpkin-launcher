# Pumkpin Launcher Website

Eigenständige Marketing-Website im Launcher-Repo. Dunkle Pixelkino-Gestaltung mit den Originalfarben, Schriften, Icons und Landschaften der Desktop-App. HTML, CSS, GSAP und ScrollTrigger; unabhängig von Tauri gebaut.

```sh
pnpm dev:website       # http://127.0.0.1:1430
pnpm build:website     # website/dist
pnpm check:website     # lokale Links und finale Assets prüfen
pnpm preview:website   # http://127.0.0.1:1431
```

`website/dist/` ist ein eigenständiges statisches Deployment. Relative Asset-Pfade erlauben auch ein Unterverzeichnis. Der normale Launcher-Build bleibt separat. Schriftdateien, Bilder und GSAP werden lokal ausgeliefert; keine externen Anfragen oder Tracker.

## Gestaltung und Bewegung

- Bildschirmfüllender Wald-Hero, gestaffelte Typografie und eine dezente Fahrt durch die Landschaft beim Scrollen.
- Auf großen Bildschirmen führt eine gepinnte GSAP-Timeline durch drei echte App-Ansichten. Die Screens wechseln mit Perspektivbewegung; es gibt keine simulierten App-Steuerelemente.
- Gestaffelt einfahrende Landschaftsposter und Überschriften. Native FAQs, klare Informationen zum Entwicklungsstand.
- Auf Mobilgeräten und bei reduzierter Bewegung stehen alle drei App-Ansichten normal untereinander. `gsap.matchMedia()` entfernt Animationen und Pinning beim Wechsel der Systemeinstellung. Ohne JavaScript bleiben Inhalte und Navigation nutzbar.
- Buddy ist ein Markenzeichen. Die fünf Varianten erscheinen dezent im Branding; es gibt keine Auswahl oder Animations-Spielwiese.
- Maskottchen und Favicon wechseln automatisch anhand des lokalen Datums. Die Website verwendet dafür denselben Kalender wie die App (`src/branding/calendar.ts`), prüft spätestens jede Minute sowie bei Fokus-/Sichtbarkeitswechseln und berücksichtigt lokale Mitternacht. Die vier Saisonbeispiele im Footer bleiben als Übersicht unverändert. Ohne JavaScript bleibt Standard-Buddy sichtbar.

## Quellen der Assets

- `branding/pumpkin-launcher/assets/*/mark.svg`: unveränderte Originale, beim Start/Build nach `website/assets/brand/` kopiert. Der Zwischenordner wird nicht versioniert. Nur tatsächlich verwendete Dateien gelangen in den Build.
- `src/pixel/icon-data.ts`: gemeinsame Pixel-Icons.
- `assets/world-*.png`: direkt mit `SceneHost` aus `src/pixel/scene.ts` gerenderte Original-Landschaften, Seed 27, Modus `flat`, Sonnenanker `std`, Zeichenfläche 1920×1080 CSS-Pixel bei Rastergröße 3. Die daraus entstandenen 640×360-PNGs werden mit `image-rendering: pixelated` dargestellt. Biome: `forest`, `nether`, `snow`, `sea`. Keine KI-generierten Ersatzlandschaften.
- `assets/launcher-*.png`: echte Browser-Aufnahmen der aktuellen App mit Beispielinstanzen vom 30.09.2026. Der Modrinth-Katalog zeigt die zum Aufnahmezeitpunkt geladenen Inhalte.
- Schriften: Big Shoulders Display, Hanken Grotesk und Jersey 10 aus den vorhandenen Font-Paketen.

Der Website-Auftrag verwendet die Schreibweise **Pumkpin Launcher**, die App und Original-Assets **Pumpkin Launcher**. Zum Erstellungszeitpunkt gibt es keinen öffentlichen Installer; die Seite weist deshalb auf den Entwicklungsstand hin. Vor Veröffentlichung die tatsächliche Download-Adresse und Betreiberangaben ergänzen. Die Seite wurde lokal gebaut, nicht veröffentlicht.

## Prüfung

Der Produktionsbuild wurde bei 1440×900 sowie 390×844 und 320×780 im Browser geprüft: keine horizontale Überbreite, native FAQ per Tastatur bedienbar, alle App-Ansichten bei reduzierter Bewegung sichtbar. Die komplette Scrollsequenz mit CSS Sticky und GSAP zeigte im lokalen Browserlauf CLS 0. Keine Konsolenfehler. `pnpm build:website`, `pnpm check:website` und `pnpm exec tsc --noEmit` bestanden.
