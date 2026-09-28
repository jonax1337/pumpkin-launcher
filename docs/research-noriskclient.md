# Recherche: NoRiskClient-Launcher als Architekturvorlage

Stand: 29.09.2026 · Autorin: Iris (Research) · Grundlage: Quellcode-Lektüre, keine Ausführung

**Untersuchtes Repo:** <https://github.com/NoRiskClient/noriskclient-launcher>, Commit `2a283c5f` vom 16.09.2026, Version `0.6.28`.
Das ist der aktuelle, aktiv gepflegte Launcher der Organisation NoRiskClient (per `gh repo list NoRiskClient` geprüft; ein Repo `norisk-launcher` gibt es nicht). Umfang: ca. 86.000 Zeilen Rust in `src-tauri/src`, dazu das React-Frontend in `src/`.

Legende: **[V]** = im Quellcode oder in der Quelle verifiziert (Pfad angegeben) · **[E]** = unsere Einschätzung/Empfehlung, keine Aussage über NRC.

---

## 1. Architektur: Rust-Backend und Frontend

### Stack [V]
| Schicht | Technik |
|---|---|
| Shell | Tauri 2 (`tauri` 2.9.x), Plugins: opener, dialog, fs, clipboard-manager, process, updater, single-instance + deep-link, cli |
| Backend | Rust 2021, `tokio` (full), eine Cargo-Workspace mit 3 Hilfs-Crates (`norisk-ipc`, `norisk-logging`, `norisk-capture` nur macOS) |
| Frontend | React 18, Vite 6, Tailwind 3, **zustand** (State), react-router 7, i18next (10 Sprachen), framer-motion/gsap, three.js (Skin-Renderer), react-virtuoso/react-window (Listen) |
| Persistenz | SQLite über `sqlx` (Migrationen in `src-tauri/migrations/`), dazu JSON-Dateien (Accounts, Config) |

Kein shadcn/Radix: NRC hat ein eigenes UI-Kit in `src/components/ui/` (Modal, Combobox, Dropdown, Toasts, Skeletons) plus `design-system.ts`.

### Backend-Modulstruktur (`src-tauri/src/`) [V]
| Modul | Aufgabe |
|---|---|
| `commands/` | ~38 Dateien mit `#[tauri::command]`-Funktionen, nach Fachgebiet getrennt (profile, content, modrinth, curseforge, java, minecraft_auth, process, …). In `main.rs` über **ein** `generate_handler!` registriert. |
| `state/` | Globaler `State` als `static LAUNCHER_STATE: OnceCell<Arc<State>>` (`state_manager.rs`), Manager-Objekte mit `RwLock`/`Mutex`: `ProfileManager`, `ConfigManager`, `ProcessManager`, `EventState`, Content-Cache, `db.rs` (sqlx-Pool). |
| `minecraft/api/` | HTTP-Clients für Mojang-Piston-Meta, Fabric-/Quilt-Meta, Forge-/NeoForge-Maven, NoRisk-Backend. |
| `minecraft/auth/` | Microsoft → Xbox → Minecraft Login, Token-Refresh, Account-Store. |
| `minecraft/downloads/` | Je ein Downloader für Client, Libraries, Natives, Assets, Java, Loader-Libraries, Mods (`mod_downloader.rs`, `mod_resolver.rs`). |
| `minecraft/modloader/` | Installer je Loader: `fabric_installer`, `quilt_installer`, `forge_installer`, `neoforge_installer`. |
| `minecraft/launch/` | Klassenpfad, JVM-/Game-Argumente, Mojang-`rules`-Auswertung, Forge/NeoForge-Processor-Ausführung (`forge_patcher.rs`), eigentlicher Prozessstart. |
| `minecraft/dto/` | serde-Structs für alle externen JSON-Formate (piston_meta, version_manifest, fabric_meta, forge_install_profile, …). |
| `integrations/` | Modrinth, CurseForge, `.mrpack`-Import/Export, CurseForge-Export, **`unified_mod.rs`** (plattformübergreifende Abstraktion), Import aus anderen Launchern (`launcher_import/adapters/`: MultiMC/Prism, ATLauncher, Modrinth App, CurseForge App). |
| `sync/` | „Sync Packs": Ordner/Dateien/Mods über mehrere Profile teilen (Symlink, Merge, Copy). |
| `utils/` | Download-Helfer mit SHA1-Prüfung und Retry (`download_utils.rs`), Java-Erkennung (`java_detector.rs`), Pfade, Backups, Crash-Analyse, Hotkeys, Updater. |

