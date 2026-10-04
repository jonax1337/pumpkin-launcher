# In-Game-Mod: der Rauchtest (Paket S2)

Stand 2026-10-04, Windows 11 des Owners, Branch `ingame/S2`. Dieser Text ist die Anleitung und der
Beweisbericht des Rauchtests von `INGAME.md` (Abschnitte 3.5, 10 Schicht 4, Anhänge A und B). Er
setzt die Zellen, die Einspeisungsflags und die Wortlaute der Loader-Meldungen nicht mehr als
Vermutungen, sondern als gelaufene Läufe.

## 1. Was der Rauchtest treibt

Der Test `src-tauri/tests/smoke` (Cargo-Feature `smoke`, nie Standard, nie im Release-Workflow)
startet eine Zelle durch den Startweg des Launchers selbst, ohne Tauri-Fenster:

1. Minecraft-Version und Loader über die Dienste des Befehls `instance_install` installieren
   (`services::loader::plan_install`, `services::install::mark_installed`).
2. Java über `services::java::resolve` wählen (Mojang-Runtime, `java_component` der Version).
3. Die Einspeisung durch die echte Funktion `ingame::inject` entscheiden und vorbereiten lassen:
   Tor (`gate::decide`), JAR bereitlegen (`materialise`, unter Windows mit `FILE_SHARE_READ`
   gehaltenem Handle), Startoptionen bauen (`args::build`), Start bei der Brücke anmelden
   (`ModBridge::register_launch`). Die Tatsachen des Tors baut der Test so, wie sie
   `ingame_launch::inject_into_launch` aus dem Zustand der App baut; ein `AppState` wird nicht
   gebraucht, weil der Test dieselben Bausteine direkt zusammensetzt.
4. Die Argumente durch `launch::build_args` bauen und den Prozess durch `launch::spawn` starten;
   das Spiel meldet seine PID an die Brücke (`Injection::bind_pid`).
5. Auf den Beweis warten, dann nur den gestarteten Prozess beenden.

Konto: ein Offline-Konto; das Feature `smoke` überstimmt ausschließlich das Tor
„Microsoft-Konto“ (`LaunchFacts::with_online_account_forced`, INGAME A18). Hartes Zeitlimit je
Zelle: 240 s. Ein Spielfenster öffnet sich kurz auf dem Desktop.

**Beweis des Ankommens:** bei der Zelle mit der echten Mod (`26.3-fabric`) der Zustand der Brücke
— die Verbindung besteht erst, nachdem `hello` angenommen, der Besitzer geprüft und `welcome`
gesendet wurde (`admit` in `modbridge/state.rs`), und `ready` meldet die Bildschirme; der Test
schreibt jede dieser Stufen in seinen Laufbericht. Bei den Tracerknoten die Logzeile
`pumpkin_friends tracer <Minecraft> <Loader>` (beim Fabric-Tracer zusätzlich die Zeile seines
Mixin, weil erst sie beweist, dass das remappte JAR arbeitet).

**JARs:** der Test liest Index und Jars aus `mod/build/mod-index/` (`gradlew modIndex`) statt aus
dem eingebetteten Bestand und markiert jeden Knoten darin als geprüft — der Rauchtest ist es, der
die Prüfung liefert.

## 2. Ergebnisse (Anhang B von INGAME.md, Punkte 1 bis 6)

