Pumpkin Launcher 0.2.0 – Friends, now in your game

The biggest update since the first release: Pumpkin Friends. Keep in touch with your friends while you play — in the launcher and, for the first time, inside Minecraft itself. The in-game menu is not a mod you install: the launcher builds its own small client mod into every launch it can serve. Nothing appears in your `mods/` folder, nothing shows up in exports, and instances the launcher cannot serve simply work as before.

- **An in-game friends menu.** A "Pumpkin Friends" button in the pause menu opens the hub: friends with presence, requests (accept/decline), invites (view/decline/join), "share my world", and adding a friend by Minecraft name. Toasts announce requests, invites and joins.
- **Zero-touch, by design.** No install step, no update step, no Modrinth project: the mod is embedded in the launcher binary and injected through official loader start-up options. The mod version always equals the launcher version.
- **The launcher stays in charge.** The mod has no network code except a loopback connection to the launcher, and the launcher verifies it is the exact game process it started. In-game actions that touch your friend list or share a world ask for consent in the launcher once per game session (pre-grantable with a setting), and everything the game did shows up in the launcher's activity list.
- **Share and join.** Open your singleplayer world to selected friends and join a friend's world from inside the game or the launcher — through a direct peer-to-peer connection when possible, otherwise encrypted over a relay.
- **Safe by construction.** If the mod ever breaks a game start, the launcher detects it, tells you and starts the next launch without it. A cell of the support matrix ships only after an automated smoke test launched that exact game version through the launcher's real injection path.

## Supported games

The in-game menu is available for these Minecraft versions and loaders (each cell smoke-tested through the real launch path; more versions arrive as their cells pass the same test):

| Minecraft | Loader | Loader from | Java | In-game menu |
|---|---|---|---|---|
| 26.3 | Fabric | 0.19.5 | 25 | yes |
| 26.2 | NeoForge | 26.2.0.57 | 25 | yes |
| 1.21.11 | Fabric | 0.17.3 | 21 | yes |
| 1.21.8 | Fabric | 0.16.13 | 21 | yes |
| 1.21.1 | Fabric | 0.15.11 | 21 | yes |
| 1.21.1 | NeoForge | 21.1.0 | 21 | yes |
| 1.20.1 | Forge | 47.4.0 | 17 | yes |

Vanilla instances (no loader), Quilt, offline accounts and other Minecraft versions launch exactly as before; the instance page says what a launch would need.

## Known limits

- **Friend management stays in the launcher for now.** Renaming, removing and blocking friends and managing friend codes in-game, a hotkey and a title-screen button are planned for the next release. Identity and privacy settings (enable/disable Friends, findability, relay consent) remain launcher-only on purpose.
- **The smoke test that gates each cell ran on Windows.** The same smoke test as a nightly CI job is new in this release and has not been proven on a GitHub runner yet.
- **CJK characters in the launcher's data folder** (driven by your Windows user name) can keep Minecraft from starting while the in-game menu is enabled. This is known and unresolved; umlauts and spaces are fine. If it happens to you, switch "Freunde-Menü im Spiel" off for that instance and report it.
- NeoForge 26.2 uses a loader development channel for injection (`-Dfml.modFolders`) because the FML era has no supported production equivalent; the cell is smoke-tested and switches itself off if a start ever fails because of it.

## Upgrading

0.2.0 follows 0.1.0 — the 2.x version numbers that briefly appeared in development builds were never published. Friends is a brand-new feature: switch it on once in the launcher and nothing about your instances changes. The signed auto-updater installs 0.2.0 as usual, never while the game or a task is running.

| Platform | File |
|---|---|
| Windows 10/11 (x64) | `Pumpkin.Launcher_x64-setup.exe` |
| Linux (x64) | `Pumpkin.Launcher_amd64.AppImage` or `Pumpkin.Launcher_amd64.deb` |
| macOS (Apple Silicon and Intel) | `Pumpkin.Launcher_universal.dmg` |

Verify your download with `SHA256SUMS` (`sha256sum -c SHA256SUMS`, on Windows `Get-FileHash <file>`) or with the build provenance attestation: `gh attestation verify <file> --repo jonax1337/pumpkin-launcher`.

Pumpkin Friends is not part of Minecraft. NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
