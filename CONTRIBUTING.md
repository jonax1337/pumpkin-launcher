# Contributing to Pumpkin Launcher

Issues, discussions and pull requests are welcome. Use the issue templates for bugs and feature requests;
questions belong in [Discussions](https://github.com/jonax1337/pumpkin-launcher/discussions).
Report vulnerabilities privately through [SECURITY.md](.github/SECURITY.md).

## Development setup

Install Node 24, pnpm 12 (the pinned version is in `package.json`) and Rust stable.
Desktop development also needs:

- Windows: the MSVC Rust toolchain, MSVC Build Tools with C++ support and WebView2 Runtime.
- Linux: the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#linux). On Debian/Ubuntu:
  ```bash
  sudo apt install build-essential curl file libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
  ```
- macOS: Xcode Command Line Tools (`xcode-select --install`).

From the repository root:

```bash
pnpm install
pnpm tauri dev     # desktop app with hot reload
pnpm dev:friends   # desktop app with the Friends directory configured
pnpm tauri:remote  # desktop app with reduced WebView2 animation for remote sessions
pnpm dev           # browser frontend with mock data at http://localhost:1420
```

Set `RUST_LOG` to adjust backend logging. The browser mock does not authenticate or launch Minecraft.
Fork-specific Microsoft registration is described under [Microsoft sign-in for forks](#microsoft-sign-in-for-forks).

`pnpm dev:friends` runs `scripts/tauri-friends.mjs`: it supplies
`https://pumpkin-friends-directory.jonas-laux.workers.dev` only when
`PUMPKIN_FRIENDS_DIRECTORY` is unset, and forwards extra arguments to `tauri dev`.
An existing value (including an empty value) is preserved. To use your own Worker, set that
environment variable before starting the command; see [directory configuration](directory/README.md#deployment).
Plain `pnpm tauri dev` has no source-default directory. This wrapper configures name lookup;
it is not evidence that the remote service or Friends networking is working.

## Build and automated checks

These commands are available from the repository root:

```bash
pnpm build
pnpm check:branding
pnpm check:lib
pnpm build:website
pnpm check:website
cargo check --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets
```

`pnpm build` synchronizes branding icons, type-checks the frontend and builds it with Vite.
CI runs the frontend checks, the Friends directory tests and Rust checks on Windows, Linux and macOS;
Clippy runs on Linux with warnings non-blocking. The dependency job checks Rust advisories with `cargo deny`.

For Bridge changes, `Mod` runs layer/script checks and representative node builds on
pushes and pull requests. It selects the first and last registry row for each
loader/game-JDK/Gradle-JDK/injection-strategy combination (currently 34 of 102 nodes).
The complete build and compile matrices, Fabric kit demos and aggregate `mod-index`
package run nightly at 01:17 UTC or via **Actions → Mod → Run workflow**.
`Mod smoke` exercises all production targets nightly at 03:22 UTC or via manual dispatch,
not on each push/PR. Version-specific failures outside the representative set can
therefore surface only in a full run; dispatch both workflows before merging broad
compatibility changes. Release tags still build and package every registered node.

Component-specific setup and commands:

- [Bridge mod](mod/README.md) and [protocol fixtures](mod/fixtures/protocol/README.md)
- [Friends contracts](docs/friends/SPEC.md), [directory Worker](directory/README.md) and [relay operations](docs/friends/RELAY-OPS.md)
- [CurseForge proxy](proxy/README.md) and [website](website/README.md)
- [Minecraft API probe](tools/mc-api-probe/README.md), [production mod smoke harness](tools/mod-smoke/README.md) and [P2P connection tool](tools/p2p-spike/README.md)
- [Branding assets](branding/pumpkin-launcher/README.md), [Buddy motion](branding/pumpkin-launcher/motion/README.md) and [launch video](media/launch-video/README.md)

`pnpm tauri build` creates packages for the current OS. See [Release packaging](#release-packaging) for signing and embedded Bridge artifacts.
For the static website, `pnpm dev:website` serves port 1430 and `pnpm build:website` writes `website/dist/`.

## Code conventions

- Frontend: TypeScript and React; use the existing components and the pixel design system in `src/ui/` and `src/pixel/`. Tailwind is used for layout helpers.
- Backend: keep Tauri commands thin and put logic in services and state. Use the existing `thiserror` and `tracing` patterns.
- Backend commands: register them in `src-tauri/src/lib.rs`, the `Backend` type in `src/lib/backend.ts`, the Tauri adapter in `src/lib/backend-tauri.ts` and the browser mock in `src/lib/mock-*.ts`.
- User-facing text: keep German and English dictionaries in sync under `src/i18n/`. Backend errors use `coded!` keys from the error dictionaries. Use everyday language.
- External files and archives are untrusted. Reuse the existing `zip_guard`, `limits`, `content::fs_safety` and `launch_args` guards.
- Match existing patterns, update documentation when behavior changes and keep secrets, tokens and personal data out of commits. Public OAuth client IDs are not secrets; fork registration rules still apply.
- GitHub Actions are pinned to commit SHAs with version comments. Commit subjects should be short and imperative.

For module boundaries and data flow, see [Architecture](docs/ARCHITECTURE.md).
UI tokens and text-size behavior are described in [Pixelkino](docs/design/PIXELKINO.md).
The [Pumpkin Bridge reference](docs/bridge/README.md) describes the launcher–game channel; [mod/README.md](mod/README.md) describes its build.

## Microsoft sign-in for forks

Users of official builds only sign in through the launcher; they do not register an application.
A fork needs its own approved public Microsoft application, not another launcher's client ID:

- Register an application for **Personal Microsoft accounts only** in [Microsoft Entra](https://portal.azure.com).
- Add **Mobile and desktop applications**, with `http://localhost` as the redirect URI and no fixed port.
- Enable **Allow public client flows** for the device-code fallback. Do not create or embed a client secret.
- Obtain Minecraft API approval for your registration. Microsoft/Xbox sign-in alone does not grant Minecraft API access. The documented review entry point is [aka.ms/mce-reviewappid](https://aka.ms/mce-reviewappid); the process can change. Friends certificate/attribute use and name/UUID sharing also need to fit that approval and applicable terms.
- Replace `DEFAULT_CLIENT_ID` in `src-tauri/src/services/auth/mod.rs` and rebuild.

Browser sign-in uses PKCE and a loopback callback; device-code sign-in is the fallback.
Refresh tokens stay in the OS keyring, not `accounts.json`. Account records retain the original
`clientId`, so changing the default requires a new sign-in rather than migrating refresh tokens.
An approval-related Minecraft 403 points to application permissions; missing Xbox profiles,
family restrictions and missing Java Edition ownership are account issues.
An unavailable keyring must not fall back to plaintext storage.

A normal release requires an authenticated Microsoft account before player-name-only launches
are available. That permission does not enable Friends hosting/joining or Bridge injection.
See [Architecture](docs/ARCHITECTURE.md) and [Friends privacy](docs/friends/PRIVACY.md) for storage and data boundaries.

## Release packaging

[The release workflow](.github/workflows/release.yml) runs on annotated `v<version>` tags.
It creates a **draft**, builds Bridge JARs from `mod/nodes.txt`, validates their index/hashes/budgets,
and embeds them through `PUMPKIN_MOD_DIST` in the platform installers. Release builds configure
the Friends directory and enable `beta-relays`; the development-only `smoke` feature is excluded.

### Prepare the tag

The tag must match `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`
and `mod/gradle.properties`; `src-tauri/Cargo.lock` must record the same Rust package version.
After committing the intended release, create its annotated tag:

```bash
git tag -a --cleanup=verbatim v0.3.3
git push origin v0.3.3
```

The first command opens the tag-message editor. Use **only that version's entry** from
[CHANGELOG.md](CHANGELOG.md), not the entire release history: the workflow uses the annotation
for GitHub release notes and the launcher's update dialog. A source prepared for release is
not yet a published release.

### Signing

Installer jobs use the GitHub environment `release`. As observed on 2026-10-06,
it has no protection rules or environment secrets; reviewer and tag restrictions
are not currently configured. A protected environment restricted to release tags
with required reviewers is recommended, not an existing approval gate.
The workflow can inherit `TAURI_SIGNING_PRIVATE_KEY` from repository secrets;
that repository secret is configured. Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
only when the private key is encrypted and requires it; no password secret is
currently configured. Never commit either value.
The trusted public updater key is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.
Keep a separate secure backup: losing the private key prevents updates to existing installations
unless their trusted key is deliberately migrated or users reinstall.

### Publish the draft

The pipeline attaches Windows x64 NSIS, Linux x64 AppImage/DEB and macOS universal DMG packages,
updater signatures, `latest.json`, `SHA256SUMS` and build provenance attestations.
It also provides these stable website download names:

| Platform | Asset |
| --- | --- |
| Windows | `Pumpkin.Launcher_x64-setup.exe` |
| Linux | `Pumpkin.Launcher_amd64.AppImage`, `Pumpkin.Launcher_amd64.deb` |
| macOS | `Pumpkin.Launcher_universal.dmg` |

Only published releases reach the website's `releases/latest/download/` links and the updater;
drafts and pre-releases do not. After all workflow jobs complete successfully, open the
draft in **GitHub > Releases**, choose **Edit**, then **Publish release**. Building alone
does not publish it. **Re-run failed jobs** reuses the draft; restarting the whole
workflow can create another draft. If concurrent installer uploads lose an entry in `latest.json`,
the platform check fails and the missing platform's job can be restarted.

Updater signatures are not OS code signatures: Windows installers are not Authenticode-signed
and macOS apps are ad hoc signed, not notarized. User-facing platform warnings are in [README.md](README.md).
Build provenance can be checked with `gh attestation verify <file> --repo jonax1337/pumpkin-launcher`.

### Local package

For a local package without signed updater artifacts:

```bash
pnpm tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

To include the in-game Bridge, `PUMPKIN_MOD_DIST` must point to a valid `mod-index.json` and matching-version JARs;
see [mod/README.md](mod/README.md). Without the Bridge distribution, a local package is not equivalent
to the release workflow. Local source checks do not verify GitHub's signing secrets or environment approvals.

### Windows installer template

`src-tauri/tauri.conf.json` selects `installer/installer.nsi`, derived from
[Tauri CLI 2.12.1](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.1/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi)
under its Apache-2.0/MIT license. Customizations are limited to branding,
native dark-control painting, font-aware layout, German/English text, an
instance-folder page (`installer/instances.nsh`) and advancing to Finish after
success. Installation, WebView2, maintenance and updater flags stay upstream.
Data deletion stays upstream except for the uninstall checkbox, which removes
only `accounts.json`, `skins.json` and `templates.json` and never deletes directories.

The instance page appears in interactive first installs (not silent, passive or
update mode). It defaults to `Documents\Pumpkin Launcher\Instances`, keeps an
existing library where it is, rejects relative and drive-relative paths, drive
roots, the install directory, system folders, `%APPDATA%`, `%LOCALAPPDATA%`, the
metadata folder, `C:\Users`, the profile, Documents, Desktop and Downloads, and
writes `instances-path-request.txt` (UTF-16LE with BOM, absolute path, CRLF) into
the metadata directory. The launcher re-validates it at its next start and never
blocks startup on a bad request: it sets the file aside as
`instances-path-request.txt.rejected` and shows a notice; see
[ARCHITECTURE.md](docs/ARCHITECTURE.md#data-and-process-boundaries). The bundle
publisher is Jonas Laux.
When upgrading the Tauri CLI, compare its template with this pinned source
and port lifecycle fixes before publishing the next installer.

`pnpm build` stages committed seasonal installer images together with the icons.
Artwork regeneration is documented in the [branding guide](branding/pumpkin-launcher/README.md#windows-installer-artwork).
To package only Windows NSIS locally:

```sh
pnpm tauri build --bundles nsis --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

The committed x86 Unicode `src-tauri/installer/theme/PumpkinTheme.dll` is built
from the adjacent C++ source. It uses Windows system libraries and a static MSVC
runtime; standard app builds consume the DLL without rebuilding it. It also embeds
the installer fonts (Hanken Grotesk, Big Shoulders Display) and their OFL notices
from `src-tauri/installer/theme/fonts/`; the installer has no left stripe.
The committed TTFs come from
`python branding/pumpkin-launcher/installer/build-fonts.py`, which needs
`pip install fonttools brotli` and the Fontsource packages in `node_modules`
(`pnpm install`). Ordinary builds do not run it; rebuild the DLL after changing fonts.
After changing the theme source, rebuild it on Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File src-tauri/installer/theme/build.ps1
```

This requires MSVC x86 C++ tools, a Windows 11 SDK and NSIS plugin SDK headers.
The script discovers Visual Studio with `vswhere` and NSIS through `NSISDIR`,
Tauri's local NSIS cache or the standard installation folders; pass
`-NsisSdkPath <NSIS/Examples/Plugin/nsis>` when necessary. Commit the rebuilt DLL
together with its source. Verify native keyboard navigation, input visibility,
checkbox state, page transitions and both install/uninstall surfaces.


For destructive installer smoke tests, use a disposable Windows environment or a
temporary bundle config with a unique `productName`, `identifier`, `bundle.publisher`
and empty `bundle.fileAssociations`. A different `/D=` directory alone is **not**
isolation: maintenance can uninstall the registered application. When bundling an
existing binary for UI-only QA, do not launch it: its runtime identity remains the
one compiled into that binary, regardless of the bundle config. Verify install,
`/UPDATE /P`, shortcuts, uninstall and default preservation of application data.
With a different `productName` the instance page and request file use that name
(`%APPDATA%\<productName>`, `Documents\<productName>\Instances`) and never read
the real `dev.laux.launcher` legacy folders.

Last updated: 2026-10-08.
