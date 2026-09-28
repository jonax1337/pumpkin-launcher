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
| `services/auth.rs` | `AuthProvider`-Trait, `MicrosoftAuth`-Stub, Offline-Account |
| `services/download.rs` | `Downloader`-Trait (Stub), `InstallStep`, `InstallProgress`, Event `install-progress` |
| `services/launch.rs` | `Launcher`-Trait, Stub |

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

### Presets

Ein Preset bündelt Mods, Spieleinstellungen (`options.txt`-Schlüssel), JVM-Args und RAM und kann über `inheritsFrom` von **einem** anderen Preset erben. `Preset::resolve` faltet die Kette von der Wurzel zum Kind:

- Mods: geerbte plus eigene; gleiche ID → das Kind gewinnt; `excludeMods` entfernt geerbte Mods.
- `gameSettings`: zusammengeführt, Kind überschreibt.
- JVM-Args und RAM: die des Kindes, sonst geerbt.
- Zyklen und fehlende Eltern sind Fehler; `create_preset`/`update_preset` prüfen das vorab, `delete_preset` verweigert das Löschen, solange ein anderes Preset davon erbt.

`apply_preset` wendet das aufgelöste Preset an: ergänzt fehlende Mods (per ID), ersetzt JVM-Args, übernimmt RAM (falls gesetzt) und merkt sich `presetId`. `gameSettings` werden erst mit der Launch-Logik in `options.txt` geschrieben.

### Installation und Mod-Cache (geplant, Vertrag steht)

- Installation läuft in benannten Schritten (`InstallStep`: `java → client → libraries → natives → assets → loader → mods`). Jeder Fortschritt geht als Tauri-Event `install-progress` mit `{ instanceId, step, done, total }` ans Frontend.
- Mod-JARs liegen einmalig in einem globalen, per SHA-1 adressierten Cache (`<app_data>/cache/mods/<sha1>.jar`). Fabric bindet sie per `-Dfabric.addMods=@<datei>` ein, die übrigen Loader per Hardlink (Fallback Kopie) nach `mods/`.

### Noch nicht implementiert (Stubs)

- **auth**: Microsoft-OAuth (Auth-Code + PKCE, **eigene** Azure-App mit Mojang-Freigabe) → Xbox Live → XSTS → Minecraft-Token. Refresh-Tokens gehören in den OS-Keyring (`keyring`-Crate), nie in JSON.
- **download**: Mojang-Version-Manifest, Java (Temurin), Libraries, Natives, Assets, Loader, Mods über die Modrinth-API (CurseForge später hinter derselben Schnittstelle).
- **launch**: Classpath/Argumente bauen, Java-Prozess starten, Logs streamen.

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
