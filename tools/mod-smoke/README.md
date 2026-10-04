# Mod-Smoke: die Einspeisung im echten Spiel prüfen

Startet eine Zelle (Minecraft, Loader, eingespeiste Mod) über den Startweg des Launchers, ohne
Tauri-Fenster, und prüft, dass die Mod im Spiel ankommt. Das Verfahren, die Ergebnisse und die
Beweise stehen in `docs/friends/INGAME-SMOKE.md`; dieser Ordner ist nur der Aufruf.

## Voraussetzungen

- `gradlew modIndex` in `mod/` hat `mod/build/mod-index/` geschrieben (Index und Jars), oder
  `PUMPKIN_SMOKE_DIST` zeigt auf einen solchen Ordner.
- Der Datenordner (`PUMPKIN_SMOKE_DATA`) liegt nicht im Repo und nicht auf einem vollen Laufwerk:
  Versionen, Libraries, Assets, Runtimes und Instanzen werden dort installiert. Ein warmer Ordner
  macht spätere Läufe schnell.
- `CARGO_TARGET_DIR` zeigt auf ein eigenes Zielverzeichnis (der Test kompiliert den Launcher).
- Der Test öffnet kurz ein Spielfenster auf dem Desktop; er beendet nur den Prozess, den er selbst
  gestartet hat.

## Aufruf

```sh
# Linux/macOS (aus dem Repo-Stamm)
PUMPKIN_SMOKE_DATA=/path/to/data tools/mod-smoke/run.sh 26.3-fabric [Szenario]

# Windows PowerShell
.\tools\mod-smoke\run.ps1 -Cell 26.3-fabric -Data D:\pumpkin-build\smoke\data
```

## Umgebungsvariablen

| Variable | Bedeutung | Standard |
|---|---|---|
| `PUMPKIN_SMOKE_CELL` | die Zelle (Knoten-Id aus `mod/nodes.txt`), z. B. `26.3-fabric` | keine: der Test überspringt sich |
| `PUMPKIN_SMOKE_DATA` | Datenordner des Launchers (Instanzen, Runtimes, Berichte) | `run.sh`: `$TMPDIR/pumpkin-smoke`; `run.ps1`: Temp |
| `PUMPKIN_SMOKE_DIST` | Ordner mit `mod-index.json` und Jars | `mod/build/mod-index` |
| `PUMPKIN_SMOKE_OUT` | Ordner für Bericht, Spiel-Log und Launcher-Log | `<Data>/smoke-reports` |
| `PUMPKIN_SMOKE_SCENARIO` | Szenario, siehe unten | `hold` |
| `PUMPKIN_SMOKE_TIMEOUT_SECS` | hartes Zeitlimit des Spielstarts | `240` |
| `PUMPKIN_SMOKE_LOADER_VERSION` | feste Loader-Version statt der neuesten stabilen | neueste stabil |

## Szenarien

| Name | Wirkung | Zweck |
|---|---|---|
| `hold` (Standard) | die Haltevorrichtung des Jars (`FILE_SHARE_READ`) bleibt bis zum Ende offen | strengste Form; beantwortet Anhang B, Punkt 6 |
| `release` | die Haltevorrichtung fällt nach dem Start des Spiels, wie im Launcher | Normalfall eines echten Starts |
| `wrong-jar:<Knoten>` | die Zelle liefert das Jar eines anderen Knotens aus | echter Fehlstart für Breaker-Fixtures |
| `spawn-java:<Pfad>` | das Tor sieht das Java der Zelle, das Spiel startet mit diesem | echter Fehlstart durch falsches Java |
| `duplicate-id` | eine Kopie des Zellen-Jars liegt im Mods-Ordner der Instanz | das Tor muss die Einspeisung verweigern (Anhang B, Punkt 2) |

Bestanden ist der Normalfall mit einem Beweis (Brücke oder Tracerzeile), ein Fehlstart-Szenario
damit, dass die Wache des Breakers den Fehler im Log erkennt.

## Ergebnis

Pro Lauf entstehen in `PUMPKIN_SMOKE_OUT`: `<Zelle>__<Szenario>.json` (Urteil, Strategie, Beweis,
einspeisierte Argumente, Dauer), `<Zelle>__<Szenario>.game.log` (vollständiges Spiel-Log) und
`<Zelle>__<Szenario>.launcher.log` (Tracing-Ausgabe des Launchers, darunter die Zeilen der Brücke).

Bestandene Zellen tragen ihren Eintrag in `mod/verified.json` nach (INGAME A17); ein Knoten ohne
Eintrag bleibt aus.
