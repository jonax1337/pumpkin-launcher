<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/pumpkin-launcher/wordmark/light.svg">
    <img src="branding/pumpkin-launcher/wordmark/dark.svg" alt="Pumpkin Launcher" width="420">
  </picture>
</p>

<p align="center">
  A desktop launcher for <strong>Minecraft: Java Edition</strong>.<br>
  Keep your worlds, mods and modpacks together in a pixel-art interface.
</p>

<p align="center">
  <a href="https://github.com/jonax1337/pumpkin-launcher/releases">Download Pumpkin Launcher</a>
  · <a href="LICENSE">Apache-2.0</a>
</p>

<p align="center">
  <img src="website/assets/launcher-home.png" alt="Pumpkin Launcher home screen with seasonal buddy mascot" width="820">
</p>

## Download and install

Download the latest published app for your computer:

| Platform | Download | Install |
|---|---|---|
| Windows 10/11 (x64) | [Windows installer](https://github.com/jonax1337/pumpkin-launcher/releases/latest/download/Pumpkin.Launcher_x64-setup.exe) | Open the `.exe` and follow the installer. It installs for your Windows user. |
| Linux (x64) | [AppImage](https://github.com/jonax1337/pumpkin-launcher/releases/latest/download/Pumpkin.Launcher_amd64.AppImage) or [Debian/Ubuntu package](https://github.com/jonax1337/pumpkin-launcher/releases/latest/download/Pumpkin.Launcher_amd64.deb) | For AppImage, allow the file to run as a program in its file properties, then open it. For `.deb`, open it with your distribution's package installer. |
| macOS (Apple Silicon or Intel) | [Universal disk image](https://github.com/jonax1337/pumpkin-launcher/releases/latest/download/Pumpkin.Launcher_universal.dmg) | Open the `.dmg`, move Pumpkin Launcher to Applications, then open the app. |

If you use the [release page](https://github.com/jonax1337/pumpkin-launcher/releases/latest), expand **Assets** and choose one of these app packages. **Source code (zip)** and **Source code (tar.gz)** are for building the app, not installing it.

- **Windows:** needs [Microsoft WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section). The installer is not code-signed, so SmartScreen may warn. Only continue if you trust the download from this repository.
- **Linux:** needs WebKitGTK 4.1 to display the app and a Secret Service keyring (GNOME Keyring or KWallet) for Microsoft sign-in. On Debian/Ubuntu, prefer the `.deb` and your package installer, which can report missing system libraries. AppImage startup errors may need your distribution's WebKitGTK 4.1 runtime package; sign-in storage errors need an available, unlocked keyring. Package names differ between distributions. [Tauri's distribution-specific guidance](https://v2.tauri.app/start/prerequisites/#linux) also lists build tools: you do not need Rust, Node.js, compilers or development headers just to run a release. If startup or sign-in still fails, use the [browser help route](#help-and-privacy) below.
- **macOS:** the app is ad hoc signed, not notarized. If opening is blocked, follow [Apple's app approval guidance](https://support.apple.com/en-us/102445) only if you trust the download. Minecraft through 1.18.2 needs Rosetta 2 on Apple Silicon.

Pumpkin is still in beta. Linux and macOS packages have not yet been tried on real machines, so expect rough edges there.
Friends is experimental; playing together across different networks is not yet established as reliable.

## First steps

For a first game without mods:

1. Open Pumpkin and choose **Sign in with Microsoft**. Use an account that owns **Minecraft: Java Edition**; Bedrock alone is not enough. Complete sign-in in your browser, or choose **Use a code instead**.
2. At **How do you want to start?**, choose **Plain Minecraft**, then **Create and play**. This creates a setup for the latest Minecraft release and starts it after downloading the required files.
3. Next time, select that setup in your library and press **Play**.

An **instance** is a separate Minecraft setup with its own worlds, mods and settings. Pumpkin downloads Minecraft and the matching Java runtime automatically. You do not need to install Java or Minecraft separately.

If you already passed onboarding, open **Library > New instance > Custom instance**, set **Loader** to **Vanilla**, then choose **Create** and **Play**. This tab defaults to Fabric, so choose Vanilla explicitly for a game without mods. You can keep the suggested name and Minecraft version.

The exception: if your account has no Minecraft profile yet, open the official Minecraft Launcher once and choose a player name, then return to Pumpkin. The normal release requires a signed-in Microsoft Minecraft account before offline player names are available.

Already know what you want? Choose **Browse modpacks** for a ready-made collection of mods, **Open file** for a `.mrpack`, or **Import** to bring setups from another launcher. You can also import CurseForge `.zip` packs. A **loader** (such as Fabric or Forge) is the software that lets compatible mods run; a modpack normally chooses its loader and Minecraft version for you.

For later imports, use **Library > New instance > File** for `.mrpack` or CurseForge `.zip` packs, or **Another launcher** to copy an existing setup.

## Make it your own

- **Separate game setups:** Vanilla, Fabric, Forge, NeoForge and Quilt, with per-instance memory, Java, launch settings, icons and notes. Search and organize your library into groups.
- **Mods and modpacks:** browse Modrinth content and CurseForge, FTB and Technic modpacks. Add your own mods, resource packs and shaders, choose active packs, and manage content updates.
- **Keep your saves:** back up and restore worlds, enable automatic backups, manage world datapacks and servers, or jump straight into a world on Minecraft 1.20+. Pack updates preserve worlds and your own changes.
- **Move and share:** import from Prism Launcher/MultiMC, Modrinth App, CurseForge App or ATLauncher without changing the source. Duplicate instances, export `.mrpack` files and reuse setups as templates.
- **Skins and screenshots:** manage skins and capes, preview them in 3D, and browse each instance's screenshots.
- **Comfort settings:** German and English, adjustable text size, reduced motion, keyboard shortcuts (`?` shows them), page-specific right-click menus and optional Discord Rich Presence, off by default.
- **Friends:** opt in to friend requests, online status and sharing worlds. Friends networking and actions need consent. See [Friends](docs/friends/README.md) for availability and limits.
- **Updates and troubleshooting:** available launcher updates stay visible in the title bar and signed updates install only when you choose, not while a game or task is running. Instance logs and crash hints help when a game fails to start.

To preserve or move saves:

- **Back up or restore a world:** open the instance's **Worlds** tab, then the world's **… > Back up** or **Backups… > Restore**. Restore creates a new world instead of overwriting an existing one.
- **Export a setup with saves:** use the instance's **… > Export…** and choose what to include in the `.mrpack`. **Worlds (`saves`)** is optional and not selected by default. This is not a full instance backup; historical world backups are excluded.
- **Before deleting an instance:** deletion also deletes its backups. If it has any, choose **Export backups first** in the deletion dialog before confirming.

## Pumpkin Bridge

**0.3.0** introduces [Pumpkin Bridge](docs/bridge/README.md), the bundled client-only integration between the launcher and Minecraft. In supported modded Microsoft-account launches, a Pumpkin button opens a menu of in-game features; no manual JAR installation is needed. The shared connection and menu work independently of Friends opt-in. Friends is its first implemented feature, with private data and actions withheld until consent.

This guide describes **0.3.1**. Download links above follow the latest published release and become available for a version only after its installer pipeline succeeds and the release is published. See the [Changelog](CHANGELOG.md) for version-specific changes and historical limits.

## Help and privacy

Open **Settings > Support**. Choose **Report a bug** for a GitHub issue or **Open discussions** for questions and ideas. **Copy debug info** copies launcher version, system and instance details for your report without account names or file paths. Include what you tried and the exact error.

If Pumpkin will not open, use [Discussions in your browser](https://github.com/jonax1337/pumpkin-launcher/discussions); you do not need the app to ask for help. For Linux startup or sign-in failures, include your distribution and version, the package used (`.deb` or AppImage) and the exact error. Use **Settings > Support** only if the app opens.

For a game crash, open **Library > your instance > Log > Share log > Upload** after reading the notice. This uploads the cleaned last-start log or crash report to mclo.gs and copies its link. Anyone with the link can read it; your player name remains visible. Review the log before sharing. **Copy debug info** in the log also includes that instance's mod list. For the historical **0.2.0** in-game Friends startup problem, see the [release-specific workaround](CHANGELOG.md#known-limits); it does not establish a fix in 0.3.0.
Report security problems privately as described in [SECURITY.md](.github/SECURITY.md).

Pumpkin has no trackers or telemetry. **Settings > About > Privacy** explains which services each feature contacts.
Microsoft refresh tokens (credentials that keep you signed in) stay in the operating system's secure password storage: Windows Credential Manager, macOS Keychain or a Linux keyring. While Minecraft runs, local programs that can inspect its command line may see its access token, a short-lived game sign-in credential.
Mods and modpacks are not scanned for malware: install content only from authors you trust.

Friends uses encrypted connections, but direct peers can see your IP addresses.
Turn on **Settings > Friends > Always connect through a relay** to hide them from peers; the relay operator still sees connection metadata, such as your IP address, which endpoints connect and when.
Read [Friends privacy](docs/friends/PRIVACY.md#your-choices-at-a-glance) before enabling it.

## Contributing and license

Development setup and commands are in [CONTRIBUTING.md](CONTRIBUTING.md).
Pumpkin Launcher is released under the [Apache License 2.0](LICENSE).

Pumpkin Launcher is not affiliated with, endorsed by, or associated with Mojang, Microsoft, or Modrinth.
"Minecraft" is a trademark of Mojang Synergies AB.

Last updated: 2026-10-06.
