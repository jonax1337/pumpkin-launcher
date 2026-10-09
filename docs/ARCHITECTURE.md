# Architecture

Last updated: 2026-10-06.

Pumpkin Launcher is a Tauri 2 desktop application. React owns presentation; Rust owns accounts, files, downloads, game processes and Friends networking. This guide maps the implementation and its important boundaries, rather than duplicating every command signature.

```text
React pages -> query hooks -> lib/api.ts -> Backend
                                         | Tauri adapter
                                         v
                                  domain commands -> AppState
                                                       |
                               stores + services + game processes
                                                       |
                           local Pumpkin Bridge <-> Minecraft JVM
                           Friends P2P <-> other launchers
```

## Entry points and ownership

Paths below are relative to the repository root.

| Area | Source | Responsibility |
| --- | --- | --- |
| Desktop startup | `src-tauri/src/lib.rs` | Plugins, capabilities, AppState, command registration, startup recovery and shared Bridge listener |
| Backend state | `src-tauri/src/state.rs`, `src-tauri/src/services/operation_locks.rs` | Persistent stores, running games, per-instance operation locks and cancellation |
| Main models | `src-tauri/src/models.rs`, `src-tauri/src/services/shared_types.rs` | Instances, accounts, loaders and content; TypeScript counterpart in `src/lib/types.ts` |
| Frontend startup | `src/main.tsx`, `src/app/` | Router, providers, window shell, shortcuts, command palette (`src/app/palette/`) and appearance |
| Backend gateway | `src/lib/api.ts`, `src/lib/backend.ts`, `src/lib/backend-tauri.ts` | One typed access point; Tauri commands in the app, in-memory demonstration backend only in browser development |
| Data hooks | `src/hooks/` | TanStack Query reads, mutations, invalidation and backend event subscriptions |
| Links and shortcuts | `src-tauri/src/deep_link.rs`, `src-tauri/src/shortcut_commands.rs`, `src-tauri/src/services/shortcuts.rs`, `src-tauri/src/services/shortcut_key.rs`, `src/hooks/useDeepLinkRequests.ts` | `pumpkin://` links, opt-in `modrinth://`/`curseforge://` links and desktop shortcuts (below) |
| UI state | `src/store/` | Appearance and launcher preferences, running tasks, queued content work and transient dialog/game state |
| Presentation | `src/pages/`, `src/components/`, `src/ui/`, `src/pixel/` | Pages, shared controls and pixel scenes |
| Localisation | `src/i18n/` | German source dictionary and matching English keys; backend coded errors use the same dictionaries |

Commands are thin adapters to domain services. Their exact arguments and return types are defined by `src/lib/backend.ts` and the Rust command modules, and registered in `src-tauri/src/lib.rs`. Domain command files cover instances, accounts, content, packs, worlds, storage, support, skins, screenshots, Friends sessions and Bridge injection. New IPC behavior must update both sides together.

`AppError` serializes a code and message, with translation keys, parameters and details for coded errors. `src/lib/errors.ts` translates those errors; unknown/plugin errors remain readable rather than becoming false successes. Friends state and event payloads do not embed command errors.

## Data and process boundaries

Rust resolves the application data directory with Tauri and keeps the internal identifier `dev.laux.launcher`. On Windows the metadata root is `%APPDATA%\Pumpkin Launcher`; WebView data is under `%LOCALAPPDATA%\Pumpkin Launcher\WebView`, and cache and logs are under `%LOCALAPPDATA%\Pumpkin Launcher`. Until the launcher has migrated an existing library, Windows installs that predate the friendly name still use `%APPDATA%\dev.laux.launcher` as the metadata root. Linux and macOS paths still use the `dev.laux.launcher` identifier: `~/.local/share/dev.laux.launcher` and `~/Library/Application Support/dev.laux.launcher`.

The layout has two roots. The **metadata root** holds shared and launcher-owned data. The **instance root** holds the per-instance directories and is configurable. A fresh Windows install defaults it to `Documents\Pumpkin Launcher\Instances`; an existing library stays where it already is.

`src-tauri/src/services/dirs.rs` owns the directory layout:

| Location under the metadata root | Contents |
| --- | --- |
| `versions/<id>/` | Minecraft version JSON and client JAR |
| `libraries/`, `assets/` | Shared libraries and assets |
| `runtime/<component>/` | Shared Java runtimes |
| `runtime/bridge-mod/<modVersion>/` | Materialised, launcher-owned Bridge JARs; never instance content |
| `cache/mods/<sha1>.jar` | Shared content cache |
| `cache/argfiles/<id>/java.args` | JVM argument file of a game that is starting; lives seconds, swept at startup |
| `templates/<id>.mrpack`, `skins/<sha1>.png` | Templates and skin library |
| `friends/` | Friends configuration, graph records, requests, blocks and pending delivery records |
| `instances-path.txt`, `instances-path-request.txt` | Instance-root handoff files (below) |

