# Voxlet

**Jede Welt. Ein Klick.** · *Every world, one click.*

Voxlet ist ein Launcher für Minecraft: Java Edition auf Basis von **Tauri 2** (Rust) und **React + TypeScript + Vite**. Instanzen, Mods, Modpacks und Presets (Sammlungen aus Mods, Einstellungen und JVM-Args, die auf Instanzen angewendet werden). Orientiert an NoRiskClient.

> Stand: Vanilla und Fabric installieren und starten, Offline-Spielername, Mods und Modpacks von Modrinth, Import lokaler `.mrpack`-Dateien.

## Stack

- **Backend:** Rust, Tauri 2, serde, thiserror, tracing
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, Zustand, TanStack Query, React Router, lucide-react, Framer Motion

## Voraussetzungen

- Node 24, pnpm 11
- Rust (stable) inkl. Cargo
- Windows: WebView2 (auf Windows 11 vorinstalliert), MSVC Build Tools

## Entwicklung

```bash
pnpm install
pnpm tauri dev     # Desktop-App mit Hot Reload
pnpm dev           # nur Frontend im Browser (http://localhost:1420, Mockdaten)
```

## Build & Checks

```bash
pnpm build                          # Frontend (tsc + vite build)
cd src-tauri && cargo check         # Backend
cd src-tauri && cargo test          # Backend-Tests (JsonStore)
pnpm tauri build                    # Installer/Bundle
```

Log-Level über `RUST_LOG`, z. B. `RUST_LOG=debug pnpm tauri dev`.

## Daten

Instanzen und Presets liegen als JSON im App-Datenverzeichnis (Windows: `%APPDATA%\dev.laux.launcher\`). Die technische App-Kennung `dev.laux.launcher` bleibt trotz des Namens Voxlet unverändert, damit vorhandene Instanzen und Einstellungen weiter gefunden werden.

## Struktur

```
src/            React-Frontend
src-tauri/      Rust-Backend (commands, models, services, state, error)
docs/           Architektur
```

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
