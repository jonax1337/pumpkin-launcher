# Architektur

Desktop-App auf Basis von **Tauri 2**: ein Rust-Backend (`src-tauri/`) und ein React-Frontend (`src/`), verbunden über Tauri-Commands (`invoke`).

```
┌──────────────── Frontend (WebView) ────────────────┐
│ React Router → Seiten (Start, Bibliothek, Instanz,  │
│                Entdecken, Einstellungen)            │
│ TanStack Query ─► lib/api.ts ─► invoke(...)         │
│ Zustand: UI- und Launcher-Einstellungen (persist)   │
└───────────────────────┬────────────────────────────┘
                        │ Tauri IPC (JSON, camelCase)
┌───────────────────────▼──── Backend (Rust) ────────┐
│ commands.rs   dünne Tauri-Commands, Eingabeprüfung  │
│ state.rs      AppState: Stores + Fachlogik (Manager)│
│ services/     store (JSON), auth, download, launch  │
│ models.rs     Instance, ModLoader, Mod, ModSource,  │
│               ModpackOrigin, Preset, Account        │
│ error.rs      AppError (thiserror) → String an FE   │
└────────────────────────────────────────────────────┘
```

## Backend (`src-tauri/src`)

| Modul | Aufgabe |
|---|---|
| `lib.rs` | Einstieg: tracing initialisieren, Plugins registrieren (siehe „Plugins und Berechtigungen“), AppState laden, Commands registrieren |
| `error.rs` | `AppError` via `thiserror`; serialisiert als Fehlermeldung (String) ans Frontend |
| `models.rs` | Datenmodelle, `serde(rename_all = "camelCase")` – Spiegel in `src/lib/types.ts` |
| `state.rs` | `AppState` (Manager): je ein `JsonStore` für Instanzen und Presets plus storeübergreifende Logik (`resolve_preset`, `apply_preset`, `delete_preset`) |
| `commands.rs` | Dünne Commands: Eingabe prüfen, an `AppState`/Store delegieren, loggen |
| `services/store.rs` | Generischer `JsonStore<T>`: in-memory + atomares Schreiben (tmp + rename) |
| `services/mod.rs` | `Dirs`: Verzeichnislayout (geteilter Cache, Instanz-Verzeichnisse) |
| `services/auth.rs` | Microsoft-Konto per Gerätecode → Xbox Live → XSTS → Minecraft (Refresh-Token im OS-Schlüsselbund), Offline-Account (UUID nach `OfflinePlayer:<name>`, MD5/v3) |
| `services/mojang.rs` | serde-Formate von piston-meta: Version-Manifest v2, Versions-JSON, Asset-Index |
| `services/rules.rs` | Mojang-`rules` (os/arch/features), Arch-Filter für Natives-Classifier |
| `services/download.rs` | HTTP-Client, SHA-1-geprüfte Downloads mit Retry, 16 parallel (`buffer_unordered`), gestreamt auf Platte, Fortsetzen per HTTP-Range auf `.part` |
| `services/java.rs` | Mojangs Java-Runtime (`java-runtime/…/all.json`, Komponente aus `javaVersion.component`) |
| `services/install.rs` | Installation in Schritten, `InstallStep`, `InstallProgress`, Event `install-progress`; Installiert-Marker je Instanz (`mark_installed`, `is_installed`) |
| `services/fabric.rs` | Fabric-Meta (`meta.fabricmc.net/v2`): Loader-Versionen, Launcher-Profil (`inheritsFrom` Vanilla), Merge mit der Vanilla-Versions-JSON |
| `services/mods.rs` | Globaler Mod-Cache (`cache/mods/<sha1>.jar`) und Abgleich nach `mods/` der Instanz (Hardlink, Fallback Kopie; bestehende fremde Dateien werden nicht ersetzt); fehlt ein Cache-Eintrag, stellt `recache` ihn für Kopie und Export aus der abgelegten Datei wieder her |
| `services/modrinth.rs` | Modrinth-v2-Katalog, Versions-/Dependency-Auflösung und hashgeprüfte Downloads |
| `services/providers/` | Weitere Kataloge in Modrinth-Formen: `ftb.rs` (öffentliche FTB-API, installierbar, Downloads nur von festen Hosts mit Prüfsumme), `technic.rs` (Suche, Details und Installation: Pack-Zip des Autors über `net.rs` = nur HTTPS und öffentliche Adressen, Loader aus `bin/version.json`), `curseforge.rs` (CurseForge über den Cloudflare Worker in `proxy/`, der den API-Schlüssel hält: Suche, Mods mit Abhängigkeiten, Modpacks per `manifest.json`; der Launcher selbst kennt keinen Schlüssel, die Dateien kommen direkt vom CDN; nur über die Webseite erlaubte Dateien werden nicht umgangen, sondern vom Nutzer geladen und aus dem Downloads-Ordner übernommen). Pack-Zips werden von der Platte entpackt (`content::Blob::Zip`), nicht im Speicher gehalten |
| `services/mrpack.rs` | `.mrpack`-Export einer Instanz (Vorlagen und „Exportieren…“): Modrinth-Inhalte per SHA-1-Sammelabfrage als Download im Index, alles andere unter `overrides/`, dazu `pumpkin.json`; Grenzen so, dass der eigene Import das Pack wieder liest |
| `services/duplicate.rs` | Instanz duplizieren: neuer Eintrag (neue ID, „<Name> (Kopie)“, `lastPlayedAt` leer), Kopie von Spielordner, Natives und Installiert-Marker ohne `logs/`, `crash-reports/`, `.fabric/`; verwaltete Inhalte legt `mods::sync` per Hardlink ab; bei Fehler wird die halbe Kopie entfernt |
| `services/content.rs` | Sichere Modinstallation und `.mrpack`-Import in neue Instanzen; `plan_pack`/`import_plan` für Packs von Anbietern |
| `content_commands.rs` | Modrinth-IPC und korrelierte `content-progress`-Events |
| `support_commands.rs` | Fehlerberichte: Log teilen, Debug-Info |
| `services/launch.rs` | Classpath, JVM-/Game-Args mit `${…}`-Ersetzung, Prozessstart, Log-Streaming |
| `services/gamelog.rs` | log4j-XML auf stdout (Mojangs Logging-Config) → lesbare Zeilen |
| `services/logshare.rs` | Log teilen über mclo.gs (`POST https://api.mclo.gs/1/log`, JSON `{ content, source }`): liest höchstens die letzten 5 MiB, entfernt lokal Zugangstokens (`--accessToken`, `accessToken=`, JWTs), den Benutzernamen in `C:\Users\<name>\` und E-Mail-Adressen, behält die letzten 24.999 Zeilen plus Kürzungshinweis (Grenzen von mclo.gs: 10 MiB, 25.000 Zeilen) |
| `services/debuginfo.rs` | Debug-Info als englischer Klartext fürs GitHub-Issue: Launcher-Version, Windows-Version und Architektur, RAM, freier Platz im Datenordner, WebView2-Version, je Instanz (nummeriert, ohne Namen) MC-Version, Loader, aktive Mods, RAM (ohne eigene Einstellung der übergebene Standard), installiert/läuft |
| `services/system.rs` | Win32-Abfragen: Arbeitsspeicher (`GlobalMemoryStatusEx`), freier Platz (`GetDiskFreeSpaceExW`), Windows-Version (`RtlGetVersion`) |

### Plugins und Berechtigungen

| Plugin | Zweck |
|---|---|
| `single-instance` | Als **erstes** registriert: ein zweiter Start holt das vorhandene Hauptfenster nach vorn (`unminimize`, `show`, `set_focus`) und beendet sich, statt dieselben JSON-Stores zu schreiben |
| `opener`, `dialog` | Links/Dateien öffnen, Dateiauswahl |
| `updater` | Neue Version von GitHub Releases (`latest.json`), Signatur gegen `plugins.updater.pubkey` in `tauri.conf.json` geprüft; Ablauf in `docs/RELEASING.md` |
| `process` | Neustart nach dem Update (`relaunch`) |

`capabilities/default.json` gibt dem Hauptfenster nur, was das Frontend braucht: Fensterknöpfe, `opener` (Dateipfade nur unter `$APPDATA/instances/*/minecraft`), `dialog:default`, `updater:allow-check`/`allow-download`/`allow-install` (suchen, laden, installieren; ohne `download-and-install`) und `process:allow-restart` (kein `exit`).

### Persistenz

JSON-Dateien im App-Datenverzeichnis (`app.path().app_data_dir()`, unter Windows `%APPDATA%\dev.laux.launcher\`):

- `instances.json`
- `templates.json`
- `accounts.json` (nur `id`, `username`, `kind`, `clientId`; Refresh-Tokens in der Windows-Anmeldeinformationsverwaltung, Dienst `dev.laux.launcher`)

Eine defekte Datei wird beim Start nach `*.json.corrupt` verschoben (nicht überschrieben), der Store startet leer. Schlägt das Schreiben fehl, wird die In-Memory-Änderung zurückgerollt.

### Datenmodell

- **`ModLoader`**: `vanilla | fabric | quilt | forge | neoforge` – Vanilla ist ein normaler Loader-Wert.
- **`Mod`**: `id`, `name`, `version`, `fileName`, `sha1?`, `enabled`, `source`.
- **`ModSource`** (getaggt über `type`): `{type:"local"}` · `{type:"url", url}` · `{type:"modrinth", projectId, versionId}` · `{type:"curseforge", projectId, fileId}`.
- **`Instance.modpack`** (`ModpackOrigin?`): merkt sich, aus welchem Modrinth-/CurseForge-Pack (Projekt + Version/Datei) die Instanz stammt – Grundlage für Pack-Updates.
- **`LogKind`** (`log_share`): `latest` = `logs/latest.log` des letzten Starts · `crashReport` = neuester Bericht in `crash-reports/`.
- Neue Felder tragen `#[serde(default)]`, damit ältere JSON-Dateien weiter laden.

### Commands

| Command | Argumente | Rückgabe |
|---|---|---|
| `list_instances` | – | `Instance[]` |
| `get_instance` | `id` | `Instance` |
| `create_instance` | `input: NewInstance` | `Instance` |
| `update_instance` | `instance: Instance` | `Instance` |
| `delete_instance` | `id` | – |
| `list_presets` | – | `Preset[]` |
| `create_preset` | `input: NewPreset` | `Preset` |
| `update_preset` | `preset: Preset` | `Preset` |
| `delete_preset` | `id` | – |
| `apply_preset` | `instanceId`, `presetId` | `Instance` |
| `versions_list` | – | `VersionEntry[]` (`id`, `type`, `url`, `sha1`, `releaseTime`) |
| `instance_install` | `instanceId` | – (Events `install-progress`); abgebrochen → Fehler „Installation abgebrochen“ |
| `instance_install_cancel` | `instanceId` | – |
| `instance_launch` | `instanceId`, `username` (Offline), `javaPath?`, `defaultMemoryMb?`, `accountId?` (Microsoft) | PID (`number`) |
| `system_memory_mb` | – | physischer RAM in MiB (`number`) |
| `ms_login_start` | `clientId?` | `{ userCode, verificationUri, expiresIn, interval, message }` |
| `ms_login_finish` | – | `Account` (wartet auf Bestätigung im Browser) |
| `ms_login_cancel` | – | – |
| `ms_accounts` | – | `Account[]` (`kind: "microsoft"`, `active: false`) |
| `ms_account_remove` | `id` | – |
| `instance_kill` | `instanceId` | – (Event `instance-exit` folgt) |
| `instance_status` | `instanceId` | `{ installed, running }` |
| `loader_versions` | `loader: ModLoader`, `mcVersion` | `{ version, stable }[]`, neueste zuerst; `vanilla` → `[]`, Quilt/Forge/NeoForge → Fehler „nicht implementiert“ |
| `modrinth_search` | `query`, `projectType`, `minecraftVersion?`, `loader?`, `offset`, `index?` (relevance, downloads, follows, newest, updated) | Modrinth-Suchergebnis (`snake_case`) |
| `modrinth_project` | `projectId` | Modrinth-Projekt (`snake_case`) |
| `modrinth_versions` | `projectId`, `minecraftVersion?`, `loader?` | Modrinth-Versionen (`snake_case`) |
| `provider_search` / `provider_project` / `provider_versions` | `source` (`ftb`, `technic`, `curseforge`) plus die Felder der Modrinth-Gegenstücke | Gleiche Formen wie Modrinth (`snake_case`); CurseForge-IDs sind die Projektnummern |
| `provider_install_pack` | `source` (`ftb`, `technic`, `curseforge`), `projectId`, `versionId`, `name`, `operationId` | Neue `Instance` mit `modpack: { type: "provider", source, projectId, versionId }` (CurseForge: `type: "curseforge"`); bleibt bei CurseForge etwas nur über die Webseite ladbar, folgt das Event `content-blocked` |
| `provider_install_mod` | `source` (`curseforge`), `instanceId`, `projectId`, `versionId`, `operationId` | Aktualisierte `Instance`; Mods tragen `source: { type: "curseforge", projectId, fileId }` und `id: "cf-<projectId>"` |
| `curseforge_adopt_download` | `instanceId`, `projectId`, `fileId` | `Instance` oder `null`, wenn die Datei noch nicht im Downloads-Ordner liegt |
| `modrinth_install_mod` | `instanceId`, `versionId`, `operationId` | Aktualisierte `Instance` |
| `modrinth_install_pack` | `versionId`, `name`, `operationId` | Neue `Instance` |
| `modrinth_import_pack` | absoluter `path`, `name`, `operationId` | Neue `Instance` |
| `instance_duplicate` | `instanceId`, `operationId` | Neue `Instance` (Fortschritt als `content-progress`, Phase `copy`); läuft die Instanz, Fehler |
| `instance_export_entries` | `instanceId` | `string[]`: Ordner und Dateien im Spielordner (ohne Neuerzeugtes) plus Ordner aktiver Inhalte |
| `instance_export` | `instanceId`, `include` (Einträge aus `instance_export_entries`), absoluter `path` (`.mrpack`) | – |
| `pack_install_cancel` | `operationId` | – (bricht `modrinth_install_pack`/`modrinth_import_pack`/`template_create_instance` ab) |
| `log_share` | `instanceId`, `kind: LogKind` | öffentlicher mclo.gs-Link (`string`); fehlt die Datei, eine Meldung in Alltagssprache |
| `debug_info` | `defaultMemoryMb` (RAM-Standard wie bei `instance_launch`) | Klartext ohne Instanz-/Kontonamen und Pfade (`string`) |

Content-Fortschritt: `content-progress` `{ operationId, phase, done, total }` (Phasen `resolve`, `validate`, `download`, `extract`, `copy`, `complete`). Der Aufrufer vergibt die `operationId`; späte oder fremde Events dürfen keinen anderen Auftrag aktualisieren. Modpack-Import und Minecraft-Installation sind getrennte Schritte: nach dem Import installiert `instance_install` die passende Minecraft-/Fabric-Runtime.

Events: `install-progress` `{ instanceId, step, done, total }` · `instance-log` `{ instanceId, stream: "stdout"|"stderr", line }` · `instance-exit` `{ instanceId, code: number|null, crashed: boolean, crashReport: string|null, logFile: string|null }` (`crashed` = Fehlercode ohne Stopp durch den Nutzer; Pfade absolut, öffnbar per `openPath`, Scope `$APPDATA/**`) · `instances-changed` (ohne Daten; nach dem Nachtragen von Ordner-Inhalten beim Start). Installation und Start gibt es für `loader = vanilla` und `fabric`.

### Fabric

- `instance_install` lädt bei `fabric` das Profil `versions/loader/<mc>/<loader>/profile/json`. Ist `loaderVersion` leer, nimmt es den neuesten stabilen Loader und **speichert ihn in der Instanz** (die UI sollte die Instanz danach neu laden).
- Fehlende SHA-1 im Profil (Loader, Intermediary) kommen aus den `.sha1`-Dateien des Maven-Repos; das ergänzte Profil liegt unter `versions/fabric-loader-<loader>-<mc>/…json` für den Start ohne Netz.
- Merge: Fabric-Libraries vor den Vanilla-Libraries (gleiche `group:artifact[:classifier]` → Fabric gewinnt), `mainClass` = `net.fabricmc.loader.impl.launch.knot.KnotClient`, Profil-Argumente werden angehängt. ID, Client-JAR, Assets und Java bleiben die der Vanilla-Version.
- Schritte `loader` (Profil) und `mods` (Abgleich `mods/`) kommen zusätzlich als `install-progress`.
- Der Installiert-Marker enthält bei Mod-Loadern MC-Version, Loader und Loader-Version; ein Wechsel gilt als „nicht installiert“.

### Mods

`instances/<id>/minecraft/mods/` ist der Mods-Ordner (Spielverzeichnis, dort sucht Fabric). `mods::sync` legt jede aktivierte Mod mit `sha1` aus `cache/mods/<sha1>.jar` per Hardlink (Fallback Kopie) unter ihrem `fileName` ab und entfernt deaktivierte nur, wenn die Datei dort denselben SHA-1 hat; fremde Dateien bleiben liegen. Fehlt eine verwaltete Mod im Cache, schlägt der Abgleich fehl. Modrinth-Installationen laden die ausgewählte Fabric-/Minecraft-kompatible Version und erforderliche transitive Dependencies, prüfen Dateigröße, SHA-1 und SHA-512 und füllen den Cache. Automatische Updates oder stilles Ersetzen kollidierender Dateien sind nicht vorgesehen.

„Benötigt von“ (`requiredBy`): Vorlagen legen zusätzlich `pumpkin.json` (`{ requiredBy: { <fileName>: [projectId…] } }`) ins `.mrpack`, der Import wertet sie aus; bei fremden Packs wird es aus den Pflicht-Abhängigkeiten der per SHA-1 erkannten Modrinth-Versionen abgeleitet. Beim Start trägt `content::adopt_untracked` Dateien aus `mods/`, `resourcepacks/`, `shaderpacks/` nach, die nicht in der Instanz stehen (`*.disabled` → deaktiviert; ohne Netz als lokal), und sendet danach `instances-changed`.

### Verzeichnisse (App-Datenverzeichnis)

```
versions/<id>/<id>.json|.jar   libraries/…   assets/{indexes,objects,log_configs}/   runtime/<komponente>/
instances/<instanz-id>/minecraft/ (Spielverzeichnis, darin mods/)   instances/<instanz-id>/natives/   cache/mods/<sha1>.jar
```

Headless-Test ohne UI: `cargo run --example launch -- [version|1.21] [spielername] [sekunden] [vanilla|fabric[:loader]]` (in `src-tauri/`), z. B. `-- 1.21.11 Headless 60 fabric`.

### Presets

Ein Preset bündelt Mods, Spieleinstellungen (`options.txt`-Schlüssel), JVM-Args und RAM und kann über `inheritsFrom` von **einem** anderen Preset erben. `Preset::resolve` faltet die Kette von der Wurzel zum Kind:

- Mods: geerbte plus eigene; gleiche ID → das Kind gewinnt; `excludeMods` entfernt geerbte Mods.
- `gameSettings`: zusammengeführt, Kind überschreibt.
- JVM-Args und RAM: die des Kindes, sonst geerbt.
- Zyklen und fehlende Eltern sind Fehler; `create_preset`/`update_preset` prüfen das vorab, `delete_preset` verweigert das Löschen, solange ein anderes Preset davon erbt.

`apply_preset` wendet das aufgelöste Preset an: ergänzt fehlende Mods (per ID), ersetzt JVM-Args, übernimmt RAM (falls gesetzt) und merkt sich `presetId`. `gameSettings` werden erst mit der Launch-Logik in `options.txt` geschrieben.

### Installation und Mod-Cache

- Installation läuft in benannten Schritten (`InstallStep`: `java → client → libraries → natives → assets → loader → mods`; `loader` kommt als Profil-Download vor `java`). Jeder Fortschritt geht als Tauri-Event `install-progress` mit `{ instanceId, step, done, total }` ans Frontend.
- Mod-JARs liegen einmalig in einem globalen, per SHA-1 adressierten Cache (`<app_data>/cache/mods/<sha1>.jar`) und kommen für alle Loader per Hardlink (Fallback Kopie) nach `mods/` (siehe „Mods“). `-Dfabric.addMods` bleibt eine Option, falls `mods/` frei vom Launcher bleiben soll.

### Noch nicht implementiert (Stubs)

- **auth**: Der Microsoft-Flow ist fertig, braucht aber eine **eigene** Azure-App mit Minecraft-Freigabe – siehe `docs/ACCOUNT-SETUP.md`.
- **Mod-Loader und Mods**: Quilt/Forge/NeoForge und CurseForge. Modrinth unterstützt derzeit Fabric-Mods und Vanilla-/Fabric-Modpacks; andere Projekttypen sind nicht installierbar.


## Frontend (`src/`)

Oberfläche im Pixel-Design „Pixelkino“ (Spezifikation: `docs/design/PIXELKINO.md`, Referenz-Mockup: `docs/design/concepts/pixelkino.html`).

**Daten und Zustand**

- `lib/types.ts` – TS-Spiegel der Rust-Modelle
- `lib/api.ts` – `invoke`-Wrapper; außerhalb von Tauri (reiner `pnpm dev` im Browser) Fallback auf Mockdaten aus `lib/mock.ts`
- `hooks/` – TanStack Query; Mutations invalidieren die betroffenen Queries. `useInstances` (Spielen = bei Bedarf installieren, dann starten; Backend-Events), `useContent` (Modrinth-Vorgänge mit Fortschritt), `useTemplates`, `useAppUpdate` (Launcher-Update: stille Suche nach dem Start im Release-Build, Download mit Fortschritt, Installation erst nach Zustimmung und erst, wenn kein Minecraft mehr läuft), `useSupport` (Log teilen: Link kopieren, Toast mit „Öffnen“; Debug-Info kopieren)
- `store/settings.ts` – Launcher-Einstellungen, lokal persistiert: Java, RAM, Konten (Offline-Namen, aktives Konto), Pixelgröße, bewegte Szenen
- `store/game.ts` – flüchtiger Laufzeitzustand aus den Events: Installationsfortschritt, Starten, Protokoll (gepuffert, max. 2000 Zeilen je Instanz), Absturz, Startzeit
- `store/look.ts` – Szenenbild (Biom) je Instanz, lokal persistiert (das Backend hat dafür kein Feld; ohne Wahl fest aus der Instanz-ID)
- `store/tasks.ts` – Verlauf abgeschlossener Aufgaben für das Aufgaben-Menü; laufende Aufgaben kommen live aus `store/game.ts` und `useContent`
- Mods/Modpacks verwenden in Tauri den echten Modrinth-Katalog; neue Content-Installationen melden im Browser ohne Tauri keine vorgetäuschten Erfolge.
- Konten: Offline-Spielernamen lokal, Microsoft-Konten über den Gerätecode-Login des Backends.

**Oberfläche**

- `app/Layout.tsx` – rahmenloses Fenster: Fensterleiste mit Wortzeichen, Kontomenü und eigenen Fensterknöpfen, links eine Icon-Seitenleiste (Start · Bibliothek · Entdecken, unten Aufgaben-Menü und Einstellungen) (`@tauri-apps/api/window`, Ziehen per `data-tauri-drag-region`); setzt `--px`, pausiert Szenen, solange Minecraft läuft
- `pages/` – Start (Szene, Weiterspielen-Reihe, Onboarding), Bibliothek (Poster/Liste), Instanz (klebender Kopf, Inhalte, Protokoll, Einstellungen; `pages/detail/`), Entdecken (Katalog, Projektseite), Einstellungen
- `components/px.tsx` – Bausteine: Knopf, Chip, Fortschritt, Suchfeld, Auswahl, Segmente, Checkbox, Schalter, Radio, Speicher-Slider, Tooltip, Menü/Kontextmenü, Dialog, Seitenpanel, Leer- und Fehlerzustände, Toasts. Verhalten von Radix, Aussehen aus `styles/`
- `components/game.tsx` – Spielen-Knopf (feste Größe in allen Zuständen), Statuszeile, Status-Chip, Protokoll mit Filter/Suche/Mitscrollen
- `components/instance.tsx` – Instanz-Menü (Knopf und Rechtsklick): „Duplizieren“ (Fortschritt im Aufgaben-Menü), Dialoge „Exportieren…“ (Auswahl der Ordner, Speichern-Dialog, Toast mit „Im Ordner zeigen“), „Als Vorlage speichern“ und „Löschen“
- `components/support.tsx` – Rückfrage „Log öffentlich teilen?“ (einmal im Layout, `askShareLog`), Knopf „Debug-Info kopieren“, Einstellungen › Support (GitHub-Issues und -Diskussionen). „Log teilen“ steht in der Protokoll-Leiste und als Symbol in der Absturz-Statuszeile; nach einem Absturz mit Bericht wird der Bericht geteilt, sonst `latest.log`
- `components/ContentBrowser.tsx`, `NewInstanceDialog.tsx`, `PlayerNames.tsx`, `Onboarding.tsx` – Katalog und Seitenpanel, Neue Instanz, Konten und Microsoft-Anmeldung, erster Start
- `components/AppUpdate.tsx` – Zeile „Updates“ in *Einstellungen › Über*: Version suchen, Versionshinweise, „Installieren und neu starten“, nach dem Warten auf Spiel und Downloads „Jetzt neu starten“
- `pixel/` – `unit.ts` (Pixeleinheit auf ganze Gerätepixel), `scene.ts` (Szenen-Engine: 7 Biome, 12 fps, Pausenregeln, Cache), `PixelScene.tsx`, `icons.tsx` (Pixel-Icons, Mod-Glyphen, Wortzeichen, Spielerkopf)
- `styles/pixelkino.css` (aus dem Mockup übernommen), `styles/states.css` (Auswahlliste, Hover/Druck/Fokus, Ein- und Ausblenden) plus kleine Ergänzungen je Bereich; beide in der Tailwind-Schicht `components`, deren Reihenfolge `index.html` vor allen Stylesheets festlegt

## Herkunft der Ideen und Lizenz

Architektur und Datenmodell orientieren sich an der Recherche zu NoRiskClient (`docs/research-noriskclient.md`). NoRiskClient steht unter **GPLv3**: übernommen werden nur Ideen und Konzepte, **kein Code**. Protokolle und Formate (Microsoft/Xbox-Auth, piston-meta, Fabric-/Quilt-Meta, Forge-`install_profile.json`, Modrinth, `.mrpack`, CurseForge) werden nach der jeweiligen Primärdokumentation implementiert.

Crates kommen erst mit dem Feature, das sie braucht (z. B. `reqwest`/`tokio` mit dem Downloader, `keyring` mit dem Login) – Kandidaten siehe Recherche, Abschnitt 7.