| Location under the instance root | Contents |
| --- | --- |
| `<id>/minecraft/` | Isolated game directory, including mods, worlds and screenshots |
| `<id>/natives/`, `installed` | Native libraries and installed-version marker |
| `<id>/session-logs/`, `backups/` | Saved session logs and world backups outside the game directory |

`src-tauri/src/services/storage_location.rs` handles the instance-root handoff. `instances-path.txt` records the current instance root; `instances-path-request.txt` is a request written by the installer. Both live in the metadata directory (the legacy `dev.laux.launcher` directory before the first migration) and contain one absolute path in UTF-16LE with a byte-order mark, followed by CRLF (at most 64 KiB).

Destinations must be absolute drive or UNC share paths. Device paths, localhost aliases, links and junctions are refused, as is anything inside or around the launcher data folder, the program folder or the current library. The destination must be absent or an empty real folder. Relocation is refused while any game runs.

Relocation copies only the top-level folders listed in `instances.json` into a staging folder, verifies them by SHA-1, commits the new path and then removes the old root non-recursively. Unknown entries stay in the old root and produce a "retained" notice. Nothing at the destination is overwritten, and a failure keeps the old root. At startup the marker `instances-staging.txt` and stale `.pumpkin-instances-<uuid>` folders are cleaned up, and a destination that is already a complete copy is adopted.

An installer request is only a hint and never blocks startup. If it cannot be read or applied (garbage, over 64 KiB, occupied or nested folder, missing drive, relocation error), it is renamed to `instances-path-request.txt.rejected` (or deleted), the launcher starts with the current or default library, and a one-time notice is shown. Only a stored current path that has vanished or is unsafe stops startup (fail closed: error dialog, no windows). Settings > Storage changes the folder through the IPC commands `storage_set_instances_dir`, `storage_open_instances_dir` and `storage_open_instance_path`.

`src-tauri/src/services/store.rs` maintains JSON stores in memory and writes atomically through a temporary file and rename. Entry mutations happen under the store lock. Unreadable newer records are preserved instead of discarded during a write.

