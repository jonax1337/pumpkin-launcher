# Pumpkin Launcher

**Jede Welt. Ein Klick.** · *Every world, one click.*

Pumpkin Launcher ist ein Launcher für Minecraft: Java Edition auf Basis von **Tauri 2** (Rust) und **React + TypeScript + Vite**. Instanzen, Mods, Modpacks und Presets (Sammlungen aus Mods, Einstellungen und JVM-Args, die auf Instanzen angewendet werden). Orientiert an NoRiskClient.

> Stand: Vanilla und Fabric installieren und starten, Offline-Spielername, Mods und Modpacks von Modrinth, Import lokaler `.mrpack`-Dateien.

## Stack

- **Backend:** Rust, Tauri 2, serde, thiserror, tracing
- **Frontend:** React 19, TypeScript, Vite, Radix UI (Verhalten von Menü, Dialog, Auswahl, Tooltip), Tailwind CSS v4 (nur Layout-Hilfen), Zustand, TanStack Query, React Router, Sonner
- **Design:** eigenes Pixel-Design „Pixelkino“ mit Szenen-Engine auf Canvas, Pixel-Icons und rahmenlosem Fenster – siehe [docs/design/PIXELKINO.md](docs/design/PIXELKINO.md)

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

Instanzen und Presets liegen als JSON im App-Datenverzeichnis (Windows: `%APPDATA%\dev.laux.launcher\`). Die technische App-Kennung `dev.laux.launcher` bleibt trotz des Namens Pumpkin Launcher unverändert, damit vorhandene Instanzen und Einstellungen weiter gefunden werden.

## Struktur

```
src/            React-Frontend
src-tauri/      Rust-Backend (commands, models, services, state, error)
docs/           Architektur, Design (Spezifikation + Mockup)
```

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), Design: [docs/design/PIXELKINO.md](docs/design/PIXELKINO.md) mit Referenz-Mockup `docs/design/concepts/pixelkino.html`.

## Saisonales Branding

Buddy, Akzentfarben und Fenster-/Taskleisten-Icon wechseln automatisch nach dem lokalen Kalender: März–Mai Frühling, Juni–August Sommer, 1. Oktober–2. November Halloween und Dezember–Februar Winter; sonst Standard. Die App prüft auch Mitternacht und die Rückkehr aus dem Standby. Paket-Icons werden beim Dev-/Release-Build passend erzeugt.

Die freigegebenen Quellen liegen unter `branding/pumpkin-launcher/`, die Integration unter `src/branding/`. Prüfung: `pnpm check:branding`. Details und Grenzen nativer Paket-Icons: [Branding](branding/pumpkin-launcher/README.md).

Unter **Einstellungen → Darstellung → Dein Pumpkin** lässt sich jede Variante dauerhaft auswählen. Die Wahl bleibt nach einem Neustart erhalten und gilt für Buddy, Farben und das Fenster-/Taskleisten-Icon. **Automatisch** schaltet wieder auf den Saisonkalender um.

## Marketing-Website

Die separate Website liegt in [`website/`](website/README.md). `pnpm dev:website` startet sie auf Port 1430, `pnpm build:website` erzeugt das unabhängig deploybare Verzeichnis `website/dist/`. Der Desktop-Launcher behält seinen eigenen Build.
