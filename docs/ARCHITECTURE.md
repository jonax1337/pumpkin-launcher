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
| Backend state | `src-tauri/src/state.rs` | Persistent stores, running games, operation locks and cancellation |
| Main models | `src-tauri/src/models.rs`, `src-tauri/src/services/shared_types.rs` | Instances, accounts, loaders and content; TypeScript counterpart in `src/lib/types.ts` |
| Frontend startup | `src/main.tsx`, `src/app/` | Router, providers, window shell, shortcuts and appearance |
| Backend gateway | `src/lib/api.ts`, `src/lib/backend.ts`, `src/lib/backend-tauri.ts` | One typed access point; Tauri commands in the app, in-memory demonstration backend only in browser development |
| Data hooks | `src/hooks/` | TanStack Query reads, mutations, invalidation and backend event subscriptions |
| UI state | `src/store/` | Appearance and launcher preferences, running tasks, queued content work and transient dialog/game state |
| Presentation | `src/pages/`, `src/components/`, `src/ui/`, `src/pixel/` | Pages, shared controls and pixel scenes |
| Localisation | `src/i18n/` | German source dictionary and matching English keys; backend coded errors use the same dictionaries |

Commands are thin adapters to domain services. Their exact arguments and return types are defined by `src/lib/backend.ts` and the Rust command modules, and registered in `src-tauri/src/lib.rs`. Domain command files cover instances, accounts, content, packs, worlds, storage, support, skins, screenshots, Friends sessions and Bridge injection. New IPC behavior must update both sides together.

`AppError` serializes a code and message, with translation keys, parameters and details for coded errors. `src/lib/errors.ts` translates those errors; unknown/plugin errors remain readable rather than becoming false successes. Friends state and event payloads do not embed command errors.

## Data and process boundaries

Rust resolves the application data directory with Tauri. Typical paths are `%APPDATA%\dev.laux.launcher` on Windows, `~/.local/share/dev.laux.launcher` on Linux and `~/Library/Application Support/dev.laux.launcher` on macOS.

`src-tauri/src/services/dirs.rs` owns the directory layout:

| Location under application data | Contents |
| --- | --- |
| `versions/<id>/` | Minecraft version JSON and client JAR |
| `libraries/`, `assets/` | Shared libraries and assets |
| `runtime/<component>/` | Shared Java runtimes |
| `runtime/bridge-mod/<modVersion>/` | Materialised, launcher-owned Bridge JARs; never instance content |
| `cache/mods/<sha1>.jar` | Shared content cache |
| `instances/<id>/minecraft/` | Isolated game directory, including mods, worlds and screenshots |
| `instances/<id>/natives/`, `installed` | Native libraries and installed-version marker |
| `instances/<id>/session-logs/`, `backups/` | Saved session logs and world backups outside the game directory |
| `templates/<id>.mrpack`, `skins/<sha1>.png` | Templates and skin library |
| `friends/` | Friends configuration, graph records, requests, blocks and pending delivery records |

`src-tauri/src/services/store.rs` maintains JSON stores in memory and writes atomically through a temporary file and rename. Entry mutations happen under the store lock. Unreadable newer records are preserved instead of discarded during a write.

