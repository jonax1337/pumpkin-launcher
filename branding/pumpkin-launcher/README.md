# Pumpkin Launcher: finale App-Assets

**SVG ist die Logoquelle.** Jede Season hat genau ein freigegebenes Zeichen. UI, Wortzeichen und Vorschau verwenden SVG direkt. Es gibt keine separaten Mini-Zeichnungen, monochromen Tray-Masken oder PNG-Versionen für die UI.

Die Dateien sind vorbereitet, **noch nicht in die App eingebaut**. Tauri-Konfiguration, Produktname, bestehende App-Icons und UI-Code wurden durch diese Vorbereitung nicht geändert.

## Dateien

In `assets/<standard|spring|summer|halloween|winter>/`:

| Datei | Zweck |
|---|---|
| `mark.svg` | Verbindliches, editierbares Logo der Season; direkt für UI und Skalierung |
| `lockup.svg` | Logo plus „PUMPKIN LAUNCHER“, Schrift als Pfade |
| `32x32.png` | Native Tauri-/System-Bilddatei, bei Bedarf auch für ein farbiges Tray-Icon |
| `128x128.png`, `128x128@2x.png` | Die von der vorhandenen Tauri-Konfiguration erwarteten PNG-Größen |
| `icon.ico` | Windows-Container mit 16, 24, 32, 48, 64, 128 und 256 Pixeln |
| `icon.icns` | macOS-Container mit 32–1024 Pixeln inklusive Retina-Einträgen |

Alle nativen Bilder werden **direkt aus derselben SVG-Datei** gerendert, ohne neue Gesichtszüge oder vereinfachte Formen. Die 32px-Renderings werden gegen die Pixel-Hashes der freigegebenen Entwürfe geprüft.

`wordmark/` enthält das reine Wortzeichen als helle und dunkle SVG. Die Konturen sind in Pfade umgewandelt. `web/` enthält das Standard-Favicon als SVG und ICO. Weitere Rasterformate für die UI sind nicht nötig.

## Übergabe

- `motion/`: 30 animierte SVGs (sechs Bewegungen × fünf Seasons), statische Fallbacks und eine interaktive Vorschau. Details in [motion/README.md](motion/README.md).
- `index.html`: finale Vorschau, inklusive Datumstest; alle gezeigten Logos sind SVGs.
- `overview.png`: aufbewahrte Übersicht des letzten Konzepts.
- `CONCEPT.md`: gewählte Motive und vorgeschlagene Saisonzeiten.
- `manifest.json`: Asset-Pfade und Prüfsummen.
- `pumpkin-launcher-assets.zip`: vollständiges Paket mit Quellen und Generator.

Die verworfenen Entwürfe und die verworfenen Mini-/Tray-Dateien wurden aus dem Repository in einen lokalen Wiederherstellungsordner außerhalb des Projekts verschoben. Im Repository bleibt nur dieses finale Konzept.

## Neubau und Prüfung

```powershell
python branding/pumpkin-launcher/build.py
python branding/pumpkin-launcher/build.py --check
node branding/pumpkin-launcher/seasons.mjs --check
```

Benötigt werden Python mit Pillow sowie Node.js mit Sharp. Sharp ist im vorhandenen Codex-Runtime-Paket verfügbar; der Renderer findet zuerst eine reguläre Installation, danach die lokale Codex-Runtime. Alternativ kann `PUMPKIN_SHARP_PATH` auf das Sharp-Paket zeigen. Es wurden keine App-Abhängigkeiten installiert oder verändert.

Der Build liest jede eingebettete ICO-/ICNS-Größe wieder ein und vergleicht sie mit einem direkten SVG-Rendering. Die SVGs sind die eigenständige Quelle; die alten Entwurfs-Skripte und der Pixel-Art-Studio-Skill werden für die statischen Assets nicht benötigt. Die Lizenz der verwendeten Jersey-10-Schrift liegt in `source/FONT-LICENSE.txt`.

Die Animationen werden separat mit `python branding/pumpkin-launcher/motion/build.py` erzeugt; ihr Zeichengenerator verwendet den installierten Pixel-Art-Studio-Skill. Anschließend aktualisiert der normale Branding-Build auch das vollständige ZIP. Der Branding-Build prüft, dass die Animationen weiterhin zu den unveränderten SVG-Quellen gehören.

Die vorhandene Tauri-Konfiguration erwartet die fünf nativen Dateien aus der Tabelle. Zur späteren Integration können die Dateien einer Season nach `src-tauri/icons/` übernommen und die SVGs in der UI referenziert werden. Diese Ziele wurden noch nicht überschrieben. Die Datumsfunktion in `seasons.mjs` ist ebenfalls nur vorbereitet; sie wird aktuell ausschließlich in der Vorschau genutzt.
