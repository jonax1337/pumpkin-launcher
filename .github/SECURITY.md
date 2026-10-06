# Security Policy

Last updated: 2026-10-06.

## Reporting a vulnerability

If you find a security vulnerability in Pumpkin Launcher or its repository-owned services, please do **not** open a public issue. This includes download handling, credential storage, the local Pumpkin Bridge channel, Friends networking and directory/relay handling.

Use this repository's [private vulnerability report](https://github.com/jonax1337/pumpkin-launcher/security/advisories/new) (GitHub sign-in required), also reached through **Security > Report a vulnerability**. Include the affected launcher/service version, operating system, reproduction steps and potential impact if known. Do not include live access tokens, private keys or friend codes. For ordinary crashes and bugs, use [Issues](https://github.com/jonax1337/pumpkin-launcher/issues) instead.

You should get a response within a few days.

## Scope

- The Rust backend (`src-tauri/`) and React frontend (`src/`) in this repository
- The generated installer published from this repository
- The CurseForge proxy (`proxy/`)
- Pumpkin Bridge and its bundled client mod (`mod/`), including the local launcher–game protocol and Friends actions
- Friends networking in the Rust backend and the repository's directory service (`directory/`)
- The repository's relay configuration and deployment files (`infra/relay/`)

Out of scope: vulnerabilities in the Minecraft/Microsoft APIs themselves, Modrinth and other upstream provider services, third-party relay infrastructure such as n0's service, and third-party mod content installed via the launcher. Report those to their respective maintainers. Vulnerabilities in Pumpkin's handling of those services or content remain in scope.

## A note on credentials

Microsoft refresh tokens are stored only in the operating system's credential store, never in plain files: the Windows Credential Manager, the macOS Keychain, or a Secret Service on Linux (GNOME Keyring, KWallet), all under the service name `dev.laux.launcher`. Any change to that guarantee is treated as a security issue.

Minecraft's session (access) token has to reach the game, and Minecraft takes it as the `--accessToken` command-line argument. While the game runs, other programs on the same computer that can list processes can read it. This is how all Minecraft launchers work and is not specific to Pumpkin Launcher; the token expires after a short time and is not the refresh token.

## What the launcher verifies

- Downloads of Minecraft, Java and mod loaders come from pinned hosts only (Mojang, the Fabric, Quilt, Forge and NeoForge Maven servers, Maven Central), over HTTPS, with a size limit and a SHA-1 check. For loader libraries the hash comes from the same Maven server as the file, so it protects against corruption, not against a compromised server.
- Mods and packs from Modrinth, CurseForge, FTB and Technic are checked against the hashes and sizes the provider publishes, where it publishes them (Technic authors' own hosts offer none). The launcher does **not** scan them for malware.
- Descriptions of projects are sanitized, and images from hosts other than the providers' own are loaded only after a click.
- Updates are installed only if their signature matches the public key built into the app (`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`). Releases carry `SHA256SUMS` and a build provenance attestation; see [release signing and provenance](../CONTRIBUTING.md#release-packaging).