Refresh tokens and permanent Friends keys belong in the OS keyring, not JSON. Minecraft sessions and directory login tokens are memory-only. Account records retain their OAuth `clientId`, because refresh must use the original app registration. See [Microsoft sign-in for forks](../CONTRIBUTING.md#microsoft-sign-in-for-forks).

Installation, content mutation and launch are serialized by the instance operation lock. Running instances refuse conflicting mutations. Cancellation is propagated through service callbacks; blocking file operations run off the async executor and stop between files.

## Installation and launch

`src-tauri/src/services/install.rs`, `src-tauri/src/services/loader/`, `src-tauri/src/services/java.rs`, `src-tauri/src/services/launch.rs` and `src-tauri/src/services/launch_args.rs` implement installation and startup.

- Loader values are `vanilla`, `fabric`, `quilt`, `forge` and `neoforge`. Fabric/Quilt profiles merge with Vanilla metadata; Forge/NeoForge use the official installer and its processors. Forge starts at 1.16.5 and NeoForge at 1.20.1.
- An omitted loader version resolves to a stable version and is saved on the instance. Installed profiles can launch without refetching their installation metadata.
- Java selection is instance override, launcher preference, then Mojang runtime. Custom paths and JVM/game arguments are validated before launch.
- Installation reports `install-progress`; content work reports `content-progress`. Game output, spawn and exit feed UI state, session logs, crash analysis and Friends lifecycle signals.
- The launch path takes configured world backups, recovers interrupted pack updates, synchronizes managed content, refreshes the account and resolves Java before spawning Minecraft.
- `src-tauri/src/pack_open.rs` receives `.mrpack` files through the command line, single-instance handoff or macOS open events. It publishes `pack-opened`; the UI consumes `pack_open_take` and opens the import dialog.

## Content, packs and recovery

| Services | Contract |
| --- | --- |
| `src-tauri/src/services/mods.rs`, `src-tauri/src/services/content/` | Managed files use SHA-1 cache entries and hardlinks with copy fallback. Synchronization does not overwrite unrelated files; a missing managed cache file is an error. Local content can be identified through Modrinth hashes. |
| `src-tauri/src/services/modrinth.rs`, `src-tauri/src/services/providers/` | Catalogs normalize provider results. CurseForge metadata goes through the key-holding Worker in `proxy/`; allowed downloads come directly from provider CDNs. Technic author downloads require HTTPS and public destinations. |
| `src-tauri/src/services/mrpack.rs`, `src-tauri/src/services/content/pack.rs` | Import validates archive paths, bounds and hashes into a newly created instance. Export links resolvable catalog content and includes other selected content in overrides. `pumpkin.json` preserves valid instance artwork and required-by metadata. |
| `src-tauri/src/services/templates.rs` | Templates snapshot mods, resource/shader packs, config and options, not worlds/logs/screenshots. New instances use the regular pack importer and are independent of the original. |
| `src-tauri/src/services/imports/` | Existing launcher instances are read, never modified in place; unsupported/unreadable entries are reported or skipped. |
| `src-tauri/src/services/duplicate.rs` | Independent instance identity and game directory; regenerated logs/crash reports/Fabric cache are omitted. Managed content is synchronized separately. |
| `src-tauri/src/services/pack_update/` | Staged, transactional file updates with interrupted-operation recovery; local edits and conflicts are not silently lost. |
| `src-tauri/src/services/worlds/`, `src-tauri/src/services/datapacks.rs` | World transfer, backups and automatic backup retention; temporary leftovers are recovered/removed at startup. |
| `src-tauri/src/services/pack_selection.rs` | Resource-pack and Iris selection changes only owned settings lines, preserving other values and line endings. Writes are refused while the game runs. |

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

The Pixelkino kit lives in `src/ui/`; styles are collected centrally rather than imported separately by each component. Scene rendering is in `src/pixel/`; branding chooses seasonal assets and accents. See [Pixelkino](design/PIXELKINO.md) for appearance and interaction rules.

German dictionary keys are the source shape; English must define the same keys. User content such as instance names is not translated. Backend error-key extraction requires literal dictionary strings.

The updater searches for signed release artifacts and waits for consent plus no running game/task before installation. Release packaging and signing belong in [CONTRIBUTING.md](../CONTRIBUTING.md#release-packaging).

## Licensing boundary

NoRiskClient informed architectural concepts, not copied implementation. Its GPLv3 code, assets, credentials and proprietary services are not part of Pumpkin Launcher. Public protocols and formats are implemented from their primary documentation. Register separate OAuth applications and provider credentials for forks rather than borrowing another launcher's keys.