### Frontend-Struktur (`src/`) [V]
- `services/*.ts`: dünne Wrapper je Backend-Bereich um `invoke('command_name', …)` (z. B. `profile-service.ts`, `modrinth-service.ts`, `unified-service.ts`). Die UI ruft **nie direkt** `invoke`.
- `store/*.ts`: zustand-Stores pro Domäne (Profile, Auth, Launch-State, Content-Cache, Import-Progress, …).
- `hooks/`: `useProfileLaunch`, `useProcessEvents`, `useProcessLogCursor`, `useResolvedLoaderVersion` usw.
- Fortschritt: Backend sendet Events mit `EventPayload { event_id, event_type, target_id, message, progress, error }` (`state/event_state.rs`, ca. 45 `EventType`-Varianten wie `InstallingJava`, `DownloadingLibraries`, `DownloadingMods`, `LaunchingMinecraft`), das Frontend hört per `listen()`.
- Mehrere Fenster als eigene HTML-Einstiege: `minecraft-log-window.html`, `single-log-window.html`, `updater.html`.

**Einordnung [E]:** Die Aufteilung `commands/` (dünn) → `state/`-Manager (Logik) → `minecraft/*`/`integrations/*` (Fachlogik, IO) ist sauber und lohnt sich als Vorbild. Nicht übernehmen sollten wir die Größe einzelner Dateien (`profile_state.rs` 3.800 Zeilen, `profile_command.rs` 3.100) und die sichtbaren Altlasten (`*.tsx.backup`, `.temp`, „V2/V3"-Komponenten nebeneinander).

---

## 2. Datenmodell: Profile, Modpacks, Presets, eigene Mods, Loader

Alles in `src-tauri/src/state/profile_state.rs`, Persistenz in `migrations/0002_profiles.sql` [V].

### Profil (`struct Profile`) [V]
Kernfelder: `id: Uuid`, `name`, `path`, `game_version`, `loader: ModLoader`, `loader_version: Option`, `settings: ProfileSettings`, `state: ProfileState`, `mods: Vec<Mod>`, `group: Option<String>`, `use_shared_minecraft_folder`, `description`, `banner`/`background` (`ImageSource`: Url | RelativePath | RelativeProfile | AbsolutePath | Base64), `modpack_info: Option<ModPackInfo>`, `preferred_account_id`, `playtime_seconds`, `last_played`.
Vorwärtskompatibilität: `#[serde(flatten)] extra: serde_json::Map` fängt unbekannte Felder auf, fast alle Felder haben `#[serde(default)]`.

- `ProfileState`: `NotInstalled | Installing | Installed | Running | Error`.
- `ProfileSettings`: `java_path` + `use_custom_java_path`, `memory {min,max}` in MB, `resolution`, `fullscreen`, `extra_game_args`, `custom_jvm_args`, `quick_play_path`, **pro Loader** gepinnte Loader-Version (`overwrite_loader_versions: HashMap<loader, version>`), damit beim Wechsel Fabric→Forge→Fabric die Fabric-Wahl erhalten bleibt.
- DB: Tabelle `profiles` (Skalare als Spalten, `settings`/`modpack_info` als JSON-Text) plus `profile_mods` (eine Zeile pro Mod, `ordinal` für Reihenfolge, `ON DELETE CASCADE`).

### Mod-Loader [V]
```rust
enum ModLoader { Vanilla, Forge, Fabric, Quilt, NeoForge }  // serde lowercase
```
Vanilla ist ein Loader-Wert, kein Sonderfall. Loader-Versionen kommen von `meta.fabricmc.net/v2`, `meta.quiltmc.org/v3`, Forge-/NeoForge-`maven-metadata.xml` (`quick-xml`). Forge/NeoForge: Installer-JAR laden, `install_profile.json` lesen und die **Processors selbst ausführen** (`launch/forge_patcher.rs`), statt den offiziellen Installer headless zu starten.

### Mod-Eintrag (`struct Mod` + `enum ModSource`) [V]
`ModSource` ist ein getaggtes Enum (`#[serde(tag="type")]`):
`Local{file_name}` · `Url{url,file_name}` · `Maven{coordinates,repository_url}` · `Embedded{name}` · `Modrinth{project_id,version_id,file_name,download_url,file_hash_sha1}` · `CurseForge{project_id,file_id,file_name,download_url,file_hash_sha1,file_fingerprint}`.
Dazu am `Mod`: `enabled`, `display_name`, `version`, `game_versions`, `associated_loader`, `modpack_origin` („modrinth:proj:ver"), `updates_enabled`, `force_include_versions` (Mod bewusst auf einer nicht gelisteten MC-Version erzwingen).

### Modpacks [V]
- Profil merkt sich die Herkunft über `ModPackInfo { source: Modrinth{project_id,version_id} | CurseForge{project_id,file_id}, file_hash }`; Mods aus dem Pack tragen `modpack_origin`. Damit sind Pack-Updates/Versionswechsel möglich (`unified_mod.rs::switch_modpack_version`).
- Import: `.mrpack` (`integrations/mrpack.rs`, liest `modrinth.index.json` + `overrides/`), CurseForge-ZIP (`manifest.json` + Overrides). Export in beide Formate (`mrpack_export.rs`, `curseforge_export.rs`).

### „Presets" bei NRC = Standard-Profile + NoRisk-Packs [V]
1. **Standard-Profile** (`integrations/norisk_versions.rs`): vom Server geladene `Vec<Profile>` mit `is_standard_version = true`. Nutzer erzeugen daraus eigene Profile; `source_standard_profile_id` hält die Herkunft fest.
2. **NoRisk-Packs** (`integrations/norisk_packs.rs`, Datei `norisk_modpacks.json`): serverseitig definierte Mod-Listen mit
   - `inheritsFrom: [packId]` + `excludeMods` (Vererbung),
   - `compatibility: McVersion → Loader → { identifier, filename, source? }` (eine Mod-ID, je MC-Version/Loader eine konkrete Datei),
   - `loaderPolicy` (Loader-Version per MC-Version-Pattern, Strategie `exact | latest_compatible | min_compatible`),
   - `startupHelper.additional_paths` (Startdateien wie `options.txt` in neue Profile kopieren).
   Profil wählt ein Pack über `selected_norisk_pack_id`; einzeln abgewählte Pack-Mods landen in `profile_disabled_norisk_mods`.

**Für uns [E]:** Das Pack-Modell (Vererbung + Kompatibilitätsmatrix + Loader-Policy) ist genau das, was wir für „eigene Modpacks/Presets" brauchen, und als *Datenformat-Idee* frei nutzbar (siehe Lizenz). Wir können es schlanker halten: eine versionierte JSON-Definition im eigenen Repo/CDN reicht.

### Eigene Mods [V]
- Früher Ordner `custom_mods/`, jetzt **als veraltet markiert** (`#[deprecated]`, `profile_state.rs:2486`); lokale Mods liegen im normalen `mods/`-Ordner als `ModSource::Local`.
- Deaktivieren über Dateiendung `.disabled` (Konvention anderer Launcher).
- Verwaltete Mods werden **nicht** ins Profil kopiert: Sie liegen in einem globalen `meta/mod_cache/` und werden beim Start per JVM-Property eingebunden:
  - Fabric: `-Dfabric.addMods=@<metadatei>` (eine absolute Pfadzeile pro JAR; offizielles Fabric-Feature) (`mod_resolver.rs:753`).
  - Forge/NeoForge: `-Dnrc.addMods=@…` / `nrc.modsFolder`. Das wertet **NRCs eigener Loader** („nrc-forgeloader", von `assets.norisk.gg`) aus, nicht Forge selbst (`installer.rs:888`, `launch/launcher.rs:453`).
  - Quilt: klassisch in `mods/` synchronisiert (`sync_mods_to_profile`).

**Für uns [E]:** Globaler, per Hash deduplizierter Mod-Cache ist sinnvoll. Für Fabric können wir `fabric.addMods` 1:1 nutzen. Für Forge/NeoForge haben wir keinen eigenen Loader-Patch → dort Hardlink/Kopie aus dem Cache nach `mods/`. Ob NeoForge/FML eine gleichwertige offizielle Property hat, ist hier **nicht geklärt**; das müsste eine Lektüre von FML/`ModDirTransformerDiscoverer` klären.

### Profil-Ordner [V]
Profile können einen gemeinsamen Minecraft-Ordner nutzen (`use_shared_minecraft_folder`), außer Gruppen „server" und „modpacks", die immer isoliert sind (`is_isolated_group`). Zusätzlich „Sync Packs" (`sync/model.rs`): Ziele vom Typ `DirLink` (Symlink), `FileMerge` (z. B. `options.txt` zusammenführen, lokale Keys behalten), `FileCopy`, `Mods`.

---

## 3. Auth, Downloads, Java

### Auth-Flow (`minecraft/auth/minecraft_auth.rs`, `commands/minecraft_auth_command.rs`) [V]
Zwei Wege:

**a) Standard (Desktop): SISU-Flow im Tauri-Webview**
1. Device-Key erzeugen (P-256, `p256`), `device.auth.xboxlive.com/device/authenticate` (signierte Requests).
2. `sisu.xboxlive.com/authenticate` liefert die MS-Login-URL; PKCE-Challenge (`generate_oauth_challenge`).
3. Neues `WebviewWindow` „signin" öffnet die URL; der Launcher pollt `window.url()` bis zur Redirect-URL `login.live.com/oauth20_desktop.srf?code=…`.
4. `login.live.com/oauth20_token.srf` → MS-Token; `sisu.xboxlive.com/authorize` → XSTS.
5. `api.minecraftservices.com/launcher/login` → MC-Token; `/entitlements/license` (Besitz prüfen); `/minecraft/profile` (UUID, Name, Skins).
Client-ID: `00000000402b5328` (die Client-ID des **offiziellen Minecraft Launchers**, Scope `service::user.auth.xboxlive.com::MBI_SSL`).

**b) Browser-Flow (Flatpak oder per Einstellung)**
Eigene Azure-App (`DIRECT_OAUTH_CLIENT_ID`), `login.microsoftonline.com/consumers/oauth2/v2.0/authorize`, lokaler **axum**-Callback-Server auf `http://localhost:25585/callback` (Fallback-Port), dann `user.auth.xboxlive.com` → `xsts.auth.xboxlive.com` → Minecraft-Services wie oben.

Weiteres: Retry mit Budget (`auth_retry`, 5 Versuche/15 s), Offline-Modus bei Netzfehlern (gecachte Credentials behalten), Multi-Account mit aktivem Account und optionalem Account pro Profil.
**Speicherung: `accounts.json` im Launcher-Verzeichnis, Klartext-JSON, atomar geschrieben**; kein OS-Keyring.

**Für uns [E + V]:**
- Die offizielle Launcher-Client-ID zu verwenden ist nicht unser Weg. Wir registrieren eine eigene Azure-App und lassen sie für die Minecraft-Services-API freischalten. Neue Azure-Apps werden seit 2022 von `api.minecraftservices.com` abgelehnt, bis Mojang sie über das Formular <https://aka.ms/mce-reviewappid> freigibt (Quellen: [HeliosLauncher-Doku](https://github.com/dscalzi/HeliosLauncher/blob/master/docs/MicrosoftAuth.md), [Mojang-Hilfeartikel](https://help.minecraft.net/hc/en-us/articles/16254801392141), [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/5971906/xboxlive-signin-minecraft-services-access-for-an-i)). **Das ist ein Blocker mit Vorlauf von mehreren Tagen und sollte sofort beantragt werden.**
- Flow = Variante b (Auth-Code + PKCE, Loopback-Redirect). Mit Tauri reicht statt eigenem axum-Server auch Deep-Link oder Webview-Redirect; axum ist nicht zwingend.
- Refresh-Token in den OS-Keyring (`keyring`-Crate) statt Klartext-JSON.

### Download-, Asset- und Library-Handling [V]
- Version-Manifest: `launchermeta.mojang.com/mc/game/version_manifest.json` → piston-Meta pro Version.
- Ein globaler `reqwest::Client` (`config.rs`, `Lazy`, eigener User-Agent). `utils/download_utils.rs`: `DownloadConfig` mit `expected_sha1`, Retry, optionaler Hash-Prüfung vorhandener Dateien, Maven-`.sha1`-Sidecar als Fallback.
- Parallelität über `futures::stream::iter(..).buffer_unordered(n)`: Assets 12, Forge-Libraries 10 (Konstanten in den Downloadern).
- Natives werden aus den Library-JARs extrahiert (`mc_natives_download.rs`), OS/Arch-Regeln über `launch/rules.rs`.
- Installationsablauf (`minecraft/installer.rs`) als Folge `timed_step(...)` mit Start/Ende-Event und Zeitmessung: Java → Libraries → Natives → Assets → Client → Loader → Mods → Sync → Launch. Nach dem Start: `ProcessManager` überwacht Prozess, Logs, Spielzeit.

### Java-Runtime-Management [V]
- Benötigte Major-Version aus piston-Meta (`java_version.major_version`, `component`).
- Distributionen: **Temurin (Standard, Adoptium API `api.adoptium.net/v3/binary/latest/…`)**, Zulu (Azul API, zweistufig), GraalVM.
- Ablage pro Distribution/Version im Launcher-Verzeichnis; vor Download wird nach vorhandener Installation gesucht.
- Sonderfall Apple Silicon: für die Legacy-Komponente wird x86_64-Java geladen (Rosetta).
- Eigener Java-Pfad pro Profil möglich; ist er zu alt, fällt der Launcher auf Download zurück. `utils/java_detector.rs` findet System-Javas.

**Für uns [E]:** Temurin über die Adoptium-API reicht als einzige Distribution. Mojangs eigene Runtime-Manifeste wären die Alternative; NRC nutzt sie nicht.

---

## 4. Modrinth- und CurseForge-Integration [V]

**Modrinth** (`integrations/modrinth.rs`, Basis `https://api.modrinth.com/v2`): `/search`, `/project/{id}`, `/project/{id}/version`, `/version/{id}`, `/version_file/{hash}` und `/version_files` (Batch-Lookup über SHA1/SHA512, für Update-Check und Zuordnung lokaler JARs), `/tag/*`.

**CurseForge** (`integrations/curseforge.rs`, `https://api.curseforge.com/v1`): Suche (classId 6 = Mods, 4471 = Modpacks), Files, Changelog, Beschreibung, Batch `mods`/`files`, **Fingerprint-Matching** (Murmur2) für lokale Dateien.
- API-Key **fest im Quellcode** (`CURSEFORGE_API_KEY`, Header `x-api-key`). Diesen Key dürfen wir nicht verwenden. Wir brauchen einen eigenen Key über die CurseForge-Developer-Konsole.
- Leere `download_url` (Autor hat Drittanbieter-Distribution verboten, `allow_mod_distribution`) wird erkannt und die Datei übersprungen (`curseforge.rs:1503`). Einen Hinweis „bitte manuell herunterladen" für den Nutzer gibt es an dieser Stelle nicht.

**Vereinheitlichung** (`integrations/unified_mod.rs`): `ModPlatform {Modrinth, CurseForge}`, gemeinsame Typen `UnifiedModSearchResult`, `UnifiedVersion`, `UnifiedDependency`, `UnifiedSortType`, sowie `search_mods_unified`, `get_mod_versions_unified`, `check_mod_updates_unified`. Das Frontend spricht nur `unified-service.ts` an.

**Für uns [E]:** Diese Unified-Schicht ist das wichtigste Muster in dem Bereich. Wir starten mit Modrinth (offen, kein Key, `.mrpack` offen dokumentiert) und fügen CurseForge später als zweite Implementierung derselben Schnittstelle hinzu.

---

## 5. UI/UX-Muster, die sich lohnen [V → E]

1. **Profil-Wizard** (`components/profiles/wizard-v2/`): Schritte Quelle → Version/Loader → Details → Review. Eigener Schritt „aus anderem Launcher importieren".
2. **Launcher-Import** (Prism/MultiMC, ATLauncher, Modrinth App, CurseForge App): senkt die Hürde zum Umstieg stark.
3. **Profil-Detail mit linker Leiste + Tabs** (`profiles/v3/`) und **Browse-Side-Sheet**: Modrinth-/CF-Suche direkt im Profilkontext geöffnet, gefiltert auf dessen MC-Version und Loader.
4. **Fortschritt als benannte Schritte** (Events pro Installationsschritt, `ProgressToast`) statt eines anonymen Balkens; Laufende Instanzen global sichtbar (`RunningInstancesIndicator`).
5. **Log-Viewer im eigenen Fenster** mit Instanz-Sidebar, Upload zu mclo.gs (`mclogs_api.rs`) und **Crash-Analyse mit Fix-Vorschlag** (`crash_fix_command.rs`: falsche Mod-Version erkennen und Up-/Downgrade anbieten).
6. **Gruppen** für Profile (`GroupTabs`, `GroupPicker`), Banner-/Hintergrundbild pro Profil, Spielzeit-Anzeige.
7. **Globales Drag & Drop** (`useGlobalDragAndDrop`): `.mrpack`/ZIP/JAR aufs Fenster ziehen.
8. **Pro-Mod-Schalter „Updates aktiv"** und Update-Check per Hash-Batch.
9. **Virtualisierte Listen** (react-virtuoso) für große Mod-Listen und Skeleton-Loader.
10. i18n von Anfang an (Deutsch ist dabei).

Nicht übernehmen [E]: Werbung (Applixir), Advent-Kalender, Cosmetics/Capes/Friends/Chat, Clips-Recorder. Das sind NRC-Produktfeatures, die die Codebasis stark aufblähen.

---

## 6. Lizenz: was wir dürfen

**Befund [V]:** `LICENSE` = **GNU GPL v3.0**. README: Das Projekt ist ursprünglich ein Fork von [LiquidLauncher](https://github.com/CCBlueX/LiquidLauncher) (ebenfalls GPL) und enthält noch Code daraus. Die README sagt ausdrücklich, dass Code auch nur auszugsweise nicht in Closed-Source-Software verwendet werden darf und abgeleitete Werke unter GPL veröffentlicht werden müssen.

**Konsequenzen [E] (Einschätzung, keine Rechtsberatung):**
- **Kein Code kopieren oder abschreiben**, auch keine einzelnen Funktionen oder Structs 1:1, solange Rookery/unser Launcher nicht selbst GPLv3 werden soll. Kopierter GPL-Code macht unser gesamtes Programm GPL-pflichtig.
- **Unbedenklich:** Ideen, Architekturmuster (Modulaufteilung, Unified-Mod-Schicht, Event-basierter Fortschritt, globaler Mod-Cache), Datenmodell-*Konzepte* (Profil, getaggtes `ModSource`, Pack-Vererbung + Kompatibilitätsmatrix), UX-Abläufe. Ideen und Konzepte sind durch das Urheberrecht nicht geschützt.
- **Öffentliche Protokolle und Formate sind nicht NRCs Eigentum:** Microsoft-/Xbox-/Minecraft-Auth-Endpunkte, piston-meta, Fabric-/Quilt-Meta, Forge-`install_profile.json`, Modrinth-API und `.mrpack`, CurseForge-API und `manifest.json`. Diese implementieren wir nach **Primärdokumentation** (wiki.vg-Archiv bzw. Minecraft-Wiki, docs.modrinth.com, docs.curseforge.com, Microsoft-Identity-Doku), nicht nach NRC-Code.
- **Nicht nutzen:** NRCs CurseForge-API-Key, NRCs Azure-Client-IDs, NoRisk-Server/-CDN (`api.norisk.gg`, `cdn.norisk.gg`), deren Assets/Icons (siehe `THIRD_PARTY_ICONS.md`), den proprietären nrc-forgeloader.
- **Clean-Room-Praxis:** Wer NRC-Code gelesen hat, schreibt unsere Implementierung aus der Spezifikation und dokumentiert die Quelle. Dieses Dokument enthält bewusst nur Beschreibungen und kurze Signaturen zur Einordnung, keine übernehmbaren Implementierungen.

---

## 7. Crate-Empfehlung für unser Projekt

Aktueller Stand bei uns (`src-tauri/Cargo.toml`): tauri 2, tauri-plugin-opener, serde/serde_json, thiserror 2, tracing, uuid. Versionen beim Hinzufügen mit `cargo add` auf den jeweils aktuellen Stand setzen.

| Zweck | Crate | Begründung / NRC-Vergleich |
|---|---|---|
| Async-Runtime | `tokio` (Features: `rt-multi-thread, macros, fs, process, sync, time`) | Tauri nutzt tokio ohnehin; NRC nimmt `full`, wir brauchen nur diese Teilmenge |
| HTTP | `reqwest` (`json, stream, rustls-tls`, `default-features = false`) | Wie NRC; rustls vermeidet OpenSSL-Probleme unter Windows/Linux |
| Streams/Parallelität | `futures` (`buffer_unordered`) | Reicht für begrenzte parallele Downloads, kein eigener Pool nötig |
| Serialisierung | `serde`, `serde_json` | vorhanden |
| Fehler | `thiserror` (Lib), optional `anyhow` nur an Rändern | vorhanden |
| Datenbank | **`rusqlite` (`bundled`)** oder `sqlx` (`sqlite, runtime-tokio, migrate`) | Siehe unten |
| Hashes | `sha1`, `sha2` | SHA1 für Mojang/Modrinth, SHA512 für Modrinth-Lookup |
| Archive | `zip` (JARs, .mrpack, Natives), `flate2` + `tar` (Java unter Linux/macOS) | NRC nutzt zusätzlich `async_zip`; unnötig, wenn Entpacken in `spawn_blocking` läuft |
| XML | `quick-xml` (`serialize`) | Nur für Forge-/NeoForge-`maven-metadata.xml` |
| Versionen | `semver` | Loader-Versionen vergleichen (MC-Versionen sind kein Semver, eigene Vergleichslogik nötig) |
| Zeit/IDs | `chrono` (`serde`), `uuid` (`v4, serde`) | `uuid` vorhanden, Feature `serde` ergänzen |
| Pfade | `directories` *oder* `dirs` (eins reicht) | NRC nutzt beide |
| Auth (OAuth) | **keine OAuth-Crate nötig**: PKCE mit `sha2` + `base64` + `rand` selbst bauen; Callback über `tauri-plugin-deep-link` oder Loopback | Der Minecraft-Teil (Xbox/XSTS/MC) ist ohnehin handgeschrieben; `oauth2`-Crate lohnt nur für Schritt 1 |
| Token-Speicher | `keyring` | Besser als NRCs Klartext-`accounts.json` |
| Dateisperren | `fs4` | Gleichzeitige Downloads/Launcher-Instanzen schützen (NRC nutzt es) |
| Logging | `tracing` + `tracing-subscriber` (vorhanden), ggf. `tracing-appender` für Logdateien | NRC mischt `log`/`log4rs`/`tracing`; wir bleiben bei `tracing` |
| Tauri-Plugins | `tauri-plugin-dialog`, `-fs`, `-single-instance` (+ `deep-link`), `-updater`, `-process` | Wie NRC |

**DB-Entscheidung [E]:** Mit `rusqlite` beginnen, wenn wir nur Profile und einen Cache speichern: synchron, klein, `bundled` erspart System-SQLite, Aufruf über `spawn_blocking`. `sqlx` lohnt, wenn wir Migrationen und compile-geprüfte Queries wollen; NRC ist genau deshalb darauf umgestiegen (`migrations/0001–0003`). Für ein reines Profil-Modell reicht sogar JSON pro Profil. **Empfehlung: `rusqlite` + eine einfache `user_version`-Migration; Wechsel zu sqlx nur, wenn die Query-Zahl wächst.**

Weglassen: `dashmap`, `once_cell`/`lazy_static` (std `LazyLock`/`OnceLock` reicht), `axum`/`hyper`/`tower` (nur wenn wir wirklich einen Loopback-Server brauchen), `async_zip`, `trust-dns-resolver`, `craftping`, `discord-rich-presence` (erst bei Bedarf).

Frontend-Hinweis: Wir haben bereits zustand + TanStack Query + shadcn. TanStack Query deckt den Content-Cache ab, den NRC mit eigenen Stores (`content-cache-store.ts`) nachbaut.

---

## Zusammenfassung: die 5 wichtigsten Erkenntnisse

1. **Lizenz GPLv3 (+ LiquidLauncher-Erbe): nur Ideen übernehmen, keinen Code.** Protokolle und Formate implementieren wir nach Primärdoku von Microsoft, Mojang, Modrinth und CurseForge.
2. **Eigene Azure-App und Mojang-Freischaltung sofort beantragen** (<https://aka.ms/mce-reviewappid>). NRC nutzt im Standard-Flow die Client-ID des offiziellen Launchers; das ist für uns keine Option. Ohne Freigabe endet der Login mit 403. Den CurseForge-Key ebenfalls selbst beantragen.
3. **Datenmodell als Vorlage:** Profil mit `ModLoader`-Enum (inkl. Vanilla), getaggtes `ModSource`-Enum (Local/Url/Maven/Modrinth/CurseForge), `ModPackInfo` für Pack-Herkunft; Presets als Pack-Definition mit Vererbung, Kompatibilitätsmatrix MC×Loader und Loader-Policy.
4. **Architekturmuster, die tragen:** dünne `commands/` → Manager in `state/` → Fachmodule; Unified-Schicht über Modrinth/CurseForge; globaler Mod-Cache (Fabric per `-Dfabric.addMods=@datei`); Installation als benannte, zeitgemessene Schritte mit Events ans Frontend.
5. **Schlanker Crate-Satz reicht:** tokio, reqwest (rustls), futures, serde, thiserror, sha1/sha2, zip/flate2/tar, quick-xml, chrono, uuid, rusqlite, keyring, tracing und die Tauri-Plugins. NRCs ~90 Dependencies entstehen vor allem durch Produktfeatures, die wir nicht brauchen.

### Offene Punkte
- Offizieller Weg, Mods für **Forge/NeoForge** außerhalb von `mods/` einzubinden, wurde nicht geprüft (NRC nutzt dafür einen eigenen Loader). Zu klären: Lektüre des FML-/NeoForge-Loader-Codes.
- Aktuelle CurseForge-Bedingungen für Drittanbieter-Keys wurden nicht geprüft (<https://docs.curseforge.com/rest-api/>).
