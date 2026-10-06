# Changelog

Last updated: 2026-10-06.

For installation and a first game, start with the [launcher guide](README.md#download-and-install).

## 0.3.0 — 2026-10-06

### Pumpkin Bridge

- The in-game Pumpkin button now opens a module home, with Friends as its first
  module, rather than opening the Friends-only menu directly.
- The shared Pumpkin Bridge connection and menu can work while Friends is off;
  private Friends data and actions still require opt-in.
- Redesigned the in-game Friends interface with player heads and Pumpkin UI.
- Updated Friends to use Minecraft names; name requests still need a configured
  directory and a recipient who allows them.
- Made the shared production core compatible with Java 8.
- Expanded the build registry to 102 exact Fabric, Quilt, Forge and NeoForge
  targets across 27 selected Minecraft releases, including 1.16.5. The validated
  package is embedded in the launcher; automatic injection requires recorded
  startup evidence. Registration and startup do not prove every runtime flow.

### Minecraft and world sharing

- Lowered the Friends hosting and joining floor to Minecraft 1.16.5; guests still
  need the host's exact game release, loader and required mods.
- Added Forge installation and launch support from Minecraft 1.16.5, including
  legacy runtime libraries, and patched legacy game logging to Log4j 2.17.1.

### Fixes

- Made an already requested cancellation win over a ready operation before it
  commits an instance, preventing cancelled duplication from leaving a copy.
- Aligned release tests with the Java 17 minimum for JUnit on Java 8 game targets.
- Fixed the bare-Node Mojang key check and mod-packaging jobs so they do not
  require an uninstalled pnpm cache integration.
- Preserved the development launch classpath for Java 8 Fabric targets.
- Added a real software Vulkan driver for headless Minecraft 26.3 CI rendering.
- Kept Minecraft profile requests explicitly HTTPS and removed sensitive values
  from failed-test diagnostics.

### Current limits

Friends remains experimental. Authenticated sharing and joining with two accounts
across different networks and equivalent non-Windows runtime behavior are not yet
established. Bridge startup evidence does not prove those flows or rendered menus.
The per-instance Bridge controls remain hidden while Friends is off; the global
Bridge switch is independent of Friends consent. The historical CJK-path warning
below does not establish that 0.3.0 fixes that problem.

### Documentation

- Added clearer download, installation, first-game and Friends instructions.
- Separated the general Bridge documentation from Friends and consolidated
  developer setup and release packaging in `CONTRIBUTING.md`.
- Corrected the privacy reference to disclose sender display names stored with
  directory requests.

## 0.2.0 — 2026-10-05

### Friends

- Introduced opt-in friend requests, presence, invitations and world sharing in
  the launcher, including friend requests by Minecraft name.
- Added the in-game Pumpkin Friends hub: friends, requests, invitations,
  sharing controls and notifications.
- Bundled and automatically added the in-game integration to supported Fabric,
  NeoForge and Forge launches without changing the instance's `mods` folder or exports.
- Kept consent, process validation and encrypted direct/relay connections under
  launcher control. Added startup-failure detection that disables the in-game
  integration for the next launch when it prevents the game from starting.
- Added stable installer filenames for website downloads.

### Known limits

The original release's known limits included Windows-only runtime evidence,
unsupported game/loader combinations and startup problems with Chinese, Japanese
or Korean characters (CJK) in the launcher's data-folder path. These describe **0.2.0**,
not the current supported Minecraft versions and loaders for Bridge.

**0.2.0 workaround:** if a CJK folder path prevents Minecraft from starting with
the in-game Friends menu, open the affected instance's **Worlds** tab, open
**Friends menu in the game**, switch off **Friends menu in the game for this instance**,
then retry the launch. That instance control is shown while Friends is enabled.
Alternatively, switch off the menu globally at **Settings > Friends > Friends menu in the game**.
Report the error through [Help and privacy](README.md#help-and-privacy).
See the original [0.2.0 Known limits](https://github.com/jonax1337/pumpkin-launcher/releases/tag/v0.2.0#known-limits).
This is not a claim that 0.3.0 fixes the path problem.

## 0.1.0 — 2026-10-03

First public beta for Windows, Linux and macOS.

- Microsoft sign-in and separate Vanilla, Fabric, Forge, NeoForge and Quilt instances.
- Mods and modpacks from Modrinth, CurseForge, FTB and Technic, with content updates
  and modpack version switching that preserve worlds and local changes.
- Instance duplication, `.mrpack` export, `.mrpack`/CurseForge ZIP import and import
  from Prism/MultiMC, Modrinth App, CurseForge App and ATLauncher.
- Worlds, backups, restore, servers, Quick Play (launch directly into a world or server)
  and per-world datapacks (files that change a world's gameplay without a mod loader).
- Skins and capes with 3D previews; skin import from files or player names.
- Screenshot browser, session logs, crash hints and redacted log sharing through mclo.gs.
- Signed automatic updates, installed with consent and deferred while games or tasks run.
- German and English, keyboard shortcuts, adjustable text size and reduced motion.

The first beta was exercised primarily on Windows; Linux and macOS packages
were not yet verified on real machines. Installers were not OS code-signed.

Historical entries summarize the annotated [0.1.0](https://github.com/jonax1337/pumpkin-launcher/releases/tag/v0.1.0)
and [0.2.0](https://github.com/jonax1337/pumpkin-launcher/releases/tag/v0.2.0)
release notes.
