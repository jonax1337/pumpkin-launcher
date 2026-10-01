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
| `lib.rs` | Einstieg: tracing initialisieren, Plugins registrieren (siehe „Plugins und Berechtigungen“), AppState laden, Commands registrieren; im Hintergrund dann `worlds::remove_leftovers` und `content::adopt_untracked` |
| `error.rs` | `AppError` via `thiserror`; serialisiert als Fehlermeldung (String) ans Frontend. `is_retryable`: Ablehnungen des Servers (4xx außer 408 und 429, dazu `Refused` mit eigener Meldung) versucht kein Download erneut |
| `models.rs` | Datenmodelle, `serde(rename_all = "camelCase")` – Spiegel in `src/lib/types.ts` |
| `state.rs` | `AppState` (Manager): je ein `JsonStore` für Instanzen und Presets plus storeübergreifende Logik (`resolve_preset`, `apply_preset`, `delete_preset`) |
| `commands.rs` | Dünne Commands: Eingabe prüfen, an `AppState`/Store delegieren, loggen |
| `services/store.rs` | Generischer `JsonStore<T>`: in-memory + atomares Schreiben (tmp + rename); `modify(id, …)` ändert einen Eintrag unter dem Store-Lock, so geht keine gleichzeitige Änderung verloren |
| `services/mod.rs` | `Dirs`: Verzeichnislayout (geteilter Cache, Instanz-Verzeichnisse); `blocking`: Dateiarbeit im Thread-Pool, die beim Abbruch zwischen zwei Dateien aufhört |
| `services/auth.rs` | Microsoft-Konto per Gerätecode → Xbox Live → XSTS → Minecraft (Refresh-Token im OS-Schlüsselbund), Offline-Account (UUID nach `OfflinePlayer:<name>`, MD5/v3) |
| `services/mojang.rs` | serde-Formate von piston-meta: Version-Manifest v2, Versions-JSON, Asset-Index |
| `services/rules.rs` | Mojang-`rules` (os/arch/features), Arch-Filter für Natives-Classifier (`natives-macos-arm64`, `natives-windows-x86` …), Classpath-Trenner je OS (`;` unter Windows, sonst `:`) |
| `services/download.rs` | HTTP-Client, SHA-1-geprüfte Downloads mit Retry (nicht bei `AppError::is_retryable` = false), 16 parallel (`buffer_unordered`), gestreamt auf Platte, Fortsetzen per HTTP-Range auf `.part` |
| `services/java.rs` | Mojangs Java-Runtime (`java-runtime/…/all.json`, Komponente aus `javaVersion.component`; Plattform-Schlüssel `windows-x64`, `windows-arm64`, `linux`, `linux-i386`, `mac-os`, `mac-os-arm64`, auf ARM ohne passende Runtime die x64-Runtime in der Emulation; unter Unix Exec-Bit und Symlinks aus dem Manifest); Wahl beim Start: eigener Pfad der Instanz → Einstellung des Launchers → mitgelieferte Runtime, eigene Pfade müssen auf eine vorhandene `javaw.exe`/`java.exe` (Linux/macOS: `java`) zeigen |
| `services/install.rs` | Installation in Schritten, `InstallStep`, `InstallProgress`, Event `install-progress`; Installiert-Marker je Instanz (`mark_installed`, `is_installed`) |
| `services/fabric.rs` | Fabric-Meta (`meta.fabricmc.net/v2`): Loader-Versionen, Launcher-Profil (`inheritsFrom` Vanilla), Merge mit der Vanilla-Versions-JSON |
| `services/mods.rs` | Globaler Mod-Cache (`cache/mods/<sha1>.jar`) und Abgleich nach `mods/` der Instanz (Hardlink, Fallback Kopie; bestehende fremde Dateien werden nicht ersetzt); fehlt ein Cache-Eintrag, stellt `recache` ihn für Kopie und Export aus der abgelegten Datei wieder her |
| `services/modrinth.rs` | Modrinth-v2-Katalog, Versions-/Dependency-Auflösung und hashgeprüfte Downloads |
| `services/providers/` | Weitere Kataloge in Modrinth-Formen: `ftb.rs` (öffentliche FTB-API, installierbar, Downloads nur von festen Hosts mit Prüfsumme), `technic.rs` (Suche, Details und Installation: Pack-Zip des Autors über `net.rs` = nur HTTPS und öffentliche Adressen, Loader aus `bin/version.json`), `curseforge.rs` (CurseForge über den Cloudflare Worker in `proxy/`, der den API-Schlüssel hält: Suche, Mods mit Abhängigkeiten, Modpacks per `manifest.json`; der Launcher selbst kennt keinen Schlüssel, die Dateien kommen direkt vom CDN; nur über die Webseite erlaubte Dateien werden nicht umgangen, sondern vom Nutzer geladen und aus dem Downloads-Ordner übernommen. Nach den API-Bedingungen wird nichts zwischengespeichert, weder im Worker noch im Launcher. Abhängigkeiten werden Ebene für Ebene mit Sammelabfragen (`POST /v1/mods`, `/v1/mods/files`) und der Datei-Wahl aus `latestFilesIndexes` aufgelöst, damit große Bäume unter dem Limit des Workers von 60 Anfragen pro Minute bleiben; auf 429 wartet der Launcher (`Retry-After`, das der Worker mitschickt, höchstens 30 s, sonst 5/10/20 s) und versucht es bis zu dreimal. Lehnt das CDN einen Download mit 401 ab, weil CurseForge dafür einen Schlüssel verlangt, nennt die Meldung (`AppError::Refused`) die Datei und den Ausweg (Launcher aktualisieren oder Datei von Hand laden), ohne dieselbe Adresse noch zweimal zu versuchen; 403 bedeutet beim CDN schon heute „Datei fehlt“ und bleibt beim allgemeinen Text. Der Dialog „Von Hand laden“ fragt CurseForge erst, wenn im Downloads-Ordner eine passend benannte Datei liegt. Forks nutzen den Worker dieses Projekts nicht, sondern einen eigenen mit eigenem Schlüssel über `PUMPKIN_CF_PROXY`). Pack-Zips werden von der Platte entpackt (`content::Blob::Zip`), nicht im Speicher gehalten |
| `services/mrpack.rs` | `.mrpack`-Export einer Instanz (Vorlagen und „Exportieren…“): Modrinth-Inhalte per SHA-1-Sammelabfrage als Download im Index, alles andere unter `overrides/`, dazu `pumpkin.json`; Vorlagen bleiben unter den Grenzen des eigenen Imports (4000 Dateien, 256 MiB), ein Export hat keine (ZIP64 für große Dateien); abbrechbar, die `.part`-Datei wird entfernt |
| `services/duplicate.rs` | Instanz duplizieren: neuer Eintrag (neue ID, „<Name> (Kopie)“, `lastPlayedAt` leer, Spielzeit 0), Kopie von Spielordner, Natives und Installiert-Marker ohne `logs/`, `crash-reports/`, `.fabric/`; verwaltete Inhalte legt `mods::sync` einzeln per Hardlink ab (als Fortschritt sichtbar, der Abgleich prüft jede JAR); bei Fehler oder Abbruch wird die halbe Kopie entfernt |
| `services/imports/` | Instanzen anderer Launcher übernehmen (nur lesend): `prism.rs` (Prism Launcher/MultiMC: `instance.cfg` mit `name`, `MaxMemAlloc`/`JvmArgs` nur bei `OverrideMemory`/`OverrideJavaArgs`, `mmc-pack.json`-Komponenten; Spielordner `minecraft`, sonst `.minecraft`), `modrinth_app.rs` (Modrinth App: SQLite `app.db` per `rusqlite`, schreibgeschützt geöffnet, Tabellen `instances`, `instance_content_sets`, `instance_launch_overrides`, in seit Mitte 2026 nicht mehr geöffneten Datenbanken noch `profiles`; eine unlesbare Zeile verbirgt nur sich selbst; Spielordner `profiles/<path>` unter `settings.custom_dir` oder dem Datenordner), `curseforge.rs` (CurseForge App: `minecraftinstance.json`, Loader aus `baseModLoader.name`, Herkunft der Mods aus `installedAddons[].addonID`/`installedFile.{id,fileName}`), `atlauncher.rs` (`instance.json`: `id` = Minecraft-Version, `launcher.loaderVersion`, `maximumMemory`, `javaArguments`; deaktivierte Mods liegen in `disabledmods/`). Gesucht wird unter `PrismLauncher`, `ModrinthApp` und `ATLauncher` im Datenordner des Systems (`dirs::data_dir`, unter Windows `%APPDATA%`) und unter `curseforge/minecraft` im Benutzerordner (außer unter Windows im Ordner „Dokumente“, Standard der CurseForge App laut ihrer Hilfe) oder im gewählten Ordner; unlesbare Instanzen werden protokolliert und übersprungen, nicht startbare (Forge/NeoForge zu alt) mit Grund in `unsupported` gemeldet. Der Import legt die Instanz an (Name, Version, Loader, RAM und JVM-Args, `importedFrom`), kopiert den Spielordner ohne `logs/`, `crash-reports/`, `.fabric/`, `.cache/` und die Dateien des Launchers (`disabledmods/<name>` als `mods/<name>.disabled`), legt die Inhalte in den Mod-Cache (Phasen `copy` und `hash` im Hintergrund-Thread, abbrechbar) und erfasst sie wie `adopt_untracked` (Modrinth-SHA-1-Abfrage, ohne Netz lokal; was die CurseForge App von CurseForge hat, als CurseForge-Inhalt); bei Fehler oder Abbruch verschwindet der halbe Ordner, auch wenn der Hintergrund-Thread erst danach endet |
| `services/content.rs` | Sichere Modinstallation und `.mrpack`-Import in neue Instanzen (Ziele exklusiv neu angelegt, kein Symlink unterhalb des Datenordners; darüber, etwa `/var` unter macOS, zählt keiner); `plan_pack`/`import_plan` für Packs von Anbietern |
| `services/local_files.rs` | Eigene Dateien in eine Instanz: Pfade prüfen (absolut, normale Datei, `.jar`/`.zip`, 1 B bis 256 MiB), Art erkennen (`.jar` = Mod; Zip mit `pack.mcmeta` im Wurzelverzeichnis = Ressourcenpaket, mit Ordner `shaders/` = Shader, sonst fragt die Oberfläche), freie Dateinamen (`name (2).jar`; dieselbe, nur nicht erfasste Datei im Ordner wird übernommen), ein Modrinth-Projekt nur einmal pro Instanz, Cache, Erkennung über `content::identify` (dieselbe SHA-1-Sammelabfrage wie Pack-Import und Nachtragen) |
| `content_commands.rs` | Modrinth-IPC und korrelierte `content-progress`-Events |
| `support_commands.rs` | Fehlerberichte: Log teilen, Debug-Info |
| `services/worlds.rs` | Welten unter `saves/<Ordner>` (Ordnername = ID): Name, zuletzt gespielt, Spielmodus, Hardcore und Version aus `level.dat` (gzip-NBT über `fastnbt` + `flate2`; unlesbar → Ordnername), Größe, `icon.png` als `data:`-URL (bis 256 KiB). Sicherung als ZIP `instances/<id>/backups/<Welt>-<Unix-ms>.zip` (Ordner als oberster Eintrag, ohne `session.lock`, über `.part`); Wiederherstellen immer in einen freien Ordner („<Welt> (2)“ …), entpackt mit den Pfadprüfungen von `providers::zip_paths` (ohne die Größengrenzen der Pack-Importe, damit große Welten zurückkommen); Löschen sichert vorher und verschiebt den Ordner erst aus `saves/` (als `backups/<Welt>-<Unix-ms>.deleting`), bevor er entfernt wird. Beim Start entfernt `remove_leftovers` unter `backups/` nur, was ein unterbrochener Vorgang unter genau diesen Namen liegen ließ (`.zip.part`, `.deleting`). Die Sicherungen gehören zur Instanz und werden mit ihr gelöscht |
| `services/servers.rs` | Serverliste `servers.dat` (NBT ohne Kompression): Name, Adresse, Icon, `acceptTextures`; ändert nur diese Felder, unbekannte Tags und versteckte Einträge (`hidden`, legt das Spiel für Quick Play an) bleiben; Schreiben über `.tmp` + Umbenennen. Einträge werden über ihre Stelle in der sichtbaren Liste angesprochen |
| `services/datapacks.rs` | Datenpakete einer Welt unter `saves/<Welt>/datapacks/` (`.zip` oder Ordner): Name, Beschreibung aus `pack.mcmeta` (Text-Komponente als schlichter Text ohne `§`-Codes, höchstens 64 KiB gelesen), Zustand nur lesend aus `level.dat` (`Data.DataPacks.Enabled`/`Disabled`, Einträge `file/<Name>`; `level.dat` schreibt allein das Spiel). Hinzufügen eigener Zips (Pfadregeln wie `local_files`, nur `.zip`) und von Modrinth (Version mit Loader `datapack` für die Minecraft-Version der Instanz, Download mit Größe, SHA-1 und SHA-512 geprüft): jedes Zip wird mit `providers::zip_files` geprüft und braucht ganz oben `pack.mcmeta` und `data/`; erst alle prüfen, dann exklusiv neu anlegen (`content::write_new`, vorhandene Namen sind ein Fehler), bei Fehler zurückrollen. Entfernen nur für Namen aus der Liste, über `trash` in den Papierkorb |
| `world_commands.rs` | Dünne Commands für Welten, Sicherungen, Datenpakete und Serverliste; Dateiarbeit über `services::blocking` |
| `services/launch.rs` | Classpath, JVM-/Game-Args mit `${…}`-Ersetzung (danach Fenster `--width/--height` bzw. `--fullscreen` und eigene Spielargumente), Prozessstart, Log-Streaming, Sitzungsdauer für die Spielzeit. Quick Play schaltet das Feature der Versions-JSON ein (ab 1.20: `is_quick_play_singleplayer` → `--quickPlaySingleplayer <Ordner>`, `is_quick_play_multiplayer` → `--quickPlayMultiplayer <host:port>`); ältere Versionen bekommen für Server `--server`/`--port`, in Welten starten sie nicht |
| `services/gamelog.rs` | log4j-XML auf stdout (Mojangs Logging-Config) → lesbare Zeilen |
| `services/logshare.rs` | Log teilen über mclo.gs (`POST https://api.mclo.gs/1/log`, JSON `{ content, source }`): liest höchstens die letzten 5 MiB, entfernt lokal Zugangstokens (`--accessToken`, `accessToken=`, JWTs), den Benutzernamen in `C:\Users\<name>\`, `/home/<name>/` und `/Users/<name>/` sowie E-Mail-Adressen, behält die letzten 24.999 Zeilen plus Kürzungshinweis (Grenzen von mclo.gs: 10 MiB, 25.000 Zeilen) |
| `services/debuginfo.rs` | Debug-Info als englischer Klartext fürs GitHub-Issue: Launcher-Version, Betriebssystem mit Version (Windows-Build, Linux-Distribution, macOS-Version) und Architektur, RAM, freier Platz im Datenordner, WebView-Version (WebView2, WebKitGTK bzw. WKWebView), je Instanz (nummeriert, ohne Namen) MC-Version, Loader, aktive Mods, RAM (ohne eigene Einstellung der übergebene Standard), installiert/läuft |
| `services/system.rs` | Arbeitsspeicher, freier Platz und OS-Version, je System ein Untermodul: Windows über Win32 (`GlobalMemoryStatusEx`, `GetDiskFreeSpaceExW`, `RtlGetVersion`), Linux über `/proc/meminfo` und `/etc/os-release`, macOS über `sysctl` (`hw.memsize`, `kern.osproductversion`); freier Platz unter Unix per `statvfs` |
| `services/skins.rs` | Skins und Umhänge über die offizielle Minecraft-Services-API (`/minecraft/profile`, nur Microsoft-Konten, Token aus `auth::session`): Profil lesen, Skin hochladen (multipart, `variant` + PNG), zurücksetzen, Umhang zeigen/ausblenden; Fehlerstatus (401, 429, 4xx, 5xx) in Alltagssprache. Lokale Bibliothek `skins/<sha1>.png` + `skins.json`; PNG-Prüfung über den IHDR-Kopf (64×64 oder 64×32). Texturen nur von `textures.minecraft.net`, per HTTPS |
| `skin_commands.rs` | Dünne Skin-Commands |
| `services/screenshots.rs` | Screenshots einer Instanz: PNGs in `screenshots/` mit Name, Aufnahmezeit (Änderungszeit) und Größe, neueste zuerst; Löschen nur für Namen aus dieser Liste und über die Crate `trash` in den Papierkorb (umkehrbar, daher ohne Rückfrage in der UI). `trash` braucht COM im STA-Modus, deshalb ist `screenshot_delete` synchron und läuft auf dem Hauptthread, den das Fenster schon so eingerichtet hat |
| `screenshot_commands.rs` | Dünne Screenshot-Commands |

### Plugins und Berechtigungen

| Plugin | Zweck |
|---|---|
| `single-instance` | Als **erstes** registriert: ein zweiter Start holt das vorhandene Hauptfenster nach vorn (`unminimize`, `show`, `set_focus`) und beendet sich, statt dieselben JSON-Stores zu schreiben |
| `opener`, `dialog` | Links/Dateien öffnen, Dateiauswahl |
| `updater` | Neue Version von GitHub Releases (`latest.json`), Signatur gegen `plugins.updater.pubkey` in `tauri.conf.json` geprüft; Ablauf in `docs/RELEASING.md` |
| `process` | Neustart nach dem Update (`relaunch`) |

`capabilities/default.json` gibt dem Hauptfenster nur, was das Frontend braucht: Fensterknöpfe, `opener` (Dateipfade nur der Spielordner `$APPDATA/instances/*/minecraft` selbst sowie darin `crash-reports/`, `logs/`, `saves/` und `screenshots/`; „Im Ordner zeigen“ kommt aus `opener:default`), `dialog:default`, `updater:allow-check`/`allow-download`/`allow-install` (suchen, laden, installieren; ohne `download-and-install`) und `process:allow-restart` (kein `exit`).

Asset-Protokoll (`app.security.assetProtocol` in `tauri.conf.json`, Cargo-Feature `protocol-asset`): nur für die Vorschau der Screenshots, Scope `$APPDATA/instances/*/minecraft/screenshots/**` (`*` trifft genau einen Pfadteil, also nur die Ordner der Instanzen). Das Frontend macht aus dem Pfad mit `convertFileSrc` eine URL, die WebView lädt die PNG direkt von der Platte; ohne IPC, Base64 oder Verkleinern im Backend. Andere Dateien des Datenordners (Konten, Logs) bleiben darüber unerreichbar. Die CSP ist aus (`csp: null`), braucht also keinen Eintrag.

### Persistenz

JSON-Dateien im App-Datenverzeichnis (`app.path().app_data_dir()`; Windows `%APPDATA%\dev.laux.launcher\`, Linux `~/.local/share/dev.laux.launcher/`, macOS `~/Library/Application Support/dev.laux.launcher/`):

- `instances.json`
- `templates.json`
- `accounts.json` (nur `id`, `username`, `kind`, `clientId`; Refresh-Tokens im OS-Schlüsselbund, Dienst `dev.laux.launcher`: Windows-Anmeldeinformationsverwaltung, macOS-Schlüsselbund, unter Linux Secret Service wie GNOME Keyring oder KWallet)
- `skins.json` (Skin-Bibliothek; die PNG-Dateien liegen unter `skins/<sha1>.png`)

Eine defekte Datei wird beim Start nach `*.json.corrupt` verschoben (nicht überschrieben), der Store startet leer. Schlägt das Schreiben fehl, wird die In-Memory-Änderung zurückgerollt.

### Datenmodell

- **`ModLoader`**: `vanilla | fabric | quilt | forge | neoforge` – Vanilla ist ein normaler Loader-Wert.
- **`Mod`**: `id`, `name`, `version`, `fileName`, `sha1?`, `enabled`, `source`.
- **`ModSource`** (getaggt über `type`): `{type:"local"}` · `{type:"url", url}` · `{type:"modrinth", projectId, versionId}` · `{type:"curseforge", projectId, fileId}`.
- **`Instance.modpack`** (`ModpackOrigin?`): merkt sich, aus welchem Modrinth-/CurseForge-Pack (Projekt + Version/Datei) die Instanz stammt – Grundlage für Pack-Updates.
- **`LogKind`** (`log_share`): `latest` = `logs/latest.log` des letzten Starts · `crashReport` = neuester Bericht in `crash-reports/`.
- **Startoptionen der Instanz**: `javaPath?` (eigene `javaw.exe` bzw. `java`, sonst Einstellung des Launchers bzw. mitgelieferte Runtime), `window` (`{type:"default"}` · `{type:"size", width, height}` · `{type:"fullscreen"}`), `gameArgs` (nach den Argumenten der Version), dazu wie bisher `memoryMb?` und `jvmArgs`. `update_instance` prüft einen geänderten Java-Pfad und lehnt Fenstergrößen von 0 ab.
- **`Instance.playtimeSecs`**: Summe aller Sitzungen; das Backend rechnet sie beim Spielende an (unplausible Dauern über 7 Tage oder bei zurückgestellter Uhr zählen nicht). `update_instance` übernimmt sie wie `lastPlayedAt` (setzt der Start) nie vom Frontend; Inhalts-Vorgänge schreiben nur die Liste `mods`.
- **`Instance.importedFrom?`**: Instanzordner im anderen Launcher, aus dem importiert wurde; `import_detect` markiert solche Quellen als `imported`.
- **`ForeignInstance`** (nur Antwort von `import_detect`, unverändert an `instance_import`): `launcher` (`prism | modrinth | curseforge | atlauncher`), `path`, `gameDir`, `imported`, `unsupported?` (Grund, warum Pumpkin Launcher sie nicht starten kann), `name`, `minecraftVersion`, `loader`, `loaderVersion?`, `memoryMb?`, `jvmArgs`.
- **`Instance.group?`**: Gruppe in der Bibliothek (getrimmt, leer = keine). Es gibt keine eigene Gruppen-Entität: Gruppen sind die Namen, die Instanzen tragen.
- **`LibrarySkin`**: `id` (SHA-1 der PNG), `name`, `variant` (`classic | slim`), `addedAt`. Dieselbe Datei kommt nur einmal in die Bibliothek.
- **`Screenshot`** (nur Antwort, nicht gespeichert): `fileName`, `path` (absolut), `takenAt` (Änderungszeit in ms), `size` (Bytes).
- **`SkinProfile`** (nur Antwort, nicht gespeichert): `skin: { url, variant } | null`, `capes: { id, alias, url, active }[]`.
- **`LaunchOptions`** (nur Eingabe von `instance_launch`): `username` (Offline), `accountId?` (Microsoft), `javaPath?` (Einstellung des Launchers; der Pfad der Instanz geht vor), `defaultMemoryMb?`, `quickPlay?` (`QuickPlay`; die Welt muss existieren, die Adresse darf nicht wie eine Option aussehen).
- **`QuickPlay`** (getaggt über `type`): `{type:"world", id}` (Ordnername unter `saves/`) · `{type:"server", address}` (`host[:port]`). **`Instance.lastQuickPlay?`** merkt sich das Ziel des letzten Starts per Quick Play (`world_delete` vergisst es, wenn es die gelöschte Welt war).

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
| `instance_install` | `instanceId` | – (Events `install-progress`); abgebrochen → Fehler „Vorgang abgebrochen“ |
| `instance_install_cancel` | `instanceId` | – |
| `instance_launch` | `instanceId`, `options: LaunchOptions` | PID (`number`) |
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
| `curseforge_adopt_download` | `instanceId`, `projectId`, `fileId`, `fileName` | `Instance` oder `null`, wenn die Datei noch nicht im Downloads-Ordner liegt (CurseForge wird erst gefragt, wenn dort eine Datei mit passendem Namen liegt) |
| `modrinth_install_mod` | `instanceId`, `versionId`, `operationId` | Aktualisierte `Instance` |
| `instance_check_files` | `instanceId`, absolute `paths` | `{ path, kind, duplicateOf, error }[]` je Datei: `kind` null = Zip ohne eindeutiges Merkmal, `duplicateOf` = Name des Eintrags mit demselben SHA-1, `error` = warum die Datei nicht passt |
| `instance_add_files` | `instanceId`, `files: { path, kind }[]`, `operationId` | Aktualisierte `Instance` (Phasen `copy`, `resolve`, `complete`); erkannte Dateien als `source: { type: "modrinth" }`, sonst `local`; schon vorhandener SHA-1 oder ein schon vorhandenes Modrinth-Projekt → Fehler |
| `modrinth_identify` | `instanceId`, `modIds` (lokale Einträge) | Aktualisierte `Instance`; erkannte Einträge werden Modrinth-Einträge (Schalter bleibt), ohne Netz ein Fehler |
| `modrinth_install_pack` | `versionId`, `name`, `operationId` | Neue `Instance` |
| `modrinth_import_pack` | absoluter `path`, `name`, `operationId` | Neue `Instance` |
| `instance_duplicate` | `instanceId`, `operationId` | Neue `Instance` (Fortschritt als `content-progress`, Phase `copy`: erst verwaltete Inhalte, dann Dateien); läuft die Instanz, Fehler |
| `import_detect` | `folder?` (absolut; ohne: Standardorte) | `ForeignInstance[]`, nach Namen sortiert |
| `instance_import` | `source: ForeignInstance`, `operationId` | Neue `Instance` (Fortschritt als `content-progress`, Phasen `copy` und `hash`); die Quelle bleibt unverändert |
| `instance_export_entries` | `instanceId` | `string[]`: Ordner und Dateien im Spielordner (ohne Neuerzeugtes) plus Ordner aktiver Inhalte |
| `instance_export` | `instanceId`, `include` (Einträge aus `instance_export_entries`), absoluter `path` (`.mrpack`), `operationId` | – (Phase `pack`) |
| `pack_install_cancel` | `operationId` | – (bricht `modrinth_install_pack`/`provider_install_pack`/`modrinth_import_pack`/`template_create_instance`/`instance_import`/`instance_duplicate`/`instance_export` ab; Fehler „Vorgang abgebrochen“) |
| `log_share` | `instanceId`, `kind: LogKind` | öffentlicher mclo.gs-Link (`string`); fehlt die Datei, eine Meldung in Alltagssprache |
| `debug_info` | `defaultMemoryMb` (RAM-Standard wie bei `instance_launch`) | Klartext ohne Instanz-/Kontonamen und Pfade (`string`) |
| `world_list` | `instanceId` | `World[]`, zuletzt gespielte zuerst |
| `world_backup` | `instanceId`, `worldId`, `operationId` | `WorldBackup` (Fortschritt als `content-progress`, Phase `backup`) |
| `world_backups` | `instanceId` | `WorldBackup[]` aller Welten, auch gelöschter, neueste zuerst |
| `world_restore` | `instanceId`, `backupId` | `World` (neuer Ordner, falls der alte belegt ist) |
| `world_backup_delete` | `instanceId`, `backupId` | – |
| `world_delete` | `instanceId`, `worldId`, `operationId` | `WorldBackup` (die Sicherung vor dem Löschen; war die Welt `lastQuickPlay`, wird das Ziel geleert) |
| `world_quick_play_supported` | `instanceId` | `boolean`: startet die Version direkt in Welten (lädt bei Bedarf die Versions-JSON) |
| `datapack_list` | `instanceId`, `worldId` | `Datapack[]`, nach Namen sortiert |
| `datapack_add` | `instanceId`, `worldId`, absolute `paths` (`.zip`) | – (alle oder keins; kein Datenpaket oder Name schon vergeben → Fehler mit Dateiname) |
| `datapack_install` | `instanceId`, `worldId`, `versionId` (Modrinth, Loader `datapack`), `operationId` | – (Phasen `resolve`, `download`, `complete`) |
| `datapack_remove` | `instanceId`, `worldId`, `packId` (aus `datapack_list`) | – (in den Papierkorb; synchron auf dem Hauptthread wie `screenshot_delete`) |
| `server_list` | `instanceId` | `Server[]` (ohne versteckte Einträge) |
| `server_save` | `instanceId`, `index?` (fehlt = neu), `server: Server` | – |
| `server_remove` | `instanceId`, `index` | – |
| `skin_profile` | `accountId` (Microsoft) | `SkinProfile` |
| `skin_library` | – | `LibrarySkin[]` |
| `skin_texture` | `id` | PNG als `data:`-URL |
| `skin_add` | absoluter `path` einer PNG | `LibrarySkin` (Name = Dateiname, Modell `classic`) |
| `skin_update` | `id`, `name`, `variant` | `LibrarySkin` |
| `skin_delete` | `id` | – |
| `skin_save_active` | `accountId`, `name` | `LibrarySkin` (der gerade getragene Skin) |
| `skin_upload` | `accountId`, `skinId` | – (Skin der Bibliothek wird aktiver Skin) |
| `skin_reset` | `accountId` | – (Standardskin) |
| `skin_cape` | `accountId`, `capeId?` | – (ohne `capeId`: Umhang ausblenden) |
| `screenshot_list` | `instanceId` | `Screenshot[]`, neueste zuerst; ohne Ordner `[]` |
| `screenshot_delete` | `instanceId`, `fileName` (aus `screenshot_list`) | – (Datei im Papierkorb); unbekannter Name → „Screenshot … wurde nicht gefunden“ |

Sichern, Wiederherstellen und Löschen von Welten sowie Änderungen an Datenpaketen und Serverliste gehen nur, solange die Instanz nicht läuft (`AppState::operation`): das Spiel hält die Dateien offen und schreibt sie beim Beenden neu.

Content-Fortschritt: `content-progress` `{ operationId, phase, done, total }` (Phasen `resolve`, `validate`, `download`, `extract`, `copy`, `backup`, `hash`, `pack`, `complete`). Der Aufrufer vergibt die `operationId`; späte oder fremde Events dürfen keinen anderen Auftrag aktualisieren. Modpack-Import und Minecraft-Installation sind getrennte Schritte: nach dem Import installiert `instance_install` die passende Minecraft-/Fabric-Runtime.

Events: `install-progress` `{ instanceId, step, done, total }` · `instance-log` `{ instanceId, stream: "stdout"|"stderr", line }` · `instance-exit` `{ instanceId, code: number|null, crashed: boolean, crashReport: string|null, logFile: string|null }` (kommt nach dem Speichern der Spielzeit; `crashed` = Fehlercode ohne Stopp durch den Nutzer; Pfade absolut, öffnbar per `openPath`, Scope `$APPDATA/**`) · `instances-changed` (ohne Daten; nach dem Nachtragen von Ordner-Inhalten beim Start). Installation und Start gibt es für `loader = vanilla` und `fabric`.

### Fabric

- `instance_install` lädt bei `fabric` das Profil `versions/loader/<mc>/<loader>/profile/json`. Ist `loaderVersion` leer, nimmt es den neuesten stabilen Loader und **speichert ihn in der Instanz** (die UI sollte die Instanz danach neu laden).
- Fehlende SHA-1 im Profil (Loader, Intermediary) kommen aus den `.sha1`-Dateien des Maven-Repos; das ergänzte Profil liegt unter `versions/fabric-loader-<loader>-<mc>/…json` für den Start ohne Netz.
- Merge: Fabric-Libraries vor den Vanilla-Libraries (gleiche `group:artifact[:classifier]` → Fabric gewinnt), `mainClass` = `net.fabricmc.loader.impl.launch.knot.KnotClient`, Profil-Argumente werden angehängt. ID, Client-JAR, Assets und Java bleiben die der Vanilla-Version.
- Schritte `loader` (Profil) und `mods` (Abgleich `mods/`) kommen zusätzlich als `install-progress`.
- Der Installiert-Marker enthält bei Mod-Loadern MC-Version, Loader und Loader-Version; ein Wechsel gilt als „nicht installiert“.

### Mods

`instances/<id>/minecraft/mods/` ist der Mods-Ordner (Spielverzeichnis, dort sucht Fabric). `mods::sync` legt jede aktivierte Mod mit `sha1` aus `cache/mods/<sha1>.jar` per Hardlink (Fallback Kopie) unter ihrem `fileName` ab und entfernt deaktivierte nur, wenn die Datei dort denselben SHA-1 hat; fremde Dateien bleiben liegen. Fehlt eine verwaltete Mod im Cache, schlägt der Abgleich fehl. Modrinth-Installationen laden die ausgewählte Fabric-/Minecraft-kompatible Version und erforderliche transitive Dependencies, prüfen Dateigröße, SHA-1 und SHA-512 und füllen den Cache. Automatische Updates oder stilles Ersetzen kollidierender Dateien sind nicht vorgesehen.

„Benötigt von“ (`requiredBy`): Vorlagen legen zusätzlich `pumpkin.json` (`{ requiredBy: { <fileName>: [projectId…] } }`) ins `.mrpack`, der Import wertet sie aus; bei fremden Packs wird es aus den Pflicht-Abhängigkeiten der per SHA-1 erkannten Modrinth-Versionen abgeleitet. Eigene Dateien (Ziehen aufs Fenster im Tab „Inhalte“ oder „Datei hinzufügen…“) laufen über `instance_check_files` (Art, Doppelte) und `instance_add_files`: Cache, Eintrag, `mods::sync`. Was Modrinth per SHA-1 kennt, wird mit Projekt und Version eingetragen und bekommt so Updates; ohne Netz bleibt es lokal und lässt sich später über „Mit Modrinth abgleichen“ (`modrinth_identify`) nachholen. Ein abgelegtes `.mrpack` führt zum Import als neue Instanz (`/instances?neu=1&datei=<Pfad>`). Beim Start trägt `content::adopt_untracked` Dateien aus `mods/`, `resourcepacks/`, `shaderpacks/` nach, die nicht in der Instanz stehen (`*.disabled` → deaktiviert; ohne Netz als lokal), und sendet danach `instances-changed`.

### Verzeichnisse (App-Datenverzeichnis)

```
versions/<id>/<id>.json|.jar   libraries/…   assets/{indexes,objects,log_configs}/   runtime/<komponente>/
instances/<instanz-id>/minecraft/ (Spielverzeichnis, darin mods/)   instances/<instanz-id>/natives/   instances/<instanz-id>/backups/<welt>-<unix-ms>.zip   cache/mods/<sha1>.jar
skins/<sha1>.png
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
- `lib/platform.ts` – Betriebssystem aus dem User-Agent der WebView (Java-Auswahl: Dateifilter `.exe` nur unter Windows, Beispielpfad je System)
- `lib/api.ts` – `invoke`-Wrapper; außerhalb von Tauri (reiner `pnpm dev` im Browser) Fallback auf Mockdaten aus `lib/mock.ts`
- `hooks/` – TanStack Query; Mutations invalidieren die betroffenen Queries. `useFileDrop` meldet aufs Fenster gezogene Dateien (Tauri `onDragDropEvent`, für Neue Instanz und Inhalte). `useInstances` (Spielen = bei Bedarf installieren, dann starten; Backend-Events), `useContent` (Modrinth-Vorgänge mit Fortschritt; als `cancellable` markierte Läufe zeigen im Aufgaben-Menü „Abbrechen“), `useTemplates`, `useAppUpdate` (Launcher-Update: stille Suche nach dem Start im Release-Build, Download mit Fortschritt, Installation erst nach Zustimmung und erst, wenn kein Minecraft und keine Aufgabe mehr läuft), `useRunningTasks` (laufende Aufgaben aus `store/game.ts`, `useContent` und `useWorldJob` an einer Stelle: Aufgaben-Menü und Update-Neustart lesen nur hierüber), `useSupport` (Log teilen: Link kopieren, Toast mit „Öffnen“; Debug-Info kopieren), `useSkins` (Bibliothek, Texturen, Profil des Microsoft-Kontos), `useWorlds` (Welten, Sicherungen, Datenpakete und Serverliste; Sichern/Löschen/Wiederherstellen mit Fortschritt im Store `useWorldJob`, auch im Aufgaben-Menü; nach Spielende neu geladen), `useScreenshots` (Liste bei jedem Öffnen des Tabs neu, nach `instance-exit` invalidiert; Löschen), `useImport` (Instanzen anderer Launcher finden, auswählen und nacheinander importieren, je Instanz eine Aufgabe im Aufgaben-Menü)
- `store/settings.ts` – Launcher-Einstellungen, lokal persistiert: Java, RAM, Konten (Offline-Namen, aktives Konto), Pixelgröße, bewegte Szenen
- `store/game.ts` – flüchtiger Laufzeitzustand aus den Events: Installationsfortschritt, Starten, Protokoll (gepuffert, max. 2000 Zeilen je Instanz), Absturz, Startzeit
- `store/look.ts` – Szenenbild (Biom) je Instanz und zugeklappte Gruppen der Bibliothek, lokal persistiert (das Backend hat dafür kein Feld; ohne Wahl fest aus der Instanz-ID)
- `store/tasks.ts` – Verlauf abgeschlossener Aufgaben für das Aufgaben-Menü; laufende Aufgaben kommen live aus `useRunningTasks`
- Eigene Dateien hinzufügen geht nur in der App; „Mit Modrinth abgleichen“ erkennt im Browser nichts.
- Mods/Modpacks verwenden in Tauri den echten Modrinth-Katalog; neue Content-Installationen melden im Browser ohne Tauri keine vorgetäuschten Erfolge.
- Konten: Offline-Spielernamen lokal, Microsoft-Konten über den Gerätecode-Login des Backends.
- Welten, Datenpakete und Server im Browser: Beispiele aus `lib/mock-worlds.ts` (je Instanz bzw. Welt, nur im Speicher; Sichern und Datenpakete von Modrinth mit vorgetäuschtem Download, eigene Zips nur in der App).
- Screenshots im Browser: fünf auf einem Canvas gemalte Platzhalter je Instanz aus `lib/mock-screenshots.ts` (`path` ist dort die data:-URL); Öffnen und Im-Ordner-Zeigen gehen nur in der App.
- Skins im Browser: Beispielprofil und -bibliothek aus `lib/mock-skins.ts` (Texturen auf einem Canvas gemalt); Dateien hinzufügen geht nur in der App.

**Oberfläche**

- `app/Layout.tsx` – rahmenloses Fenster: Fensterleiste mit Wortzeichen, Kontomenü und eigenen Fensterknöpfen (auf allen Systemen, auch unter macOS statt der Ampel), links eine Icon-Seitenleiste (Start · Bibliothek · Entdecken, unten Aufgaben-Menü und Einstellungen) (`@tauri-apps/api/window`, Ziehen per `data-tauri-drag-region`); setzt `--px`, pausiert Szenen, solange Minecraft läuft
- `pages/` – Start (Szene, Weiterspielen-Reihe, „Weiterspielen in …“ per Quick Play mit dem Ziel des letzten Quick-Play-Starts, Onboarding), Bibliothek (Poster/Liste, mit Gruppen als aufklappbare Abschnitte, ohne Gruppe zuletzt; zugeklappte bleiben gemerkt), Instanz (klebender Kopf mit Spielzeit, Inhalte mit Ablage eigener Dateien `detail/LocalFiles.tsx`, Welten mit den Abschnitten Welten und Server – „Spielen“ startet per Quick Play, gesperrt mit Tooltip, solange das Spiel läuft oder die Version keine Welten unterstützt; „Datenpakete…“ im Menü einer Welt zeigt ihre Pakete mit Zustand, nimmt Zips per Auswahl oder Ziehen aufs Fenster an und öffnet für „Auf Modrinth suchen“ das Seitenpanel `AddContentSheet` mit `world` –, Screenshots – Raster nach Tagen, Vorschau per Asset-Protokoll mit `loading=lazy`/`decoding=async`, große Ansicht mit ← →, Öffnen, Im Ordner zeigen, Papierkorb –, Protokoll, Einstellungen mit Java, Fenster und Spielargumenten, gesperrt, solange das Spiel läuft; `pages/detail/`), Entdecken (Katalog, Projektseite; Datenpakete fragen über `AddToWorldMenu` je Instanz ein Untermenü mit ihren Welten ab), Einstellungen, Skins (`/skins`, über das Kontomenü: aktueller Skin und Umhang des Microsoft-Kontos, Bibliothek als Raster; Offline-Konten sehen einen Hinweis auf die Microsoft-Anmeldung)
- `components/px.tsx` – Bausteine: Knopf, Chip, Fortschritt, Suchfeld, Auswahl, Segmente, Checkbox, Schalter, Radio, Speicher-Slider, Tooltip, Menü/Kontextmenü, Dialog, Seitenpanel, Leer- und Fehlerzustände, Toasts. Verhalten von Radix, Aussehen aus `styles/`
- `components/game.tsx` – Spielen-Knopf (feste Größe in allen Zuständen), Statuszeile, Status-Chip, Protokoll mit Filter/Suche/Mitscrollen
- `components/instance.tsx` – Instanz-Menü (Knopf und Rechtsklick, Untermenü „Gruppe“): „Duplizieren“ und „Exportieren…“ (Auswahl der Ordner, Speichern-Dialog; beide mit Fortschritt und „Abbrechen“ im Aufgaben-Menü, danach Toast mit „Öffnen“ bzw. „Im Ordner zeigen“), Dialoge „Als Vorlage speichern“, „Neue Gruppe“ und „Löschen“
- `components/common.tsx` – geteilte Formularbausteine: Arbeitsspeicher (`MemoryChooser`), Java (`JavaChooser`, global und je Instanz)
- `components/support.tsx` – Rückfrage „Log öffentlich teilen?“ (einmal im Layout, `askShareLog`; während des Hochladens gesperrt), Knopf „Debug-Info kopieren“, Einstellungen › Support (GitHub-Issues und -Diskussionen). „Log teilen“ steht in der Protokoll-Leiste und als Symbol in der Absturz-Statuszeile; nach einem Absturz mit Bericht wird der Bericht geteilt, sonst `latest.log`
- `components/ContentBrowser.tsx`, `NewInstanceDialog.tsx`, `PlayerNames.tsx`, `Onboarding.tsx` – Katalog und Seitenpanel, Neue Instanz, Konten und Microsoft-Anmeldung, erster Start
- `components/LauncherImport.tsx` – Reiter „Anderer Launcher“ in *Neue Instanz*: gefundene Instanzen nach Launcher gruppiert zum Ankreuzen (noch nicht importierte vorgewählt), „Ordner wählen…“ für portable Launcher wie MultiMC, nicht startbare ausgegraut mit Grund, Fortschritt in der Zeile; das Onboarding öffnet über `/instances?neu=import` den Dialog der Bibliothek (der bleibt offen, wenn der erste Import die Bibliothek füllt) und nennt die Zahl gefundener Instanzen
- `components/AppUpdate.tsx` – Zeile „Updates“ in *Einstellungen › Über*: Version suchen, Versionshinweise, „Installieren und neu starten“, nach dem Warten auf Spiel und Aufgaben „Jetzt neu starten“
- `pixel/` – `unit.ts` (Pixeleinheit auf ganze Gerätepixel), `scene.ts` (Szenen-Engine: 7 Biome, 12 fps, Pausenregeln, Cache), `PixelScene.tsx`, `icons.tsx` (Pixel-Icons, Mod-Glyphen, Wortzeichen, Spielerkopf), `skin.ts` + `SkinFigure.tsx` (Vorderansicht aus der Skin-Textur: Kopf, Körper, Arme – schlank bei `slim` –, Beine mit zweiter Schicht; altes 64×32-Format gespiegelt, eine ganz deckende Hutschicht gilt dort wie im Spiel als leer; Grundschicht deckend; Umhang-Außenseite; Canvas in Texturpixeln, per CSS um ganze `--iu` vergrößert)
- `styles/pixelkino.css` (aus dem Mockup übernommen), `styles/states.css` (Auswahlliste, Hover/Druck/Fokus, Ein- und Ausblenden) plus kleine Ergänzungen je Bereich; beide in der Tailwind-Schicht `components`, deren Reihenfolge `index.html` vor allen Stylesheets festlegt

## Herkunft der Ideen und Lizenz

Architektur und Datenmodell orientieren sich an der Recherche zu NoRiskClient (`docs/research-noriskclient.md`). NoRiskClient steht unter **GPLv3**: übernommen werden nur Ideen und Konzepte, **kein Code**. Protokolle und Formate (Microsoft/Xbox-Auth, piston-meta, Fabric-/Quilt-Meta, Forge-`install_profile.json`, Modrinth, `.mrpack`, CurseForge) werden nach der jeweiligen Primärdokumentation implementiert.

Crates kommen erst mit dem Feature, das sie braucht (z. B. `reqwest`/`tokio` mit dem Downloader, `keyring` mit dem Login) – Kandidaten siehe Recherche, Abschnitt 7.
