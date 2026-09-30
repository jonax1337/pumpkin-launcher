# Pumpkin Launcher

Die ausgewählte Logo-Familie besteht aus Buddy als Standard und vier Seasons. Der Sommer verwendet das verfeinerte Palmenmotiv aus Konzept 06. Frost entspricht exakt der vom Nutzer bestätigten Fassung.

| Variante | Identität | Dateien | Vorgeschlagenes Zeitfenster |
|---|---|---|---|
| Buddy | Originalkürbis mit Blatt und offenen Augen | `assets/standard/` | Jederzeit manuell; automatisch in den Pausen |
| Bloom Buddy | Blüte und Lachaugen | `assets/spring/` | 1. März–31. Mai |
| Sunny Buddy | Kleine Palme und entspannte Lachaugen | `assets/summer/` | 1. Juni–31. August |
| Hex Buddy | Geknickter Zauberhut und Zwinkern | `assets/halloween/` | 1. Oktober–2. November |
| Frost Buddy | Eisblaue Mütze, seitlich geknoteter Schal, rosige Wangen | `assets/winter/` | 1. Dezember–Ende Februar |

Automatische Standardpausen: September sowie 3.–30. November. Die Termine sind ein Vorschlag; eine manuelle Wahl des Standardlogos oder einer festen Season ist vorgesehen. Die Datumslogik in `seasons.mjs` hat 18 ausführbare Grenzfallprüfungen: `node seasons.mjs --check`.

## Zeichnung und Export

- Alle Motive basieren auf einem 32×32-Gestaltungsraster; die verbindlichen Quellen sind die transparenten SVG-Dateien.
- `32x32.png`: direkter SVG-Export für native System-Schnittstellen.
- `128x128@2x.png`: direkter 256px-SVG-Export für die vorhandene Tauri-Konfiguration.
- `mark.svg`: verbindliche SVG-Quelle; direkt in der UI verwenden.
- `overview.png`: Vergleichstafel der ausgewählten Familie.
- Die UI skaliert die SVGs direkt. Rasterdateien werden ausschließlich für native Systemformate daraus erzeugt; es gibt keine eigenständigen Mini- oder Tray-Zeichnungen.

Die gemeinsame Basis verwendet Kürbisorange `#E9904D`, warmes Licht `#F8BD72`, Pflaumenschatten `#784153` und dunkle Konturen `#2B2433`. Blätter: `#69866E` und `#ADC795`; die Palme ergänzt `#416454` für die Schatten der Wedel. Saisonale Akzente ergänzen die Figur, während Körper und Grundfarben wiedererkennbar bleiben. Die Gesichter dürfen zur Season passen.

Die bestehenden Launcher-Schriften bleiben die typografische Basis: Jersey 10 für das Wortzeichen, Big Shoulders Display für große Überschriften und Hanken Grotesk für UI-Text.

Die Zeichen wurden mit Pixel Art Studio aufgebaut und in großen, kleinen und einfarbigen Ansichten geprüft. Die finale Palme hat neun Farben, binäre Transparenz, keine isolierten Alpha-Pixel und keine nahen Farbduplikate. Standard, Frühling, Halloween und Winter wurden per SHA-256 gegen die vorherigen Fassungen abgeglichen.

Dies ist das abgeschlossene Designkonzept mit exportierten Assets und funktionierender Datumsvorschau. Die Integration in die Launcher-App ist ein separater nächster Schritt. Namens- und Markenverfügbarkeit wurden nicht geprüft.