Refresh tokens and permanent Friends keys belong in the OS keyring, not JSON. Minecraft sessions and directory login tokens are memory-only. Account records retain their OAuth `clientId`, because refresh must use the original app registration. See [Microsoft sign-in for forks](../CONTRIBUTING.md#microsoft-sign-in-for-forks).

Installation, content mutation and launch take a per-instance operation lock (`src-tauri/src/services/operation_locks.rs`): operations on different instances run in parallel, a second operation on the same instance is refused with `errors.operationRunning`, and a running game refuses conflicting mutations of its instance. Operations that create a new instance lock no other instance. Operations that touch every instance or the shared mod cache (moving the instance root, clearing the mod cache, the startup recovery sweeps) take the whole-library lock, which is granted only while no other operation runs and refuses new ones until it ends. Locks never wait; the exception is installation, which writes the shared game files (libraries, assets, versions, Java, loader profiles) one install at a time, so a second install waits for the first. Cancellation is propagated through service callbacks; blocking file operations run off the async executor and stop between files.

## Installation and launch

`src-tauri/src/services/install.rs`, `src-tauri/src/services/loader/`, `src-tauri/src/services/java.rs`, `src-tauri/src/services/launch.rs` and `src-tauri/src/services/launch_args.rs` implement installation and startup.

- Loader values are `vanilla`, `fabric`, `quilt`, `forge` and `neoforge`. Fabric/Quilt profiles merge with Vanilla metadata; Forge/NeoForge use the official installer and its processors. Forge starts at 1.16.5 and NeoForge at 1.20.1.
- An omitted loader version resolves to a stable version and is saved on the instance. Installed profiles can launch without refetching their installation metadata.
- Java selection is instance override, launcher preference, then Mojang runtime. Custom paths and JVM/game arguments are validated before launch.
- Installation reports `install-progress`; content work reports `content-progress`. Game output, spawn and exit feed UI state, session logs, crash analysis and Friends lifecycle signals.
- The launch path takes configured world backups, recovers interrupted pack updates, synchronizes managed content, refreshes the account and resolves Java before spawning Minecraft.
- `src-tauri/src/pack_open.rs` receives `.mrpack` files through the command line, single-instance handoff or macOS open events. It publishes `pack-opened`; the UI consumes `pack_open_take` and opens the import dialog.

### Launch environment, hooks and argument files

`src-tauri/src/services/launch_settings.rs` (data, validation, merge), `launch_command.rs` (command-line parsing and program lookup), `launch_hooks.rs` (the two hooks) and `argfile.rs` implement this part of the launch path.

- `Instance.launch` and the launcher defaults (`LaunchOptions.defaultLaunch`, from the frontend settings store) hold environment variables, a wrapper command and the pre-launch and post-exit commands. Per field, a non-empty instance value wins and an empty one falls back to the launcher default, like the JVM arguments. Both sides are validated when saved and again at launch.
- Commands are parsed into a program and arguments (`"`/`'` group words, backslashes stay literal) and started directly, never through a shell. The program is an absolute file or is looked up on `PATH`, never in the game folder. A wrapper that cannot be found stops the launch with a coded error before the Bridge registers the launch.
- Variable names are `[A-Za-z_][A-Za-z0-9_]*`; names starting with `PUMPKIN_` (any case) are refused because the launcher uses them for the Bridge and for hook context. The variables of the Bridge injection are appended last and win regardless.
- The pre-launch hook runs in `prepare_launch`, before the injection, in the game folder with `PUMPKIN_INSTANCE_ID`, `PUMPKIN_INSTANCE_NAME`, `PUMPKIN_GAME_DIR`, `PUMPKIN_MC_VERSION` and `PUMPKIN_LOADER`. A non-zero exit, a start failure or the 60-second timeout aborts the launch. The post-exit hook is started from `on_game_exit` after `instance-exit` as a background task with the same variables plus `PUMPKIN_EXIT_CODE` (`-1` without a code); it is limited to 60 seconds and failures are only logged.
- Hooks and wrappers run programs with the user's rights, so only the user's own settings may set them. Pack, template and launcher imports build instances from `Instance::from_new` and carry no launch settings; only duplicating an instance copies them.
- With Java 9 or newer, `launch::spawn` passes the JVM a single `@file` argument (`wrapper args... java @file`). The file holds every argument in the JDK argument-file syntax (arguments with whitespace, quotes, `#` or backslashes are double-quoted, `\` and `"` escaped) and sits in its own folder under `cache/argfiles/` (`0700`/`0600` on Unix; the profile's access rules on Windows). It is deleted five seconds after the process started (20 seconds with a wrapper), when the launch fails, and any leftovers are swept at startup. The Java major comes from the cached `JavaMajors` probe; Java 8, an unknown version and, on Windows, non-ASCII arguments or folders (the JVM reads the file in the system code page) use plain arguments.

## Links and shortcuts

`pumpkin://` is registered by the installer and bundles (`plugins.deep-link` in `tauri.conf.json`); Linux AppImages register it for the user at startup. A link reaches `deep_link.rs` as a command-line argument (first start, single-instance handoff on Windows and Linux) or a macOS open event, is parsed once into a typed `DeepLink`, buffered (at most 8) until the UI calls `deep_link_take`, and announced by `deep-link-opened`. Grammar:

| Link | Effect |
| --- | --- |
| `pumpkin://launch/<id>[?world=<folder>\|?server=<host[:port]>][&s=<token>]` | Asks "Start <name>?" and then starts the instance, optionally with Quick Play; a valid `s` token skips the question |
| `pumpkin://open/<id>` | Opens the instance page |
| `pumpkin://install/modrinth/<mod\|modpack\|shader\|resourcepack\|datapack>/<slug-or-id>` | Opens the Modrinth project in Discover; the UI asks the project for its real type |
| `modrinth://<type>/<slug-or-id>`, `curseforge://install?addonId=<n>[&fileId=<n>]` | Same flow; only after the user switched on Settings > Java & launch > "Open Modrinth and CurseForge links in Pumpkin". CurseForge links open the project page (no file is preselected) |

Links are untrusted input from any web page. The parser accepts only URL characters (no quotes, spaces or backslashes that could leave the command line), at most 1024 bytes, ids of `[A-Za-z0-9_-]` up to 64 characters, and decodes percent escapes exactly once before re-validating the result; duplicate query keys, unknown hosts or paths and a `world` together with `server` are rejected with a log line that never contains the link. Nothing here starts a game or installs content by itself: install links only navigate, and a launch link needs the confirmation dialog unless it is trusted.

The trust token is `HMAC-SHA256(secret, instance id)` in hex, where the secret is 32 random bytes in `shortcut-secret.txt` in the metadata directory (created on first use, user-only permissions on Unix). `ShortcutKey::accepts` verifies it in constant time inside the backend; the token never reaches the UI, only `trusted`. A token is valid for one instance on one installation, and a link with a Quick Play target is never trusted. If the secret file is replaced or damaged, a new one is created and old shortcuts ask before starting.

`instance_create_shortcut` writes a file that contains only the token link (plus the instance's icon, or the launcher's where the system cannot use it) to the Desktop: `.url` on Windows, `.desktop` (`Exec=xdg-open "<link>"`, mode 0755, plus a copy in `~/.local/share/applications`) on Linux and `.webloc` on macOS. An existing file is never overwritten; the new one gets ` (2)`, ` (3)` and so on.

The icon is painted by the UI (`src/lib/shortcutIcon.ts`, the same choice as `InstanceIcon`: own image, modpack icon, pixel icon) into a 256 px PNG and passed to the command. `services/shortcut_icon.rs` checks it (PNG signature, square, 16–256 px, at most 1 MiB) and stores it as `shortcut-icons/<instance id>.ico` (a PNG inside an ICO container) or `.png`; the shortcut points there. The UI cannot read foreign images itself (CSP allows display only), so `instance_pack_icon` has the backend fetch the modpack icon (Modrinth, CurseForge, FTB, Technic) through `services/remote_icon.rs` (`providers::net::download_public`: HTTPS, public hosts, 1 MiB, 15 s) and return it as a `data:` URL. An icon that is missing or unusable never stops the shortcut: it falls back to the launcher's icon. The CurseForge App import uses the same fetcher for the address in `installedModpack.thumbnailUrl`, restricted to `forgecdn.net` because the address comes from a foreign file.

`modrinth://` and `curseforge://` belong to other programs, so the launcher never registers them on its own. `deep_link_set_foreign` registers or releases them at runtime through the deep-link plugin (Windows and Linux; macOS fixes schemes in the bundle, so the switch is hidden through `Capabilities.foreignSchemes`). `deep_link_foreign_enabled` asks the system instead of a stored setting, and releasing only removes registrations that point at this launcher.

## Content, packs and recovery

| Services | Contract |
| --- | --- |
| `src-tauri/src/services/mods.rs`, `src-tauri/src/services/content/` | Managed files use SHA-1 cache entries and hardlinks with copy fallback. Synchronization does not overwrite unrelated files; a missing managed cache file is an error. Local content can be identified through Modrinth hashes. |
| `src-tauri/src/services/modrinth.rs`, `src-tauri/src/services/providers/` | Catalogs normalize provider results. CurseForge metadata goes through the key-holding Worker in `proxy/`; downloads come directly from provider CDNs. When the CurseForge API names no `downloadUrl` for a file, the launcher builds the CDN path `mediafilez.forgecdn.net/files/<id/1000>/<id%1000>/<file name>` itself (`CfFile::cdn_url`); a pack plan probes it and lists a file as `Blocked` (manual download) only if the CDN refuses it. Every file is still checked against its SHA-1. Technic author downloads require HTTPS and public destinations. |
| `src-tauri/src/services/mrpack.rs`, `src-tauri/src/services/content/pack.rs` | Import validates archive paths, bounds and hashes into a newly created instance. Export links resolvable catalog content and includes other selected content in overrides. `pumpkin.json` preserves valid instance artwork and required-by metadata. |
| `src-tauri/src/services/templates.rs` | Templates snapshot mods, resource/shader packs, config and options, not worlds/logs/screenshots. New instances use the regular pack importer and are independent of the original. |
| `src-tauri/src/services/imports/` | Existing launcher instances are read, never modified in place; unsupported/unreadable entries are reported or skipped. |
| `src-tauri/src/services/duplicate.rs` | Independent instance identity and game directory; regenerated logs/crash reports/Fabric cache are omitted. Managed content is synchronized separately. |
| `src-tauri/src/services/pack_update/` | Staged, transactional file updates with interrupted-operation recovery; local edits and conflicts are not silently lost. |
| `src-tauri/src/services/worlds/`, `src-tauri/src/services/datapacks.rs` | World transfer, backups and automatic backup retention; temporary leftovers are recovered/removed at startup. |
| `src-tauri/src/services/pack_selection.rs` | Resource-pack and Iris selection changes only owned settings lines, preserving other values and line endings. Writes are refused while the game runs. |
| `src-tauri/src/services/crashdiagnosis/`, `src-tauri/src/crash_commands.rs` | Crash assistant behind `crash_diagnose`: reads the newest crash report of the last launch, else the newest session log of it (head or tail only, capped at 2 MiB), and applies plain-text rules, one file each, listed in one table. A finding carries a stable `id`, severity, short evidence lines and typed fix actions (raise memory, drop the custom Java path, search a dependency, switch a mod off, open a help page, repair); the backend only suggests, the UI runs them through the existing instance, mods and install commands. Suspect mods from `crashreport` are the fallback when no rule matches. |
| `src-tauri/src/services/mod_profiles.rs`, `src-tauri/src/profile_commands.rs` | Named on/off snapshots of an instance's mods and shaders. Applying goes through `mods::sync_commit` like a manual switch (files and `instances.json` together, one write), touches only `enabled` of content the profile knows, and is refused while the game runs. Profiles stay with the instance: duplicates keep them, exports and templates omit them, a game or loader change drops them. |

`src-tauri/src/services/transport.rs`, `src-tauri/src/services/download.rs`, `src-tauri/src/services/providers/net.rs`, `src-tauri/src/services/content/fs_safety.rs` and `src-tauri/src/services/zip_guard.rs` are security boundaries: destination/redirect restrictions, capped streaming, checksum verification, archive limits, traversal/symlink prevention and rollback. `src-tauri/src/services/limits.rs` centralizes their limits. Do not bypass these helpers for a new provider.

The renderer sanitizes catalog Markdown with DOMPurify. Description links use HTTP(S); untrusted image hosts require a user click. File access and filesystem mutations remain behind Rust commands and Tauri capabilities.

## Friends and Pumpkin Bridge

These are separate layers:

- `src-tauri/src/services/p2p/` is a Minecraft-independent iroh transport with compiled relay selection, framing, admission and stream tunneling.
- `src-tauri/src/services/friends/` owns identity, codes, by-name requests, presence, invites, manifest matching and host/join sessions. Friends is off by default and requires a Microsoft account and consent.
- `src-tauri/src/services/modbridge/` owns the shared process-bound loopback connection, protocol, scopes and queues. Its `ingame/` subdirectory owns the embedded index, injection, materialisation and startup circuit breaker.
- `mod/` is the client-only Launcher–Minecraft integration, `pumpkin_bridge`. Its shared transport, protocol and UI home do not depend on Friends opt-in. Friends is the only currently implemented feature module, under `mod/core/src/main/java/dev/laux/pumpkin/bridge/modules/friends/` and `mod/src/main/java/dev/laux/pumpkin/bridge/modules/friends/`, not the owner of the connection or menu shell.

The Bridge listener can run before Friends is enabled. It exposes no private Friends data or actions then. Disable/reset/identity changes revoke feature grants and private queued work, not the shared listener or launch token. Other mods in the same JVM can access the channel; process ownership and consent are not a malware sandbox.

Exact contracts: [Friends specification](friends/SPEC.md), [Pumpkin Bridge integration, injection and protocol](bridge/README.md), [Minecraft API reference](bridge/MINECRAFT-API.md). Operational boundaries: [privacy](friends/PRIVACY.md), [relay runbook](friends/RELAY-OPS.md), [directory deployment](../directory/README.md), [mod build and support registry](../mod/README.md).

## Frontend conventions

Pages call the typed backend through query hooks, not ad hoc network or filesystem APIs. Mutations invalidate affected query keys; event subscriptions update running-game/task state. Browser mocks are demonstrations, not evidence that desktop operations succeeded.

The Pixelkino kit (Inventar style: slots, stone plates, creative tabs, tooltip-style menus, 8×8 icon set) lives in `src/ui/` (look in CSS: `look.css`, `look/*.css`; layout as Tailwind utilities in the components; see `src/ui/README.md`); styles are collected centrally (`src/index.css`, `src/ui/ui.css`) rather than imported separately by each component. Global tokens and the app shell are in `src/styles/` (`base.css`, `shell.css`), page styles sit next to their pages. Scene rendering is in `src/pixel/`; branding chooses seasonal assets and accents. See [Pixelkino](design/PIXELKINO.md) for appearance and interaction rules.

German dictionary keys are the source shape; English must define the same keys. User content such as instance names is not translated. Backend error-key extraction requires literal dictionary strings.

The updater searches for signed release artifacts and waits for consent plus no running game/task before installation. Release packaging and signing belong in [CONTRIBUTING.md](../CONTRIBUTING.md#release-packaging).

## Licensing boundary

NoRiskClient informed architectural concepts, not copied implementation. Its GPLv3 code, assets, credentials and proprietary services are not part of Pumpkin Launcher. Public protocols and formats are implemented from their primary documentation. Register separate OAuth applications and provider credentials for forks rather than borrowing another launcher's keys.