| Anhang B | Zelle / Lauf | Strategie | Ergebnis | Beweis (Auszug) |
|---|---|---|---|---|
| 1. `-Dfabric.addMods` auf 26.3 | `26.3-fabric`, Szenario `hold` | `fabricAddMods` | **bestanden** (14,4 s) | Spiel-Log: `- pumpkin_friends 2.1.0+26.3-fabric`, `[Pumpkin Friends bridge/INFO] Pumpkin Friends: connected to the Pumpkin Launcher 2.0.1`; Launcher-Log: `Mod ist bereit instance=smoke-26.3-fabric screens=["hub"]`; Bericht: `proof: bridge-ready ["hub"]`. Eingepflanzt: `-Dfabric.addMods=D:\...\runtime\friends-mod\2.1.0\pumpkin_friends-2.1.0+26.3-fabric.jar` |
| 1. `-Dfabric.addMods` auf einer obfuszierten Version | `1.21.1-fabric` (der obfuscate Knoten; Anhang B nennt 1.20.1, ein 1.20.1-Fabric-Knoten existiert noch nicht), `hold` | `fabricAddMods` (Loom-remapptes JAR) | **bestanden** (20,4 s) | `Loading Minecraft 1.21.1 with Fabric Loader 0.19.5`, `pumpkin_friends tracer 1.21.1 fabric` und `… fabric mixin`; Bericht: `proof: tracer-log+mixin` |
| 2. doppelte Fabric-Mod-Id | `26.3-fabric`, Szenario `duplicate-id` (Kopie des Jars im Mods-Ordner der Instanz) | — (Tor verweigert) | **bestanden** | Bericht: `the gate refused to inject beside the copy in mods` — das Tor überspringt mit `idCollision` (INGAME 3.3 Regel 6), das Spiel bliebe unberührt |
| 3. NeoForge 21.1.x über `--fml.mavenRoots` | `1.21.1-neoforge`, `hold` | `fmlMavenRoot` | **bestanden** (12,4 s, NeoForge 21.1.253) | Spiel-Log (ModLauncher-Argumente): `--fml.mavenRoots D:\...\maven-1.21.1-neoforge --fml.mods dev.laux.pumpkin:pumpkin_friends:2.1.0`; `pumpkin_friends tracer 1.21.1 neoforge` |
| 4. NeoForge 26.2.0.88 über `-Dfml.modFolders` | `26.2-neoforge`, `hold` | `fmlModFolders` | **bestanden** (9,8 s) | Eingepflanzt: `-Dfml.modFolders=pumpkin%%D:\...\pumpkin_friends-2.1.0+26.2-neoforge.jar`; Spiel-Log: `pumpkin_friends tracer 26.2 neoforge` |
| 5. Forge 1.20.1 (47.4.x) über `--fml.mavenRoots` | `1.20.1-forge`, `hold` | `fmlMavenRoot` | **bestanden** (11,1 s, Forge 47.4.26) | Spiel-Log (ModLauncher-Argumente): `--fml.mavenRoots D:\...\maven-1.20.1-forge --fml.mods dev.laux.pumpkin:pumpkin_friends:2.1.0`; `pumpkin_friends tracer 1.20.1 forge` |
| 6a. Nicht-ASCII-Datenpfad (Windows) | alle fünf Zellen, `hold`, Datenordner `D:\pumpkin-build\smoke\Jürgen Müller\` (ü und Leerzeichen) | alle | **bestanden** (alle fünf) | je Zelle derselbe Beweis wie oben (Brücke bzw. Tracerzeile); kein List-File nötig, die JVM nimmt den Pfad unverändert |
| 6b. `FILE_SHARE_READ`-Handle | alle fünf Zellen, einmal `hold` (Handle bis zum Ende offen — strenger als der Launcher) und einmal `release` (Handle fällt nach dem Start, wie im Launcher) | alle | **bestanden**: jeder Loader liest das JAR in beiden Szenarien | je Zelle `passed` in `hold` und `release` (26.3-fabric `release`: 29,8 s, Laufbericht: `[smoke] link up for smoke-26.3-fabric: hello accepted, owner check passed, welcome sent` und `[smoke] mod ready for smoke-26.3-fabric: screens ["hub"]`; 1.21.1-fabric: 84,2 s, Tracer+Mixin; 1.21.1-neoforge: 13,7 s; 26.2-neoforge: 13,1 s; 1.20.1-forge: 15,0 s); die Tracerzeile bzw. `bridge-ready` steht im Log, während das Launcher-Handle offen blieb |

## 3. Was die Fehlstart-Läufe lehrten (Breaker, INGAME 3.8)

Der Rauchtest erzeugt absichtliche Fehlstarts (Szenarien `wrong-jar:<Knoten>` und
`spawn-java:<Pfad>`) und ersetzt damit die nachgebauten Fixture-Logs durch echte Mitschnitte
(`src-tauri/src/services/friends/ingame/fixtures/`).

| Lauf | Ergebnis | Folge |
|---|---|---|
| `1.21.1-fabric` + JAR von `26.3-fabric` | erster Lauf **durchgefallen**: die Wache erkannte den Fehler nicht; der echte Fabric-Loader 0.19.5 schreibt `Incompatible mods found!`, nicht das angenommene `Incompatible mod set` | Muster ergänzt (`startup_failure.rs`); zweiter Lauf bestanden nach 2,1 s: `the startup watch recognised the failure: FabricIncompatibleModSet`. Echt-Mitschnitt `fabric_incompatible_mod_set.txt` |
| `1.21.1-neoforge` + JAR von `26.2-neoforge` | erster Lauf **timed out**: FML 4 schreibt `Missing or unsupported mandatory dependencies:` und `Error during pre-loading phase: Mod pumpkin_friends requires …`, kein Treffer der alten Muster | Muster ergänzt; zweiter Lauf bestanden nach 5,0 s: `the startup watch recognised the failure: ModLoadingError`. Echt-Mitschnitt `neoforge_mod_loading_error.txt` |
| `1.20.1-forge` + JAR von `1.21.1-neoforge` | **timed out** — und das ist die echte Antwort: Forge 47 übergeht das JAR mit fremdem Deskriptor (`neoforge.mods.toml` statt `mods.toml`) stumm (`No dependencies to load found. Skipping!`), das Spiel startet ohne Mod, ohne Fehler | kein Breaker-Fund möglich; für Forge bleibt der Fixture nachgebaut. Ein falsches JAR ist auf Forge inert, kein Startfehler |

Fixtures nach diesen Läufen: `fabric_incompatible_mod_set.txt` und `neoforge_mod_loading_error.txt`
sind echte Mitschnitte; `mixin_apply_failed.txt`, `unsupported_class_version.txt` und
`unrelated_crash.txt` bleiben nachgebaut — ein echter Mixin-Fehlschlag ließ sich mit den fünf
gelieferten Jars nicht erzeugen (die Abhängigkeitsprüfung des Loaders greift vorher), und ein zu
altes Java trifft zuerst die Klassen des Spiels, nicht die der Mod, weil jeder Knoten dasselbe
Java braucht wie sein Minecraft. Die Breaker-Tests bestehen mit den echten Mitschnitten, und der
unverwandte Absturz löst sie weiter nicht aus.

## 4. So wird der Rauchtest wiederholt

```sh
# einmalig: Index und Jars bauen (mod/)
cd mod && ./gradlew modIndex

