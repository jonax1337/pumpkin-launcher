# Pumpkin Friends: dependencies

Written by R0a (2026-10-03). Normative context: `docs/friends/SPEC.md` (3.1, 12.2, work package R0a).

## What R0a added

`src-tauri/Cargo.toml`:

| Entry | Why |
|---|---|
| `iroh = "1.3"` (default features) | QUIC transport with Ed25519 ids, hole punching and relays (spec 3). Resolves to iroh 1.3.0 (crates.io, rust-version 1.91). Default features are `metrics`, `fast-apple-datapath`, `portmapper` and `tls-ring`. |
| `data-encoding = "2"` | RFC 4648 base32 for the friend code (4.2). |
| `unicode-normalization = "0.1"` | NFC step of the peer-string sanitising (12.3). |
| `windows-sys` features `Win32_NetworkManagement_IpHelper`, `Win32_Networking_WinSock` | TCP table lookup for `sockowner` (6.1, 6.2). |
| cargo feature `beta-relays` (off by default) | n0's public relays in debug and closed-beta builds (3.2). |
| dev-dependency `iroh` with `test-utils` | In-process relay for tests (3.7). |

`iroh = "1.3"` resolved without changes: `cargo info iroh` lists 1.3.0 as the current version, and the feature names above (including `test-utils`) exist at that version. The existing lock entries were not changed; only new packages were added (`cargo check --locked` is green).

### The `test-utils` dev-dependency stays out of release

Cargo's resolver 2 (edition 2021) does not unify dev-dependency features into normal builds:

```
$ cargo tree -e normal -i iroh -f "{p} {f}"
iroh v1.3.0 default,fast-apple-datapath,metrics,portmapper,tls-ring
└── launcher v0.1.0
```

No `test-utils` in the normal tree, so `axum`, `simple-dns` and the relay server code are not compiled into the app.

## Binary size

Measured on Windows (x86_64-pc-windows-msvc), `cargo build --release` with the repo's release profile (LTO, `opt-level = 3`, `codegen-units = 1`, `panic = "abort"`, `strip`), full app `launcher.exe`:

| Build | Size |
|---|---|
| This tree: friends dependencies added, nothing references iroh yet | 18,017,280 bytes (17.18 MiB) |
| Same tree plus a temporary probe that uses iroh: two endpoints (`presets::N0`), accept and connect, one bi stream echoed, called from `run()` | 23,159,296 bytes (22.09 MiB) |
| **Delta with iroh in use** | **+5,142,016 bytes (about +4.9 MiB)** |

- The delta is the figure that counts: both builds embed the same frontend, so only iroh and the code it pulls in differ. The probe was only used to measure and is not part of the commit.
- It is close to the spec's estimate of +4.6 MB. The probe uses the `presets::N0` preset, which brings in iroh's DNS and address-lookup code. The real service builds endpoints without address lookup (spec 3.3), so the final delta may shrink a little. R1 should record the figure again once the transport exists.
- A first baseline (the tree before this PR, 17,050,112 bytes) was built with an empty `dist/` placeholder, so it is not comparable with the 18,017,280 bytes above (that build embeds the real frontend, about 1 MB compressed). The gap of about 1 MB to it is the embedded frontend, not iroh: nothing calls the new dependencies yet, so LTO drops them (not measured separately).
- Only Windows was measured.
- Compile cost: a cold release build of the full app takes about 14 minutes on a 12-thread machine, and the iroh tree adds roughly 150 entries to `cargo tree -e normal` (all targets).

## Crypto and security-relevant crates (audit notes)

| Crate | Version | Role | Notes |
|---|---|---|---|
| `ed25519-dalek` | 3.0.0 | Ed25519 identity keys and signatures (via `iroh-base`) | Part of the dalek-cryptography workspace. This release is a major bump (changelog 3.0.0, 2026-07-06). The dalek changelog mentions fixes found in a Quarkslab audit of the older 1.x line; we found no statement of an audit covering 3.0.0 itself, so none is claimed. |
| `curve25519-dalek` | 5.0.0 | Curve arithmetic under `ed25519-dalek` | Same workspace and caveat as above (changelog 5.0.0, 2026-07-06). |
| `noq`, `noq-proto`, `noq-udp` | 1.3.0 | QUIC implementation under iroh | n0's fork of Quinn, with multipath, QUIC address discovery and NAT traversal extensions. No third-party audit is stated in its README. TLS runs through rustls. |
| `rustls` | 0.23.45 | TLS 1.3 for QUIC and relays | Already in the tree before iroh. |
| `ring` | 0.17.14 | Crypto provider for iroh (`tls-ring`) | Already in the tree before iroh (aws-lc-rs 1.18.0 also was). iroh adds no new TLS backend. |

R2 must treat these as unaudited-by-us building blocks: friend codes, binding signatures and the hello key (spec 4.2, 5.2) rely on Ed25519 and SHA-256 through `iroh-base`, `ed25519-dalek` and `sha2`.

## Advisories (`cargo deny check advisories`)

Baseline: ok. With iroh in the tree one advisory appears:

- **RUSTSEC-2024-0436, `paste` 1.0.15 is unmaintained.** Path: `iroh` to `netwatch` to `netdev` to `netlink-packet-core` to `paste`. It is a proc-macro that runs at compile time only, and the netlink crates are Linux-only (network interface queries). No safe upgrade exists. It is ignored in `deny.toml` with this reason, next to the existing `proc-macro-error` entry; remove the entry when `netlink-packet-core` drops `paste`.

With that entry, `cargo deny --manifest-path src-tauri/Cargo.toml check advisories` reports `advisories ok`.
