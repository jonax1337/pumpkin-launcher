<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/pumpkin-launcher/wordmark/light.svg">
    <img src="branding/pumpkin-launcher/wordmark/dark.svg" alt="Pumpkin Launcher" width="420">
  </picture>
</p>

<h3 align="center">Every world, one click.</h3>

<p align="center">
  A desktop launcher for <strong>Minecraft: Java Edition</strong> — instances, mods, modpacks and templates,<br>
  wrapped in a hand-crafted pixel-art UI. Built with Tauri&nbsp;2 (Rust) and React&nbsp;+&nbsp;TypeScript.
</p>

<p align="center">
  <a href="https://github.com/jonax1337/pumpkin-launcher/actions/workflows/ci.yml"><img src="https://github.com/jonax1337/pumpkin-launcher/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-orange.svg" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/Tauri-2-blue.svg" alt="Tauri 2">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-blueviolet.svg" alt="Platform: Windows | Linux | macOS">
</p>

<p align="center">
  <img src="website/assets/launcher-home.png" alt="Pumpkin Launcher home screen with seasonal buddy mascot" width="820">
</p>

## Features

- **Instances** — create, configure and launch isolated game instances for Vanilla, **Fabric, Forge, NeoForge and Quilt**
- **Per-instance launch settings** — own Java, window size or fullscreen, extra game arguments; total playtime per instance
- **Library groups** — sort instances into collapsible groups right from the instance menu
- **Mods & modpacks** — browse, search and install from [Modrinth](https://modrinth.com), plus CurseForge, FTB and Technic modpacks, directly in the launcher; update installed mods on request
- **`.mrpack` import** — drag in local modpack files
- **Your own files** — drop `.jar` mods, resource packs and shader packs onto an instance; files Modrinth knows (by SHA-1) still get updates
- **Switch in one click** — import instances from Prism Launcher / MultiMC, Modrinth App, CurseForge App and ATLauncher with worlds, mods and settings; the other launcher stays untouched
- **Screenshots** — browse every instance's F2 screenshots by day, flip through them full size, open them in your image viewer, show them in your file manager or move them to the trash
- **Duplicate & export** — copy an instance to experiment safely, or share it as a `.mrpack` (Modrinth mods linked, everything else embedded; worlds optional, no size limit); both run in the task menu and can be cancelled
- **Worlds & servers** — see an instance's worlds and server list, back up and restore worlds (deleting backs up first), edit servers and jump straight into a world (Minecraft 1.20+) or onto a server with Quick Play; the home screen offers to continue where you last went
- **Datapacks per world** — add `.zip` datapacks to a world by drag & drop, or install them from Modrinth (in the world's panel or in Discover, picking instance and world); see which ones the game has enabled, move unwanted ones to the recycle bin
- **Templates** — save an instance (mods, resource and shader packs, config, options) and start new ones from it
- **Microsoft login** in the browser, with a device code as fallback (see [status](#status) below); offline player names only in development builds or next to a signed-in Microsoft account
- **Skins & capes** — keep a local skin library (PNG, classic or slim) with pixel-art previews, put a skin on and pick your cape through the official Minecraft API (Microsoft accounts)
- **Quality-of-life** — crash detection with per-instance logs, resumable downloads, automatic RAM detection, one-click log sharing via mclo.gs (access tokens, your user name in paths and e-mail addresses removed first) and a debug info without personal data for bug reports
- **Auto-updates** — signed updates from GitHub Releases, installed only when you say so and never while Minecraft or a task (download, import, export, world backup) is running; a second launch just focuses the open window
- **Seasonal branding** 🎃 — mascot, accent colors and window/taskbar icon switch automatically with the calendar (spring, summer, Halloween, winter)
- **Pixelkino UI** — a custom pixel design system with a canvas scene engine, pixel icons and a frameless window. See [the design spec](docs/design/PIXELKINO.md)

<p align="center">
  <img src="website/assets/launcher-library.png" width="395" alt="Library view">
  <img src="website/assets/launcher-discover.png" width="395" alt="Discover view with mods and modpacks">
</p>

## Status

Pumpkin Launcher is in beta (v0.1.x). Install, launch, content, worlds, skins, import, duplicate/export and auto-update are in place and tested on Windows. Linux (AppImage, `.deb`) and macOS (universal `.dmg`) are built by the release workflow and their backend is tested in CI on every change, but they have not been tried on real machines yet, so expect rough edges there.

> **Microsoft login:** sign-in, Xbox Live and XSTS work end-to-end, but Microsoft must approve each launcher's Azure app before `minecraftservices.com` accepts it. Pumpkin Launcher's own client ID is registered and approval is requested; until it comes through, the final Minecraft step returns 403 and the launcher says so. How to register and approve a client ID (for forks) is documented in [`docs/ACCOUNT-SETUP.md`](docs/ACCOUNT-SETUP.md).

## Getting started

### Platforms

| | Package | Notes |
|---|---|---|
| **Windows** 10/11 (x64) | NSIS installer | Not code-signed yet: SmartScreen asks once |
| **Linux** (x64) | AppImage, `.deb` | Needs WebKitGTK 4.1 (e.g. Ubuntu 22.04+, Debian 12+); Microsoft accounts need a Secret Service keyring (GNOME Keyring, KWallet) |
| **macOS** (Apple Silicon and Intel) | Universal `.dmg` | Not notarized: open it once via right-click → Open, see [Releasing](docs/RELEASING.md#macos-gatekeeper). Minecraft up to 1.18.2 runs on Intel Java and needs Rosetta 2 on Apple Silicon (`softwareupdate --install-rosetta --agree-to-license`) |

### Prerequisites

- **Node 24** and **pnpm 11** (`corepack enable`)
- **Rust** (stable toolchain; on Windows MSVC)
- **Windows**: WebView2 Runtime (preinstalled on Windows 11) and MSVC Build Tools
- **Linux** (Debian/Ubuntu; other distros see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux)):
  ```bash
  sudo apt install build-essential curl file libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)

### Develop

```bash
pnpm install
pnpm tauri dev     # desktop app with hot reload
pnpm dev           # frontend only in the browser (http://localhost:1420, mock data)
```

Log level via `RUST_LOG`, e.g. `RUST_LOG=debug pnpm tauri dev`.

### Build & checks

```bash
pnpm build                        # frontend (sync branding icons, tsc, vite build)
cd src-tauri && cargo check       # backend
cd src-tauri && cargo test        # backend tests
pnpm tauri build                  # installers for your OS (needs the updater signing key, see docs/RELEASING.md)
pnpm check:branding               # seasonal calendar & branding assets
```

## Project layout

```
src/            React frontend (pages, components, pixel design system)
src-tauri/      Rust backend (commands, models, services, state, error)
branding/       released brand assets per season + generators
docs/           architecture, design spec, account setup
website/        standalone marketing website (static, no tracker)
media/          launch video source (HyperFrames, YouTube + TikTok cuts)
scripts/        build helper scripts
proxy/          Cloudflare Worker holding the CurseForge API key (forks need their own key and worker)
```

Details: [Architecture](docs/ARCHITECTURE.md) · [Releasing](docs/RELEASING.md) · [Pixelkino design spec](docs/design/PIXELKINO.md) · [Branding](branding/pumpkin-launcher/README.md) · [Website](website/README.md) · [Launch video](media/launch-video/README.md) · [CurseForge proxy](proxy/README.md)

Instances, templates, accounts and skins are stored as JSON in the app data directory (Windows: `%APPDATA%\dev.laux.launcher\`, Linux: `~/.local/share/dev.laux.launcher/`, macOS: `~/Library/Application Support/dev.laux.launcher/`). The technical identifier stays `dev.laux.launcher` so existing data keeps being found.

## Marketing website

The repo also contains the [website/](website/) folder — a standalone static site with the same Pixelkino look, automatically deployed to [jonax1337.github.io/pumpkin-launcher](https://jonax1337.github.io/pumpkin-launcher/) via GitHub Pages. Locally: `pnpm dev:website` serves it on port 1430, `pnpm build:website` produces the self-contained `website/dist/` folder. No trackers, no external requests.

## Contributing

Issues and pull requests are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and conventions. For security issues, please refer to [SECURITY.md](.github/SECURITY.md) instead of opening a public issue.

## License

Released under the [Apache License 2.0](LICENSE).

Pumpkin Launcher is not affiliated with, endorsed by, or associated with Mojang, Microsoft, or Modrinth. "Minecraft" is a trademark of Mojang Synergies AB.
