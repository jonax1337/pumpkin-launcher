# Contributing to Pumpkin Launcher

Thanks for your interest! Issues, discussions and pull requests are all welcome.

## Development setup

```bash
# Prerequisites: Node 24, pnpm 11, Rust stable; system packages per OS: see README (Prerequisites)
pnpm install
pnpm tauri dev     # desktop app with hot reload
pnpm dev:friends   # same, with the friends directory attached
pnpm dev           # frontend only, mock data (http://localhost:1420)
```

See the [README](README.md) for the full toolchain and build commands.

## Before you open a PR

Please make sure the following pass locally:

```bash
pnpm build                # frontend (type-check + vite build)
pnpm check:branding       # seasonal calendar & branding assets
pnpm check:lib            # frontend helpers (Modrinth, formatting, errors, routes, image hosts, server addresses, content list, library, names)
pnpm check:website        # website links & assets (only if you touched website/)
cd src-tauri
cargo check
cargo test
cargo clippy --all-targets   # CI reports warnings only for now; please don't add new ones
```

CI runs the same checks on every push and pull request; the backend checks run on Windows, Linux and macOS (clippy on Linux). It also runs `cargo deny` for known advisories in the Rust dependencies, and CodeQL scans the TypeScript and Rust code on pushes to main, on pull requests and weekly.

## Releases

Releases are built from `v*` tags by `.github/workflows/release.yml`. Version bump, tagging, required secrets and the updater are described in [docs/RELEASING.md](docs/RELEASING.md).

## Conventions

- **Frontend:** TypeScript, React 19, Tailwind only for layout helpers — the pixel design system (`src/ui/`, `src/pixel/`) is the source of truth for look & feel. Match the existing component patterns.
- **Backend:** Rust with `thiserror`/`tracing`; Tauri commands stay thin, logic lives in `services/` and `state.rs`. User-facing errors must be worded in everyday language and use an error code: `coded!("errors.…", name = value)` needs an entry in the German dictionary `src/i18n/de/errors*.ts` (it does not compile without one), and the English dictionary in `src/i18n/en/` must define the same key.
- **New backend command:** register it in `src-tauri/src/lib.rs`, add it to the `Backend` type (`src/lib/backend.ts`), its Tauri call (`src/lib/backend-tauri.ts`) and the browser mock (`src/lib/mock-*.ts`), so `pnpm dev` keeps working without Tauri. File and archive input from outside (packs, other launchers, servers) is untrusted: reuse the guards in `services/` (`zip_guard`, `limits`, `content::fs_safety`, `launch_args`) instead of reading it directly.
- **UI text:** every string lives in `src/i18n/de/` and `src/i18n/en/` (German is the source; the English type enforces the same keys). Text that grows with the text-size setting uses `--tz` (see the accessibility section of [the design spec](docs/design/PIXELKINO.md)).
- **Workflows:** GitHub Actions are pinned to commit SHAs with the version as a comment; Dependabot raises both together.
- **Docs:** if you change behavior or UI, update the relevant page under `docs/` and the READMEs.
- **Commits:** short, imperative subject lines (German or English both fine, English preferred).
- **No secrets:** never commit client IDs, tokens or personal data.

## Reporting bugs & ideas

Use the issue templates. For questions and general discussion, please use [Discussions](https://github.com/jonax1337/pumpkin-launcher/discussions) instead of opening an issue. Security reports go through [SECURITY.md](.github/SECURITY.md).
