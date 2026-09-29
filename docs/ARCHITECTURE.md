# Architektur

Desktop-App auf Basis von **Tauri 2**: ein Rust-Backend (`src-tauri/`) und ein React-Frontend (`src/`), verbunden über Tauri-Commands (`invoke`).

```
┌──────────────── Frontend (WebView) ────────────────┐
│ React Router → Seiten (Home, Instanzen, Mods, …)    │
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
| `lib.rs` | Einstieg: tracing initialisieren, AppState laden, Commands registrieren |
| `error.rs` | `AppError` via `thiserror`; serialisiert als Fehlermeldung (String) ans Frontend |
| `models.rs` | Datenmodelle, `serde(rename_all = "camelCase")` – Spiegel in `src/lib/types.ts` |
| `state.rs` | `AppState` (Manager): je ein `JsonStore` für Instanzen und Presets plus storeübergreifende Logik (`resolve_preset`, `apply_preset`, `delete_preset`) |
| `commands.rs` | Dünne Commands: Eingabe prüfen, an `AppState`/Store delegieren, loggen |
| `services/store.rs` | Generischer `JsonStore<T>`: in-memory + atomares Schreiben (tmp + rename) |
| `services/mod.rs` | `Dirs`: Verzeichnislayout (geteilter Cache, Instanz-Verzeichnisse) |
| `services/auth.rs` | `AuthProvider`-Trait, `MicrosoftAuth`-Stub, Offline-Account (UUID nach `OfflinePlayer:<name>`, MD5/v3) |
| `services/mojang.rs` | serde-Formate von piston-meta: Version-Manifest v2, Versions-JSON, Asset-Index |
| `services/rules.rs` | Mojang-`rules` (os/arch/features), Arch-Filter für Natives-Classifier |
| `services/download.rs` | HTTP-Client, SHA-1-geprüfte Downloads mit Retry, 16 parallel (`buffer_unordered`) |
| `services/java.rs` | Mojangs Java-Runtime (`java-runtime/…/all.json`, Komponente aus `javaVersion.component`) |
| `services/install.rs` | Installation in Schritten, `InstallStep`, `InstallProgress`, Event `install-progress` |
| `services/fabric.rs` | Fabric-Meta (`meta.fabricmc.net/v2`): Loader-Versionen, Launcher-Profil (`inheritsFrom` Vanilla), Merge mit der Vanilla-Versions-JSON |
| `services/mods.rs` | Globaler Mod-Cache (`cache/mods/<sha1>.jar`) und Abgleich nach `mods/` der Instanz (Hardlink, Fallback Kopie) |
| `services/launch.rs` | Classpath, JVM-/Game-Args mit `${…}`-Ersetzung, Prozessstart, Log-Streaming |
| `services/gamelog.rs` | log4j-XML auf stdout (Mojangs Logging-Config) → lesbare Zeilen |

### Persistenz

JSON-Dateien im App-Datenverzeichnis (`app.path().app_data_dir()`, unter Windows `%APPDATA%\dev.laux.launcher\`):

- `instances.json`
- `presets.json`

Eine defekte Datei wird beim Start nach `*.json.corrupt` verschoben (nicht überschrieben), der Store startet leer. Schlägt das Schreiben fehl, wird die In-Memory-Änderung zurückgerollt.

### Datenmodell

- **`ModLoader`**: `vanilla | fabric | quilt | forge | neoforge` – Vanilla ist ein normaler Loader-Wert.
- **`Mod`**: `id`, `name`, `version`, `fileName`, `sha1?`, `enabled`, `source`.
- **`ModSource`** (getaggt über `type`): `{type:"local"}` · `{type:"url", url}` · `{type:"modrinth", projectId, versionId}` · `{type:"curseforge", projectId, fileId}`.
- **`Instance.modpack`** (`ModpackOrigin?`): merkt sich, aus welchem Modrinth-/CurseForge-Pack (Projekt + Version/Datei) die Instanz stammt – Grundlage für Pack-Updates.
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
| `instance_install` | `instanceId` | – (Events `install-progress`) |
| `instance_launch` | `instanceId`, `username` (Offline), `javaPath?`, `defaultMemoryMb?` | PID (`number`) |
| `instance_kill` | `instanceId` | – (Event `instance-exit` folgt) |
| `instance_status` | `instanceId` | `{ installed, running }` |
| `loader_versions` | `loader: ModLoader`, `mcVersion` | `{ version, stable }[]`, neueste zuerst; `vanilla` → `[]`, Quilt/Forge/NeoForge → Fehler „nicht implementiert“ |

Events: `install-progress` `{ instanceId, step, done, total }` · `instance-log` `{ instanceId, stream: "stdout"|"stderr", line }` · `instance-exit` `{ instanceId, code: number|null }`. Installation und Start gibt es für `loader = vanilla` und `fabric`.

### Fabric

- `instance_install` lädt bei `fabric` das Profil `versions/loader/<mc>/<loader>/profile/json`. Ist `loaderVersion` leer, nimmt es den neuesten stabilen Loader und **speichert ihn in der Instanz** (die UI sollte die Instanz danach neu laden).
- Fehlende SHA-1 im Profil (Loader, Intermediary) kommen aus den `.sha1`-Dateien des Maven-Repos; das ergänzte Profil liegt unter `versions/fabric-loader-<loader>-<mc>/…json` für den Start ohne Netz.
- Merge: Fabric-Libraries vor den Vanilla-Libraries (gleiche `group:artifact[:classifier]` → Fabric gewinnt), `mainClass` = `net.fabricmc.loader.impl.launch.knot.KnotClient`, Profil-Argumente werden angehängt. ID, Client-JAR, Assets und Java bleiben die der Vanilla-Version.
- Schritte `loader` (Profil) und `mods` (Abgleich `mods/`) kommen zusätzlich als `install-progress`.
- Der Installiert-Marker enthält bei Mod-Loadern MC-Version, Loader und Loader-Version; ein Wechsel gilt als „nicht installiert“.

### Mods

`instances/<id>/minecraft/mods/` ist der Mods-Ordner (Spielverzeichnis, dort sucht Fabric). `mods::sync` legt jede aktivierte Mod mit `sha1` aus `cache/mods/<sha1>.jar` per Hardlink (Fallback Kopie) unter ihrem `fileName` ab und entfernt deaktivierte nur, wenn die Datei dort denselben SHA-1 hat; fremde Dateien bleiben liegen. Fehlt eine Mod im Cache, schlägt die Installation fehl (Downloads über Modrinth folgen).

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

- **auth**: Microsoft-OAuth (Auth-Code + PKCE, **eigene** Azure-App mit Mojang-Freigabe) → Xbox Live → XSTS → Minecraft-Token. Refresh-Tokens gehören in den OS-Keyring (`keyring`-Crate), nie in JSON.
- **Mod-Loader und Mods**: Quilt/Forge/NeoForge, Mods über die Modrinth-API (CurseForge später hinter derselben Schnittstelle).
- **Accounts**: kein Account-Store; `instance_launch` nimmt vorerst den Offline-Namen direkt.

Die Traits nutzen `async fn` in Traits (nicht `dyn`-fähig); wird Laufzeit-Polymorphie nötig, auf Enum-Dispatch oder `async-trait` umstellen.

## Frontend (`src/`)

- `lib/types.ts` – TS-Spiegel der Rust-Modelle
- `lib/api.ts` – `invoke`-Wrapper; außerhalb von Tauri (reiner `pnpm dev` im Browser) Fallback auf Mockdaten aus `lib/mock.ts`
- Hooks auf TanStack Query; Mutations invalidieren die betroffenen Queries
- Zustand-Store für Launcher-Einstellungen (Java, RAM, Pfade) – vorerst nur lokal persistiert, noch ohne Backend
- Mods, Modpacks, News, Account: reine Platzhalterdaten

## Herkunft der Ideen und Lizenz

Architektur und Datenmodell orientieren sich an der Recherche zu NoRiskClient (`docs/research-noriskclient.md`). NoRiskClient steht unter **GPLv3**: übernommen werden nur Ideen und Konzepte, **kein Code**. Protokolle und Formate (Microsoft/Xbox-Auth, piston-meta, Fabric-/Quilt-Meta, Forge-`install_profile.json`, Modrinth, `.mrpack`, CurseForge) werden nach der jeweiligen Primärdokumentation implementiert.

Crates kommen erst mit dem Feature, das sie braucht (z. B. `reqwest`/`tokio` mit dem Downloader, `keyring` mit dem Login) – Kandidaten siehe Recherche, Abschnitt 7.
