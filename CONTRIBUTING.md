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

- Frontend: TypeScript and React; use the existing components and the pixel design system in `src/ui/` and `src/pixel/`. The kit keeps its look in CSS and its layout in Tailwind utilities (see `src/ui/README.md`).
- Backend: keep Tauri commands thin and put logic in services and state. Use the existing `thiserror` and `tracing` patterns.
- Backend commands: register them in `src-tauri/src/lib.rs`, the `Backend` type in `src/lib/backend.ts`, the Tauri adapter in `src/lib/backend-tauri.ts` and the browser mock in `src/lib/mock-*.ts`.
- User-facing text: keep German and English dictionaries in sync under `src/i18n/`. Backend errors use `coded!` keys from the error dictionaries. Use everyday language.
- External files and archives are untrusted. Reuse the existing `zip_guard`, `limits`, `content::fs_safety` and `launch_args` guards.
- Match existing patterns, update documentation when behavior changes and keep secrets, tokens and personal data out of commits. Public OAuth client IDs are not secrets; fork registration rules still apply.
- GitHub Actions are pinned to commit SHAs with version comments. Commit subjects should be short and imperative.

For module boundaries and data flow, see [Architecture](docs/ARCHITECTURE.md).
UI tokens, the Inventar surface classes, icons and text-size behavior are described in [Pixelkino](docs/design/PIXELKINO.md); `docs/design/concepts/` holds the static design mockups.
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

#### OS code signing (optional)

The workflow signs the Windows installer and the macOS app only when the entries below exist.
Each platform needs all of its **required** entries; with any missing, that platform builds exactly
as before (unsigned Windows installer, ad hoc signed macOS app), so forks need no setup.
The step **Detect configured code signing** in each installer job logs what it found.
Create secrets under **Settings > Secrets and variables > Actions** (repository or the `release`
environment) and variables on the same page's **Variables** tab.

| Name | Kind | Platform | Value |
| --- | --- | --- | --- |
| `AZURE_TENANT_ID` | secret | Windows, required | Directory (tenant) ID of the Entra app registration |
| `AZURE_CLIENT_ID` | secret | Windows, required | Application (client) ID of that registration |
| `AZURE_CLIENT_SECRET` | secret | Windows, required | Client secret **value** of that registration |
| `AZURE_SIGNING_ENDPOINT` | variable | Windows, required | Regional endpoint of the signing account, e.g. `https://weu.codesigning.azure.net` |
| `AZURE_SIGNING_ACCOUNT` | variable | Windows, required | Artifact Signing account name |
| `AZURE_SIGNING_CERTIFICATE_PROFILE` | variable | Windows, required | Certificate profile name |
| `APPLE_CERTIFICATE` | secret | macOS, required | Base64 of the exported Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | secret | macOS, required | Password chosen when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | secret | macOS, required | Certificate name, e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | secret | macOS, for notarization | Apple ID email |
| `APPLE_PASSWORD` | secret | macOS, for notarization | [App-specific password](https://support.apple.com/en-us/102654) of that Apple ID, not the account password |
| `APPLE_TEAM_ID` | secret | macOS, for notarization | Apple Developer Team ID |

Without all three notarization secrets the macOS app is Developer-ID signed but not notarized
(Tauri skips notarization with a warning). The notarization variant with an App Store Connect
API key is not wired.

**Windows (Azure Artifact Signing).** Follow Microsoft's [quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart):
register the `Microsoft.CodeSigning` resource provider, create an Artifact Signing account, complete
identity validation and create a **Public Trust** certificate profile. Note the account's regional
endpoint; a region/endpoint mismatch causes `403 Forbidden`. Then create a Microsoft Entra app
registration with a client secret and assign it the **Artifact Signing Certificate Profile Signer**
role on the certificate profile ([role assignment](https://learn.microsoft.com/en-us/azure/artifact-signing/tutorial-assign-roles)).
Its tenant ID, client ID and secret are the three `AZURE_*` secrets; account, profile and endpoint are the variables.
The job installs the pinned `artifact-signing-cli` (a third-party wrapper around Microsoft's signing client
and `signtool`, recommended by [Tauri's Windows signing guide](https://v2.tauri.app/distribute/sign/windows/#azure-artifact-signing))
and passes it to Tauri as `bundle.windows.signCommand` through a generated `--config` file, so
`tauri.conf.json` and local builds are unaffected. Tauri signs the app executable, the NSIS plugins it
bundles, the uninstaller and the installer; the workflow signs `installer/theme/PumpkinTheme.dll`
in its checkout before the build because Tauri does not know that plugin. Every signature carries an RFC 3161 timestamp from
`http://timestamp.acs.microsoft.com`. The updater `.sig` is created by Tauri after all signing, so it covers the signed installer.
Do not add `certificateThumbprint` or a fixed `signCommand` to `tauri.conf.json`: that would make every build require the certificate.

**macOS (Developer ID and notarization).** With a paid Apple Developer Program membership, create a
**Developer ID Application** certificate in your developer account, install it in Keychain Access,
export it with its private key as `.p12` (set an export password), then encode it:
`base64 -i certificate.p12 | pbcopy`. That text is `APPLE_CERTIFICATE`. Find the exact identity with
`security find-identity -v -p codesigning`. Create the app-specific password at
[appleid.apple.com](https://appleid.apple.com) and read the Team ID from your membership page.
The workflow exports these values only when present, because Tauri prefers `APPLE_SIGNING_IDENTITY`
over `signingIdentity: "-"` in `tauri.conf.json`, which stays as the ad hoc fallback. Tauri imports
the certificate, signs the universal app and, with the notarization secrets, notarizes and staples it.

#### Verify a signed release

Windows (PowerShell), on the downloaded installer and on `pumpkin-launcher.exe` in the install folder:

```powershell
Get-AuthenticodeSignature .\Pumpkin.Launcher_x64-setup.exe | Format-List Status, SignerCertificate, TimeStamperCertificate
```

`Status` must be `Valid` and a timestamp certificate must be present.

macOS, on the `.app` inside the mounted DMG (an ad hoc build shows `Signature=adhoc`):

```bash
codesign -dv --verbose=4 "/path/to/Pumpkin Launcher.app"
spctl -a -vv "/path/to/Pumpkin Launcher.app"
xcrun stapler validate "/path/to/Pumpkin Launcher.app"
```

`codesign` must list a `Developer ID Application` authority and your `TeamIdentifier`; `spctl`
must report `accepted` with `source=Notarized Developer ID`.

README and website wording that the installer is not code-signed or the app is not notarized
([README.md](README.md) "Download and install", website download notes) is deliberately unchanged.
The maintainer must update it once the first signed release has shipped and been verified as above.

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

Updater signatures are not OS code signatures. Whether the Windows installer is Authenticode-signed
and the macOS app is notarized depends on the secrets described under [OS code signing](#os-code-signing-optional);
without them Windows installers are unsigned and macOS apps are ad hoc signed. User-facing platform warnings are in [README.md](README.md).
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
