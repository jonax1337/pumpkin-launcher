# Security Policy

## Reporting a vulnerability

Pumpkin Launcher is in early development. If you find a security vulnerability — especially in download handling, credential storage, or anything exposed to the UI — please do **not** open a public issue.

Instead, use GitHub's **private vulnerability reporting** on this repository (*Security → Report a vulnerability*), or start a security advisory. Please include reproduction steps and affected versions if you can.

You should get a response within a few days.

## Scope

- The Rust backend (`src-tauri/`) and React frontend (`src/`) in this repository
- The generated installer published from this repository
- The CurseForge proxy (`proxy/`)

Out of scope: the Minecraft/Microsoft APIs themselves, Modrinth's service, and third-party mod content installed via the launcher.

## A note on credentials

Microsoft refresh tokens are stored only in the operating system's credential store, never in plain files: the Windows Credential Manager, the macOS Keychain, or a Secret Service on Linux (GNOME Keyring, KWallet), all under the service name `dev.laux.launcher`. Any change to that guarantee is treated as a security issue.

Minecraft's session (access) token has to reach the game, and Minecraft takes it as the `--accessToken` command-line argument. While the game runs, other programs on the same computer that can list processes can read it. This is how all Minecraft launchers work and is not specific to Pumpkin Launcher; the token expires after a short time and is not the refresh token.

## What the launcher verifies

- Downloads of Minecraft, Java and mod loaders come from pinned hosts only (Mojang, the Fabric, Quilt, Forge and NeoForge Maven servers, Maven Central), over HTTPS, with a size limit and a SHA-1 check. For loader libraries the hash comes from the same Maven server as the file, so it protects against corruption, not against a compromised server.
- Mods and packs from Modrinth, CurseForge, FTB and Technic are checked against the hashes and sizes the provider publishes, where it publishes them (Technic authors' own hosts offer none). The launcher does **not** scan them for malware.
- Descriptions of projects are sanitized, and images from hosts other than the providers' own are loaded only after a click.
- Updates are installed only if their signature matches the public key built into the app (see the README for the key and how to verify a release by hand). Releases carry `SHA256SUMS` and a build provenance attestation.
