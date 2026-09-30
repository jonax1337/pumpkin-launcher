# Contributing to Pumpkin Launcher

Thanks for your interest! Issues, discussions and pull requests are all welcome.

## Development setup

```bash
# Prerequisites: Node 24, pnpm 11, Rust stable (MSVC), WebView2 on Windows
pnpm install
pnpm tauri dev     # desktop app with hot reload
pnpm dev           # frontend only, mock data (http://localhost:1420)
```

See the [README](README.md) for the full toolchain and build commands.

## Before you open a PR

Please make sure the following pass locally:

```bash
pnpm build                # frontend (type-check + vite build)
pnpm check:branding       # seasonal calendar & branding assets
cd src-tauri
cargo check
cargo test
```

CI runs the same checks on every push and pull request.

## Conventions

- **Frontend:** TypeScript, React 19, Tailwind only for layout helpers — the pixel design system (`src/ui/`, `src/pixel/`) is the source of truth for look & feel. Match the existing component patterns.
- **Backend:** Rust with `thiserror`/`tracing`; Tauri commands stay thin, logic lives in `services/` and `state.rs`. User-facing errors must be worded in everyday language.
- **Docs:** if you change behavior or UI, update the relevant page under `docs/` and the READMEs.
- **Commits:** short, imperative subject lines (German or English both fine, English preferred).
- **No secrets:** never commit client IDs, tokens or personal data.

## Reporting bugs & ideas

Use the issue templates. For questions and general discussion, please use [Discussions](https://github.com/jonax1337/pumpkin-launcher/discussions) instead of opening an issue. Security reports go through [SECURITY.md](.github/SECURITY.md).
