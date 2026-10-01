<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding/pumpkin-launcher/wordmark/light.svg">
    <img src="branding/pumpkin-launcher/wordmark/dark.svg" alt="Pumpkin Launcher" width="420">
  </picture>
</p>

<h3 align="center">Every world, one click.</h3>

<p align="center">
  A desktop launcher for <strong>Minecraft: Java Edition</strong> — instances, mods, modpacks and presets,<br>
  wrapped in a hand-crafted pixel-art UI. Built with Tauri&nbsp;2 (Rust) and React&nbsp;+&nbsp;TypeScript.
</p>

<p align="center">
  <a href="https://github.com/jonax1337/pumpkin-launcher/actions/workflows/ci.yml"><img src="https://github.com/jonax1337/pumpkin-launcher/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-orange.svg" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/Tauri-2-blue.svg" alt="Tauri 2">
  <img src="https://img.shields.io/badge/platform-Windows-blueviolet.svg" alt="Platform: Windows">
</p>

<p align="center">
  <img src="website/assets/launcher-home.png" alt="Pumpkin Launcher home screen with seasonal buddy mascot" width="820">
</p>

## Features

- **Instances** — create, configure and launch isolated game instances for Vanilla, **Fabric, Forge, NeoForge and Quilt**
- **Mods & modpacks from [Modrinth](https://modrinth.com)** — browse, search and install directly in the launcher
- **`.mrpack` import** — drag in local modpack files
- **Presets** — reusable collections of mods, settings and JVM args that can be applied to any instance
- **Microsoft login** via device code (see [status](#status) below), plus offline player profiles
- **Quality-of-life** — crash detection with per-instance logs, resumable downloads, automatic RAM detection, one-click log sharing via mclo.gs (access tokens, Windows user name and e-mail addresses removed first) and a debug info without personal data for bug reports
- **Auto-updates** — signed updates from GitHub Releases, installed only when you say so and never while Minecraft is running; a second launch just focuses the open window
- **Seasonal branding** 🎃 — mascot, accent colors and window/taskbar icon switch automatically with the calendar (spring, summer, Halloween, winter)
- **Pixelkino UI** — a custom pixel design system with a canvas scene engine, pixel icons and a frameless window. See [the design spec](docs/design/PIXELKINO.md)

<p align="center">
  <img src="website/assets/launcher-library.png" width="395" alt="Library view">
  <img src="website/assets/launcher-discover.png" width="395" alt="Discover view with mods and modpacks">
</p>

## Status

Pumpkin Launcher is in active, early development (v0.1.x). Core install/launch flows work; polish, Linux/macOS support and a public installer are still on the way. The Modrinth catalog shows live data.

> **Microsoft login:** sign-in, Xbox Live and XSTS work end-to-end, but Microsoft must approve each launcher's Azure app before `minecraftservices.com` accepts it. Until Pumpkin Launcher's own client ID is approved, the final Minecraft step returns 403 and the launcher says so. Everything you need to register and approve your own client ID is documented in [`docs/ACCOUNT-SETUP.md`](docs/ACCOUNT-SETUP.md).

## Getting started

### Prerequisites

- **Node 24** and **pnpm 11** (`corepack enable`)
- **Rust** (stable toolchain, MSVC)
- **Windows**: WebView2 Runtime (preinstalled on Windows 11) and MSVC Build Tools

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
cd src-tauri && cargo test        # backend tests (JsonStore)
pnpm tauri build                  # NSIS installer (needs the updater signing key, see docs/RELEASING.md)
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
```

Details: [Architecture](docs/ARCHITECTURE.md) · [Releasing](docs/RELEASING.md) · [Pixelkino design spec](docs/design/PIXELKINO.md) · [Branding](branding/pumpkin-launcher/README.md) · [Website](website/README.md) · [Launch video](media/launch-video/README.md)

Instances, presets and settings are stored as JSON in the app data directory (Windows: `%APPDATA%\dev.laux.launcher\`). The technical identifier stays `dev.laux.launcher` so existing data keeps being found.

## Marketing website

The repo also contains the [website/](website/) folder — a standalone static site with the same Pixelkino look, automatically deployed to [jonax1337.github.io/pumpkin-launcher](https://jonax1337.github.io/pumpkin-launcher/) via GitHub Pages. Locally: `pnpm dev:website` serves it on port 1430, `pnpm build:website` produces the self-contained `website/dist/` folder. No trackers, no external requests.

## Contributing

Issues and pull requests are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and conventions. For security issues, please refer to [SECURITY.md](.github/SECURITY.md) instead of opening a public issue.

## License

Released under the [Apache License 2.0](LICENSE).

Pumpkin Launcher is not affiliated with, endorsed by, or associated with Mojang, Microsoft, or Modrinth. "Minecraft" is a trademark of Mojang Synergies AB.
