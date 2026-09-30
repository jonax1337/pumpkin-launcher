# Security Policy

## Reporting a vulnerability

Pumpkin Launcher is in early development. If you find a security vulnerability — especially in download handling, credential storage, or anything exposed to the UI — please do **not** open a public issue.

Instead, use GitHub's **private vulnerability reporting** on this repository (*Security → Report a vulnerability*), or start a security advisory. Please include reproduction steps and affected versions if you can.

You should get a response within a few days.

## Scope

- The Rust backend (`src-tauri/`) and React frontend (`src/`) in this repository
- The generated installer published from this repository

Out of scope: the Minecraft/Microsoft APIs themselves, Modrinth's service, and third-party mod content installed via the launcher.

## A note on credentials

Microsoft refresh tokens are stored only in the OS credential manager (Windows Credential Manager, service `dev.laux.launcher`) — never in plain files. Any change to that guarantee is treated as a security issue.