# eine Zelle (Linux/macOS; Windows: tools/mod-smoke/run.ps1)
CARGO_TARGET_DIR=<eigenes Zielverzeichnis> PUMPKIN_SMOKE_DATA=<Datenordner> \
  tools/mod-smoke/run.sh 26.3-fabric [hold|release|wrong-jar:<Knoten>|spawn-java:<Pfad>|duplicate-id]
```

Bericht, Spiel-Log und Launcher-Log je Lauf: `<PUMPKIN_SMOKE_DATA>/smoke-reports/`. Alle
Variablen: `tools/mod-smoke/README.md`. In CI: `.github/workflows/mod-smoke.yml` (Linux, Xvfb,
Software-GL, nächtlich und bei Änderungen unter `mod/**` und den Einspeisungsquellen).

## 5. Offen und unbewiesen

- **Der CI-Workflow wurde nie ausgeführt** (Paket S2 kann ihn hier nicht laufen lassen). Ob
  Minecraft 26.x headless unter Software-Rendering startet (INGAME 12, Risiko 2), bleibt offen;
  der Workflow sagt das in seinem Kopfkommentar.
- **Datenpfad mit CJK-Zeichen** (`D:\pumpkin-build\smoke\日本語 データ\`, über die Anforderung von
  INGAME 12 Risiko 3 hinaus): `26.3-fabric` mit Einspeisung blieb 240 s ohne eine einzige
  Ausgabezeile stumm und wurde abgebrochen; das Spielverzeichnis enthält nur `mods`, das Spiel
  kam nicht bis zur Protokollierung. Ursache nicht untersucht (kein Bestandteil dieses Pakets);
  der geforderte Fall „ü und Leerzeichen“ ist bestanden.
- **`loaderMin`-Böden**: geraucht wurde mit dem jeweils neuesten stabilen Loader (Fabric 0.19.5,
  NeoForge 21.1.255/26.2.0.88, Forge 47.4.26), nicht mit den Böden der Knoten
  (`loaderMin`-Spalte von `mod/nodes.txt`).
- **Begleiter Fabric API**: die Mod erklärt `fabric-api` als Abhängigkeit
  (`mod/descriptors/fabric/fabric.mod.json`); der Rauchtest legt sie in den Mods-Ordner der
  Rauchinstanz. Bis ein Paket die Abhängigkeit entfernt, beweist der Lauf die Einspeisung
  einschließlich dieses Begleiters.
- **Mod-Workflow-Kommentar**: `.github/workflows/mod.yml` sagt noch „Noch kein Rauchtest (Paket
  S2)“; die Zeile ist veraltet, aber die Datei gehört diesem Paket nicht.
