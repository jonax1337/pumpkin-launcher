# Buddy Motion

Sechs vorbereitete Bewegungen für alle fünf freigegebenen Seasons: **30 animierte SVG-Dateien**. Die App verwendet diese Dateien über `src/branding/Brand.tsx`; UI-Zustände und Bewegungseinstellungen steuern die jeweilige Pose.

| Datei pro Season | Ablauf | Möglicher Einsatz |
|---|---|---|
| `idle.svg` | Ruhiges Schweben, Blinzeln, leicht nachlaufendes Blatt/Accessoire | Startseite oder Leerseite |
| `hello.svg` | Kleiner Hüpfer und Winken, dann zurück zur Ruhe | Begrüßung oder Onboarding |
| `loading.svg` | Blickwechsel und drei nacheinander aufleuchtende Pixel | Unbestimmtes Laden |
| `success.svg` | Kurzer Freudensprung, kleine Hände und Konfetti | Download oder Einrichtung fertig |
| `oops.svg` | Sanftes Kopfschütteln und überraschter Ausdruck | Ein Fehler ist aufgetreten |
| `sleep.svg` | Geschlossene Augen und aufsteigendes Z | Inaktivität oder Pause |

Ordner: `standard/`, `spring/`, `summer/`, `halloween/`, `winter/`. Jeder enthält zusätzlich `poster.svg` als statischen Fallback.

## Eigenschaften

- **SVG bleibt das App-Format.** Die Dateien sind transparent und skalierbar, ohne externe Bilder, Skripte oder Laufzeitbibliotheken.
- Feste 48×48-Zeichenfläche mit 32×32-Buddy bei Ursprung 8/8. Gleiche Maße und Ankerposition für alle Reaktionen; keine springenden Layoutgrößen.
- Native SVG-SMIL-Animationen schalten klar gezeichnete Posen um. Bewegungen bleiben auf dem Pixelraster; keine weich rotierten oder verzerrten Pixel.
- `idle`, `loading` und `sleep` laufen in Schleifen. `hello`, `success` und `oops` spielen einmal und enden im originalen ruhigen Buddy.
- `prefers-reduced-motion: reduce` zeigt automatisch die statische Version. Die ursprünglichen freigegebenen SVGs bleiben unverändert.
- `manifest.json` enthält Dateipfade, Loop-Verhalten und Laufzeiten. Fehler- und Ladeanimationen ersetzen keine Status- oder Fehlertexte.

## Verwendung

Für eine einfache laufende Animation genügt ein normales Bild:

```html
<img src="motion/standard/idle.svg" width="96" height="96" alt="Buddy">
```

Für kontrolliertes Abspielen, Pause oder erneutes Auslösen kann das SVG als `<object>` geladen werden:

```html
<object id="buddy" type="image/svg+xml" data="motion/standard/success.svg"
        width="96" height="96" aria-label="Buddy freut sich"></object>
```

Nach dem `load`-Ereignis stehen am SVG-Wurzelelement die nativen Methoden `setCurrentTime(0)`, `pauseAnimations()` und `unpauseAnimations()` zur Verfügung. Beispiel:

```js
const object = document.querySelector('#buddy');
object.addEventListener('load', () => {
  const svg = object.contentDocument.documentElement;
  svg.setCurrentTime(0);
  svg.unpauseAnimations();
});
```

Beim Verbergen, Verlassen des sichtbaren Bereichs oder einem laufenden Spiel pausieren. Die mitgelieferte Vorschau setzt das für unsichtbare Karten und verborgene Tabs bereits um. Eine CSS-Klasse `is-static` am SVG-Wurzelelement erzwingt außerdem den ruhigen Posterzustand. Die Systemeinstellung für reduzierte Bewegung hat immer Vorrang.

## Vorschau und Quelle

`index.html` zeigt alle Bewegungen, Seasons, Pause/Replay und Zeitregler. Einmalige Reaktionen werden nur in dieser Vorschau auf Wunsch wiederholt. `buddy-motion-preview.gif` ist eine reine Ansicht für Chat und Review, kein erforderliches App-Asset.

Neu erzeugen: `python branding/pumpkin-launcher/motion/build.py`. Benötigt werden Pillow und der installierte [Pixel Art Studio Skill](https://github.com/Gamezxz/pixel-art-studio), alternativ über `PIXEL_ART_STUDIO_PATH` auffindbar. Die Basisgrafiken werden direkt aus den freigegebenen SVGs gelesen und gegen ihre Pixel-Hashes geprüft.

Der Generator prüft feste Abmessungen, transparente Sicherheitsränder, Binäralpha, mindestens drei unterschiedliche Posen, nahtlose Loop-Enden und die Rückkehr einmaliger Reaktionen zur Originalpose. `qa/contact-sheet.png` ist das Arbeitsblatt der Posen. Das Runtime-Paket benötigt den Skill nicht; zum Neubau gehören die Quellen im vollständigen Branding-Paket dazu.
