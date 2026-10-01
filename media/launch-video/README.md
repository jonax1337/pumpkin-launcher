# Launch-Video „One Take“

44 s, 60 fps, eine durchgehende Kamerafahrt ohne Schnitt durch eine Pixel-Welt im Pixelkino-Stil, mit Buddy als Hauptfigur und einem selbst komponierten Chiptune-Soundtrack. Gebaut mit [HyperFrames](https://hyperframes.heygen.com) (HTML + GSAP → MP4).

| Ordner | Inhalt |
|---|---|
| `src/` | Film-Code: `film.js` (Welt, Kamera, Timeline), `pixel.js` (Pixel-Art-Generatoren), `film.css` |
| `audio/music.py` | Soundtrack- und SFX-Synth (Python, numpy + scipy), fester Seed → immer dieselbe Datei |
| `yt/`, `tiktok/` | HyperFrames-Projekte 1920×1080 (YouTube) und 1080×1920 (TikTok, Shorts, Reels) |
| `build.mjs` | Baut beide Projekte zusammen: Buddy-Posen und Logos aus `branding/`, Schriften aus `node_modules/@fontsource*`, Soundtrack aus `audio/` |

Nichts davon wird dupliziert: `yt/src`, `yt/assets`, `tiktok/src`, `tiktok/assets` und `audio/soundtrack.wav` sind generiert und stehen in `.gitignore`. Ändert sich Buddy im Branding, zieht das Video beim nächsten Build mit.

## Workflow

Voraussetzungen: `pnpm install` im Repo-Root (für die Schriften), Node 24, Python 3 mit `numpy` und `scipy`. Die HyperFrames-CLI läuft über `npx` und ist auf eine feste Version gepinnt.

```bash
cd media/launch-video
npm run build            # Soundtrack erzeugen + beide Projekte zusammenbauen
npm run preview:yt       # Studio-Vorschau (oder preview:tiktok)
npm run check            # Lint, Layout, Kontrast für beide Formate
npm run render           # → yt/renders/…16x9.mp4 und tiktok/renders/…9x16.mp4
```

Fertige Videos gehören nicht ins Git (je ~50 MB). Sie werden auf YouTube und TikTok hochgeladen und als Assets an ein GitHub-Release gehängt.

## Ablauf (120 BPM, 1 Takt = 2 s)

| Zeit | Bild | Ton |
|---|---|---|
| 0–4 | Buddy schläft auf einem Mini-Felsen unter Polarlichtern, „Mods. Modpacks. Shader. Überall verstreut.“, er schreckt hoch und fliegt mit kleinen Blatt-Flügeln los | Arpeggio-Intro mit Echo, Aufwach-Blips |
| 4–20 | Modrinth, CurseForge, Feed The Beast, Technic: Salto bei der Ankunft, die Inhalte poppen auf und kreisen um ihn, beim Abflug schluckt er sie | je Insel eine 2-Takt-Phrase, Flügelschlag, Fänger-Tings |
| 20–24 | Pull-back: seine Flugspur verbindet alle Inseln, „Was, wenn alles an einem Ort wäre?“, Slam auf die Pumpkin-Insel | Snare-Roll, Riser, Reverse-Cymbal, Slam-Pfiff |
| 24 | Drop: Doppel-Schockwelle, alle 16 Inhalte brechen aus ihm heraus, „Ein Launcher. Alle Quellen.“ | Impact, Sidechain-Groove |
| 25–30 | Das Launcher-Fenster klappt aus Buddy auf; er köpft im Beat den Quellen-Schalter und stampft auf „Anlegen“ | Hook, Boings |
| 30–35 | Er hüpft über die Loader-Chips, wählt Fabric, landet auf SPIELEN → Wird installiert → Startet | Pops, Klick, Progress-Ticks |
| 35–37 | Warp-Dive: die UI fällt weg, Buddy springt in die Welt der Instanz | Launch-Whoosh |
| 37–44 | Buddy schwebt über der Sonne, Wortmarke, „Jede Welt. Dein Ding.“, GitHub-Link | Schlussakkord |

## Technik

- **Ein Take:** Die Kamera ist eine monotone kubische Interpolation (PCHIP) über Position und log-Zoom. Sie ist C1-glatt, schießt nie über und bleibt nie stehen. Dazu kommen automatisches Banking in Kurven, ein leichter Handheld-Float, Zoom-Punches im Beat und Parallax-Ebenen für Himmel, Wolken und Vordergrund.
- **Deterministisch:** Alle Pixel-Art entsteht beim Laden aus Seed-Zufall. Alles Bewegte wird aus der Timeline-Zeit berechnet (`render(t)` an einem pausierten GSAP-Proxy), deshalb ist jeder Frame reproduzierbar.
- **Buddy:** Die Posen stammen aus `branding/pumpkin-launcher/motion/standard/*.svg` und werden über die Timeline geschaltet statt über SMIL.
- **Check-Hinweis:** Die Texte in der Welt tragen `data-layout-allow-occlusion`, weil die Effekt-Canvas (Speed-Lines) im Layout-Audit grundsätzlich als opak zählt. Die Texteinblendungen im Vordergrund werden voll geprüft.
