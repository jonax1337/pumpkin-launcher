# Pumpkin Friends: Design Spec v2 (friends, world sharing via LAN tunnel, Fabric mod)

**Status: FROZEN, 2026-10-03 (v2); synced with the Wave 0 and Wave 1 implementation on 2026-10-03.** This document replaces v1 (`FRIENDS-SPEC.md`). It applies every finding of the security and feasibility reviews of v1, unless the changelog (Appendix D) says otherwise. It is the only source of truth for the protocol. R0a copies it to `docs/friends/SPEC.md`, and from then on the file in the repo is the spec. There is no separate PROTOCOL.md. The deviations reported by the Wave 0/1 packages are written back into the sections they concern (index in D.3). Deviations where the code still has to change are listed in Appendix E and are **not** reflected as done in the normative text.

**Owner decisions (final; recorded here, not open):**

| # | Decision |
|---|---|
| OD-1 | v1 keeps all three goals: the friends system, hosting a world for friends in other networks through the LAN tunnel, and the in-game Fabric mod. Moved to the v1.1 backlog (section 15, non-normative): automatic build of modded instances from a friend's manifest, `shareActivity`, `appearOffline`, alias UI beyond a minimal rename, Quilt, in-game join from the mod, and dedicated-server hosting (v2). Kept: the mod's pause-screen "share with friends", toasts, the friends list view and IPC (hardened as an untrusted channel), a minimal block, and the fingerprint on request and invite dialogs. v1 joins only when the friend already has a matching instance (MC version + loader family + non-client-only mod set). Otherwise it shows exactly what is missing, and offers to create a vanilla instance when the host runs vanilla. |
| OD-2 | Transport: iroh with a compiled-in relay map. The production plan is our own relay (D1 documents it). n0's public relays are allowed only in debug and closed-beta builds, and only when they are named in the PrivacyNotice with an explicit opt-in. Relay URLs are never peer-supplied. |
| OD-3 | The mod targets only the latest Minecraft release that research verified: **26.3**. A second MC version is v1.1 backlog. The mod is built with a full JDK (Temurin 25) downloaded into `mod/.jdk`. |
| OD-4 | Proceed even though Mojang's native P2P hosting may come back and overlap this feature. |
| OD-5 | Wave 0 viability gate. R0a (skeleton + deps) and R0b (throwaway spike CLI that builds and passes loopback tests) are agent work. The **owner personally** runs R0b on two machines in different networks. Waves 1+ may be built in parallel, but **the release is blocked** until the R0b numbers (direct vs relay path, echo latency) are recorded in `docs/friends/VERIFICATION.md` and the owner has run the two-PC end-to-end tests (13.4). |

**Change rule.** Sections 3-9 and Appendix A are the contract. A change to them is made in `docs/friends/SPEC.md` first, in the same PR as the code.

**Conventions.**
- Rust doc comments and `tracing` texts are German, identifiers English (CONTRIBUTING.md). Clean-code rules apply (load the `clean-code` skill).
- Contract serde rules: see 8.1. All user-facing backend errors are `AppError::invalid(coded!("errors.friends.*"))` and are only ever returned from commands. They are never inside an event or a state payload.
- "Peer string" = any string another launcher or the mod sends us. Every peer string goes through `sanitize` (12.3) before it is stored, shown or forwarded.

---

## 0. Decisions at a glance

| Topic | Decision |
|---|---|
| Transport | iroh 1.3 (QUIC, TLS 1.3, Ed25519 ids). Dial by id. Hole punching, with the relay as fallback. No address lookup service (no pkarr/DNS). |
| Relays | Compiled-in `RELAY_MAP` with stable one-byte indexes. Release: our relays only. Debug and closed beta: our relays plus n0's, with opt-in. Peers exchange relay **indexes** only. |
| Identity | Permanent Ed25519 key in the OS keyring. Without a keyring (Linux without a secret service) friends are unavailable. "Rotate" and "Reset" notify friends through a retired-key outbox (4.6). A missing key with existing data is the "identity lost" state. |
| Friend code | `pumpkin-` + 72 base32 chars (80 chars total). Payload: version, relay index, a **per-code ephemeral hello id**, a 9-byte secret and a 2-byte check. The permanent id is **not** in the code. Single use, 7-day TTL, at most 3 active. |
| Hello | Each active code is served by its own relay-only hello endpoint. Strangers without the right secret are closed without any answer. The invitee's request stays pending and is retried for 14 days while the inviter is offline. |
| Friendship | Mutual consent. The inviter accepts in the UI. Acceptance is delivered by the inviter dialing the invitee on the friends ALPN. |
| Presence | One connection per online friend, keep-alive 15 s, idle timeout 40 s. States `offline`, `online`, `playing`. At most 50 friends, with lazy dialing of friends not seen recently. |
| Tunnel | One QUIC bi-stream per Minecraft TCP connection, `TCP_NODELAY` on every local socket. Host: only to the LAN port, and only after it is verified to be **owned by the game PID and answering a server list ping**. Guest: a single-owner listener on a random loopback address, with a handshake nonce check and a PID check. |
| LAN port | Mod hint, strict log parser, or manual entry. Every source is verified the same way (PID + ping). Ends on `Stopping server`, unpublish, game exit, or a failed liveness probe. |
| Join | Only into an existing matching instance (MC version + loader + non-client-only mod set, compared by **sha512**). Vanilla host: an offer to create a vanilla instance. No downloads from or on behalf of the host. Minimum MC version for hosting and joining: **1.20**. |
| Mod | Fabric, MC 26.3, client only. Pause-screen friends screen (list, share, guests, stop) and toasts. JSON lines over loopback with a per-launch env token. The launcher treats it as untrusted: the first `share` per launch needs confirmation in the launcher. |
| Contract | One serde convention (`tag = "type"`, camelCase fields), no `AppError` in payloads, shared JSON fixtures checked by both Rust and `tsc`. |
| Default | Everything is off. Enabling needs an explicit opt-in and a Microsoft account. |

---

## 1. Scope

### 1.1 Goals (v1)
1. **Friends.** Codes, mutual consent, presence, removal, a minimal block, rotate and reset of the identity.
2. **Host a world.** The host opens a singleplayer world to LAN (through the mod or vanilla). The launcher tunnels the verified LAN port to invited, online friends.
3. **Join.** The guest accepts an invite and joins with an existing matching instance through Quick Play. If nothing matches, the UI lists what is missing or extra. A vanilla host gets a "create vanilla instance" offer.
4. **Mod.** Fabric 26.3 client mod: a friends screen from the pause menu (presence list, share, guest list with kick, stop) and toasts. Without the launcher it does nothing.
5. **Privacy.** Opt-in, off by default, invite-only, no telemetry, no chat, honest IP wording, "always relay".

### 1.2 Non-goals (v1)
- Chat, voice, activity feed, activity sharing, appear offline.
- Public links, adding by bare id, discovery, deep links.
- Building or changing an instance from a friend's manifest (v1.1). Transferring any file between peers.
- Quilt, Forge or NeoForge mod builds, and a mod for any MC version other than 26.3.
- In-game join from the mod. The mod points the player to the launcher.
- Hosting or joining for MC versions older than 1.20, or with an offline account.
- Integrating with Mojang's Friends List (O key). Tray icon or a background process after the window closes.

### 1.3 Release gate (normative)
The v1 release (any build for non-developers, including the closed beta) is blocked until all of these hold:

| Gate | Condition | Recorded in |
|---|---|---|
| G1 | The R0b spike numbers exist for at least 3 network pairs: (a) two different home ISPs or home + office, (b) home + mobile hotspot (CGNAT), (c) any pair with `--relay-only`. Each row has the path (direct/relay), time to connect, echo p50/p99, and whether a vanilla LAN join worked through the spike tunnel. | `docs/friends/VERIFICATION.md` |
| G2 | The owner ran the 13.4 end-to-end table on two PCs in different networks with two Microsoft accounts, every row "pass". The real Microsoft login test (still open per MEMORY) is done first. | same |
| G3 | Release builds contain only our relays in `RELAY_MAP`, and our relay passed the D1 acceptance (QUIC address discovery on UDP 7842 works, `online()` completes). | same |
| G4 | The compliance checklist (Appendix C) is ticked, and the owner has confirmed that the Mojang/MS approval covers sharing player names and UUIDs between users. | same |
| G5 | CI is green (13.5). | CI |

Closed-beta builds with n0 relays need G1, G2, G4 and G5, plus the n0 opt-in (3.2).

### 1.4 v2 note (non-normative)
Dedicated-server hosting from an instance is planned for v2. It will reuse the tunnel (section 6) and keep online-mode and an explicit EULA click. No design is frozen for it.

---

## 2. Architecture

```
HOST PC                                                   GUEST PC
Minecraft (integrated server, LAN port L, all interfaces)  Minecraft (Quick Play -> 127.a.b.c:F)
  pumpkin_friends mod --JSON lines--+                        (mod optional, no join from the mod)
        ^ TCP 127.0.0.1:L           |                                 | TCP 127.a.b.c:F
Launcher (Rust)                     v                        Launcher (Rust)
  gamesignal <- lan_detect (stdout), modbridge, spawn/exit     gamesignal <- spawn/exit
  sockowner (PID owns L?) + server_ping (answers?)             sockowner (PID owns client socket?)
  friends: hosting, manifest, mod_link                         friends: joining (single-owner listener), matching
  p2p main endpoint  <==== QUIC peer/1 (direct or relay) ====> p2p main endpoint
  p2p hello endpoints (one per active code, relay-only)        (dials hello endpoints when redeeming a code)
  React UI (no network access)                                 React UI
                     \---- TCP 443 + UDP 7842 ----> [relay from RELAY_MAP] <----/
Modrinth API: guest only, for client-only classification and titles (no downloads in the join flow)
Mojang sessionserver: Rust only, for friend skins (cached)
```

Rules:
- The webview never fetches friend data from the network. Skins come from the `friend_skin` command (Rust fetches and caches).
- The launcher never listens on a non-loopback socket of its own. The game's LAN port binds all interfaces, as in vanilla (12.1).
- The game and the mod never see peer ids, IPs or keys. The mod sees sanitised names, opaque friend ids and states.
- The tunnel lives in the launcher process. With friends enabled, closing the window minimizes it (10.7).

---

## 3. Transport

### 3.1 Library
- `iroh = "1.3"` with default features (locked at iroh 1.3.0, iroh-relay 1.3.0, noq 1.3.0; the spike `tools/p2p-spike` and the relay image stay in lockstep). It compiles against tokio 1.53.1, reqwest 0.13.5 and rustls 0.23.45. Default features include `tls-ring`; ring and aws-lc-rs were already in the tree, so there is no new TLS backend. R0a measured **+4.9 MiB** release binary on Windows (probe with `presets::N0`, `docs/friends/DEPENDENCIES.md`); the real endpoints use `presets::Minimal`, so I1 re-measures the final figure.
- The feature `unstable-net-report` (relay-observed public address, `Endpoint::net_report`) has no semver guarantee and is **not** enabled in the launcher. Only the spike enables it to print the QUIC-address-discovery result for G3.
- R0b documents the exact 1.3 API in `docs/friends/IROH-NOTES.md`. Where this spec names an iroh call, the notes are authoritative for the spelling, and this spec for the behaviour. IROH-NOTES section 10 lists where iroh differs from the v2 draft; every item is written back below.

### 3.2 Relay map (`services/p2p/relays.rs`)
```rust
#[derive(Debug, Clone)]
pub struct RelayEntry { pub index: u8, pub url: Cow<'static, str>, pub operator: RelayOperator, pub quic_port: Option<u16> }
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum RelayOperator { Pumpkin, N0 }
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum RelaySelection { All, Only(u8) }   // which map entries an endpoint uses
pub const RELAY_MAP: &[RelayEntry];   // compiled in, per build profile (entries use Cow::Borrowed)
pub fn find_relay(map: &[RelayEntry], index: u8) -> Option<&RelayEntry>;   // unknown index (e.g. from a peer) -> None
```
- `url` is a `Cow` only so that tests can pass a runtime relay map (3.7). Production code never builds an entry at runtime; the only production source of entries is `RELAY_MAP`.
- **Index rules.** Indexes are stable forever. Entries are only appended, and a removed relay leaves its index unused. Indexes 0-99 are ours, and 200-209 are n0's.
- **Release build** (`not(any(debug_assertions, feature = "beta-relays"))`): only `RelayOperator::Pumpkin` entries (`https://relay-eu1.<relay-domain>/` = index 0, with `quic_port: Some(7842)`). **Current state: `RELAY_MAP = &[]`**, because our relay is not deployed yet. Release builds therefore cannot connect friends until I1 adds index 0 (gate G3).
- **Debug builds and closed-beta builds** (`any(debug_assertions, feature = "beta-relays")`; the cargo feature `beta-relays` is off by default and lives in its own `[features]` section of `src-tauri/Cargo.toml`): ours plus n0's production relays. **Current state:** only the n0 entries `200 use1-1`, `201 usw1-1`, `202 euc1-1`, `203 aps1-1` (`https://<name>.relay.n0.iroh.link./`, `quic_port: Some(7842)`), copied from `iroh::defaults::prod` of the locked version (not `RelayMode::Default`, which could switch to staging). A unit test keeps them equal to the locked iroh. I1 adds our index 0 to **both** variants.
- If `RELAY_MAP` contains a `N0` entry, `friends_enable` requires `acceptThirdPartyRelays = true` (else `errors.friends.relayConsentRequired`). The PrivacyNotice and the opt-in dialog name n0 as the operator.
- **Building the iroh `RelayMap`** (`relays.rs`, `SelectedRelays`, internal): for `quic_port: Some(port)` the entry becomes `RelayConfig::from(url)` with its QUIC address-discovery port set to `port`; for `None` it becomes `RelayConfig::new(url, None)` (no address discovery). An endpoint whose selection is empty runs with `RelayMode::Disabled`; otherwise `RelayMode::Custom(map)`, never iroh's built-in relays. An invalid URL fails the bind with `NetError::InvalidRelayUrl`, and `RelaySelection::Only(i)` with an index not in the map fails with `NetError::UnknownRelay(i)`.
- **Peer-supplied relay data is an index only.** Never store, dial or log a URL received from a peer. Unknown indexes are ignored. A test asserts that a `hello` whose `homeRelay` is not in the map makes no connection attempt anywhere except the map's relays.
- The map changes only through a launcher update (the signed updater). There is no setting for it.

### 3.3 Endpoints
| Endpoint | Key | ALPNs | Relays | IP transports | Lifetime |
|---|---|---|---|---|---|
| **Main** (one per process) | permanent identity | `pumpkin/peer/1` | whole map | on, unless `alwaysRelay` (`clear_ip_transports`) | while the feature is enabled and available |
| **Hello** (one per active code, at most 3) | per-code hello key (4.2) | `pumpkin/hello/1` | only the map entry at the code's relay index | **always off** (relay-only; `NetOptions.hello_relay_only`, 3.7) | while the feature is enabled and the code is unexpired |
| **Retired** (dial-only, transient) | retired key (4.6) | none accepted, dials `pumpkin/peer/1` | whole map | always off | only while delivering one outbox item |

Builder settings for all endpoints (`p2p/endpoint.rs`):
- `Endpoint::builder(presets::Minimal)`: no address lookup (no DNS/pkarr publisher or resolver). `secret_key` from `NetConfig.secret`, `alpns` from `NetConfig.alpns`, relay mode as in 3.2, `hooks(GateHooks)` (3.5). `relay_only` maps to `clear_ip_transports()`.
- Transport config: keep-alive 15 s, idle timeout 40 s, `max_concurrent_bidi_streams = 16`, `max_concurrent_uni_streams = 0` (constants in `endpoint.rs`). The keep-alive is connection-wide; inside, iroh keeps every path alive every 5 s and caps a path's idle time at 15 s whatever is configured (IROH-NOTES 10.7). Offline detection is governed by the connection idle timeout (40 s). The idle timeout is currently a constant without a test seam (Appendix E, E1).
- Every dial is wrapped in `tokio::time::timeout(DIAL_TIMEOUT = 8 s)` (an offline peer otherwise costs up to the idle timeout). Relay reachability is judged after `ONLINE_WAIT = 5 s` (3.4).
- **Every endpoint runs an accept loop** for its whole life (`PeerNet::bind` spawns it). Without one, dialers of that endpoint would hang until their timeout instead of being refused (IROH-NOTES 10.5). The retired endpoint has no ALPNs, so any inbound handshake fails at once.
- **Test builds** (`cfg(test)`): an endpoint with IP transports binds only `127.0.0.1:0` (`clear_ip_transports` + `bind_addr`), so no test causes a firewall prompt or leaves the machine. This applies to every test in the crate, including the later R4 and R5 tests.

**Dialing a peer:** `PeerNet::dial(peer, alpn)` builds `EndpointAddr::from_parts(id, every relay URL of the dialing endpoint's own selection)`. It never uses an address or URL from a peer. iroh sends the first packets to every relay of the address at once (IROH-NOTES 4), so a multi-relay address works and "home relay first" is neither expressible (`EndpointAddr.addrs` is a `BTreeSet`) nor needed. The peer's announced `homeRelay` index therefore does not change how it is dialed; it is stored (`FriendRecord.home_relay`) and must be in the map, otherwise ignored (3.2). An id without any relay URL is not dialable (`NoAddress`), not even on loopback, because no address lookup is configured.

**Accepting:** a background task accepts `Incoming`s. At most 8 handshakes run concurrently; further `Incoming`s are `ignore()`d (3.5). Connections the Gate admitted wait in a queue of 16 for `PeerNet::accept()`; when nobody receives any more, a new connection is closed with `SHUTDOWN`. Dropping a `PeerNet` aborts the task and ends all its connections locally, so a `PeerNet` must outlive its `PeerConn`s.

### 3.4 Fallback order
1. Direct UDP path after hole punching.
2. Relay path (shown as "Relay" in the UI).
3. "Always relay": the main endpoint runs without IP transports.
4. No relay reachable: `NetworkStatus::Degraded { reason: relayUnreachable }`, and all friends show offline.

**Detecting it** (IROH-NOTES 10.4): when no relay of the map can be reached, `online()` never completes and `home_relay_status()` stays empty (an unreachable relay never becomes the home relay), so there is no error to read. `PeerNet::status()` therefore reports a `NetState` (`p2p/endpoint.rs`): it starts as `Starting`; once a home relay is connected, or at the latest after `ONLINE_WAIT` (5 s), it becomes `Online { home_relay }` (the map index of the connected home relay) or `RelayUnreachable`, and from then on follows iroh's home-relay watcher until the endpoint closes. R4 maps it onto the contract:

| `NetState` / bind result | `NetworkStatus` |
|---|---|
| `Starting` | `Starting` |
| `Online { home_relay }` | `Online { relay_host }`, host taken from `find_relay(&net.relay_map, home_relay)` |
| `RelayUnreachable` | `Degraded { reason: RelayUnreachable }` |
| `PeerNet::bind` returned `Err` | `Degraded { reason: BindFailed }` |

### 3.5 Admission (`Gate`, `EndpointHooks::after_handshake`)
`services/p2p` knows nothing about friends:
```rust
/// Entscheidet nach dem TLS-Handshake über eine eingehende Verbindung; die Peer-ID ist dann authentisch.
pub trait Gate: Send + Sync + 'static { fn admit(&self, peer: &PeerId, alpn: &[u8]) -> Admission; }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admission { Accept, Reject(CloseCode), Drop }
```
- `Gate::admit` is **synchronous** (it runs inside the iroh hook). Everything it needs (friends, blocked peers, outgoing `awaitingAnswer` requests, hello rate limits) must be held in memory by the caller.
- The internal `GateHooks` (`p2p/gate.rs`) implements `EndpointHooks::after_handshake`. iroh runs that hook for **outgoing connections too** (IROH-NOTES 10.2); `GateHooks` returns `Accept` for `Side::Client` without asking the Gate, so outgoing connections stay ungated.
- `Reject(code)` becomes `AfterHandshakeOutcome::Reject { error_code: code, reason: empty }`. The dialer's `connect` **succeeds**, then the connection ends with `CloseReason::Peer(code)`. On the accepting side the handshake fails, so `PeerNet::accept` never sees the connection.
- `Drop` cannot be frameless after the handshake (IROH-NOTES 10.1): it is `Reject` with code 0 (`NORMAL`) and an empty reason. QUIC still sends a CONNECTION_CLOSE, and the remote sees `CloseReason::Peer(NORMAL)`, exactly like a normal end. **No application frame is ever sent**, so to the remote it looks like a closed dead end, not a refusal. The only fully silent option is `Incoming::ignore()` before the handshake, when the peer id is not known yet (used for the handshake cap below).
- Main endpoint, `pumpkin/peer/1`: `Accept` if the peer is a stored friend (confirmed or not) and not blocked, **or** we have an outgoing request in state `awaitingAnswer` whose `peerId` is this peer. Otherwise `Reject(NOT_FRIEND)`. A blocked friend therefore sees exactly what a removed friend sees.
- Hello endpoint, `pumpkin/hello/1`: `Drop` if the peer is blocked or over a hello rate limit (12.4), otherwise `Accept`. The secret is checked on the first frame (5.2).
- Pre-handshake: if 8 handshakes are already in flight on an endpoint, new `Incoming`s are `ignore()`d (nothing is sent back). "In flight" = `Incoming`s being awaited in the accept task (semaphore `MAX_HANDSHAKES = 8`). There is no dedicated test of this cap yet (Appendix E, E2).
- Outgoing connections are not gated (see `GateHooks` above).

### 3.6 Close codes (QUIC application error codes)
`0 NORMAL` (also used for silent drops), `1` reserved/unused, `2 NOT_FRIEND`, `3 DUPLICATE`, `4 PROTOCOL` (bad frame, size, or tunnel validation; also the stream reset code), `5 RATE_LIMITED`, `6 SHUTDOWN` (launcher exit, disable, rebind).
- In code: `pub struct CloseCode(u32)` with the constants `CloseCode::{NORMAL, NOT_FRIEND, DUPLICATE, PROTOCOL, RATE_LIMITED, SHUTDOWN}` (`p2p/conn.rs`). How a connection ended is a `CloseReason { Peer(CloseCode), Local, TimedOut, Lost }` (`TimedOut` = idle timeout, e.g. a crashed peer).
- `Endpoint::close()` alone would close every open connection with code 0 (IROH-NOTES 10.3). `PeerNet::close(code)` therefore first closes every tracked connection with `code`, then closes the endpoint. R4 calls `close(CloseCode::SHUTDOWN)` before dropping or rebinding an endpoint.
- `bridge` (6.3) resets its stream with `NORMAL` when its `stop` token is cancelled.

### 3.7 Network options (normative test seam)
The friends service never reads `RELAY_MAP` directly. It gets its network configuration injected (`services/friends/service.rs`, R4):
```rust
pub struct NetOptions { pub relay_map: Vec<RelayEntry>, pub hello_relay_only: bool, pub relay_tls: RelayTls }
impl NetOptions { pub fn production() -> Self; }   // relay_map = RELAY_MAP.to_vec(), hello_relay_only = true, relay_tls = Verify
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelayTls { Verify, #[cfg(test)] InsecureForTests }                          // defined in services/p2p/endpoint.rs (R1)
impl Friends { pub fn new(dirs: &Dirs, secrets: Arc<dyn SecretStore>, signals: GameSignals, bridge: ModBridge, net: NetOptions) -> Self; }
```
- `lib.rs` passes `NetOptions::production()`. No other production call site exists, and there is no setting for any field.
- R4 maps the options onto `NetConfig` (8.7): every endpoint gets `relay_map` and `relay_tls`; hello endpoints get `relay_only = hello_relay_only` and `RelaySelection::Only(code.relay_index)`. This mapping is a pure function (`hello_net_config`) and unit-tested.
- **Tests** use an in-process relay: `iroh::test_utils::run_relay_server()` (dev-dependency `iroh` with `test-utils`, added by R0a) returns `(RelayMap, RelayUrl, Server)`; the `Server` guard must stay alive. R4 and R5 copy the helper `test_relay()` from `services/p2p/tests.rs`: it returns `(RelayEntry { index: 0, operator: Pumpkin, url, quic_port: the server's random QUIC port }, impl Send guard)`. That entry is the only `relay_map` entry, with `relay_tls = InsecureForTests` (= `ca_tls_config(CaTlsConfig::insecure_skip_verify())`) and `hello_relay_only = true`. This is the configuration for every test that runs the hello flow.
- **Every** test that connects two endpoints needs that relay entry, because a bare id is not dialable (3.3), even on loopback. Pure logic tests that never touch a hello endpoint may set `hello_relay_only = false`; their endpoints bind `127.0.0.1` only (3.3), and the path usually upgrades from `Relay` to `Direct`.
- `InsecureForTests` exists only under `cfg(test)`, so a release build cannot skip relay certificate checks. Consequence: it is usable only by tests inside the `src-tauri` crate (unit tests), not by integration tests or examples.

---

## 4. Identity, codes, requests, presence, removal, identity operations

### 4.1 Identity
- Permanent `SecretKey` (32 bytes), stored through `services/secrets.rs`: trait `SecretStore { load(name) -> AppResult<Option<String>>, save(name, value), delete(name) }` (a missing entry is `Ok(None)` and deleting it is `Ok`; every other error means "keyring unusable"), the keyring implementation `KeyringSecrets`, and the in-memory fake `MemorySecretStore` (`cfg(test)` only, so in-crate tests only). Keyring service `dev.laux.launcher`, entries `friends-identity` and `friends-identity-retired`, value = 64 lowercase hex. `auth/keyring.rs` is refactored onto `secrets.rs`.
- A keyring entry that is not 64 hex chars is treated as **missing** (warning in the log), which yields `identityLost` when friends data exists. It is never silently replaced.
- `PeerId` = EndpointId as 64 lowercase hex. In Rust it is the type `services::p2p::PeerId` (R1, 8.7). The R2 helpers work on plain `&str`/`String` ids (R2 does not depend on R1); R4 converts with `PeerId::from_str`, which accepts exactly the same strict spelling as `identity::parse_peer_id`. **Fingerprint** = the first 16 hex chars in 4 groups of 4 (`3f9a c021 77de 01b4`, `identity::fingerprint`). It is shown in Settings, in the friend menu, and always next to the name on request and invite dialogs. Logs use the 8-char short form (`identity::short_id`, `PeerId::short`, and `PeerId`'s `Debug`).
- **Availability** (computed at startup and on every enable):
  | State | Condition | Effect |
  |---|---|---|
  | `noSecretStore` | the keyring probe fails with a platform error (not "no entry"), e.g. Linux without a secret service | Every friends command except `friends_state` fails with `errors.friends.unavailable`. The Friends navigation entry is hidden. Settings explains why. Keys are never stored in files. |
  | `identityLost` | no `friends-identity` entry, but `config.enabled` or any record exists | Only `friends_state` and `friends_reset` work. Others fail with `errors.friends.identityLost`. The UI shows "Identität verloren" and the reset action. A new key is never created silently. |
  | `available` | otherwise | normal |

  Computed by `identity::availability(secrets, has_friends_data)`, where R4 passes `config.enabled || stores.any()`. `RecordStores::any()` sees only readable records (D.3).
- Key operations (`friends/identity.rs`): `identity::create(secrets)` makes and stores a new key without an existence check (R4 checks availability first). `identity::renew(secrets) -> Renewal { retired: Option<Identity>, current: Identity }` is the key move shared by `friends_rotate_identity` and `friends_reset`: the current key (if any) is saved as `friends-identity-retired` first, then a new key becomes `friends-identity`. `load`, `load_retired` and `delete_retired` complete the set.
- Profile announced to friends (self-asserted, marked as such in the UI): `displayName` (3-32 chars after sanitising), and `mcName`/`mcUuid` of the active Microsoft account at enable time, updated via `profile` when the account changes.
- Signing: `Identity::sign(&self, domain: &[u8], parts: &[&[u8]]) -> [u8; 64]` and the free function `identity::verify(peer_id: &str, domain, parts, sig: &[u8; 64]) -> bool` (Ed25519 over `domain || parts...`; an invalid id counts as a wrong signature). "sign_new"/"sign_permanent" in 4.6 and 5.2 mean `sign` on the respective `Identity`.

### 4.2 Friend code (`services/friends/code.rs`, `src/lib/friendCode.ts`)
```
payload = [0x02 version][relay index u8][hello EndpointId 32 B][secret 9 B][check 2 B]     // 45 bytes
check   = SHA-256(version || relay index || hello id || secret)[0..2]
code    = "pumpkin-" + base32(RFC 4648, lowercase alphabet a-z2-7, no padding)(payload)      // 8 + 72 = 80 chars
```
- Constants (also in TS, checked by fixtures): `FRIEND_CODE_PREFIX = "pumpkin-"`, `FRIEND_CODE_BODY_LENGTH = 72`, `FRIEND_CODE_LENGTH = 80`, display groups of 4.
- **Hello key:** `hello_secret = SHA-256("pumpkin/hello-key/2" || identity_secret(32) || salt(16))`, with a random 16-byte `salt` per code stored in `CodeRecord`. No extra keyring entries are needed. The permanent id cannot be derived from the code. In code: `Identity::hello_secret(&salt)` is the `NetConfig.secret` of the code's hello endpoint, and `Identity::hello_id(&salt)` its id.
- **Parsing** (Rust authoritative, TS checks shape only): trim, lowercase, require the prefix, remove spaces and `-` from the rest, then require exactly 72 chars of the alphabet. Rust then checks the version (`0x02`) and the checksum (`errors.friends.codeInvalid`). A relay index not in our map gives `errors.friends.protocolUnsupported`. A hello id equal to one of our own active codes gives `errors.friends.codeOwn`.
- **Golden vectors:** Appendix B. Rust (`code.rs` tests) and `friendCode.check.mjs` both assert them.
- **Inviter storage:** `CodeRecord { id, salt, secretSha256, relayIndex, tail (last 4 chars), createdAt, expiresAt, usedBy? }`. `salt` is the 16 random bytes as hex; `secretSha256` is the lowercase-hex SHA-256 of the 9 raw secret bytes. The plain code is returned once, by `friend_code_create`.
- **Rust API** (`friends/code.rs`; randomness from `getrandom`):
  - `code::issue(identity, relay_index) -> AppResult<IssuedCode { salt: [u8; 16], parts: CodeParts }>`.
  - `code::parse(input) -> AppResult<CodeParts>` (normalisation, version and checksum; `codeInvalid`).
  - `CodeParts { relay_index, hello_id: [u8; 32], secret: [u8; 9] }` with `encode()`, `tail()`, `secret_hex()` (18 lowercase hex, the `friendRequest.secret`), `secret_digest()` (= `secretSha256`), `ensure_relay_known(|index| map has index)` (`protocolUnsupported`) and `ensure_not_own(&own_hello_ids)` (`codeOwn`; R4 passes `identity.hello_id(&record.salt)` of every active code). The two checks take their input from the caller because R2 knows neither `RELAY_MAP` nor the active codes.
  - `code::secret_matches(secret_sha256, secret_hex) -> bool`: the hello check of 5.2.
- **TS helpers** (`src/lib/friendCode.ts`, shape only): `normalizeFriendCode(input): string | null`, `isFriendCodeShape(input): boolean`, `friendCodeBodyGroups(code): string[]`.
- Limits: TTL **7 days**, single use, at most **3** active codes (`errors.friends.tooManyCodes`). Revoking or expiring a code shuts its hello endpoint down.

### 4.3 Friend request (mutual consent)
```
Invitee B                                               Inviter A (code owner)
friend_add(code): store Outgoing{state: delivering, helloId, relayIndex, secret, expiresAt = now+14 d}
dial helloId via map[relayIndex] on hello/1 (8 s) ---->  hello endpoint (relay-only). Gate: Drop if blocked/rate limited
send friendRequest{secret, profile} ------------------>  secret matches an active code?
                                                          no  -> close 0, no frame (silent)
                                                          used by another peer -> error{codeUsed}
                                                          B already a friend -> error{alreadyFriends}
                                                          ok  -> mark code usedBy=B, store Incoming{B}, emit friend-request
<------------------ received{peerId: A, binding, profile} (binding = A's permanent-key signature, 5.2)
verify binding, store Outgoing{state: awaitingAnswer, peerId: A}
close NORMAL
         ... A clicks "Annehmen" ...                      friend_request_answer(accept=true):
                                                          store Friend{B, confirmed:false}, delete Incoming
<========= A dials B on peer/1 at once, then per presence backoff ==  (B's Gate: outgoing awaitingAnswer to A -> Accept)
control hello from A  -> B stores Friend{A, confirmed:true}, deletes Outgoing; B answers hello
                                                          A sets confirmed=true on B's hello
```
- **Dialing the hello endpoint:** B uses its main endpoint: `PeerNet::dial(&PeerId::from_bytes(&parts.hello_id)?, b"pumpkin/hello/1")`. The address carries every relay of B's map (3.3), which includes `relayIndex` (checked by `ensure_relay_known`). `RequestRecord.helloId` is the hex of the hello id, and `RequestRecord.secret` is `parts.secret_hex()`, kept for retries.
- **Inviter offline when B redeems:** the request stays `delivering`. B's presence loop retries the hello dial with backoff 30 s, 2 min, 5 min, 10 min, then every 30 min, for up to **14 days** from `friend_add`. The UI shows "Wird zugestellt, sobald der Besitzer des Codes online ist". `peerOffline` is never shown for this.
- **Immediate retry:** `friends_retry_now` (8.4) dials every `delivering` request at once, ignoring its backoff, and then restarts its backoff at the first step (30 s). A request whose attempt is still in flight or started less than 10 s ago is skipped. The UI calls it when the Friends page opens and from the "Jetzt zustellen" button of a `delivering` row (10.2). B cannot see when A comes online, so this is how B gets a prompt delivery; the backoff remains the unattended fallback.
- **Possibly expired code:** B cannot know the code's expiry, and an expired or revoked code gets no answer (its hello endpoint is gone). When a `delivering` request is older than `CODE_TTL_SECS` (7 days), the UI adds the hint "Der Code ist eventuell abgelaufen; frag nach einem neuen." The retries still continue until the 14-day request TTL.
- **Invitee offline when A accepts:** A dials B through the presence loop (same backoff). An unconfirmed friend shows "Wartet, bis {name} online kommt". After 14 days unconfirmed, the record is removed.
- **Decline:** A deletes the incoming request. Nothing is sent. B's request expires after 14 days.
- **Cancel (B):** deletes the outgoing request. If A had accepted, A's next dial gets `NOT_FRIEND`, and A shows the friend as "removed".
- **Incoming TTL:** 14 days. At most 20 pending incoming requests (`error{full}`).
- **Idempotence:** a repeated `friendRequest` with the right secret from the peer that used the code gets `received` again.
- **Limits:** at most 50 friends (`errors.friends.friendLimit`), counting confirmed and unconfirmed friends plus outgoing requests.

### 4.4 Presence
- Runs while the feature is enabled and available.
- **Eager dialing** at startup and whenever the endpoint comes online: unconfirmed friends, friends seen in the last 7 days, and outgoing requests in `delivering`. At most 4 concurrent dials, 8 s each.
- **Lazy dialing** for all other friends: once, 60 s after startup, then every 60 min. `friends_retry_now` (called when the Friends page opens) also dials every offline friend whose last attempt is more than 2 min old, besides the `delivering` requests (4.3).
- Backoff per friend after a failed eager dial: 30 s, 2 min, 5 min, 10 min, then every 30 min. An inbound connection from a friend resets the backoff and counts as online.
- **Control stream:** the dialer opens it. Both sides send `hello` first, then `status`. `status` is re-sent only on change (`online`, or `playing` while any instance runs; no details).
- **Duplicates:** keep the connection dialed by the peer with the lexicographically lower `PeerId`, and close the other with `DUPLICATE`. In code: `p2p::duplicate_survivor(local, remote) -> Direction` (`Outgoing` when `local < remote`, else `Incoming`; `PeerId` orders bytewise, which equals the hex order) compared with `PeerConn::direction()`.
- **Offline:** `SHUTDOWN` means offline at once. The idle timeout means offline after at most 40 s. Then lazy or eager dialing resumes.
- `lastSeen` (unix secs) is updated on disconnect. Profile and status persistence is debounced (at most one `friends.json` write per 5 s).
- **Hosting is never broadcast.** Only invited friends learn of a session.

### 4.5 Removal and block
- **Remove:** send `unfriend` if connected, delete the record, close with `NORMAL`, stop dialing.
- **Receiving `unfriend`, or `NOT_FRIEND` on dial from a peer we consider a friend:** set `removedByPeer = true` and stop dialing. The UI shows "Hat die Freundschaft beendet" with only "Entfernen". Exception: `NOT_FRIEND` from a friend with a pending `rotated` outbox item is expected and ignored (4.6).
- **Block** (a friend or a request peer): remove as above but without sending `unfriend`. Add `BlockedPeer`. Blocked peers get `NOT_FRIEND` on peer/1, and are dropped silently on hello/1. Their requests are discarded.
- **Unblock** only removes the block.
- Settings shows a minimal blocked list with "Entsperren". No central reporting.

### 4.6 Rotate, reset, retired key
| Action | Effect |
|---|---|
| `friends_rotate_identity` | A new key becomes `friends-identity`. The old key moves to `friends-identity-retired`. For every friend, an outbox item `rotated{newPeerId, signature}` is stored, with `signature = sign_new("pumpkin/rotate/1", old_id, new_id)`. **All active codes are revoked and deleted, and their hello endpoints shut down**: a hello key is derived from the identity secret (4.2), so an old code cannot be served without keeping the old secret, which would defeat the rotation. Pending incoming requests and outgoing `awaitingAnswer` requests are deleted too, because they are bound to the old id; outgoing `delivering` requests are kept and are delivered under the new id. `Lifecycle::IdentityChanged` is delivered (8.7), then the main endpoint rebinds (`SHUTDOWN`). Friends are kept. The confirm dialog says that codes and waiting requests are dropped (10.8). |
| `friends_reset` | For every friend, an outbox item `unfriend` is stored (only if the old key exists). The old key becomes the retired key. All friends, requests, codes (with their hello endpoints) and blocks are deleted. `Lifecycle::IdentityChanged` is delivered (8.7). A new identity is created. The feature stays in its enabled state. In `identityLost` there is nothing to notify, so only the deletion and the new identity happen. |

- **Outbox delivery:** while the feature is enabled, a transient **retired endpoint** (old key, relay-only) dials each pending friend (same backoff as presence), opens the control stream, sends `hello` then the outbox message, waits for `{"type":"ack"}` (10 s), and closes with `NORMAL`. A delivered item is deleted. Items expire after 14 days. When the outbox is empty, the retired key is deleted from the keyring.
- **Receiving `identityRotated`:** verify that the signature is by `newPeerId` over (old id = the authenticated remote, new id). On success: change the friend record's id to `newPeerId`, set `notice = identityChanged{previousFingerprint}`, send `ack`, and close. On failure: close with `PROTOCOL`.
- **Receiving `unfriend` from the retired key:** handled as in 4.5.
- Only one retired key exists at a time. Rotating or resetting while an outbox exists drops the older outbox, and the confirm dialog says so.
- A thief who has the old key cannot undo a rotation: after it, the friend's gate no longer admits the old id.

---

## 5. Wire protocol between launchers

### 5.1 Framing and limits
- Frame: `u32` big-endian length, then UTF-8 JSON, one object with a `"type"` string. The length is checked before any allocation. Over the limit means `PROTOCOL`, in two steps:
  - `services/p2p` (R1) resets the **stream**: `BiStream::read_frame(limit)` resets both directions with `PROTOCOL` on any frame error (too large, bad JSON, IO). The generic `p2p::frame::read(recv, limit)` / `frame::write(send, &msg, limit)` work on any `AsyncRead`/`AsyncWrite` and never reset; `write` sends nothing over the limit. Errors are `FrameError { TooLarge { len, limit }, Json, Io }`.
  - The friends service decides about the **connection**: a frame error on the hello stream or the control stream closes the connection with `PROTOCOL` (R4); on a request or tunnel stream the stream reset is enough (R4/R5).
- The per-context limits below are constants of the friends protocol (R4 for hello, control and request streams; R5 for the tunnel open frame), not of `p2p`.

  | Context | Limit per frame |
  |---|---|
  | hello/1 | 4 KiB |
  | control stream | 16 KiB |
  | request/response stream | 512 KiB |
  | tunnel open frame and response | 1 KiB |

- Within `/1`, fields are only added, as `Option` + `#[serde(default)]`. Unknown fields are ignored. An incompatible change means a new ALPN `/2`. `hello.protocol` = 1, `hello.features` = `[]`.
- Unknown message types: on the control stream, ignore and log at debug. On request streams, answer `error{code:"unsupported"}`.
- Timeouts: first frame on a new stream 10 s, request + response 30 s, hello exchange 10 s.
- Every peer string in every frame is sanitised (12.3) before use. Every id and hash is format-checked.

### 5.2 `pumpkin/hello/1` (one bi stream, one request, one response)
```jsonc
// invitee -> inviter (hello endpoint)
{"type":"friendRequest","protocol":1,"secret":"<18 lowercase hex>",
 "profile":{"displayName":"Alex","mcName":"Alex"|null,"mcUuid":"<32 hex>"|null}}
// inviter -> invitee
{"type":"received","peerId":"<64 hex>","binding":"<128 hex>","profile":{...}}
{"type":"error","code":"codeUsed"|"alreadyFriends"|"full"|"unsupported"}
// wrong secret, blocked, rate limited: no frame, close code 0
```
- `binding = sign_permanent("pumpkin/bind/1", hello_id, invitee_permanent_id)`. The invitee verifies it against `peerId`, with `hello_id` = the dialed id and its own id. If the check fails, the request stays `delivering` and the attempt counts as failed. This proves that whoever controls the code's hello key also controls `peerId`.

### 5.3 `pumpkin/peer/1`
Every bi stream starts with an **open frame** from the opener: `{"type":"control"}` (one per connection, opened by the dialer), `{"type":"request"}`, or `{"type":"tunnel","sessionId":"<uuid>"}`.

R4 owns the accept loop and the control stream. It dispatches `request` and `tunnel` streams and the control messages `invite`, `inviteRevoke` and `inviteDecline` through the `PeerStreamHandler` seam (8.7), which R5 implements. With no handler registered, a request stream gets `error{unsupported}`, a tunnel stream gets `error{sessionNotFound}`, and the three invite messages are ignored (debug log).

**Control stream (both directions):**
```jsonc
{"type":"hello","protocol":1,"features":[],"launcher":"0.2.0",
 "profile":{"displayName":"Alex","mcName":"Alex"|null,"mcUuid":"…"|null},"homeRelay":0|null}   // first frame each way; homeRelay = map index
{"type":"status","presence":"online"|"playing"}
{"type":"profile","profile":{...}}
{"type":"invite","invite":{"id":"<uuid>","sessionId":"<uuid>","worldName":"Inselwelt"|null,
   "instance":{"name":"Fabric 26.3","minecraftVersion":"26.3","loader":"fabric","loaderVersion":"0.19.5"|null,"modCount":42},
   "expiresAt":1790000000}}                                    // host -> guest
{"type":"inviteRevoke","inviteId":"<uuid>","reason":"stopped"|"kicked"|"expired"}   // host -> guest
{"type":"inviteDecline","inviteId":"<uuid>"}                   // guest -> host
{"type":"unfriend"}
{"type":"identityRotated","newPeerId":"<64 hex>","signature":"<128 hex>"}   // retired endpoint only
{"type":"ack"}                                                 // reply to identityRotated / unfriend from the retired endpoint
```
- A `profile` whose sanitised `displayName` differs from the stored one sets `notice = renamed{previousName}`. Duplicate display names among friends are shown with the fingerprint's first group appended.

**Request streams** (at most 5 per friend per minute; excess gets `error{rateLimited}`):
```jsonc
{"type":"manifestRequest","sessionId":"<uuid>"}                                       // guest -> host
{"type":"manifest","manifest":{"minecraftVersion":"26.3","loader":"fabric","loaderVersion":"0.19.5"|null,
   "mods":[{"sha512":"<128 lowercase hex>","fileName":"sodium-fabric-0.7.0+mc26.3.jar"}]}}   // host -> guest
{"type":"error","code":"sessionNotFound"|"notInvited"|"rateLimited"|"unsupported"}
```

**Tunnel streams:** see 6.1. The host answers the open frame with `{"type":"tunnelOk"}` or `{"type":"error","code":"sessionNotFound"|"notInvited"|"guestLimit"|"rateLimited"|"lanUnreachable"}`. Raw bytes follow `tunnelOk`.

### 5.4 Invites
- Only the host's launcher sends `invite`, only to confirmed friends that are currently connected, and only those the host selected (UI, or the mod after confirmation, 7.4). At most 7 per session.
- `expiresAt` is at most 2 h after sending. Re-inviting after that is allowed.
- Receive limits: 10 invites per friend per hour, 1 open invite per session, 20 open in total (the oldest is dropped).
- `worldName` is sent only if the host ticks "Weltnamen zeigen" (off by default). The instance summary is always sent.
- Teardown: `inviteRevoke` on session end, kick or expiry. A guest whose connection to the host is lost keeps the invite until `expiresAt`, with `hostOnline = false`.
- **Closed invites (host side, normative):** a kick and a received `inviteDecline` close the invite on the host. The invite is deleted, and the guest's `SessionGuest` becomes `left` with `kicked: true` (kick) or `declined` (decline). From then on the host refuses that friend's `manifestRequest` and tunnel streams with `notInvited` (6.1), whatever the guest launcher does with the `inviteRevoke`. Only an explicit `host_invite` for that friend opens a new invite (new invite id, state `invited`, `kicked: false`). A guest that leaves on its own (`join_leave`, game exit, lost connection) becomes `left` with `kicked: false` and keeps its open invite until `expiresAt`, so it may rejoin.

### 5.5 Manifest
- **Built by the host** (`manifest::build`) at `host_start`, and cached for the session. It is rebuilt only when the instance's mod list changes.
  - Content: `minecraftVersion`, `loader`, `loaderVersion`, and for every **enabled** `Mod` with `kind == ModKind::Mod`: `sha512` (computed from the file in a blocking task and cached by (file name, size, mtime)) and `fileName`.
  - The host excludes nothing. That includes the Pumpkin Friends mod, so no jar can hide from the manifest by declaring a mod id. The guest's matching ignores it only by verified identity: its sha512 resolves to the pinned Modrinth project id (`MOD_PROJECT_ID`, 11.5).
  - Nothing else: no paths, configs, resource packs, JVM args or worlds. The share dialog tells the host that invited friends see version, loader and the mod list.
- **Validated by the guest** (`manifest::validate`), else `errors.friends.manifestInvalid`:
  - `loader` is a known `ModLoader`.
  - `minecraftVersion` exists in Mojang's version manifest, and its `releaseTime >= MIN_MC_RELEASE_TIME` (else `errors.friends.versionUnsupported`).
  - `loaderVersion` matches `^[0-9A-Za-z.+_-]{1,64}$` or is null.
  - At most 500 mods. `sha512` is 128 lowercase hex, with no duplicates.
  - `fileName` is sanitised, at most 128 chars, and **display only** (never a path, never written to disk).

### 5.6 Matching (`matching::plan`, guest, no downloads)
1. **Candidates:** local instances with the same `minecraftVersion` and the same `loader` (the loader version is ignored).
2. **Required set** of a mod list = the mods that are not known to be client-only. Client-only = the sha512 resolves on Modrinth (`POST /version_files`, `algorithm: "sha512"`) to a version whose project has `server_side == "unsupported"`, or the project is `MOD_PROJECT_ID`. Unresolvable mods count as required.
3. A candidate **matches** when its required sha512 set equals the host's. Otherwise, `missing` = host required minus local, and `extra` = local required minus host. Each is a `ModRef` with a title from Modrinth, or the sanitised `fileName`.
4. Verdict:

   | Verdict | When |
   |---|---|
   | `versionUnsupported` | the host version is older than 1.20 |
   | `ready` | at least one candidate matches |
   | `missingContent` | candidates exist, none matches |
   | `noInstance` | no candidates |

   `createVanilla = (host loader == vanilla && verdict == noInstance)`.
5. Modrinth lookups are batched (one `version_files` call, one `projects` call), cached in memory for 1 h, and respect the existing User-Agent and limits. If Modrinth is unreachable, all mods count as required and the plan has `lookupFailed = true`.

Matching table (normative, tested in R6). A, B, C = mods that the server needs. S, M = client-only on Modrinth. X = not on Modrinth.

| Host | Guest instances | Verdict | Details |
|---|---|---|---|
| vanilla 26.3 | vanilla 26.3 | ready | |
| vanilla 26.3 | none | noInstance | createVanilla = true |
| fabric 26.3 {A,B,S} | fabric 26.3 {A,B} | ready | |
| fabric 26.3 {A,B} | fabric 26.3 {A} | missingContent | missing = [B] |
| fabric 26.3 {A} | fabric 26.3 {A,C} | missingContent | extra = [C] |
| fabric 26.3 {A} | fabric 26.3 {A,M} | ready | |
| fabric 26.3 {A,X} | fabric 26.3 {A,X} (same sha512) | ready | |
| fabric 26.3 {A,X} | fabric 26.3 {A} | missingContent | missing = [X] (fileName title) |
| fabric 26.3 | fabric 26.2, quilt 26.3 | noInstance | createVanilla = false |
| fabric 1.19.4 | any | versionUnsupported | |

---

## 6. Tunnel

### 6.1 Host side (`friends/hosting.rs`, `friends/mcproto.rs`, `p2p/tunnel.rs`)
- **Preconditions for `host_start`:** the instance is running (`errors.friends.gameNotRunning`), was launched with a Microsoft account (`errors.friends.msAccountRequired`), and its version's `releaseTime >= MIN_MC_RELEASE_TIME` (`errors.friends.versionUnsupported`). At most one session at a time (`errors.friends.sessionActive`).
- **Port sources:** a mod `lanOpened` hint, the log parser (6.4), or the manual `port` argument (1024-65535, else `errors.friends.portInvalid`). None known: `errors.friends.lanPortUnknown`.
- **Port verification** (`lan_detect::verify_port(pid, port) -> PortCheck { Ok, NotOwned, NoAnswer }`), on every new port from any source and before every switch:
  1. `sockowner::listens(game_pid, port)` must be true: a TCP LISTEN socket on that port owned by the game process (run through `spawn_blocking`). Otherwise `PortCheck::NotOwned` → `errors.friends.portNotGame`. A failed lookup (IO error) also counts as `NotOwned` and logs a warning: in doubt nothing is shared.
  2. A server list ping to `127.0.0.1:port` through the existing `services::server_ping::ping`, wrapped in a 2 s timeout (`server_ping`'s own limit is 5 s), must succeed: the answer must be a well-formed status response whose payload parses as JSON. `ServerStatus` does not expose `version.protocol`, so that field is not checked; step 1 is the security check, step 2 only confirms that a Minecraft server answers. Otherwise `PortCheck::NoAnswer` → `errors.friends.lanUnreachable`.
  3. The session stores the verified port, and the UI shows "Port {port} · gehört zu Minecraft (PID {pid})".
- **Liveness:** every 15 s during a session, `sockowner::listens(game_pid, port)` is re-checked. Two consecutive failures end the session with `lanClosed`.
- **Incoming tunnel stream:**
  1. Admission checks: the session exists (`sessionNotFound`); the peer has an open invite for this session or is a connected guest, and its `SessionGuest` is neither `declined` nor `left` with `kicked: true` (`notInvited`, 5.4); distinct connected guests stay at most 7 (`guestLimit`); at most 4 concurrent streams per guest and at most 20 new streams per guest per minute (`rateLimited`).
  2. Reply `tunnelOk`.
  3. **Validate before touching the server** (`mcproto`, 5 s, total at most 2 KiB buffered):
     - The first packet is a Handshake: VarInt length at most 1024, packet id `0x00`, protocol VarInt, server address String (at most 255 chars), port u16, next state `1` (status) or `2` (login). Next state `3` (transfer) and the legacy ping byte `0xFE` are refused.
     - For next state 2, the next packet is Login Start: id `0x00`, whose first field (name) matches `^[A-Za-z0-9_]{1,16}$`.
     - On failure, reset the stream with `PROTOCOL` and connect nothing.
  4. `TcpStream::connect(127.0.0.1:port)` (3 s), `set_nodelay(true)`, write the buffered (validated) bytes to the TCP socket, then `bridge(stream, tcp, Bytes::new(), stop)` with an **empty** prefix (6.3: the prefix goes into the stream, which is the guest direction). Connect failure: reset the stream.
  5. The guest is `connected` while at least one stream is open. Emit `host-session`.
- The host never connects anywhere except `127.0.0.1:<verified session port>`. The peer cannot choose the host, port or session.
- **Kick:** delete the guest's invite, set its `SessionGuest` to `left` with `kicked: true`, send `inviteRevoke{kicked}`, and cancel the guest's streams. Later streams and manifest requests from that friend get `notInvited` until the host re-invites it with `host_invite` (5.4).
- **Decline:** on `inviteDecline`, delete the invite and set the `SessionGuest` to `declined`. Same admission rule as after a kick.
- **Session end** (each emits `host-session-ended` with the reason in brackets): `host_stop` (stopped), mod `stopSharing` (stopped), log "Stopping server" or "Unpublishing integrated server" (lanClosed), mod `lanClosed` followed by a failed port check (lanClosed), failed liveness (lanClosed), game exit (gameExited), `Lifecycle::Disabled` (disabled), `Lifecycle::Rebind` or `Lifecycle::IdentityChanged` (stopped), `Lifecycle::Shutdown` (stopped). On end: `inviteRevoke{stopped}` to every guest, then cancel the session's `CancellationToken`. For lifecycle ends this happens before the subscriber releases its `done` token (8.7), so the revoke still leaves through the old endpoint.

### 6.2 Guest side (`friends/joining.rs`, `p2p/tunnel.rs`)
- **`invite_join(inviteId, instanceId)`:**
  1. The invite is open (`errors.friends.notFound.invite` / `inviteExpired`).
  2. The host is reachable (dial, 8 s, else `peerOffline`).
  3. The instance still matches (re-run the plan for this instance, else `instanceMismatch`).
  4. **Bind the single-owner listener.**
     - Windows and Linux: a random address `127.a.b.c` (each of a, b, c in 1..=254, not `127.0.0.1`), port 0.
     - macOS (only `127.0.0.1` is configured on lo0): `127.0.0.1`, port 0.
  5. Return `JoinTicket{joinId, inviteId, instanceId, address:"<ip>:<port>"}`.
  6. The frontend launches the instance with `LaunchOptions.friendJoin = {joinId, address}` (8.6).
  - One join at a time: a new `invite_join` ends the previous one with `left`.
- **Timers** (all durations come from an injected `JoinTimers`, 8.7; production values in brackets):
  - The join starts as `waitingForGame`, and the **spawn wait** (`spawn_wait`, 600 s) starts at `invite_join`.
  - Every `GameSignal::LaunchProgress{friend_join: joinId}` restarts the spawn wait. `instance_launch` sends it at its phase boundaries (8.6: after the world backup, the mod sync, the account session, the installed-version check and the Java resolution), at most once per second. Downloading a missing version is **not** part of `instance_launch`: it happens in the separate `instance_install` command, which carries no `friend_join` and sends no `LaunchProgress`. Therefore the frontend completes any needed install **before** it calls `invite_join` (10.4 step 3), so the spawn wait never runs during a download.
  - **Absolute cap:** without a spawn within `spawn_wait_cap` (1800 s) of `invite_join`, the join ends (`error`) even if progress continues.
  - `GameSignal::LaunchFailed{friend_join: joinId}` ends the join at once with `error`. The listener is closed in the same step.
  - On `GameSignal::Spawned{friend_join: joinId, pid}` the listener records the PID, the spawn wait stops, and the **first-connection timer** (`first_connection`, 600 s) starts. Without a first valid connection in that time, the join ends (`error`).
  - A join that ends by timer or launch failure closes the listener, so its address refuses connections afterwards.
- **Accepting a local connection** (all checks before any QUIC stream is opened):
  1. `set_nodelay(true)`.
  2. Until the first valid connection, only 1 unvalidated connection is handled at a time. Others are closed at once.
  3. PID check: `sockowner::connects_from(game_pid, client_addr)` must be true: the game process owns a non-LISTEN TCP socket whose local address equals the client address the listener sees. The lookup blocks on Linux (`/proc/<pid>/fd`) and macOS (`lsof`), so run it through `spawn_blocking`. If the platform lookup itself fails (an IO error), log once and rely on step 4.
  4. Nonce check: peek the Handshake (`mcproto`, 2 s, at most 1 KiB). The server-address field, cut at the first NUL, must equal the listener IP string, and the port field must equal the listener port. Legacy `0xFE` is refused.
  5. Failure: close the TCP connection. No stream is opened, and the connection does not count as activity.
  6. Success: open a tunnel stream (redial if needed, 8 s), send the open frame, wait for `tunnelOk` (10 s), write the peeked bytes, then `bridge`. After the first valid connection, up to 4 concurrent connections are allowed, each validated the same way.
- **Mapping onto `LocalListener` (6.3):** steps 1-5 are R5's `admit` closure, which returns `Some((socket, peeked bytes))` on success; `LocalListener` then calls `open` and passes the peeked bytes to `bridge` as `prefix`, so they go into the stream first. R5's `open` closure sends the open frame and waits for `tunnelOk`; an `error` frame gives `TunnelError::Refused(code)`, no answer in 10 s gives `TunnelError::Timeout`. Limits: `ListenerLimits { before_first_valid: 1, after_first_valid: 4 }`. Cancelling the listener's `stop` token closes the address and resets every running tunnel stream with `NORMAL`.
- **Status:** `join-session{connected{path, rttMs}}` at most every 5 s while streams are open.
- **End triggers:** `inviteRevoke` (stopped/kicked), game exit of the joining instance (gameExited), `join_leave` (left), host connection lost and not back within 30 s (hostOffline), timers or `LaunchFailed` (error), `Lifecycle::Disabled` (disabled), `Lifecycle::Rebind` or `Lifecycle::IdentityChanged` (left), `Lifecycle::Shutdown` (app exit; no event).

### 6.3 Shared tunnel code (`services/p2p/tunnel.rs`, Minecraft-agnostic)
```rust
/// Verbindet einen Tunnel-Stream mit einer lokalen TCP-Verbindung (beide Seiten mit TCP_NODELAY); `prefix` (schon von
/// `local` gelesene Bytes) geht zuerst in den Stream. `stop` setzt den Stream zurück und schließt `local`.
pub async fn bridge(stream: BiStream, local: TcpStream, prefix: Bytes, stop: CancellationToken) -> io::Result<()>;
#[derive(Debug, thiserror::Error)]
pub enum TunnelError { Net(NetError), Frame(FrameError), Refused(String /* error code of the peer */), Timeout }
/// Lokaler Zuhörer auf `ip:0`. `admit` prüft jede Verbindung, bevor ein Stream geöffnet wird, und liefert die
/// schon gelesenen Bytes zurück; `None` schließt die Verbindung.
#[derive(Debug)]
pub struct LocalListener { pub addr: SocketAddr, /* … */ }
impl LocalListener {
    pub async fn bind(ip: IpAddr) -> io::Result<Self>;
    pub fn serve<A, AF, O, OF>(self, admit: A, open: O, limits: ListenerLimits, stop: CancellationToken) -> JoinHandle<()>
    where A: Fn(TcpStream, SocketAddr) -> AF + Send + Sync + 'static, AF: Future<Output = Option<(TcpStream, Bytes)>> + Send + 'static,
          O: Fn() -> OF + Send + Sync + 'static, OF: Future<Output = Result<BiStream, TunnelError>> + Send + 'static;
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ListenerLimits { pub before_first_valid: usize /* 1 */, pub after_first_valid: usize /* 4 */ }
```
- `bridge` sets `TCP_NODELAY` on `local`, writes `prefix` into the stream, then copies both ways (`copy_bidirectional`). It is used in both directions: the guest passes the peeked handshake as `prefix`; the host writes its validated buffer to the LAN socket itself and passes an empty prefix (6.1). Cancelling `stop` resets the stream with `NORMAL` and drops `local`.
- `LocalListener` (in `services/p2p/tunnel.rs`): a connection over the current limit is dropped at once; the limit switches from `before_first_valid` to `after_first_valid` after the first connection `admit` accepted. `admit` runs after `TCP_NODELAY` is set and before any stream is opened. The futures run in spawned tasks, hence the `'static` bounds.

### 6.4 LAN log parser (`services/lan_detect.rs`)
- Stateful `LanDetector` (`Default`), fed **raw stdout** lines only: the lines exactly as the game prints them, before the launcher's log4j XML processing, so that the detector sees the `<log4j:Event …>` start lines and can track multi-line CDATA (otherwise a continuation line could pose as a message). `launch::spawn` delivers them through its `on_stdout_raw` callback (8.7), and `gamesignal::lan_line_forwarder(signals, instance_id)` wraps the detector (behind a `Mutex`, because the callback is `Fn`) and sends `LanOpened { source: Log }` / `LanClosed`. A `LanOpened` from the log is only a hint; R5 calls `verify_port` before using the port.
- **XML form** (Mojang log4j config, the default for versions with a `logging` entry): an event counts only if its `<log4j:Event …>` start line has `level="INFO"` and `thread="Server thread"`, and its message is a single-line `<log4j:Message><![CDATA[…]]></log4j:Message>`. The whole CDATA text is the message.
- **Plain form** (no XML config): the line matches `^\[\d{2}:\d{2}:\d{2}\] \[Server thread/INFO\](?:: | \([A-Za-z0-9_.\-]{1,64}\) )(.*)$` (vanilla `]: `, Fabric `] (logger) `). Group 1 is the message.
- The **whole message** must match one of:
  - `^Started serving on (\d{1,5})$` (1.20 to 26.1.2) or `^Published LAN server on port (\d{1,5})$` (26.2+): Opened(port).
  - `^Stopping server$` or `^Unpublishing integrated server$`: Closed.
- Chat (`<Name> …`), `/say` (`[Name] …`), disconnect texts and everything else cannot match, because they never form the whole message. Every port still passes 6.1 verification.
- Table test (R3): real lines for 1.20.1, 1.21.x, 26.1.2, 26.3 in XML and plain form, Fabric's plain form, chat and `/say` spoofs (`<Bob> Published LAN server on port 5432`), a multi-line CDATA, and a forged plain line on another thread.

### 6.5 Close behaviour (normative; the R5 tests assert every row, crash rows with a short idle timeout, which needs the seam of Appendix E, E1)
| Case | Host launcher sees | Guest launcher sees | Guest game |
|---|---|---|---|
| Host clicks stop / mod stopSharing | `host-session-ended{stopped}` | `friend-invite-revoked{stopped}`, `join-session{ended{stopped}}` | disconnected |
| Host kicks guest | `host-session` with the guest `left`, `kicked: true`; its later streams get `notInvited` | `friend-invite-revoked{kicked}`, `join-session{ended{kicked}}` | disconnected |
| Guest declines the invite | `host-session` with the guest `declined`; its later streams get `notInvited` | the invite is gone from `invites_list` | - |
| Host quits world to title (`Stopping server`) | `host-session-ended{lanClosed}` | revoked{stopped}, ended{stopped} | disconnected |
| Host game exits | `host-session-ended{gameExited}` | revoked{stopped}, ended{stopped} | disconnected |
| Host launcher exits normally | (process ends after sending) | revoked{stopped}, ended{stopped} within 3 s | disconnected |
| Host launcher crashes | - | `join-session{ended{hostOffline}}` within 40 s + 30 s grace | disconnected |
| Guest clicks leave | `host-session` with the guest `left`, `kicked: false` | `join-session{ended{left}}` | disconnected |
| Guest game exits | `host-session` with the guest `left`, `kicked: false` | `join-session{ended{gameExited}}` | - |
| Guest launcher exits | `host-session` with the guest `left`, `kicked: false`, within 40 s | (process ends) | disconnected |
| Guest launch fails before spawn | guest stays `invited` | `join-session{ended{error}}` at once | - |
| Host disables friends | `host-session-ended{disabled}` | revoked{stopped}, ended{stopped} within 3 s | disconnected |
| Guest disables friends | `host-session` with the guest `left`, `kicked: false` within 3 s (`SHUTDOWN` close) | `join-session{ended{disabled}}` | disconnected |
| Host changes "always relay" or rotates/resets its identity | `host-session-ended{stopped}` | revoked{stopped}, ended{stopped} within 3 s | disconnected |

---

## 7. Launcher to mod IPC (untrusted channel)

### 7.1 Transport and auth
- `services/modbridge` listens on `127.0.0.1:0` while the feature is enabled. `AppState.bridge` is constructed **stopped**; R4 calls `start()` when the feature is enabled and available and `stop()` when it is disabled (R3 never starts it).
- For each launch of a **Fabric** instance while the bridge runs, `launch_env(instance_id, loader)` returns `PUMPKIN_IPC_PORT`, `PUMPKIN_IPC_TOKEN` and `PUMPKIN_IPC_PROTOCOL=1` (constants `ENV_PORT`, `ENV_TOKEN`, `ENV_PROTOCOL`). The token is 64 lowercase hex made of two UUID v4 (`simple` form), i.e. 244 random bits from the OS random generator. They go into the child **environment only**, never into arguments. For other loaders or a stopped bridge, the list is empty and the launch is byte-identical to today. A new `launch_env` for the same instance invalidates its previous token.
- The token binds one launch. It stays valid across mod reconnects during that launch (still one connection at a time) and is dropped by `forget` on game exit (or by `stop`), so a token leaked through `hs_err_pid*.log` or a child process is useless afterwards. Same-user malware is out of scope. **Mods running in the same JVM can read the token**, so every mod request is treated as untrusted (7.4).
- Limits:
  - Non-loopback peers cannot connect: the listener binds `127.0.0.1` only (there is no separate peer-address check).
  - At most 4 unauthenticated connections (the 5th is closed at once). `hello` must arrive within 2 s; a missing or malformed `hello` closes the connection without an answer.
  - One connection per token (a second gets `reject{duplicate}`).
  - JSON lines of at most 16 KiB; a longer line closes the connection.
  - At most 20 messages/s from the mod. Excess closes the connection.
  - The outgoing queue holds at most 64 messages; when `push` finds it full, the connection is dropped. A write to the mod that takes longer than 5 s also ends the connection.
  - After `hello`, an unknown, malformed or second `hello` line is ignored (debug log); it still counts toward the 20 messages/s.

### 7.2 Handshake
```jsonc
{"type":"hello","protocols":[1],"token":"<64 hex>","mod":"0.1.0","minecraft":"26.3"}   // mod -> launcher
{"type":"welcome","protocol":1,"launcher":"0.2.0"}                                    // launcher -> mod, then a snapshot
{"type":"reject","reason":"token"|"protocol"|"duplicate"}                              // then close
```
- `welcome.launcher` is the launcher's crate version (`CARGO_PKG_VERSION`). The first `snapshot` after `welcome` is the latest one `push`ed for this launch, or an empty one.
- The mod closes the connection on a `welcome` with `protocol != 1`. After any `reject`, or a lost connection, the mod retries on its normal backoff (7.5); only a `welcome` resets the backoff.

### 7.3 Messages
**Mod to launcher**
| type | fields | launcher handling |
|---|---|---|
| `lanOpened` | `port` | Hint only. Runs 6.1 verification. A port that fails is ignored and logged. |
| `lanClosed` | | Triggers a port re-check. A failure ends the session (`lanClosed`). |
| `share` | `friendIds: string[]` (1..7) | 7.4 |
| `stopSharing` | | = `host_stop` for this instance's session |
| `kick` | `friendId` | = `host_kick` |
| `ping` | | `pong` (always answered by the bridge) |

- Exact JSON the mod sends: `{"type":"share","friendIds":[..]}`, `{"type":"stopSharing"}`, `{"type":"kick","friendId":".."}`, `{"type":"lanOpened","port":N}`, `{"type":"lanClosed"}`, `{"type":"ping"}`. After a (re)connect the mod re-sends `lanOpened` if its world is already published.
- **Ping timing** (mod side): the mod pings every 10 s and drops the connection when nothing arrives from the launcher for 30 s (socket read timeout), then reconnects on its backoff. The launcher therefore answers every `ping` with `pong`.
- **Bridge filtering before any signal** (R3): `share` with fewer than 1 or more than 7 ids, and `share`/`kick` naming an alias that was never shown to this connection in a snapshot, are ignored with a debug log; there is no error reply. Everything else becomes a `GameSignal` (`LanOpened { source: Mod }`, `LanClosed`, `ModRequest`).

**Launcher to mod**
| type | fields |
|---|---|
| `snapshot` | `friends: ModFriend[]` (at most 50), `session: ModSession \| null`, `invites: ModInvite[]` (at most 20). Sent after `welcome` and on change, debounced to 250 ms. |
| `notify` | `event: "inviteReceived" \| "guestJoined" \| "guestLeft" \| "sessionEnded" \| "friendOnline" \| "confirmInLauncher"`, `name: string \| null`, `mcUuid: string \| null` |
| `error` | `code: "notEnabled" \| "peerOffline" \| "guestLimit" \| "lanPortUnknown" \| "portNotGame" \| "denied" \| "versionUnsupported" \| "busy" \| "internal"`, `ref: string \| null` |
| `pong` | |

```ts
type ModFriend  = { id: string; name: string; mcUuid: string | null; presence: "offline" | "online" | "playing" };
type ModSession = { guests: { id: string; name: string; state: "invited" | "connected" }[] };
type ModInvite  = { id: string; fromName: string; title: string };   // join happens in the launcher
```
- `id` in `ModFriend`/`ModSession` is an opaque per-connection alias (`f1`, `f2`, ...), not the peer id. Inside the launcher, `LauncherToMod::Snapshot` carries real peer ids; the bridge replaces them with the connection's aliases on the wire and maps aliases in `share`/`kick` back to peer ids.
- The bridge keeps the latest snapshot per launch for a mod that connects late, sends the first snapshot at once and then at most one per 250 ms (the latest wins). It does **not** sanitise and does **not** enforce the caps: R5 (`mod_link.rs`) sanitises every name (12.3) and limits `friends` to 50 and `invites` to 20 before it calls `push`.
- `ModFriend.presence` is a `ModPresence { Offline, Online, Playing }` and a guest's state a `ModGuestState { Invited, Connected }` (`modbridge/protocol.rs`, mirrors of the contract types because R3 does not depend on R2). R5 maps `Presence` 1:1, maps `GuestState::Invited`/`Connected`, and omits `declined` and `left` guests.
- All names are sanitised (12.3) and contain no `§`. The mod strips `§` again and caps lengths at 32 (names) and 64 (titles). The mod ignores unknown types and fields, maps an unknown presence to `offline` and an unknown guest state to `invited`, drops entries with a null `id`, and shows no toast for unknown `notify` events or `error` codes.

### 7.4 Untrusted-request rules
- `share` from the mod: the friend ids must be connected confirmed friends. The bridge has already dropped shares with 0 or more than 7 ids and ids it never showed to that connection (7.3); `GameSignal::ModRequest` carries real peer ids.
  - The **first** `share` of each launch requires confirmation in the launcher: the launcher emits `friends-mod-confirm`, the mod gets `notify{confirmInLauncher}`, and the user answers with `friends_mod_confirm(requestId, allow)`. "Launch" means the token's lifetime (from `Spawned` to `Exited` of that instance), not one mod connection: a mod that reconnects with the same token keeps an earlier allow, and R5 tracks the allow per instance launch.
  - Denied, or no answer within 2 min: `error{denied}`.
  - After an allow, later `share`s of the same launch are limited to 3 per minute and to the 7-guest cap. Each one shows a launcher toast "{instance}: geteilt mit {names}".
- `stopSharing` and `kick` only reduce exposure and need no confirmation.
- `lanOpened` never sets a port without 6.1 verification.

### 7.5 Failure behaviour
- The launcher never blocks on the bridge. Bridge errors are logged, and the only UI effect is `friends-mod{connected:false}`.
- The mod with no env vars: no threads, no UI, one info log line. The mod also treats the env as absent when `PUMPKIN_IPC_PROTOCOL` is not `1`, the port is outside 1..65535, or the token is not 64 lowercase hex (`BridgeEnv`). On connect failure (connect timeout 2 s), after a `reject` and after a lost connection: backoff 1, 2, 5, 10, then 30 s; only a `welcome` resets it. While disconnected, the button is hidden. It never throws on the render or client thread.

---

## 8. Contract (Tauri commands, events, types)

### 8.1 Serde and TS rules (normative)
- Structs: `#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]`.
- Unit-only enums: `#[serde(rename_all = "camelCase")]`, which serialise as plain strings.
- Enums with data: `#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]`. The tag name is always `type`.
- `Option<T>` fields are always present, as `null` when empty (no `skip_serializing_if`). In TS: `T | null`.
- Timestamps are unix **seconds** (`u64`). In TS: `number`. Ids are strings.
- No `AppError` and no `Coded` inside any contract type. Failure reasons in payloads are enums that the UI translates.
- The types live in `src-tauri/src/services/friends/contract.rs` (R2) and in `src/lib/friends-types.ts` (F1), re-exported from `types.ts`.
- **Defining file per shared Rust type (normative; each type is defined exactly once, everything else re-exports with `pub use`):**

  | Type | Defined in (owner) | Used by | Why there |
  |---|---|---|---|
  | `PathKind`, `PortSource` | `src-tauri/src/services/shared_types.rs` (R0a, complete in Wave 0, not a stub) | R1 (`PeerConn::path`), R3 (`GameSignal::LanOpened`), R2 `contract.rs` (re-export), R4, R5 | R1 and R3 do not depend on R2, so these enums cannot live in `contract.rs`. |
  | `ModLoader` | `src-tauri/src/models.rs` (existing, unchanged; `rename_all = "lowercase"`, which equals camelCase for its one-word variants) | `shared_types.rs` re-exports it; `contract.rs` re-exports it from there | existing type |
  | `FriendJoin` | `src-tauri/src/models.rs` (R3), next to `LaunchOptions` | R3 (`instance_launch`), R5 | Defined once there and nowhere else in Rust. It is not part of `contract.rs` and not a fixture key; R3 asserts its JSON shape (8.6). The TS twin is in `friends-types.ts`. |
  | `PeerId` | `src-tauri/src/services/p2p/peer_id.rs` (R1) | R1 (`Gate`, `PeerConn`), R4, R5 | The `Gate` signature needs it and R1 does not depend on R2. R2 works with `String` ids; R4 and R5 use `p2p::PeerId` and never define a second id type. |
  | `ModRequest` | `src-tauri/src/services/gamesignal.rs` (R3) | R3 (modbridge), R5 (`mod_link.rs`) | carried by `GameSignal::ModRequest` |
  | `LauncherToMod` (with `ModFriend`, `ModPresence`, `ModSession`, `ModGuest`, `ModGuestState`, `ModInvite`, `ModNotify`, `ModErrorCode`) and `ModToLauncher`, `Handshake`, `RejectReason` | `src-tauri/src/services/modbridge/protocol.rs` (R3) | R3, R5 (`mod_link.rs` builds snapshots and notifications) | wire types of section 7 |

  `shared_types.rs` follows the serde rules above (`PathKind`, `PortSource`: unit-only enums with `rename_all = "camelCase"`, deriving `Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize`) and has a unit test of their JSON strings (`"direct"`, `"relay"`, `"mod"`, `"log"`, `"manual"`). It contains no logic.

### 8.2 Types (Rust | TS)
```rust
pub const FRIEND_CODE_PREFIX: &str = "pumpkin-";   pub const FRIEND_CODE_BODY_LENGTH: usize = 72;   pub const FRIEND_CODE_LENGTH: usize = 80;
pub const DISPLAY_NAME_MIN: usize = 3;  pub const DISPLAY_NAME_MAX: usize = 32;  pub const ALIAS_MAX: usize = 32;
pub const MAX_FRIENDS: usize = 50;  pub const MAX_ACTIVE_CODES: usize = 3;  pub const MAX_GUESTS: usize = 7;
pub const CODE_TTL_SECS: u64 = 604_800;  pub const REQUEST_TTL_SECS: u64 = 1_209_600;  pub const INVITE_TTL_SECS: u64 = 7_200;
pub const MIN_MC_RELEASE_TIME: &str = "2023-06-02T08:36:17+00:00";  pub const MIN_MC_LABEL: &str = "1.20";
pub const PORT_MIN: u16 = 1024;  pub const PORT_MAX: u16 = 65535;

pub enum Availability { Available, NoSecretStore, IdentityLost }
pub struct FriendsState {
    pub availability: Availability, pub enabled: bool, pub me: Option<Me>, pub settings: FriendsSettings,
    pub network: NetworkStatus, pub relays: Vec<RelayInfo>, pub third_party_relays_accepted: bool,
}
pub struct Me { pub peer_id: String, pub fingerprint: String, pub display_name: String }
pub struct FriendsSettings { pub display_name: String, pub always_relay: bool }
pub struct FriendsEnableInput { pub display_name: String, pub always_relay: bool, pub accept_third_party_relays: bool }
pub struct RelayInfo { pub host: String, pub operator: RelayOperatorKind, pub third_party: bool }
pub enum RelayOperatorKind { Pumpkin, N0 }
pub enum NetworkStatus { Off, Starting, Online { relay_host: String }, Degraded { reason: DegradedReason } }   // tagged
pub enum DegradedReason { RelayUnreachable, BindFailed }

pub struct Friend {
    pub id: String, pub display_name: String, pub alias: Option<String>, pub mc_name: Option<String>, pub mc_uuid: Option<String>,
    pub fingerprint: String, pub added_at: u64, pub last_seen: Option<u64>, pub confirmed: bool, pub removed_by_peer: bool,
    pub notice: Option<FriendNotice>, pub presence: Presence, pub path: Option<PathKind>,
}
pub enum FriendNotice { Renamed { previous_name: String }, IdentityChanged { previous_fingerprint: String } }   // tagged
pub enum Presence { Offline, Online, Playing }
pub use crate::services::shared_types::{PathKind, PortSource, ModLoader};   // PathKind { Direct, Relay }, PortSource { Mod, Log, Manual } (8.1)

pub struct FriendRequest {
    pub id: String, pub direction: RequestDirection, pub state: RequestState,
    pub peer_id: Option<String>, pub fingerprint: Option<String>, pub display_name: Option<String>, pub mc_name: Option<String>,
    pub code_tail: Option<String>, pub created_at: u64, pub expires_at: u64,
}
pub enum RequestDirection { Incoming, Outgoing }
pub enum RequestState { Pending /* incoming */, Delivering /* outgoing, not yet received */, AwaitingAnswer /* outgoing, received */ }

pub struct FriendCode { pub id: String, pub code: Option<String> /* only in the create response */, pub tail: String,
                        pub created_at: u64, pub expires_at: u64, pub used: bool }
pub struct BlockedPeer { pub peer_id: String, pub display_name: String, pub blocked_at: u64 }

pub struct HostSession {
    pub id: String, pub instance_id: String, pub port: u16, pub port_source: PortSource, pub pid: u32,
    pub world_name: Option<String>, pub show_world_name: bool, pub started_at: u64, pub guests: Vec<SessionGuest>,
}
// PortSource: re-exported above, defined in shared_types.rs
pub struct SessionGuest { pub friend_id: String, pub display_name: String, pub state: GuestState, pub kicked: bool /* true only with state Left after a kick (5.4) */,
                          pub path: Option<PathKind>, pub rtt_ms: Option<u32> }
pub enum GuestState { Invited, Declined, Connected, Left }

pub struct Invite {
    pub id: String, pub session_id: String, pub from: String, pub from_name: String, pub from_fingerprint: String,
    pub title: String /* worldName ?? instance.name, sanitised */, pub instance: InstanceSummary,
    pub received_at: u64, pub expires_at: u64, pub host_online: bool,
}
pub struct InstanceSummary { pub name: String, pub minecraft_version: String, pub loader: ModLoader, pub loader_version: Option<String>, pub mod_count: u32 }

pub struct JoinPlan {
    pub invite_id: String, pub summary: InstanceSummary, pub verdict: JoinVerdict,
    pub candidates: Vec<InstanceCandidate> /* matches first, then fewest differences */,
    pub create_vanilla: bool, pub lookup_failed: bool,
}
pub enum JoinVerdict { Ready, MissingContent, NoInstance, VersionUnsupported }
pub struct InstanceCandidate { pub instance_id: String, pub name: String, pub matches: bool, pub missing: Vec<ModRef>, pub extra: Vec<ModRef> }
pub struct ModRef { pub title: String, pub file_name: String, pub project_id: Option<String> }
pub struct JoinTicket { pub join_id: String, pub invite_id: String, pub instance_id: String, pub address: String }

pub struct LanStatus { pub port: u16, pub source: PortSource, pub pid: u32 }   // only verified ports
pub enum ModState { Unavailable, NotInstalled, Installed, Connected }
pub struct ModStatus { pub state: ModState }

// Event payloads
pub struct FriendPresenceEvent { pub friend_id: String, pub presence: Presence, pub path: Option<PathKind> }
pub struct FriendRequestEvent { pub request: FriendRequest }
pub struct InviteEvent { pub invite: Invite }
pub struct InviteRevokedEvent { pub invite_id: String, pub reason: RevokeReason }
pub enum RevokeReason { Stopped, Kicked, Expired }
pub struct HostSessionEvent { pub session: HostSession }
pub struct HostSessionEndedEvent { pub session_id: String, pub reason: SessionEnd }
pub struct JoinSessionEvent { pub join_id: String, pub invite_id: String, pub instance_id: String, pub state: JoinState }
pub enum JoinState { WaitingForGame, Connecting, Connected { path: PathKind, rtt_ms: Option<u32> }, Ended { reason: SessionEnd } }   // tagged
pub enum SessionEnd { Stopped, Kicked, LanClosed, HostOffline, GameExited, Left, Disabled, Error }
pub struct LanEvent { pub instance_id: String, pub lan: Option<LanStatus> /* None = closed */ }
pub struct ModConnectionEvent { pub instance_id: String, pub connected: bool }
pub struct ModConfirmEvent { pub request_id: String, pub instance_id: String, pub instance_name: String, pub friends: Vec<ModConfirmFriend> }
pub struct ModConfirmFriend { pub friend_id: String, pub display_name: String }
```

TS mirror (`src/lib/friends-types.ts`), exact (`ModLoader` comes from `import type { ModLoader } from "./types"`, the existing TS twin of the Rust `ModLoader`):
```ts
export const FRIENDS_LIMITS = { codePrefix: "pumpkin-", codeBodyLength: 72, codeLength: 80, displayNameMin: 3, displayNameMax: 32,
  aliasMax: 32, maxFriends: 50, maxActiveCodes: 3, maxGuests: 7, codeTtlSecs: 604800, requestTtlSecs: 1209600, inviteTtlSecs: 7200,
  minMcReleaseTime: "2023-06-02T08:36:17+00:00", minMcLabel: "1.20", portMin: 1024, portMax: 65535 } as const;
export type Availability = "available" | "noSecretStore" | "identityLost";
export interface FriendsState { availability: Availability; enabled: boolean; me: Me | null; settings: FriendsSettings;
  network: NetworkStatus; relays: RelayInfo[]; thirdPartyRelaysAccepted: boolean }
export interface Me { peerId: string; fingerprint: string; displayName: string }
export interface FriendsSettings { displayName: string; alwaysRelay: boolean }
export interface FriendsEnableInput { displayName: string; alwaysRelay: boolean; acceptThirdPartyRelays: boolean }
export interface RelayInfo { host: string; operator: "pumpkin" | "n0"; thirdParty: boolean }
export type NetworkStatus = { type: "off" } | { type: "starting" } | { type: "online"; relayHost: string } | { type: "degraded"; reason: DegradedReason };
export type DegradedReason = "relayUnreachable" | "bindFailed";
export interface Friend { id: string; displayName: string; alias: string | null; mcName: string | null; mcUuid: string | null;
  fingerprint: string; addedAt: number; lastSeen: number | null; confirmed: boolean; removedByPeer: boolean;
  notice: FriendNotice | null; presence: Presence; path: PathKind | null }
export type FriendNotice = { type: "renamed"; previousName: string } | { type: "identityChanged"; previousFingerprint: string };
export type Presence = "offline" | "online" | "playing";
export type PathKind = "direct" | "relay";
export interface FriendRequest { id: string; direction: "incoming" | "outgoing"; state: "pending" | "delivering" | "awaitingAnswer";
  peerId: string | null; fingerprint: string | null; displayName: string | null; mcName: string | null; codeTail: string | null;
  createdAt: number; expiresAt: number }
export interface FriendCode { id: string; code: string | null; tail: string; createdAt: number; expiresAt: number; used: boolean }
export interface BlockedPeer { peerId: string; displayName: string; blockedAt: number }
export type PortSource = "mod" | "log" | "manual";
export interface HostSession { id: string; instanceId: string; port: number; portSource: PortSource; pid: number;
  worldName: string | null; showWorldName: boolean; startedAt: number; guests: SessionGuest[] }
export interface SessionGuest { friendId: string; displayName: string; state: "invited" | "declined" | "connected" | "left";
  kicked: boolean; path: PathKind | null; rttMs: number | null }
export interface InstanceSummary { name: string; minecraftVersion: string; loader: ModLoader; loaderVersion: string | null; modCount: number }
export interface Invite { id: string; sessionId: string; from: string; fromName: string; fromFingerprint: string; title: string;
  instance: InstanceSummary; receivedAt: number; expiresAt: number; hostOnline: boolean }
export type JoinVerdict = "ready" | "missingContent" | "noInstance" | "versionUnsupported";
export interface ModRef { title: string; fileName: string; projectId: string | null }
export interface InstanceCandidate { instanceId: string; name: string; matches: boolean; missing: ModRef[]; extra: ModRef[] }
export interface JoinPlan { inviteId: string; summary: InstanceSummary; verdict: JoinVerdict; candidates: InstanceCandidate[];
  createVanilla: boolean; lookupFailed: boolean }
export interface JoinTicket { joinId: string; inviteId: string; instanceId: string; address: string }
export interface LanStatus { port: number; source: PortSource; pid: number }
export interface ModStatus { state: "unavailable" | "notInstalled" | "installed" | "connected" }
export type SessionEnd = "stopped" | "kicked" | "lanClosed" | "hostOffline" | "gameExited" | "left" | "disabled" | "error";
export type JoinState = { type: "waitingForGame" } | { type: "connecting" } | { type: "connected"; path: PathKind; rttMs: number | null }
  | { type: "ended"; reason: SessionEnd };
export interface FriendPresenceEvent { friendId: string; presence: Presence; path: PathKind | null }
export interface FriendRequestEvent { request: FriendRequest }
export interface InviteEvent { invite: Invite }
export interface InviteRevokedEvent { inviteId: string; reason: "stopped" | "kicked" | "expired" }
export interface HostSessionEvent { session: HostSession }
export interface HostSessionEndedEvent { sessionId: string; reason: SessionEnd }
export interface JoinSessionEvent { joinId: string; inviteId: string; instanceId: string; state: JoinState }
export interface LanEvent { instanceId: string; lan: LanStatus | null }
export interface ModConnectionEvent { instanceId: string; connected: boolean }
export interface ModConfirmEvent { requestId: string; instanceId: string; instanceName: string; friends: { friendId: string; displayName: string }[] }
export interface FriendJoin { joinId: string; address: string }
/** Fixture key -> TS type (8.3). The fixture object uses these flat, dotted keys; `satisfies` rejects missing and extra keys. */
export interface FriendsFixtureTypes {
  constants: typeof FRIENDS_LIMITS;
  "friendsState.available": FriendsState; "friendsState.noSecretStore": FriendsState; "friendsState.identityLost": FriendsState;
  "networkStatus.off": NetworkStatus; "networkStatus.starting": NetworkStatus; "networkStatus.online": NetworkStatus; "networkStatus.degraded": NetworkStatus;
  "friend.online": Friend; "friend.relayRenamed": Friend; "friend.identityChanged": Friend; "friend.unconfirmed": Friend;
  "request.incoming": FriendRequest; "request.delivering": FriendRequest; "request.awaitingAnswer": FriendRequest;
  "code.created": FriendCode; "code.listed": FriendCode; blocked: BlockedPeer;
  hostSession: HostSession; invite: Invite;
  "joinPlan.ready": JoinPlan; "joinPlan.missing": JoinPlan; "joinPlan.vanilla": JoinPlan; joinTicket: JoinTicket;
  lanStatus: LanStatus; modStatus: ModStatus;
  "event.friendPresence": FriendPresenceEvent; "event.friendRequest": FriendRequestEvent; "event.invite": InviteEvent;
  "event.inviteRevoked": InviteRevokedEvent; "event.hostSession": HostSessionEvent; "event.hostSessionEnded": HostSessionEndedEvent;
  "event.joinSession.waitingForGame": JoinSessionEvent; "event.joinSession.connecting": JoinSessionEvent;
  "event.joinSession.connected": JoinSessionEvent; "event.joinSession.ended": JoinSessionEvent;
  "event.lan": LanEvent; "event.modConnection": ModConnectionEvent; "event.modConfirm": ModConfirmEvent;
}
```

### 8.3 Shared fixtures (contract test)
- File `src/lib/friends-fixtures.ts` (owner F1):
  ```ts
  import type { FriendsFixtureTypes } from "./friends-types";
  export const FRIENDS_FIXTURES = /*JSON-BEGIN*/{ … strict JSON … }/*JSON-END*/ satisfies FriendsFixtureTypes;
  ```
  `FriendsFixtureTypes` (8.2) maps every fixture key to its TS type. The fixture object is flat, and its keys are the dotted strings of the table below. `tsc` (in `pnpm build`) checks every fixture against the TS types, and `satisfies` rejects missing and extra keys.
- R2's `contract_tests.rs` reads the file with `include_str!`, extracts the text between the markers, parses it as JSON, deserialises every key into its Rust type, re-serialises it, and asserts JSON-value equality. The key `constants` is compared with the Rust consts. The test also asserts that the set of keys in the file equals the set of rows in its own table, so a key added on one side only fails.
- **Fixture key table (normative; F1 and R2 both implement exactly these rows, R2 is the owner of the mapping):**

  | Fixture key(s) | TS type | Rust type (`services::friends::contract`) | Content requirement |
  |---|---|---|---|
  | `constants` | `typeof FRIENDS_LIMITS` | the `pub const`s of 8.2 | every field, compared value by value |
  | `friendsState.available`, `.noSecretStore`, `.identityLost` | `FriendsState` | `FriendsState` | one per `Availability`; `available` has a `me` and an `online` network |
  | `networkStatus.off`, `.starting`, `.online`, `.degraded` | `NetworkStatus` | `NetworkStatus` | one per variant (also the `friends-network` payload) |
  | `friend.online`, `.relayRenamed`, `.identityChanged`, `.unconfirmed` | `Friend` | `Friend` | `relayRenamed`: `path: "relay"` + `notice.renamed`; `identityChanged`: `notice.identityChanged` |
  | `request.incoming`, `.delivering`, `.awaitingAnswer` | `FriendRequest` | `FriendRequest` | one per `RequestState` |
  | `code.created`, `code.listed` | `FriendCode` | `FriendCode` | `created` with `code`, `listed` with `code: null` |
  | `blocked` | `BlockedPeer` | `BlockedPeer` | |
  | `hostSession` | `HostSession` | `HostSession` | one guest per `GuestState`, one of them `left` with `kicked: true` |
  | `invite` | `Invite` | `Invite` | |
  | `joinPlan.ready`, `.missing`, `.vanilla` | `JoinPlan` | `JoinPlan` | `missing` has both `missing` and `extra`; `vanilla` has `createVanilla: true` |
  | `joinTicket` | `JoinTicket` | `JoinTicket` | |
  | `lanStatus` | `LanStatus` | `LanStatus` | |
  | `modStatus` | `ModStatus` | `ModStatus` | |
  | `event.friendPresence` | `FriendPresenceEvent` | `FriendPresenceEvent` | |
  | `event.friendRequest` | `FriendRequestEvent` | `FriendRequestEvent` | |
  | `event.invite` | `InviteEvent` | `InviteEvent` | |
  | `event.inviteRevoked` | `InviteRevokedEvent` | `InviteRevokedEvent` | |
  | `event.hostSession` | `HostSessionEvent` | `HostSessionEvent` | |
  | `event.hostSessionEnded` | `HostSessionEndedEvent` | `HostSessionEndedEvent` | |
  | `event.joinSession.waitingForGame`, `.connecting`, `.connected`, `.ended` | `JoinSessionEvent` | `JoinSessionEvent` | one per `JoinState` variant |
  | `event.lan` | `LanEvent` | `LanEvent` | |
  | `event.modConnection` | `ModConnectionEvent` | `ModConnectionEvent` | |
  | `event.modConfirm` | `ModConfirmEvent` | `ModConfirmEvent` | |

  `friends-changed` has the payload `null` and no key. `FriendJoin` is not a fixture key (8.1).
- A mismatch is resolved against this section, never by editing one side only.

### 8.4 Commands
Thin wrappers. Friends core: `src-tauri/src/friends_commands.rs` (R4). Sessions, invites, mod, skins: `src-tauri/src/friends_session_commands.rs` (R5). The TS method is the `Backend` method name.

| Rust command | Args (TS) | Returns | TS method | Notes |
|---|---|---|---|---|
| `friends_state` | | `FriendsState` | `friendsState()` | always works |
| `friends_enable` | `input: FriendsEnableInput` | `FriendsState` | `friendsEnable(input)` | Needs a Microsoft account, availability `available`, and third-party consent if needed. Creates the identity on first use. |
| `friends_disable` | | `FriendsState` | `friendsDisable()` | keeps the data |
| `friends_update_settings` | `settings: FriendsSettings` | `FriendsState` | `friendsUpdateSettings(settings)` | An `alwaysRelay` change rebinds and ends sessions (the UI confirms first). |
| `friends_rotate_identity` | | `FriendsState` | `friendsRotateIdentity()` | 4.6 |
| `friends_reset` | | `FriendsState` | `friendsReset()` | 4.6; also works in `identityLost` |
| `friends_list` | | `Friend[]` | `friendsList()` | |
| `friend_requests` | | `FriendRequest[]` | `friendRequests()` | |
| `friend_code_create` | | `FriendCode` (with `code`) | `friendCodeCreate()` | |
| `friend_codes` | | `FriendCode[]` (`code: null`) | `friendCodes()` | |
| `friend_code_revoke` | `codeId` | `void` | `friendCodeRevoke(codeId)` | |
| `friend_add` | `code` | `FriendRequest` (`delivering`) | `friendAdd(code)` | Returns at once; delivery runs in the background. |
| `friend_request_answer` | `requestId, accept` | `void` | `friendRequestAnswer(requestId, accept)` | |
| `friend_request_cancel` | `requestId` | `void` | `friendRequestCancel(requestId)` | outgoing only |
| `friend_rename` | `friendId, alias: string \| null` | `void` | `friendRename(friendId, alias)` | local alias, sanitised, at most 32 chars |
| `friend_acknowledge` | `friendId` | `void` | `friendAcknowledge(friendId)` | clears `notice` |
| `friend_remove` | `friendId` | `void` | `friendRemove(friendId)` | |
| `friend_block` | `peerId` | `void` | `friendBlock(peerId)` | a friend or a request peer |
| `friend_unblock` | `peerId` | `void` | `friendUnblock(peerId)` | |
| `friends_blocked` | | `BlockedPeer[]` | `friendsBlocked()` | |
| `friends_retry_now` | | `void` | `friendsRetryNow()` | Returns at once. Dials every `delivering` request immediately and every offline friend whose last attempt is more than 2 min old (4.3, 4.4). Called on Friends page open and by "Jetzt zustellen". |
| `friend_skin` | `friendId` | `string \| null` (PNG data URL) | `friendSkin(friendId)` | Rust fetch + cache (10.2) |
| `lan_status` | `instanceId` | `LanStatus \| null` | `lanStatus(instanceId)` | |
| `host_sessions` | | `HostSession[]` | `hostSessions()` | 0 or 1 entries |
| `host_start` | `instanceId, port: number \| null, showWorldName` | `HostSession` | `hostStart(instanceId, port, showWorldName)` | |
| `host_invite` | `sessionId, friendIds: string[]` | `HostSession` | `hostInvite(sessionId, friendIds)` | |
| `host_kick` | `sessionId, friendId` | `HostSession` | `hostKick(sessionId, friendId)` | |
| `host_stop` | `sessionId` | `void` | `hostStop(sessionId)` | |
| `invites_list` | | `Invite[]` | `invitesList()` | |
| `invite_decline` | `inviteId` | `void` | `inviteDecline(inviteId)` | |
| `invite_plan` | `inviteId` | `JoinPlan` | `invitePlan(inviteId)` | fetches the manifest, then 5.6 |
| `invite_join` | `inviteId, instanceId` | `JoinTicket` | `inviteJoin(inviteId, instanceId)` | |
| `join_leave` | `joinId` | `void` | `joinLeave(joinId)` | |
| `friends_mod_status` | `instanceId` | `ModStatus` | `friendsModStatus(instanceId)` | |
| `friends_mod_install` | `instanceId, operationId` | `void` | `friendsModInstall(instanceId, operationId)` | Pinned project id, under `begin_operation`. |
| `friends_mod_confirm` | `requestId, allow` | `void` | `friendsModConfirm(requestId, allow)` | 7.4 |

"Create vanilla instance" uses the existing `createInstance` method (`NewInstance` with `loader: "vanilla"` and the host's version). No new command.

`friendsModInstall(instanceId, operationId)` resolves to `void` (F1). `useBackgroundTask` expects a task that resolves to an `Instance`, so F5 wraps the call (for example by refetching the instance afterwards) instead of changing the `Backend` signature.

### 8.5 Events (via `services::progress::emit`)
| Event | Payload | When |
|---|---|---|
| `friends-changed` | `null` | List, requests, codes, blocked, settings, availability or notices changed. The UI invalidates `friendKeys.all`. **Not** sent for presence or path changes. |
| `friends-network` | `NetworkStatus` | The UI writes it into the cached `friendKeys.state` (`network`). |
| `friend-presence` | `FriendPresenceEvent` | Presence or path of one friend changed. The only event for that change; the UI patches the friend in `friendKeys.list`. |
| `friend-request` | `FriendRequestEvent` | incoming request arrived |
| `friend-invite` | `InviteEvent` | |
| `friend-invite-revoked` | `InviteRevokedEvent` | |
| `host-session` | `HostSessionEvent` | created or changed |
| `host-session-ended` | `HostSessionEndedEvent` | |
| `join-session` | `JoinSessionEvent` | |
| `lan-changed` | `LanEvent` | verified port found, or closed |
| `friends-mod` | `ModConnectionEvent` | |
| `friends-mod-confirm` | `ModConfirmEvent` | 7.4 |

Query keys (`src/hooks/queryKeys.ts`, F1): `friendKeys.all = ["friends"]` with the children `state`, `list`, `requests`, `codes`, `blocked`, `invites`, `hostSessions`. On purpose **outside** `friendKeys.all`, so that `friends-changed` does not refetch them: `friendKeys.skin(friendId)`, `plan(inviteId)`, `lan(instanceId)`, `modStatus(instanceId)`. `lan-changed` sets `friendKeys.lan(instanceId)`; `friends-mod` invalidates `friendKeys.modStatus(instanceId)`.

`BackendEvents` gets these twelve, with `on…` methods in `eventSubscriptions`: `onFriendsChanged`, `onFriendsNetwork`, `onFriendPresence`, `onFriendRequest`, `onFriendInvite`, `onFriendInviteRevoked`, `onHostSession`, `onHostSessionEnded`, `onJoinSession`, `onLanChanged`, `onFriendsMod`, `onFriendsModConfirm`. `Capabilities` is **not** changed (Appendix D, F15: `Capabilities` is a static, synchronous object and cannot reflect a runtime keyring probe). Runtime availability comes from `FriendsState.availability` (`noSecretStore` hides the area).

### 8.6 Launch integration (R3)
- `LaunchOptions` gets `#[serde(default)] pub friend_join: Option<FriendJoin>` with `FriendJoin { join_id: String, address: String }` (struct rules of 8.1), both in `src-tauri/src/models.rs`. This is the only Rust definition of `FriendJoin` (8.1). TS: `friendJoin?: FriendJoin`. A unit test in `models.rs` asserts that `{"joinId":"j1","address":"127.1.2.3:25565"}` round-trips, and that `LaunchOptions` without the field still deserialises.
- With `friend_join` set, `instance_launch`:
  - Requires a non-empty `account_id` (Microsoft), else `errors.friends.msAccountRequired`. A non-empty `account_id` is the same rule `launch_account` uses to start online with that account's Microsoft session.
  - Requires the address to parse as a `SocketAddrV4` with a loopback IP (`127.0.0.0/8`) and a port other than 0, else `errors.friends.joinAddressInvalid`. This is stricter than the pattern `^127\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{1,5}$`: octets over 255, ports over 65535 and port 0 are refused.
  - Uses `QuickPlay::Server{address}` (any `quick_play` in the options is ignored).
  - **Does not write `last_quick_play`** (it still writes `last_played_at`).
  - The version must offer the quick-play-multiplayer feature (always true from 1.20).
- After spawn, `instance_launch` sends `GameSignal::Spawned{instance_id, pid, online_account, friend_join: Option<join_id>}` with `online_account = account_id is non-empty`. It is sent inside the `spawn_running` closure (under the running lock), so it always precedes that launch's `Exited`. `Exited` is sent in `on_game_exit` right after the running entry is taken, together with `bridge.forget(instance_id)`.
- With `friend_join` set, before spawn (`gamesignal::LaunchReporter`):
  - `instance_launch` itself emits no progress events, so it calls `LaunchReporter::progress()` at its phase boundaries: after the world backup, after the mod sync, after the account session, after the installed-version check and after the Java resolution. Each call sends `GameSignal::LaunchProgress{instance_id, friend_join}`, throttled to at most one signal per second. A version install runs in the separate `instance_install` command and sends nothing (6.2).
  - If `instance_launch` fails before the game process is spawned (any error, including the refusals above), `LaunchReporter::guard` sends `GameSignal::LaunchFailed{instance_id, friend_join}` before returning the error.
  - Without `friend_join`, neither signal is sent.

### 8.7 Internal seams
```rust
// services/shared_types.rs (R0a): PathKind, PortSource, `pub use crate::models::ModLoader` (8.1). No logic.

// services/gamesignal.rs (R3); PortSource from shared_types
#[derive(Debug, Clone, PartialEq)]
pub enum GameSignal {
    LaunchProgress { instance_id: String, friend_join: String },          // only for friend joins, at most 1/s (8.6)
    LaunchFailed { instance_id: String, friend_join: String },            // only for friend joins, failure before spawn (8.6)
    Spawned { instance_id: String, pid: u32, online_account: bool, friend_join: Option<String> },   // always before that launch's Exited (8.6)
    LanOpened { instance_id: String, port: u16, source: PortSource },      // unverified hint (mod or log); R5 runs verify_port
    LanClosed { instance_id: String },                                     // log or mod; consumer re-checks
    Exited { instance_id: String },
    ModConnected { instance_id: String }, ModDisconnected { instance_id: String },
    ModRequest { instance_id: String, request: ModRequest },
}
/// Defined here (8.1). Friend ids are real peer ids: the bridge has already mapped the mod's aliases back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModRequest { Share { friend_ids: Vec<String> /* 1..=7, all shown to that connection */ }, StopSharing, Kick { friend_id: String } }
#[derive(Clone, Default)]   // a broadcast channel with capacity 256; a slow consumer gets RecvError::Lagged
pub struct GameSignals; impl GameSignals { pub fn send(&self, s: GameSignal); pub fn subscribe(&self) -> broadcast::Receiver<GameSignal>; }
/// The raw-stdout callback for launch::spawn: feeds a LanDetector and sends LanOpened { source: Log } / LanClosed.
pub fn lan_line_forwarder(signals: GameSignals, instance_id: String) -> impl Fn(&str) + Send + Sync + 'static;
/// LaunchProgress (throttled to 1/s) and LaunchFailed for friend joins; does nothing when friend_join is None (8.6).
pub struct LaunchReporter; impl LaunchReporter {
    pub fn new(signals: GameSignals, instance_id: &str, friend_join: Option<&str>) -> Self;
    pub fn progress(&self);
    pub async fn guard<T>(&self, launch: impl Future<Output = AppResult<T>>) -> AppResult<T>;   // LaunchFailed before an Err returns
}
// AppState (state.rs, R3): `pub signals: GameSignals`, `pub bridge: ModBridge` (constructed stopped). R4 subscribes with
// `state.signals.subscribe()` and passes clones of both to `Friends::new`.

// services/sockowner (R3): Windows GetExtendedTcpTable(TCP_TABLE_OWNER_PID_ALL, v4+v6); Linux /proc/net/tcp{,6} + /proc/<pid>/fd inodes;
// macOS `/usr/sbin/lsof -nP -a -p <pid> -iTCP… -F` with fixed arguments. Other systems: every query fails with ErrorKind::Unsupported.
// Blocking on Linux and macOS: call through spawn_blocking.
pub enum TcpState { Listen, Established, Other }
pub struct TcpSocket { pub local: SocketAddr, pub remote: SocketAddr, pub state: TcpState }
pub trait SocketTable { fn sockets_of(&self, pid: u32) -> io::Result<Vec<TcpSocket>>; }   // per-OS implementation; test seam
pub fn listens(pid: u32, port: u16) -> io::Result<bool>;               // a LISTEN socket of pid on port (any address)
pub fn connects_from(pid: u32, client: SocketAddr) -> io::Result<bool>; // a non-LISTEN socket of pid whose local address == client

// services/lan_detect.rs (R3)
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum LanLine { Opened(u16), Closed }
#[derive(Debug, Default)] pub struct LanDetector; impl LanDetector { pub fn feed(&mut self, raw: &str) -> Option<LanLine>; }   // raw stdout lines (6.4)
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum PortCheck { Ok, NotOwned, NoAnswer }
pub async fn verify_port(pid: u32, port: u16) -> PortCheck;   // 6.1; a failed owner lookup counts as NotOwned

// services/modbridge (R3)
pub const ENV_PORT: &str = "PUMPKIN_IPC_PORT"; pub const ENV_TOKEN: &str = "PUMPKIN_IPC_TOKEN"; pub const ENV_PROTOCOL: &str = "PUMPKIN_IPC_PROTOCOL";
#[derive(Clone)]
pub struct ModBridge;
impl ModBridge {
    pub fn new(signals: GameSignals) -> Self;            // stopped
    pub async fn start(&self) -> AppResult<()>;          // binds 127.0.0.1:0; no await inside; idempotent
    pub async fn stop(&self);                            // closes every link, drops every token, awaits the accept task: the port is free on return
    pub fn launch_env(&self, instance_id: &str, loader: ModLoader) -> Vec<(String, String)>;   // empty unless Fabric and running
    pub fn forget(&self, instance_id: &str); pub fn is_connected(&self, instance_id: &str) -> bool;
    pub fn push(&self, instance_id: &str, message: LauncherToMod);   // keeps the latest Snapshot; full queue (64) -> disconnect
}
// services/modbridge/protocol.rs (R3): the wire types of 7.2/7.3. Defined here (8.1). Per-connection loop: modbridge/connection.rs.
pub const PROTOCOL_VERSION: u32 = 1;
pub enum ModToLauncher { Hello { protocols: Vec<u32>, token: String, mod_version: String /* "mod" */, minecraft: String },
                         LanOpened { port: u16 }, LanClosed, Share { friend_ids: Vec<String> }, StopSharing, Kick { friend_id: String }, Ping }
pub enum Handshake { Welcome { protocol: u32, launcher: String }, Reject { reason: RejectReason } }
pub enum RejectReason { Token, Protocol, Duplicate }
pub enum LauncherToMod { Snapshot { friends: Vec<ModFriend>, session: Option<ModSession>, invites: Vec<ModInvite> },
                         Notify { event: ModNotify, name: Option<String>, mc_uuid: Option<String> },
                         Error { code: ModErrorCode, r#ref: Option<String> }, Pong }
pub struct ModFriend { pub id: String, pub name: String, pub mc_uuid: Option<String>, pub presence: ModPresence }
pub enum ModPresence { Offline, Online, Playing }
pub struct ModSession { pub guests: Vec<ModGuest> }
pub struct ModGuest { pub id: String, pub name: String, pub state: ModGuestState }
pub enum ModGuestState { Invited, Connected }
pub struct ModInvite { pub id: String, pub from_name: String, pub title: String }
pub enum ModNotify { InviteReceived, GuestJoined, GuestLeft, SessionEnded, FriendOnline, ConfirmInLauncher }
pub enum ModErrorCode { NotEnabled, PeerOffline, GuestLimit, LanPortUnknown, PortNotGame, Denied, VersionUnsupported, Busy, Internal }
// ModFriend/ModGuest carry real peer ids inside the launcher; the bridge replaces them with per-connection aliases on the wire (7.3).
// Serde: enums with data `tag = "type"`, camelCase (8.1); ModToLauncher is Deserialize only.

// launch.rs (R3): seven parameters; `on_stdout_raw` gets every stdout line unprocessed (for LanDetector), stdout only.
pub fn spawn(java: &Path, args: &[String], game_dir: &Path, env: &[(String, String)],
             on_line: impl Fn(LogStream, String) + Send + Sync + 'static, on_stdout_raw: impl Fn(&str) + Send + Sync + 'static,
             on_exit: impl FnOnce(Option<i32>) + Send + 'static) -> AppResult<Running>;

// services/p2p (R1). Public: mod.rs re-exports everything below; `frame` and `tunnel` are public modules.
#[derive(Debug, Clone)]
pub struct NetConfig { pub secret: [u8; 32], pub alpns: Vec<&'static [u8]> /* empty = dial-only */, pub relay_map: Vec<RelayEntry>,
                       pub relays: RelaySelection, pub relay_only: bool, pub relay_tls: RelayTls /* 3.7 */ }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetState { Starting, Online { home_relay: u8 }, RelayUnreachable }   // 3.4
#[derive(Debug, thiserror::Error)]
pub enum NetError { UnknownRelay(u8), InvalidRelayUrl(String), Bind(String), Timeout, Unreachable, Closed(CloseReason) }
pub struct PeerNet;   // must outlive its PeerConns; dropping it ends them locally
impl PeerNet {
    pub async fn bind(config: NetConfig, gate: Arc<dyn Gate>) -> Result<Self, NetError>;   // spawns the accept and status tasks (3.3, 3.4)
    pub fn id(&self) -> PeerId;
    pub fn home_relay(&self) -> Option<u8>;                  // Some only while NetState::Online; announce it as `homeRelay`
    pub fn status(&self) -> watch::Receiver<NetState>;
    pub async fn dial(&self, peer: &PeerId, alpn: &'static [u8]) -> Result<PeerConn, NetError>;   // own relays only, DIAL_TIMEOUT inside
    pub async fn accept(&self) -> Option<(Vec<u8> /* alpn */, PeerConn)>;   // queue of 16; None once the endpoint is closed
    pub async fn close(&self, code: CloseCode);              // every connection with `code`, then the endpoint (3.6)
}
impl Dialer for PeerNet { … }
#[derive(Clone)]
pub struct PeerConn;
impl PeerConn {
    pub fn remote(&self) -> PeerId; pub fn direction(&self) -> Direction;
    pub async fn open_bi(&self) -> Result<BiStream, NetError>;   // write the open frame at once: the peer sees the stream only then; waits while 16 are open
    pub async fn accept_bi(&self) -> Result<BiStream, NetError>;
    pub fn path(&self) -> Option<PathKind /* shared_types */>; pub fn rtt(&self) -> Option<Duration>;
    pub fn close(&self, code: CloseCode); pub async fn closed(&self) -> CloseReason;
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)] pub struct CloseCode(u32);   // NORMAL, NOT_FRIEND, DUPLICATE, PROTOCOL, RATE_LIMITED, SHUTDOWN (3.6)
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum CloseReason { Peer(CloseCode), Local, TimedOut, Lost }
#[derive(Debug, Clone, Copy, PartialEq, Eq)] pub enum Direction { Outgoing, Incoming }
pub fn duplicate_survivor(local: &PeerId, remote: &PeerId) -> Direction;   // 4.4
/// Both directions of a QUIC stream; tokio AsyncRead + AsyncWrite (`shutdown()` finishes the send side cleanly). No iroh type in the API.
#[derive(Debug)] pub struct BiStream;
impl BiStream {
    pub async fn read_frame<T: DeserializeOwned>(&mut self, limit: usize) -> Result<T, FrameError>;   // any error resets with PROTOCOL (5.1)
    pub fn reset(&mut self, code: CloseCode);   // both directions
}
pub mod frame {   // generic over AsyncRead / AsyncWrite; never resets
    pub async fn read<T: DeserializeOwned>(recv: &mut (impl AsyncRead + Unpin), limit: usize) -> Result<T, FrameError>;
    pub async fn write<T: Serialize>(send: &mut (impl AsyncWrite + Unpin), message: &T, limit: usize) -> Result<(), FrameError>;
}
pub enum FrameError { TooLarge { len: usize, limit: usize }, Json(serde_json::Error), Io(io::Error) }
/// Seam so that timeout and backoff tests run on paused time without sockets; PeerNet implements it.
pub trait Dialer: Send + Sync + 'static { fn dial<'a>(&'a self, peer: &'a PeerId, alpn: &'static [u8]) -> BoxFuture<'a, Result<PeerConn, NetError>>; }
pub const DIAL_TIMEOUT: Duration = Duration::from_secs(8);
/// EndpointId; Display/FromStr exactly 64 lowercase hex (other spellings refused); Debug prints only the 8-char short form; bytewise Ord.
#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)] pub struct PeerId;
impl PeerId { pub fn from_bytes(bytes: &[u8; 32]) -> Result<Self, InvalidPeerId>; pub fn as_bytes(&self) -> &[u8; 32]; pub fn short(&self) -> String; }
pub struct InvalidPeerId;
// Also re-exported: Gate, Admission (3.5), RelayEntry, RelayOperator, RelaySelection, RELAY_MAP, find_relay (3.2), RelayTls (3.7).
// p2p::tunnel: bridge, LocalListener, ListenerLimits, TunnelError (6.3).

// services/secrets.rs (R2): SecretStore { load, save, delete }, KeyringSecrets, #[cfg(test)] MemorySecretStore (4.1)
// services/friends (R2). Peer ids are `&str`/`String` at this layer; R4 converts to p2p::PeerId.
pub struct Identity;   // identity.rs
impl Identity {
    pub fn generate() -> Self; pub fn from_secret_bytes(bytes: &[u8; 32]) -> Self; pub fn secret_bytes(&self) -> [u8; 32];   // NetConfig.secret of the main endpoint
    pub fn peer_id(&self) -> String; pub fn sign(&self, domain: &[u8], parts: &[&[u8]]) -> [u8; 64];
    pub fn hello_secret(&self, salt: &[u8; 16]) -> [u8; 32]; pub fn hello_id(&self, salt: &[u8; 16]) -> [u8; 32];
}
pub fn identity::verify(peer_id: &str, domain: &[u8], parts: &[&[u8]], signature: &[u8; 64]) -> bool;
pub fn identity::parse_peer_id(peer_id: &str) -> Option<PublicKey>; pub fn identity::fingerprint(peer_id: &str) -> String;
pub fn identity::short_id(peer_id: &str) -> &str;
pub fn identity::{load, load_retired}(secrets: &dyn SecretStore) -> AppResult<Option<Identity>>; pub fn identity::delete_retired(secrets) -> AppResult<()>;
pub fn identity::create(secrets: &dyn SecretStore) -> AppResult<Identity>;
pub fn identity::renew(secrets: &dyn SecretStore) -> AppResult<Renewal>;   // Renewal { retired: Option<Identity>, current: Identity } (4.1, 4.6)
pub fn identity::availability(secrets: &dyn SecretStore, has_friends_data: bool) -> Availability;
// code.rs (4.2): issue, parse, secret_matches, CodeParts { relay_index, hello_id, secret } (+ encode, tail, secret_hex, secret_digest,
//   ensure_relay_known, ensure_not_own), IssuedCode { salt, parts }.
// records.rs (9): FriendRecord, RequestRecord, CodeRecord, BlockedRecord, OutboxRecord, OutboxKind { Unfriend, Rotated },
//   RecordStores { friends, requests, codes, blocked, outbox: JsonStore<_> } with open(dir) and any().
// config.rs (9): FriendsConfig { version, enabled, settings: FriendsSettings, third_party_relays_accepted } with load(dir), save(dir); friends_dir(&Dirs).
// sanitize.rs (12.3): display_name(raw, peer_id), own_display_name(raw) -> AppResult<String>, world_or_instance_name, file_name,
//   alias(raw) -> Option<String>, mc_name(Option<&str>), mc_uuid(Option<&str>).
// contract.rs (8.2): every contract type and constant; contract_tests.rs (8.3).

// services/friends/service.rs (R4): network options (3.7) and the extension seam for R5.
// PeerId, PeerConn, BiStream, NetError and CloseCode below are the services::p2p types (R1); no wrapper types.
pub trait PeerStreamHandler: Send + Sync + 'static {
    /// Request-Stream nach dem Öffnungsrahmen `{"type":"request"}`; der Handler liest die Anfrage und antwortet selbst.
    async fn on_request_stream(&self, peer: &PeerId, stream: BiStream);
    /// Tunnel-Stream nach `{"type":"tunnel","sessionId":…}`; der Handler antwortet mit `tunnelOk` oder `error`.
    async fn on_tunnel_stream(&self, peer: &PeerId, session_id: String, stream: BiStream);
    /// Steuernachrichten `invite`, `inviteRevoke`, `inviteDecline` (schon größengeprüft und bereinigt).
    async fn on_control_message(&self, peer: &PeerId, message: SessionControl);
}
// SessionControl and WireInvite (the `invite` object of 5.3) are defined in services/friends/control.rs (R4), which parses them.
pub enum SessionControl { Invite(WireInvite), InviteRevoke { invite_id: String, reason: RevokeReason }, InviteDecline { invite_id: String } }
pub enum Lifecycle { Disabled, Rebind, IdentityChanged, Shutdown }
pub struct LifecycleEvent { pub kind: Lifecycle, pub done: oneshot::Sender<()> }   // send or drop `done` when your teardown is finished
impl Friends {
    pub fn register_stream_handler(&self, handler: Arc<dyn PeerStreamHandler>) -> Result<(), HandlerAlreadySet>;   // exactly once
    pub fn subscribe_lifecycle(&self) -> mpsc::Receiver<LifecycleEvent>;          // every subscriber gets every event
    pub fn send_control(&self, peer: &PeerId, message: SessionControl) -> Result<(), NotConnected>;   // R5 sends invites through this
    pub fn connection(&self, peer: &PeerId) -> Option<PeerConn>;                  // R5 opens request/tunnel streams on it (redial: `dial_friend`)
    pub async fn dial_friend(&self, peer: &PeerId) -> Result<PeerConn, NetError>;
}
// `async fn` in these traits is shorthand: the real methods return `futures::future::BoxFuture<'_, T>` (T = the shown output)
// so that the traits stay dyn-compatible without a new crate (`futures` is already a dependency). Same for `ModLookup` below.
```
- **Lifecycle (normative order):** `friends_disable` delivers `Disabled`; `friends_update_settings` with a changed `alwaysRelay` delivers `Rebind`; `friends_rotate_identity` and `friends_reset` deliver `IdentityChanged`; `friends.shutdown()` (from `RunEvent::Exit`) delivers `Shutdown`. R4 sends the event to every subscriber, then waits until every `done` has been sent or dropped, **at most 500 ms in total**, and only then closes or rebinds the endpoints with `PeerNet::close(CloseCode::SHUTDOWN)` (3.6). R4 never calls R5 code directly.
- **R4 and the R1/R3 objects:** R4 keeps one `PeerNet` per endpoint alive for as long as its connections, keeps calling `PeerNet::accept()` (the queue holds 16), dials only through `PeerNet::dial` or its `Dialer` impl (the seam for the paused-time fakes), and holds the Gate's lookups in memory because `Gate::admit` is synchronous (3.5). It starts and stops `state.bridge` with the feature (7.1) and subscribes to `state.signals`.
- **R5 wiring:** R5 constructs its `FriendSessions` in `lib.rs` `setup` right after `Friends`, calls `register_stream_handler` and `subscribe_lifecycle`, and stores it in `state.rs` (`pub sessions: FriendSessions`). These are the only edits R5 makes to `lib.rs` and `state.rs` besides its `generate_handler!` entries (14). R4 leaves the marker comment `// friends: session wiring (R5)` in `setup` at the place where this goes.

```rust
// services/friends/joining.rs (R5): injectable join timers (6.2)
pub struct JoinTimers { pub spawn_wait: Duration, pub spawn_wait_cap: Duration, pub first_connection: Duration }
impl JoinTimers { pub fn production() -> Self; }   // 600 s, 1800 s, 600 s; lib.rs passes this, tests pass small values (13.1 R5)
// FriendSessions::new(friends: &Friends, signals: GameSignals, bridge: ModBridge, lookup: Arc<dyn ModLookup>, timers: JoinTimers)

// services/friends (R6, pure or behind traits)
pub fn manifest::build(instance: &Instance, hasher: &dyn Fn(&Path) -> io::Result<String>) -> Manifest;
pub fn manifest::validate(raw: Manifest, versions: &VersionIndex) -> Result<Manifest, ManifestError>;
pub trait ModLookup { async fn classify(&self, sha512: &[String]) -> Result<HashMap<String, ModInfo>, LookupError>; } // title, project_id, client_only
pub fn matching::plan(invite: &Invite, manifest: &Manifest, instances: &[Instance], local_hashes: &dyn LocalHashes, info: &HashMap<String, ModInfo>) -> JoinPlan;
pub async fn avatar::skin(http, dirs, mc_uuid) -> AppResult<Option<String>>;
pub async fn modinstall::{status, install}(…);
```

---

## 9. Persistence

- **The backend owns everything.** `store/settings.ts` gets no friends fields. The UI reads `friendsState`.
- Files in `<app data dir>/friends/`, created on first enable:

| File | Type | Content |
|---|---|---|
| `config.json` | struct, `write_atomic` | `{version: 2, enabled, settings: {displayName, alwaysRelay}, thirdPartyRelaysAccepted}`. Missing = disabled with defaults. |
| `friends.json` | `JsonStore<FriendRecord>` | `{id, displayName, alias?, mcName?, mcUuid?, homeRelay?: u8, addedAt, lastSeen?, confirmed, removedByPeer, notice?}` |
| `requests.json` | `JsonStore<RequestRecord>` | `{id, direction, state, peerId?, helloId?, relayIndex?, secret? (outgoing only, to retry delivery), displayName?, mcName?, mcUuid?, codeTail?, createdAt, expiresAt}`. Pruned on load and hourly. |
| `codes.json` | `JsonStore<CodeRecord>` | `{id, salt, secretSha256, relayIndex, tail, createdAt, expiresAt, usedBy?}`. Expired records pruned. |
| `blocked.json` | `JsonStore<BlockedRecord>` | `{id (peer id), displayName, blockedAt}` |
| `outbox.json` | `JsonStore<OutboxRecord>` | `{id (friend peer id), kind: "unfriend" \| "rotated", newPeerId?, signature?, until}` |
| `skins/<uuid>.png` | cache | Skin PNG, at most 64 KiB, refreshed after 24 h |
| keyring | secrets | `friends-identity`, `friends-identity-retired` (64 hex each) |

- Sessions, invites, presence, joins and mod confirmations are runtime only.
- The folder is `config::friends_dir(&dirs)` = `<dirs.root>/friends`. `RecordStores::open(dir)` creates it and opens the five `JsonStore`s; `RecordStores::any()` is true when any store holds a readable record (unreadable entries of a newer version are kept on save but not counted).
- Entities implement `services::store::Entity` in `records.rs` (through a local `record!` macro, because `store.rs`'s `entity!` macro is private), with not-found keys `errors.friends.notFound.{friend,request,code,blocked}`; `OutboxRecord` uses `errors.friends.notFound.friend` (its id is a friend's peer id).
- `config.json`: `FriendsConfig::load(dir)` returns the defaults when the file is missing. A file that cannot be parsed is moved aside to `config.json.corrupt` (a free name, like `JsonStore` does) and the defaults are used. `save(dir)` writes atomically.
- Defaults: `enabled = false`, `alwaysRelay = false`, `displayName = ""`, `thirdPartyRelaysAccepted = false`. The display name is filled from the active MS account name when the feature is enabled (the opt-in pre-fills it, `FriendsEnableInput.displayName` carries the result). `showWorldName` is per session, default false.

---

## 10. UI

Kit rules (docs/design/PIXELKINO.md): no border radius, a warning always has a symbol, fixed widths for status cells, no decoration on the Friends page. i18n: German source with an English twin. Namespaces `friends` (F2), `friendsSettings` (F3), `friendsInvite` (F4), `friendsHost` (F5). All are created empty by F1.

**Self-asserted data.** Wherever a friend's or requester's name appears in a dialog, the fingerprint is shown next to it. A tooltip, "selbst angegeben", is attached to names and skin heads.

### 10.1 Navigation (F2)
- Route `/friends`. In `AREAS`, the entry `{to:"/friends", key:"ui.nav.friends", icon:"users"}` goes **at the end** (Ctrl+5, existing shortcuts unchanged). It is hidden when `availability === "noSecretStore"`. Add it to `AREA_TITLES`.
- Sidebar badge = incoming pending requests + open invites + friends with a `notice`. This needs a new `badge?: number` on `MainTab`/`BarButton` (`ui/Button.tsx`, `ui/button.css`, the forced-colors rule).
- New icons `users`, `link`, `share` in both the 7x7 and 5x5 grids of `src/pixel/icon-data.ts`.

### 10.2 Friends page `/friends` (F2)
- Gates, in this order (`friendsGate` in `src/pages/friends/friendsModel.ts`):
  - `noSecretStore`: the keyring panel (as in 10.8). The navigation entry is hidden anyway (10.1); this gate covers a direct `/friends` URL, so that the page never offers "Freunde aktivieren" on a system without a keyring.
  - `identityLost`: `StatusPanel tone="bad"` "Identität verloren" + "Zurücksetzen" (danger confirm, `friendsReset`).
  - Not enabled: `Empty size="page"` + "Freunde aktivieren", which opens the opt-in dialog (F3) on the page: `{optingIn && <FriendsOptInDialog onClose={…} />}` (10.9). The current code links to `/settings?tab=freunde` instead (Appendix E, E3).
  - No MS account: `StatusPanel` + login button.
  - `network.type === "degraded"`: a `StatusPanel tone="bad"` banner. The page stays usable.
- Header: `PageHeader title count={online}`. Actions "Freund hinzufügen" (`plus`), "Mein Code" (`link`).
- **Requests** (only if any; `List variant="accounts"`):
  - Incoming: avatar, name + fingerprint, "Annehmen", "Ablehnen", and a menu with "Blockieren" (danger confirm, as for friends).
  - Outgoing `delivering`: "Code …{tail}: wird zugestellt, sobald der Besitzer online ist" + "Jetzt zustellen" (`friendsRetryNow`, disabled for 10 s after a press) + "Zurückziehen". When the request is older than 7 days (`now - createdAt > codeTtlSecs`), an extra warning line with a symbol: "Der Code ist eventuell abgelaufen; frag nach einem neuen." (4.3).
  - Opening the page calls `friendsRetryNow()` once per mount (4.3, 4.4).
  - Outgoing `awaitingAnswer`: name + fingerprint, "wartet auf Bestätigung" + "Zurückziehen".
- **Friends** (`List variant="friends"`: 40px avatar | name+sub | 150px status | 120px action | 36px menu):
  - Sub-line: "spielt", "online", "zuletzt online vor 2 h", or for unconfirmed friends "wartet, bis {name} online kommt".
  - Status chip with dot and text (never color alone), and a "Relay" tag when `path === "relay"`.
  - Order: alphabetical by the displayed name (alias, else display name, with the fingerprint suffix for duplicates), never by presence, so rows do not move when someone comes online.
  - Action: "Beitreten" when an open invite from this friend exists. It calls `requestInviteDialog(inviteId)` (`src/pages/friends/inviteRequest.ts`, a zustand store `useInviteRequest` holding the requested invite id); F4's `FriendDialogs` reads that store, opens the InviteDialog and clears it. Otherwise "Einladen" when I host a session, the friend is confirmed, online and not removed by the peer, and holds no seat in the session (a seat = `invited`, `connected`, or `left` without a kick; a `declined` or kicked guest gets "Einladen" again, 5.4) (`canInvite`).
  - Menu: "Umbenennen" (one `TextField` dialog, `friendRename`), "Fingerabdruck anzeigen", "Entfernen" (danger confirm), "Blockieren" (danger confirm).
  - `notice` rows show "{alt} heißt jetzt {neu}" or "{name} hat eine neue Identität (Fingerabdruck geändert)", with "OK" (`friendAcknowledge`). They are separate list rows under the friend's row, so the fixed grid columns stay untouched.
  - `removedByPeer` rows are greyed, with only "Entfernen".
  - Duplicate display names are shown with the fingerprint's first group.
- Toolbar: search + `Segmented` Alle/Online. Empty state: "Noch keine Freunde" with both actions.
- `FriendAvatar`: `friendSkin(friendId)` (TanStack Query, `staleTime` 1 h) rendered with the existing `SkinHead`. Fallback: the pixel face from the name. The UI never contacts Mojang directly. `FriendAvatar`, `SelfAsserted` (`components/friends/FriendAvatar.tsx`) and `Fingerprint` (`components/friends/Fingerprint.tsx`) are shared with F3, F4 and F5, as are the pure helpers of `friendsModel.ts` (`canInvite`, `inviteFrom`, `friendLabels`, …).
- **Live data in the sidebar:** the badge needs the requests, invites and friends lists on every page. `useFriendsNav` (Sidebar) declares those queries with `enabled` only while friends are enabled and available, using the F1 query keys, and calls the interim hook `src/pages/friends/useFriendsLive.ts`, which handles `friends-changed`, `friend-request`, `friend-presence` and `friends-network`. F4's global `useFriendEvents` replaces it (14, hand-off).

### 10.3 Add friend dialog (F2, width 520, two `Tabs`)
- **Mein Code:**
  - "Code erzeugen" shows the 80-char code once, in the pixel font, in groups of 4, with "Kopieren".
  - Hint: "Gilt 7 Tage und nur für eine Person. Wer den Code hat, kann dir eine Anfrage schicken: Poste ihn nicht öffentlich."
  - The active codes (tail, expiry, used) with "Widerrufen". "Code erzeugen" is disabled at 3 active codes.
- **Code eingeben:** a `TextField` with shape validation (`friendCode.ts`). "Anfrage senden" calls `friendAdd`. Toast: "Anfrage wird zugestellt". A hint states that the display name and the Minecraft name go to the code owner, who must accept (4.3).
- The generated code and the fingerprint dialog reuse the existing pixel `.code` class (no new CSS file).

### 10.4 Invite and join (F4, global `components/friends/FriendDialogs.tsx` in `Layout`)
1. `friend-invite`: toast "{name} lädt dich ein: {title}" with the action "Ansehen". The badge increases. If another dialog is open, only the toast is shown, and the invite waits in `store/friendsUi.ts`.
2. **InviteDialog:** avatar, name + fingerprint, "lädt dich in {title} ein", and chips for MC version, loader and N mods. It calls `invitePlan` on open (`Skel` while loading).
   - `ready`: "Passende Instanz: {name}" (a `Select` if there are several), primary "Beitreten".
   - `missingContent`: warning panel "Deine Instanz {name} passt nicht", then the lists "Fehlt" and "Zusätzlich bei dir" (title + file name), and a hint "Füge die fehlenden Mods hinzu oder entferne die zusätzlichen, dann erneut prüfen" with "Erneut prüfen". No primary join.
   - `noInstance`: "Du hast keine Instanz mit Minecraft {version} und {loader}". If `createVanilla`: primary "Vanilla-Instanz anlegen", which calls `createInstance({name: title, minecraftVersion, loader:"vanilla"})`, then re-plans.
   - `versionUnsupported`: `StatusPanel tone="bad"` "Erst ab Minecraft 1.20".
   - `lookupFailed`: an extra info line "Modrinth nicht erreichbar; Client-Mods werden mitgezählt".
   - The active account must be Microsoft. Otherwise "Beitreten" is guarded with "Mit Offline-Konto kann man keiner Welt beitreten".
   - Secondary actions: "Ablehnen" (`inviteDecline`), "Später".
3. **Beitreten:** if the chosen instance is not installed (`instanceKeys.status(id).installed` false or unknown), F4 first runs the install (`useInstall`, `instance_install`) and waits for it. Only then it calls `inviteJoin`, which returns `{joinId, address}`, so the join's spawn wait never runs during a download (6.2). Then the existing `usePlay` start runs with `friendJoin: {joinId, address}` and no `quickPlay` (`LaunchOptions.friendJoin` is optional in TS). `join-session` events drive the session chip. `ended` with a reason other than `left` shows a toast with the translated reason.
   - The InviteDialog also opens from the Friends page: F4's `FriendDialogs` reads `useInviteRequest` (10.2) and clears it when it opens the dialog.
4. `friend-invite-revoked`: close the dialog if it shows that invite, and toast "{name} hat das Teilen beendet".
5. **ModConfirmDialog** on `friends-mod-confirm`: "Die Mod in {instance} möchte deine Welt mit {names} teilen. Erlauben?" with "Erlauben" / "Ablehnen" (`friendsModConfirm`). The window is restored (`setLauncherWindow("restore")`) when the dialog opens.

### 10.5 Hosting in the Worlds tab (F5, `pages/detail/WorldsTab.tsx`)
- A `ShareSection` above the world list, only when friends are enabled and available.
  - Version below 1.20: "Teilen gibt es ab Minecraft 1.20".
  - Not running: "Starte die Instanz und öffne die Welt für LAN (Weltoptionen), oder nutze die Mod."
  - Running, no verified port: "Warte auf geöffnete LAN-Welt…" + "Port selbst eingeben" (a `TextField` 1024-65535; errors from `hostStart`).
- Verified port (`lan-changed`): "Port {port} · gehört zu Minecraft (PID {pid})" and `Button icon="share"` "Mit Freunden teilen", which opens the **ShareDialog**:
  - A checkbox list of online confirmed friends (at most 7).
  - "Weltnamen zeigen" (off).
  - Info, with a symbol:
    - "Eingeladene sehen Minecraft-Version, Loader und die Modliste dieser Instanz."
    - "Eine für LAN geöffnete Welt ist auch für Geräte in deinem Heimnetz erreichbar, wie bei Vanilla."
  - Confirm: `hostStart`, then `hostInvite`.
- **Sharing:** `StatusPanel tone="run"` "Geteilt mit N Freunden", a guest list (state, path tag, RTT in `Count`, menu "Entfernen" = kick), "Weitere einladen", and "Teilen beenden" (confirm). A kicked guest shows "Entfernt", a declined one "Abgelehnt"; both offer "Erneut einladen" (`hostInvite`), which is the only way to let them in again (5.4).
- **Mod row** (Fabric 26.3 instances): `ModStatus` `notInstalled` → "Pumpkin Friends-Mod: Teilen direkt im Spiel" + "Mod hinzufügen" (`friendsModInstall` through `useBackgroundTask`, wrapped because it resolves to `void`, 8.4; text "kommt von Modrinth"). `installed` → chip "Mod nicht verbunden". `connected` → chip "Mod verbunden". `unavailable` → no row.

### 10.6 Session chip (F5, `app/TitleBar.tsx`)
- Shown only while a host session or a join is active. "Geteilt · 2 verbunden", or "Bei {name} · Direkt · 38 ms" (fixed width). Click opens a `Popover` with peer, path explanation, RTT, and "Teilen beenden" / "Verlassen".

### 10.7 Window close (F3 + F5)
- `store/friendsUi.ts` (F1) mirrors `friendsEnabled: boolean | null` from the `friendsState` query (null = not loaded yet).
- Pure helper `effectiveOnPlay(mode, friendsEnabled)` in `src/lib/onPlay.ts` (F3): `"close"` becomes `"minimize"` when `friendsEnabled !== false`.
- **Startup source (F3, normative).** The decision never relies on some page having mounted the `friendsState` query:
  - Pure helper in `src/lib/onPlay.ts`: `resolveFriendsEnabled(cached: boolean | null, fetchEnabled: () => Promise<boolean>, timeoutMs: number): Promise<boolean | null>`. It returns `cached` when that is not null. Otherwise it awaits `fetchEnabled()` raced against `timeoutMs`, and returns the fetched value; only a rejection or a timeout gives `null`.
  - `launcherWindow.ts` adds `async function ensureFriendsEnabled()`: it calls `resolveFriendsEnabled(useFriendsUi.getState().friendsEnabled, () => queryClient.fetchQuery({ queryKey: friendKeys.state, queryFn: () => api.friendsState() }).then((s) => s.enabled), 1500)` and writes a fetched value into `friendsUi`.
  - `applyLauncherOnPlay()` becomes async: `const mode = effectiveOnPlay(useSettings.getState().launcherOnPlay, await ensureFriendsEnabled())`. So "close" stays "close" for every user whose backend answers `enabled: false`, and the fallback "treat as enabled" (null) applies only when `friendsState` fails or takes longer than 1.5 s. `restoreLauncherAfterPlay()` uses the same effective mode.
- Settings > Spiel shows the hint "Mit aktivierten Freunden wird der Launcher nur minimiert." `GameTab` reads `useFriendsState` for it, and shows its existing `closeWarning` (no playtime tracking) only while `effectiveOnPlay(mode, friendsEnabled)` is still `"close"`.
- Closing the TitleBar during an active session or join asks first: "Launcher schließen? Das beendet das Teilen bzw. die Verbindung zu {name}." (F5)
- Rust: a cross-platform `RunEvent::Exit` handler calls `friends.shutdown()` (1 s timeout), and keeps the macOS `Opened` branch (R4).

### 10.8 Settings tab "Freunde" (F3, `pages/settings/FriendsTab.tsx`, `SECTIONS` value `freunde`)
- Tab order: konten, spiel, **freunde**, speicher, darstellung, ueber. The value `freunde` is fixed (the Friends page links to `/settings?tab=freunde`).
- `noSecretStore`: only a `StatusPanel` "Auf diesem System gibt es keinen Schlüsselbund (Secret Service); Freunde sind hier nicht verfügbar."
- `identityLost`: only the panel and "Zurücksetzen" (as in 10.2).
- Otherwise:
  - `FormRow` "Freunde" `Switch` (on opens the opt-in, off calls `friendsDisable`). While the feature is off, the tab shows **only** this switch; every row below appears only while it is enabled (rotate and reset need an active identity).
  - "Anzeigename" (3-32, saved on blur).
  - "Immer über Relay verbinden" (hint: "Freunde sehen deine IP-Adressen nicht. Etwas höhere Latenz. Der Relay-Betreiber sieht, wer mit wem verbunden ist, aber keine Inhalte."; with a confirm while a host session **or a join** is active, because the rebind ends both). The current code checks only host sessions (Appendix E, E4).
  - "Mein Fingerabdruck" (pixel-font `Count`) with an action that copies the full 64-char peer id: an abuse report to the relay operator needs it, because the relay keeps no logs and the fingerprint is not enough (`docs/friends/RELAY-OPS.md`; Appendix E, E5). "Blockierte" (list + "Entsperren").
  - Network line "Verbunden über {relayHost}" or "Getrennt: {reason}". Until F4's `useFriendEvents` writes `friends-network` into `friendKeys.state`, the tab subscribes itself (`useLiveNetwork`); F4 removes that.
  - Danger area (kit `danger` variant; the reset row label is the full wording below, its button says "Zurücksetzen"): "Identität erneuern" (`friendsRotateIdentity`, confirm: "Deine Freunde bekommen die neue Identität automatisch, sobald sie online sind (bis zu 14 Tage). Deine offenen Freundescodes werden widerrufen, und Anfragen, die noch auf Bestätigung warten, werden gelöscht. Läuft gerade eine geteilte Welt oder ein Beitritt, wird er beendet.") and "Identität zurücksetzen und alle Freunde löschen" (`friendsReset`, danger confirm).

### 10.9 Opt-in dialog (F3, `FriendsOptInDialog`)
`FriendsOptInDialog({ onClose })` is mounted only while open (like `NameDialog`): callers render `{open && <FriendsOptInDialog onClose={…} />}`. Relay operators are named "Pumpkin Launcher" and "n0" (`RELAY_OPERATOR_KEYS`, exported from `PrivacyNotice.tsx` and reused here).

Text (plain, final wording reviewed by the owner):
- Freunde nur über Codes, die ihr selbst austauscht. Wer deinen Code hat, kann dir eine Anfrage schicken; deine IP-Adresse sieht er dadurch nicht.
- Verschlüsselte Verbindungen zwischen den Launchern. Bei einer direkten Verbindung sehen deine Freunde deine öffentliche IP-Adresse und die Adressen deiner Netzwerke (Heimnetz, VPN). Auch wer deinen Code einlöst oder dessen Code du einlöst, kann deine Adressen sehen, solange „Immer über Relay“ aus ist. „Immer über Relay“ verhindert das.
- Relay-Server: {hosts with operator}. Sie leiten verschlüsselte Daten weiter und sehen, wer mit wem verbunden ist, aber keine Inhalte.
- Freunde sehen, ob du online bist oder spielst, und deinen Minecraft-Namen samt Skin (von dir selbst angegeben).
- Kein Chat, kein Tracking, keine öffentlichen Listen. Jederzeit abschaltbar.

Inputs:
- Display name.
- "Immer über Relay" (off).
- If `relays` has a third-party relay: a required checkbox "Ich bin einverstanden, dass {operator} ({hosts}) als Relay genutzt wird".
- "Verstanden" (required).

Primary button: "Freunde aktivieren" (`friendsEnable`). A note says that Windows may ask for firewall permission (UDP), and that allowing it in private networks improves direct connections.

`components/PrivacyNotice.tsx` lists every relay host with its operator and purpose, "Freunde: verschlüsselte Weiterleitung, keine Inhalte", and Mojang's sessionserver for friends' skins (fetched by the launcher, not the page).

### 10.10 Mock (F1, `src/lib/mock-friends.ts`)
- Scenarios:
  - `?mock=freunde`: 5 friends, 1 incoming + 2 delivering requests (one 8 days old, so the expired-code hint shows), 1 invite, a running host session (one guest connected, one kicked, one declined), 1 notice. `friendsRetryNow` delivers the younger delivering request after 1 s (it becomes `awaitingAnswer`).
  - `?mock=freunde-leer`.
  - `?mock=freunde-verloren` (identityLost).
  - `?mock=freunde-keyring` (noSecretStore).
  - Default: disabled.
- `globalThis.pumpkinMock` hooks: `invite(name)`, `friendOnline(name)`, `friendOffline(name)`, `request(name)`, `lanOpened(port)`, `guestJoined(name)`, `hostGone()`, `network("online"|"degraded")`, `modConfirm()`, `notice(name, "renamed"|"identityChanged")`, `cycle()` (toggles presence and RTT for all rows 5 times), `layoutShift()` (returns the summed `layout-shift` entries since the last call, via `PerformanceObserver`).
- `invitePlan` returns one plan per verdict. `inviteJoin` returns a ticket, and the mock launch then emits `join-session` waitingForGame → connected.
- Implemented specifics (F1): the host instance of the demo is `inst-survival`, and the `pumpkinMock` hooks target it. Invites from `pumpkinMock.invite(name)` cycle through the plans ready, missing, vanilla, unsupported and lookupFailed; the vanilla scenario turns `ready` once the user has created a vanilla instance for the same MC version through `createInstance`. Like the real backend, a presence change emits only `friend-presence`. The mock has no third-party relay, so the opt-in's consent checkbox is not visible in the stock scenarios. Mock MS login finishes after 6 s and opens `window.open`; the mock DB and the account selection reset on every reload.

---

## 11. The mod (`mod/`)

### 11.1 Target and toolchain
| Item | Value |
|---|---|
| Minecraft | 26.3 only (`"minecraft": "~26.3"`) |
| Loader | Fabric Loader 0.19.5, Fabric API 0.161.0+26.3 (required dependency) |
| Build | Loom `net.fabricmc.fabric-loom` 1.18.2 (no remap), Gradle wrapper 9.7.1 (files from FabricMC/fabric-example-mod, CC0), `options.release = 25`, `"java": ">=25"` |
| JDK | Always a full Temurin 25 JDK, downloaded by `mod/scripts/dev-env.ps1` / `dev-env.sh` from the Adoptium API into `mod/.jdk/` (gitignored). The SHA-256 is verified against the API's checksum. No admin rights. Mojang's runtimes are never used. |
| Environment | client only |

`./gradlew build` and `./gradlew genSources` are run as separate invocations.

### 11.2 Layout
```
mod/ build.gradle settings.gradle gradle.properties gradlew gradlew.bat gradle/wrapper/*
     scripts/dev-env.ps1 scripts/dev-env.sh scripts/FakeLauncher.java  README.md (build + owner GUI checklist of 13.3.2)
     src/client/java/dev/laux/pumpkin/friends/
       FriendsClient.java                      ClientModInitializer: env present -> bridge, else nothing
       bridge/ BridgeEnv BridgeClient Protocol (Gson, 16 KiB cap) Messages Backoff      <- Minecraft-free
       state/  Snapshot StateStore Sanitize (strip §, controls, caps)                 <- Minecraft-free
       mc/     PauseMenuButton FriendsScreen LanWatcher LanControl Toasts
     src/client/resources/fabric.mod.json, assets/pumpkin_friends/{icon.png, lang/{en_us,de_de}.json}
     src/test/java/dev/laux/pumpkin/friends/{ProtocolTest,BackoffTest,StateStoreTest,SanitizeTest,BridgeHarnessTest,ScriptedLauncher}.java
     .gitattributes (*.bat crlf, *.jar binary; the repo forces eol=lf)   .gitignore (run/ from runClient)
```
- Mod id `pumpkin_friends`, name "Pumpkin Friends", version `0.1.0`; the build output is `mod/build/libs/pumpkin_friends-0.1.0.jar`. The description contains "NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT." The icon `icon.png` is a copy of `src-tauri/icons/128x128.png`.
- Start-up seam: `BridgeClient.startIfLaunched(env, versions, listener, timing)` returns `Optional<BridgeClient>` and starts the thread only for a valid env (7.5); `FriendsClient` uses it. All timings are injectable through `BridgeClient.Timing`.
- Lang keys beyond the features below: `publish_failed`, `no_friends`, `someone`, `section.*`, and the `row` / `invite_row` formats.

### 11.3 Features
1. **Pause-menu button** "Pumpkin Friends" (`ScreenEvents.AFTER_INIT`, `PauseScreen`, added idempotently, placed relative to existing widgets). Only while the bridge is connected. Opens `FriendsScreen`.
2. **FriendsScreen:**
   - (a) A friends list with presence, from the snapshot.
   - (b) In singleplayer and not published: "Für Freunde öffnen", which calls `publishServer(MultiplayerScope.LAN, false, HttpUtil.getAvailablePort())` on the client thread (the 26.3 three-argument overload; `false` = no commands for guests).
   - (c) Published: checkboxes for the online friends who are not already guests, and "Einladen" (`share`), enabled for 1 to 7 selected friends. The launcher stays authoritative on the guest limit.
   - (d) Sharing: the guest list with "Entfernen" (`kick`), and "Teilen beenden" (`stopSharing`, then `unpublishServer()`).
   - (e) Received invites, read-only, with the text line "Im Launcher beitreten" under the list (a text, not a button: there is no in-game join).
   - (f) "Bestätige im Launcher" after `notify{confirmInLauncher}` (which also shows a toast). The hint stays until the next `error` message or a snapshot whose session differs from the current one.
3. **LAN watcher:** polls `isPublished()`/`getPort()` at `END_CLIENT_TICK` and sends `lanOpened`/`lanClosed` on change. This also covers vanilla World Options.
4. **Toasts:** `FriendToast` with `ResolvableProfile.createUnresolved(uuid)` when `mcUuid` is set, otherwise `SystemToast`. Text from the lang keys per `notify.event` and `error.code`. Names are inserted as literal text after `Sanitize`.
5. **Degradation:** no env means only an inert initializer. Disconnected means the button is hidden and the screen shows "Launcher nicht verbunden".

No keybinding and no in-game join.

### 11.4 Threading
- A daemon reader (blocking socket, connect timeout 2 s, read timeout 30 s) and a writer on a `LinkedBlockingQueue(64)`. The writer sends a `ping` itself when the queue has been empty for one ping interval (10 s), so pings never sit in the queue. When the queue is full, the new message is dropped and a warning is logged. Messages queued before the launcher's `welcome` are dropped, and the queue is cleared at the start of each connection, so nothing stale goes out before `hello`.
- Inbound messages go to a `ConcurrentLinkedQueue`, which is drained at `END_CLIENT_TICK` into an immutable `Snapshot` (volatile). `pong` is handled inside `BridgeClient` as a liveness signal and does not enter that queue.
- All Minecraft calls run on the client thread.

### 11.5 Distribution and supply chain
- The owner creates the Modrinth project. Its **project id** is pinned as `MOD_PROJECT_ID` in `services/friends/modinstall.rs`. Until it is set (empty string), `ModState::Unavailable`, and the dev jar (`mod/build/libs/pumpkin_friends-0.1.0.jar`) is added by hand.
- `friends_mod_install`: list the pinned project's versions for `26.3` + `fabric`. Take the newest `listed` release whose `project_id` equals the constant, pick the file whose sha512 the API reports, and install it through the existing catalog mod-install path (`Fetch::Modrinth` verification). The target file name is a sanitised leaf `[A-Za-z0-9._+-]+\.jar`.
- Releases: the manual-dispatch workflow `mod-release.yml` with the Minotaur plugin. It runs in a GitHub **environment** `modrinth-release` with the owner as required reviewer, using the `MODRINTH_TOKEN` environment secret. The owner enables 2FA on the Modrinth account. Nothing publishes automatically.

---

## 12. Privacy and security

### 12.1 Privacy (normative wording basis for UI and docs)
- Off by default. Before `friends_enable`, nothing binds UDP, listens, or contacts a relay or Mojang for friends.
- No address publishing. Relays see the ids and IPs of connected endpoints and who talks to whom, never content.
- **IP exposure, stated honestly:**
  - On a direct path, both sides learn each other's public IP and local interface addresses (LAN, VPN, Docker).
  - Code holders cannot learn the inviter's addresses, because hello endpoints are relay-only.
  - The invitee's main endpoint may reveal its addresses to the code owner unless "always relay" is on.
  - Anyone who ever knew your permanent id (current or former friends) can tell whether you are online.
  - "Always relay" hides your addresses from all peers.
- **LAN port:** opening a world to LAN binds the game's port on all interfaces, as in vanilla. The tunnel does not change that. Devices in the local network (and anything the router forwards) can reach it, with Mojang authentication as the only protection. Windows Firewall profiles apply. Stated in the ShareDialog and in `docs/friends/PRIVACY.md`.
- Presence goes only to confirmed friends. Hosting is visible only to invited friends. The manifest goes only to invited friends, and the share dialog says so.
- Friends' skins are fetched by Rust from Mojang's sessionserver (the UUID is sent to Mojang) and cached locally. Named in the PrivacyNotice.
- Logs never contain IPs, secrets, codes, tokens or hello ids. Peer ids are logged as their first 8 hex chars.

### 12.2 Security rules
- **Invite-only transport:** the Gate (3.5). Silent drops for strangers on hello endpoints. `NOT_FRIEND` on peer/1.
- **Least reach:** the host bridges only to a verified port owned by the game PID that answers a status ping (6.1), after validating the Minecraft handshake and login start. The guest listener is single-owner (6.2).
- **Online mode:**
  - Hosting needs a Microsoft-account launch (`Spawned.online_account`).
  - Joining needs a Microsoft account (`instance_launch` refuses `friendJoin` without `account_id`). Unit-tested.
  - The game itself rejects offline guests at login: the host's integrated server authenticates every login, and the tunnel forwards bytes unchanged to that port. Verified by the owner in E8b (13.4).
- **Minimum version 1.20** for hosting and joining.
- **No file transfer between peers.** No downloads on behalf of a manifest in v1. `servers.dat` and `options.txt` are never touched. The only download in the friends feature is our own mod (pinned project id) and friends' skin PNGs (sessionserver → `textures.minecraft.net` only, at most 64 KiB, PNG signature checked).
- **Untrusted input:** every frame and IPC line is size-limited before parsing. Ids and hashes are format-checked. Peer strings are sanitised (12.3). Unknown fields are ignored. A malformed peer frame resets the stream with `PROTOCOL`, and on the hello and control streams the connection is closed with `PROTOCOL` (5.1). A malformed mod IPC line after `hello` is ignored (debug log) but counts toward the 20 messages/s limit, whose excess closes the connection (7.1).
- **Dependency hygiene:** `cargo deny check advisories` is green on the final tree (R0a). `deny.toml` ignores two compile-time-only advisories with a reason each: RUSTSEC-2024-0370 (proc-macro-error via gtk3-macros, existing) and RUSTSEC-2024-0436 (paste, unmaintained, via iroh → netwatch → netdev → netlink-packet-core, Linux only). The new crypto crates (ed25519-dalek 3, curve25519-dalek 5, noq) are listed with their audit status in `DEPENDENCIES.md`.

### 12.3 Peer-string sanitisation (`friends/sanitize.rs`; same rules in the mod's `Sanitize`)
1. Unicode NFC (`unicode-normalization`).
2. Remove: `char::is_control` (Cc), U+00A7 `§`, U+00AD, U+061C, U+180E, U+200B-U+200F, U+2028-U+202E, U+2060-U+2064, U+2066-U+206F, U+FEFF, U+FFF9-U+FFFB, U+E0001, U+E0020-U+E007F.
3. Collapse whitespace runs to one space, and trim.
4. Cap by chars:

   | Field | Max | Empty |
   |---|---|---|
   | displayName | 32 | `"#" + first 8 hex of peer id` |
   | worldName, instance name | 64 | — |
   | fileName | 128 | — |
   | alias | 32 | — |

5. `mcName` must match `^[A-Za-z0-9_]{1,16}$`, else null. `mcUuid` must be 32 lowercase hex, else null.

Launcher side (`friends/sanitize.rs`): `display_name(raw, peer_id)` (with the `#` fallback), `own_display_name(raw)` (no cut; outside 3-32 chars → `errors.friends.displayNameInvalid`), `world_or_instance_name`, `file_name`, `alias(raw) -> Option<String>`, `mc_name`, `mc_uuid`. A cut never leaves trailing whitespace.

Mod side (`state/Sanitize`): the same steps; Cc controls (tab and newline included) go in step 2, before whitespace is collapsed. The cap is not followed by a second trim, and an empty name stays empty (the mod never sees peer ids, so it cannot build the `#` fallback). Both are harmless because the launcher has already sanitised and capped every name it sends.

### 12.4 Rate limits and caps (all in memory, sliding windows)
| What | Limit | On excess |
|---|---|---|
| Hello: requests per remote id | 3 per 10 min per code | silent drop |
| Hello: requests per code | 10 per hour | silent drop |
| Handshakes in flight per endpoint | 8 | `ignore()` |
| Pending incoming requests | 20 | `error{full}` |
| Active codes | 3 | `tooManyCodes` |
| Friends (incl. unconfirmed and outgoing) | 50 | `friendLimit` |
| Concurrent dials | 4 | queued |
| Control frames | 50 per 10 s per connection | close `RATE_LIMITED` |
| Request streams | 5 per friend per minute | `error{rateLimited}` |
| QUIC streams | 16 bidi, 0 uni per connection | transport limit |
| Invites received | 10 per friend per hour, 20 open in total | dropped |
| Tunnel | 7 guests, 4 concurrent + 20 new streams per guest per minute | `guestLimit` / `rateLimited` |
| Guest listener | 1 unvalidated connection before the first valid one, 4 after | close |
| Mod bridge | 4 unauthenticated connections, 20 msg/s, 3 `share` per minute after confirmation | close / `error` |

### 12.5 Relay operation (requirements; D1 documents and deploys them)
- `iroh-relay` at the same iroh version as the launcher (lockstep updates; today 1.3.0). The image is built from the pinned crate (`cargo install iroh-relay --version =1.3.0 --locked --features server` in `rust:1.91-bookworm`, the crate's MSRV) and runs on `debian:bookworm-slim` as a non-root user; no third-party relay image is used, because its origin could not be verified. When iroh is bumped, `IROH_RELAY_VERSION` and the image tag change together (`RELAY-OPS.md` section 9).
- Ports: TCP 443 (HTTPS relay and ACME: iroh-relay 1.3.0 uses the TLS-ALPN-01 challenge on 443), **UDP 7842** (QUIC address discovery, `enable_quic_addr_discovery = true`, TLS). TCP 80 only serves `/generate_204`; it stays published but is optional. The config binds IPv4 only (`0.0.0.0`), so only an A record is advised until `[::]` on Docker's bridge is verified.
- Limits: per-client receive bandwidth `limits.client.rx` (token bucket with back pressure; first values 4 MiB/s, 8 MiB burst). iroh-relay's `accept_conn_limit`/`accept_conn_burst` have no effect in 1.3.0, so a connections-per-IP limit has to come from the host or provider (owner task, `RELAY-OPS.md`). It is an open relay, because launchers cannot be authenticated. Only ciphertext passes, with no amplification.
- Logging (GDPR): no access logs. iroh-relay cannot truncate IPs and puts the peer address into every warning or error logged inside a connection span, so the standing deployment stores **no relay output at all** (logging driver `none`, `RUST_LOG=error`). A temporary debug override (`docker-compose.debug.yml`) keeps one 1 MiB log with IPs, deleted within 24 h by recreating the container. Metrics are bound to `127.0.0.1:9090`; the container health check uses them. `/healthz` cannot be bound separately: it is a handler on the public HTTPS port and returns only status, version and git hash.
- In memory only, the relay keeps the set of endpoint ids seen since 00:00 UTC (for its unique-clients metric): no IPs, lost on restart. `PRIVACY.md` 3.4 and `RELAY-OPS.md` section 11 state it.
- The legal basis and info text are in `docs/friends/PRIVACY.md` (relay section), with an abuse contact address. Blocking an abusive endpoint uses `access.denylist` in `relay.toml` (`RELAY-OPS.md` section 13); the report needs the full 64-char peer id (10.8).
- The domain is auto-renewed, and a second domain is registered as a fallback. Adding it to `RELAY_MAP` needs a launcher update.

---

## 13. Testing and definition of done

### 13.1 Rust
CI facts (`.github/workflows/ci.yml`): `cargo check` and `cargo test --locked` run on Windows, Ubuntu 22.04 and macOS. `cargo clippy --all-targets` runs on Linux only and reports warnings without failing. `cargo deny check advisories` runs once on Ubuntu. Every package keeps all of these green, and adds **zero** clippy warnings in its files (checked locally with `cargo clippy --all-targets`).

**Time rule (normative):** tests with real sockets run on real time. `tokio::time::pause` is used only in tests without sockets (the fake `Dialer`, timer state machines). No test combines both. Real-socket tests of long timers inject small durations (`JoinTimers`, 8.7) instead of pausing time.

| Package | Required tests |
|---|---|
| R0b | (spike crate) two in-process endpoints, relays disabled, loopback: echo; tunnel to a local `TcpListener`; `after_handshake` reject with code; `ignore()` of an `Incoming`. A `relay_only` endpoint **without** relays fails to bind ("no valid address available"), which is asserted; "a `relay_only` endpoint has no direct addresses" is tested with iroh's in-process relay instead (the setup R1 uses). |
| R1 | Loopback peers (they dial through the in-process relay with loopback-bound sockets, 3.3/3.7; the path then usually upgrades to `Direct`): echo through `bridge` + `LocalListener`. 1-byte ping-pong x1000 through the tunnel: p99 <= 20 ms on CI (recorded local value on Windows, path Direct: p50 0.97 ms, p99 1.47 ms; target <= 5 ms). `TCP_NODELAY` set on both sockets (asserted with `nodelay()`). Gate reject/accept/drop. Frame over limit closes with `PROTOCOL`, without allocating. Dial timeout 8 s (fake dialer). Duplicate tie-break. `SHUTDOWN` on close. QUIC stream limit 16 enforced. Unknown relay index never dialed. **Relay-only binding:** an endpoint bound with `relay_only: true` and `RelaySelection::Only(0)` (the configuration R4 uses for hello endpoints in production, 3.7) reports no direct (IP) addresses (checked through the iroh call named in IROH-NOTES), and a loopback peer dialing its id without any relay URL fails within 8 s; the same endpoint is reachable through an in-process relay (3.7), and the established path is `Relay`, never `Direct`. A `NetConfig` built from `RELAY_MAP` binds (map entries are accepted as given). |
| R2 | Code golden vectors (Appendix B), round trip, normalisation, checksum, version, own-code. Hello-key derivation vector. Sign/verify. Contract fixture test (8.3). `SecretStore` keyring + fake; availability matrix (noSecretStore, identityLost, available). Records keep unreadable entries. Sanitisation table (bidi, zero-width, `§`, NFC, caps, empty name). Config defaults all off. Auth refresh-token tests stay green. |
| R3 | `LanDetector` table (6.4). `sockowner` on the current OS: a test `TcpListener` is reported as owned by `std::process::id()`, and a connection from this process is found by `connects_from`. `verify_port` against a fake status server (ok / not owned / no answer). Modbridge: wrong token, protocol negotiation, duplicate, oversize line, no hello within 2 s, 5th unauthenticated connection refused, rate limit, message → `GameSignal` mapping. `launch_env` empty when stopped or non-Fabric. `spawn` env test with a tiny child printing its env. `friend_join`: no `last_quick_play` write, refusal without `account_id`, bad address refused. `FriendJoin` JSON shape and `LaunchOptions` without the field (8.6). With `friend_join`, a refused or failing launch sends `LaunchFailed` before the error returns; progress sends `LaunchProgress` at most once per second; without `friend_join`, neither is sent. `shared_types` JSON strings (R0a test stays green). `examples/launch.rs` compiles. |
| R4 | Two `Friends` services with temp dirs, built with `NetOptions` pointing at one in-process relay and `hello_relay_only = true` (3.7): code → hello **through the relay** → request → accept → both friends (inviter online, and inviter offline at redemption: the inviter service starts later, then `friends_retry_now` on the invitee delivers within 5 s); `hello_net_config(NetOptions::production(), ..)` gives `relay_only = true` and `Only(code.relay_index)`; decline is silent; cancel → `removedByPeer`; block looks like removal; unfriend; rotate (friend learns the new id, a thief with the old key is rejected afterwards; **after rotate `friend_codes` is empty, pending incoming and `awaitingAnswer` requests are gone, and redeeming a code created before the rotation gets no frame and stays `delivering`**); reset outbox delivers `unfriend`; `friends_retry_now` (fake dialer, paused time): a `delivering` request in the 10-min backoff step is dialed at once, a second call within 10 s does not dial again; **extension seam:** a fake `PeerStreamHandler` receives request streams, tunnel streams (with `sessionId`) and `invite`/`inviteRevoke`/`inviteDecline`; without a handler the defaults of 5.3 apply; a second `register_stream_handler` fails; a fake lifecycle subscriber gets `Disabled` on `friends_disable`, `Rebind` on an `alwaysRelay` change, `IdentityChanged` on rotate and reset, `Shutdown` on `shutdown()`, each before the endpoint closes (subscriber holds `done` for 200 ms, the remote sees `SHUTDOWN` only afterwards), and a subscriber that never answers delays the close by at most 500 ms; identityLost refuses commands; incoming TTL prune; hello silent drop for a wrong secret (no frame received; the close arrives as `CloseReason::Peer(NORMAL)`, 3.5); hello rate limits; foreign `homeRelay` index ignored; presence online/offline/crash (short idle timeout, through the seam of Appendix E, E1); lazy-dial schedule (fake clock); 50-friend cap; load test with 50 fake friends, startup dial batch finishes within 4 x 8 s rounds. |
| R5 | Real loopback tunnel to a fake LAN server (a status-answering `TcpListener` owned by the test process): host verification, handshake/login-start validation (legacy ping, transfer state, bad name, oversize rejected), guest nonce + PID check (a foreign handshake address is refused, no stream opened), single-owner limits, 7-guest cap, kick, stop, liveness end, every row of 6.5 (with real `Friends` services from R4 and an in-process relay). **Kick and decline at admission:** after a kick, the kicked guest's launcher ignores `inviteRevoke` and opens a new tunnel stream and a `manifestRequest`: both get `notInvited`, and the guest is `left` with `kicked: true`; after `host_invite` for the same friend, a tunnel stream gets `tunnelOk` again; the same for a guest that sent `inviteDecline` (`declined`). A guest that left on its own can rejoin while its invite is open. **Join timers on real time** with `JoinTimers { spawn_wait: 2 s, spawn_wait_cap: 6 s, first_connection: 3 s }`: no spawn and no progress → the join ends `error` after about 2 s; `LaunchProgress` every 1 s keeps it in `waitingForGame` past 2 s, and it still ends `error` at the 6 s cap; after `Spawned`, a first valid connection at 2 s succeeds, and in a second join no connection by 3 s ends it `error` (a connection at 4 s is refused because the listener is closed); `LaunchFailed` ends the join `error` within 100 ms and the listener address refuses connections. The timer state machine is also tested without sockets on paused time with production values (9 min first connection succeeds, 11 min fails; progress for 25 min keeps the join, 31 min ends it). `Lifecycle` handling: `Disabled`, `Rebind`, `IdentityChanged`, `Shutdown` end host session and join with the reasons of 6.1/6.2, and the `inviteRevoke{stopped}` reaches the guest before `done`. Mod `share` needs confirmation once per launch; denied/timeout. |
| R6 | Manifest build (excludes disabled mods and non-`Mod` kinds; a jar declaring mod id `pumpkin_friends` stays in), matching ignores our mod only via `MOD_PROJECT_ID`, validation table, sha512 hashing and cache. The matching table (5.6) with a fake `ModLookup`. Lookup failure → `lookupFailed`. Avatar: host check (only `textures.minecraft.net`), size cap, PNG signature, cache TTL. Mod install: wrong `project_id` refused, non-listed refused. |

### 13.2 Frontend
- `pnpm build` (tsc strict = types, i18n completeness, fixtures) and `pnpm check:lib`, including the new `friendCode.check.mjs` (golden vectors, shape, grouping, normalisation), `onPlay.check.mjs` and `src/pages/friends/friendsModel.check.mjs` (F2: gates, badge count, labels, `canInvite`, expired-code hint).
- `onPlay.check.mjs` (F3) covers: `effectiveOnPlay` for null/true/false × the three modes (null and true turn "close" into "minimize"; false keeps "close"); `resolveFriendsEnabled` returns the cached value without calling the fetch, returns `false` from a fetch that resolves `false` (so "close" stays "close"), and returns `null` for a fetch that rejects and for one that does not settle within the timeout (fake fetch, timeout 50 ms).
- Mock pass in `pnpm dev`: every scenario and hook, German and English, a narrow window (900 px), forced colors.
- **Layout shift:** on `/friends?mock=freunde` and with the session chip visible, `pumpkinMock.cycle()` and then `pumpkinMock.layoutShift()` must return **< 0.001**. Run it in the browser (devtools or Playwright MCP) and paste the result into the PR.

### 13.3 Mod

#### 13.3.1 Agent-verifiable (M1 acceptance; also run by the D2 CI job)
- `./gradlew build` compiles every class, including `mc/`, against the 26.3 mappings and the pinned Fabric API; this is the signature check for `publishServer`, `unpublishServer`, `isPublished`, `getPort`, `FriendToast`, `ResolvableProfile.createUnresolved`, `ScreenEvents.AFTER_INIT` and `END_CLIENT_TICK`.
- `./gradlew test`: JUnit for `Protocol`, `Backoff`, `StateStore` and `Sanitize`.
- **Scripted protocol harness** `BridgeHarnessTest` (JUnit, no Minecraft classes): `ScriptedLauncher` listens on a loopback port and plays the launcher side of section 7 from a script, while the real `BridgeEnv`, `BridgeClient` and `StateStore` connect to it with env values passed in. Asserted cases:
  1. No env: `BridgeEnv` reports absent, and no thread is started.
  2. Handshake: `hello` with the token and `protocols: [1]`, then `welcome` and a `snapshot`, which `StateStore` exposes (names stripped of `§`, lengths capped).
  3. `reject{token}`, `reject{protocol}` and `reject{duplicate}`: the client closes and keeps retrying on the normal backoff (1, 2, 5, 10, 30 s), never faster; it does not stop for good. Only a `welcome` resets the backoff.
  4. A line over 16 KiB from the launcher closes the connection; a malformed line is ignored without an exception.
  5. `notify` and `error` messages reach the state queue; the mod's `ping` is answered by the launcher's `pong` (ping goes mod → launcher only, 7.3), which `BridgeClient` consumes as a liveness signal.
  6. Outgoing `share`, `stopSharing`, `kick`, `lanOpened`, `lanClosed` have the exact JSON of 7.3.
  7. The launcher closes mid-session: the client goes to "disconnected" and reconnects after the backoff 1, 2, 5 s (shortened by an injected clock).
- No GUI check is part of M1. A `./gradlew runClient` smoke run is optional and not required of the agent.

#### 13.3.2 Owner-verified GUI checklist (in `mod/README.md`; run by the owner in I1 as part of E10, results in VERIFICATION.md)
Against `FakeLauncher.java` first, then the real launcher:
  1. Without env: no button, no crash, one log line.
  2. The button appears only while connected.
  3. Publish from the mod: the launcher shows the verified port (source `mod`).
  4. Publish from vanilla World Options: same.
  5. First invite from the mod: "Bestätige im Launcher", and after allowing it the friend gets a toast with a head.
  6. Kick and stop: the friend is disconnected and gets a toast.
  7. Kill the launcher mid-session: the UI hides, the game runs on without exceptions.
  8. Resize with the pause menu open: no duplicate button.
  9. German and English.
  10. A name containing `§c` and bidi characters is shown without formatting.

### 13.4 Owner end-to-end table (two PCs, different networks, two Microsoft accounts; results in VERIFICATION.md)
| # | Case | Pass criterion |
|---|---|---|
| E1 | Code exchange, inviter **offline** at redemption (at least 5 min), then starts its launcher; once the inviter is online, the invitee presses "Jetzt zustellen" | The inviter has the incoming request within 30 s after the press. After the inviter accepts, both sides show the friend within 30 s. (Unattended delivery follows the 4.3 backoff and is not timed here.) |
| E2 | Presence | Online within 10 s of start. Offline within 3 s of a normal exit, within 45 s of killing the process |
| E3 | Vanilla 26.3 host, guest joins via launcher (direct path) | In world, path "Direkt", RTT shown |
| E4 | Same with "always relay" on the guest | Path "Relay". `netstat` on the host shows no connection from the guest's IP |
| E5 | Fabric 26.3 host with the fixture set `fabric-api, lithium, ferrite-core, sodium (client-only), modmenu (client-only)`; guest instance without sodium and modmenu | Plan `ready`, join works |
| E6 | Guest missing `lithium` | Plan `missingContent` with missing = Lithium |
| E7 | Vanilla host, guest without the instance | "Vanilla-Instanz anlegen" → join works |
| E8a | Offline account on the guest | Join refused in the UI before launch |
| E8b | While the host shares a vanilla 26.3 world, a Minecraft 26.3 client with an **offline account** uses Direct Connect to the host's verified LAN port (from a second device in the host's network to `<host LAN IP>:<port>`, or on the host PC to `127.0.0.1:<port>`) | The vanilla login fails; the exact message is recorded (expected "Failed to verify username!", or the client-side "Invalid session"). The player never enters the world. |
| E9 | Every row of 6.5 that needs two PCs | Events as specified |
| E10 | Mod: share from the pause menu with launcher confirmation, toasts, kick, stop; the owner GUI checklist 13.3.2 | Every item of 13.3.2 passes |
| E11 | Host quits to the title screen | Session ends `lanClosed` within 2 s (log) or 30 s (liveness) |
| E12 | Windows Firewall prompt on first enable | Behaviour recorded, both choices still connect (relay at worst) |
| E13 | Child account with multiplayer blocked (if available) | Clear vanilla message recorded |

If a fixture mod has no 26.3 release, substitute another Modrinth mod with the same side classification, and record it.

### 13.5 Definition of done (v1)
1. All work packages accepted against their acceptance criteria.
2. CI green as described in 13.1, plus `pnpm build`, `pnpm check:lib`, and the `mod` job.
3. Release gates G1-G5 (1.3) met.
4. Every user-visible error is translated (de + en). The opt-in text and the PrivacyNotice are reviewed by the owner.
5. **Doc-sync checklist** (I1): for each of sections 3-9, 11 and Appendix A, the owning package lead confirms "matches code" in VERIFICATION.md. Deviations are written back into SPEC.md first.

---

## 14. Work packages

**Ownership rules.**
- Files listed under a package are exclusive to it while it runs. The only exceptions are the seams that a later package's row names explicitly (R5: the `state.rs` field and the `lib.rs` wiring at R4's marker, 8.7). Files of finished packages (Waves 0 and 1) pass to a later package only where that package's row lists them (R4: `p2p/endpoint.rs` and `p2p/tests.rs` for Appendix E, E1/E2; F4: the F2 and F3 files named in its row).
- **Stubs:** R0a creates every new Rust module file as a stub (overview doc comment only). Ownership then passes to the package named in R0a's list. `services/shared_types.rs` is not a stub: R0a writes it complete (8.1), and changes to it later go through the change rule.
- **Cross-package seams are defined in R4** (`PeerStreamHandler`, `Lifecycle`, `NetOptions`, 3.7/8.7). R4 is accepted with fake handlers and subscribers; R5 only registers against them.
- **Append-only shared files** (any package may append; the orchestrator merges both sides):

  | File | What may be appended |
  |---|---|
  | `src-tauri/Cargo.toml` | `[dependencies]` lines and feature lists (state the reason in the PR). The file may have CRLF line endings in a working copy (autocrlf); keep them. After adding a dependency, regenerate `Cargo.lock` (`cargo metadata --offline`) before `--locked` works. |
  | `src-tauri/Cargo.lock` | regenerated |
  | `src/i18n/{de,en}/errors.friends.ts` | new keys, always in both languages |
  | `src-tauri/src/services/friends/mod.rs` | `mod`/`pub mod` lines |
  | `src-tauri/src/lib.rs` | `generate_handler!` entries (only R4 makes structural changes; R5 also fills the wiring marker, 8.7) |
  | `package.json` | `check:lib` chain |
  | `docs/friends/SPEC.md` | Edit only the sections your package implements (as named in its acceptance), per the change rule. The orchestrator merges parallel edits; a conflict between two packages' edits is resolved by the orchestrator against this spec, never by one package rewriting another's section. |

- A later package appends to `state.rs` only where its row says so (strictly sequential via `dependsOn`).
- Every package keeps the repo green, follows the clean-code skill, and adds the tests listed in 13.1/13.2.

### Wave 0
**R0a, rust-net: skeleton, dependencies, error keys, spec in repo**
- Files:
  - `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`:
    - `iroh = "1.3"`, `data-encoding = "2"`, `unicode-normalization = "0.1"`.
    - windows-sys features `Win32_NetworkManagement_IpHelper` and `Win32_Networking_WinSock`.
    - The cargo feature `beta-relays` (in a new `[features]` section).
    - `[dev-dependencies]`: `iroh = { version = "1.3", features = ["test-utils"] }` (in-process relay for tests, 3.7).
  - `deny.toml` (ignore entry for RUSTSEC-2024-0436 with its reason, 12.2; needed for the `cargo deny` acceptance).
  - `src-tauri/src/services/mod.rs`.
  - `src-tauri/src/services/shared_types.rs` (complete, not a stub: `PathKind`, `PortSource`, `ModLoader` re-export, with its JSON test; 8.1).
  - Stubs:
    - `services/p2p/mod.rs` (→ R1).
    - `services/friends/mod.rs` and `services/secrets.rs` (→ R2).
    - `services/modbridge/mod.rs`, `services/lan_detect.rs`, `services/sockowner/mod.rs`, `services/gamesignal.rs` (→ R3).
  - `src-tauri/src/error/text.rs` (`GERMAN_SOURCES` 6 → 7).
  - `src/i18n/{de,en}/errors.friends.ts` (all Appendix A keys), `src/i18n/{de,en}/errors.ts`.
  - `docs/friends/SPEC.md` (this file), `docs/friends/DEPENDENCIES.md`.
- Acceptance: CI green on all three OSes (check, test, Linux clippy without new warnings, cargo deny advisories with iroh in the tree); `pnpm check:lib` (`errors.check.mjs`) green; no behaviour change; the `shared_types` JSON test passes; the `test-utils` dev-dependency does not enter the release dependency tree (`cargo tree -e normal -i iroh -f "{p} {f}"` lists no `test-utils`); release binary size delta and crypto-crate audit notes in DEPENDENCIES.md. **Done (Wave 0).**

**R0b, rust-net: viability spike CLI (agent part), owner run (gate G1)**
- Files: `tools/p2p-spike/**` (its own `Cargo.toml` + `Cargo.lock`, same iroh version, not in CI), `docs/friends/IROH-NOTES.md`, `docs/friends/VERIFICATION.md` (template).
- CLI:
  - `id`.
  - `listen [--relay URL] [--relay-only] [--forward 127.0.0.1:PORT]`.
  - `dial <id> [--relay URL] [--relay-only] [--echo 1000] [--throughput 50] [--local 127.0.0.1:PORT]`.
  - Prints path changes, RTT, the relay-observed public address (QUIC address discovery), echo p50/p99 and throughput. `--forward`/`--local` tunnel a real Minecraft LAN world.
- Acceptance: `cargo build --release` and `cargo test` pass on Windows; the loopback tests of 13.1 (R0b row) pass; IROH-NOTES documents the exact 1.3 calls for every iroh item named in 3.2-3.7 and 8.7, including multi-relay dial, the RelayMap QUIC config, how to read an endpoint's direct addresses, and the in-process test relay with its certificate-skip setting (3.7), the last one shown working in a spike test; README runbook lets the owner run G1 without help; VERIFICATION.md has the G1 table and the 13.4 table ready to fill. **The owner then runs it on two networks** (not agent work; it blocks only the release). **Agent part done (Wave 0); the owner run (G1) is open.** Without `--relay`, the spike uses n0's production relays (`iroh::defaults::prod`), so n0 sees both IPs during the run (stated in the README); the listener keeps a persistent id in `spike-key.txt`, the dialer uses a throwaway key. Owner: `cargo build --release` in `tools/p2p-spike`, copy `target/release/p2p-spike.exe` to both PCs, follow `tools/p2p-spike/README.md`.

**F1, frontend: contract, fixtures, mock, hooks, i18n scaffolding**
- Files:
  - `src/lib/friends-types.ts`, `src/lib/friends-fixtures.ts`, `src/lib/types.ts` (re-export + `LaunchOptions.friendJoin`), `src/lib/backend.ts`, `src/lib/backend-tauri.ts`.
  - `src/lib/mock-friends.ts`, `src/lib/mock-backend.ts`.
  - `src/lib/friendCode.ts`, `src/lib/friendCode.check.mjs`.
  - `src/hooks/queryKeys.ts`, `src/hooks/useFriends.ts`, `src/store/friendsUi.ts`.
  - `src/i18n/de.ts`, `src/i18n/en.ts`, `src/i18n/{de,en}/{friends,friendsSettings,friendsInvite,friendsHost}.ts` (empty dicts), `src/i18n/{de,en}/mock.ts`.
  - `package.json` (`check:lib`).
- Acceptance:
  - Every command and event of 8.4/8.5 is in `Backend`, `BackendEvents`, `eventSubscriptions` and `backend-tauri.ts` with the exact snake_case names.
  - `friends-types.ts` contains `FriendsFixtureTypes` exactly as in 8.2, and the fixtures contain exactly the keys of the 8.3 table (with its content requirements) and pass `tsc`.
  - `queryKeys.ts` has `friendKeys.all` and `friendKeys.state` (used by 10.7).
  - `friendCode.check.mjs` asserts the Appendix B vectors and `FRIENDS_LIMITS.codeLength === 80`.
  - The mock implements every method and the scenarios and hooks of 10.10.
  - `friendsUi` mirrors `friendsEnabled`.
  - `pnpm build`, `pnpm check:lib` and `pnpm dev` work.
  - **Done (Wave 0).**

### Wave 1
**R1, rust-net: P2P transport** (depends R0a, R0b)
- Files: `src-tauri/src/services/p2p/**` (`mod.rs`, `endpoint.rs`, `relays.rs`, `gate.rs`, `frame.rs`, `stream.rs`, `tunnel.rs`, `dialer.rs`, `conn.rs` (`PeerConn`, `CloseCode`, `CloseReason`, `Direction`, `duplicate_survivor`), `peer_id.rs` (`PeerId`, `InvalidPeerId`), `tests.rs`); `src-tauri/Cargo.toml` (append `bytes = "1"`, already in the lock tree, for `bridge`'s `Bytes`).
- Acceptance: the API of 3 and 6.3/8.7 (including `RelayTls` and `NetConfig.relay_map`, 3.7); R1 tests of 13.1 green on three OSes without network access (the in-process relay runs on loopback); no friends or Minecraft knowledge inside `p2p` (`PathKind` comes from `shared_types`). **Done (Wave 1).** `p2p/relays.rs` passes to I1 (release map); `p2p/endpoint.rs` and `p2p/tests.rs` pass to R4 for Appendix E, E1/E2.

**R2, rust-friends: identity, secrets, codes, records, config, contract, sanitising** (depends R0a, F1)
- Files: `services/secrets.rs`, `services/auth/keyring.rs`, `services/friends/{mod.rs, contract.rs, contract_tests.rs, identity.rs, code.rs, records.rs, config.rs, sanitize.rs, test_support.rs}` (`test_support.rs` is `cfg(test)`: `TempDir`, `error_key`); `src-tauri/Cargo.toml` (append `getrandom = "0.4"`, already in the lock tree via uuid and iroh, for the code secret and salt).
- Acceptance: R2 tests of 13.1; the contract types exactly as 8.2, with `PathKind`, `PortSource` and `ModLoader` re-exported, never redefined (8.1); fixture equality for every row of the 8.3 key table, and the key-set check. **Done (Wave 1).**

**R3, rust-launch: game signals, LAN detection, socket ownership, mod bridge, launch integration** (depends R0a)
- Files:
  - `services/gamesignal.rs`, `services/lan_detect.rs`, `services/sockowner/{mod,windows,linux,macos}.rs`, `services/modbridge/{mod,protocol,server,connection,tests}.rs` (`connection.rs`: per-connection loop, `LineReader`, aliases, rate window, snapshot debounce).
  - `services/launch.rs` (`spawn` env and `on_stdout_raw` parameters) and **`src-tauri/examples/launch.rs` (mandatory)**.
  - `src-tauri/src/commands.rs`: env injection, raw stdout → `lan_line_forwarder` → `GameSignal`, `LaunchProgress`/`LaunchFailed`/`Spawned`/`Exited` signals, `bridge.forget` on exit, `friend_join` handling.
  - `src-tauri/src/models.rs` (`LaunchOptions.friend_join`, `FriendJoin`; the only Rust definition, 8.1).
  - `src-tauri/src/state.rs` (`signals`, `bridge`, constructed stopped).
  - `src-tauri/src/services/worlds/auto.rs`: one line (`friend_join: None` in a test `LaunchOptions` literal).
- Acceptance: R3 tests of 13.1; `ModRequest` defined in `gamesignal.rs` and `LauncherToMod` in `modbridge/protocol.rs` (8.1); `PortSource` used from `shared_types`; with the bridge stopped, launches are byte-identical to today; all existing launch tests pass. **Done (Wave 1).**

**M1, mod: Fabric 26.3 client mod** (no dependency; builds against section 7)
- Files: `mod/**` (layout 11.2, including `mod/.gitattributes` and `mod/.gitignore`), `.gitignore` (append `mod/.jdk/`, `mod/build/`, `mod/.gradle/`). **Done (Wave 1).**
- Acceptance (agent-verifiable only, 13.3.1): on Windows without admin rights, `dev-env` (checksum-verified Temurin 25) + `./gradlew build` and `./gradlew test` work; JUnit green, including `BridgeHarnessTest` with all seven cases; the build compiles every 26.3 signature listed in 13.3.1; `mod/README.md` contains the owner GUI checklist 13.3.2 verbatim and the `FakeLauncher.java` usage. The GUI checklist itself is **not** M1 acceptance; the owner runs it in I1 (E10).

**D1, docs-ci: relay infrastructure and relay docs** (no dependency)
- Files: `infra/relay/**` (`Dockerfile` building the pinned `iroh-relay`, `docker-compose.yml`, `docker-compose.debug.yml` (temporary log override), `relay.toml`: ACME via TLS-ALPN-01 on 443, UDP 7842 QUIC address discovery, per-client rx limits, metrics on localhost, no stored logs; 12.5), `docs/friends/RELAY-OPS.md` (sizing, ports 80/443/7842, updates in lockstep, costs, domain + fallback domain, runbook; section 2 lists where the relay differs from the v2 draft of 12.5), `docs/friends/PRIVACY.md` (relay GDPR text, log/retention policy, abuse contact, LAN-port note, skins note, in-app text drafts in section 7, the Appendix C checklist with where each item is met in section 8).
- Acceptance:
  - `docker compose config` validates.
  - Every item of 12.5 appears in the docs.
  - After the owner deploys, a test with the R0b spike (`--relay`) shows the relay-observed public address and a completed `online()`. Recorded in VERIFICATION.md as G3 input.
- **Done (Wave 1)**, except the deployment (owner). Unverified container items to expect at the first deploy: the image build, the sysctl `net.ipv4.ip_unprivileged_port_start` for non-root binding of 80/443 (fallback: root user with `cap_add NET_BIND_SERVICE`), volume ownership; the compose service has no `read_only` root filesystem yet. Placeholders: `<relay-domain>`, `<ops-mailbox>`, optionally `<fallback-domain>`; operator, address, hosting provider and AVV are marked "(owner)" in PRIVACY.md. n0's operator details and retention are unverified and must be checked before a beta build with n0 relays ships.

**F2, frontend: Friends page, navigation, add dialog** (depends F1)
- Files: `src/main.tsx`, `src/app/mainTabs.ts`, `src/app/Sidebar.tsx`, `src/app/usePageTitle.ts`, `src/ui/Button.tsx`, `src/ui/button.css`, `src/ui/a11y.css` (listed, unchanged), `src/ui/List.tsx`, `src/ui/list.css`, `src/pixel/icon-data.ts`, `src/pages/Friends.tsx`, `src/pages/friends/**` (as built: `AddFriendDialog`, `EnterCodeTab`, `MyCodeTab`, `FriendRow`, `FriendsContent`, `FriendsGate`, `FriendsSection`, `RequestsSection`, `NetworkBanner`, `useFriendDialogs`, `useFriendsNav`, `useRetryDeliveries`, `useFriendsLive` (interim), `inviteRequest`, `friendsModel` + `friendsModel.check.mjs`), `src/components/friends/FriendAvatar.tsx` (also `SelfAsserted`), `src/components/friends/Fingerprint.tsx`, `src/i18n/{de,en}/friends.ts`, `src/i18n/{de,en}/ui.ts`, `package.json` (append `friendsModel.check.mjs` to `check:lib`).
- Acceptance: 10.1-10.3 against all mock scenarios; Ctrl+5 opens Friends and Ctrl+1..4 are unchanged; badge count = requests + invites + notices; icons in both grids; in `?mock=freunde` the page mount calls `friendsRetryNow` once, "Jetzt zustellen" turns the younger delivering request into `awaitingAnswer` and is disabled for 10 s, and only the 8-day-old request shows the expired-code hint; layout shift < 0.001 (13.2); `pnpm build`/`check:lib` green. **Done (Wave 1)**; open: Appendix E, E3 (moved to F4).

**F3, frontend: settings tab, opt-in, privacy notice, window close** (depends F1)
- Files: `src/pages/Settings.tsx`, `src/pages/settings/FriendsTab.tsx`, `src/pages/settings/GameTab.tsx` (hint), `src/components/friends/FriendsOptInDialog.tsx`, `src/components/PrivacyNotice.tsx`, `src/lib/launcherWindow.ts`, `src/lib/onPlay.ts`, `src/lib/onPlay.check.mjs`, `src/i18n/{de,en}/friendsSettings.ts`, `package.json` (append `check:lib`).
- Acceptance:
  - 10.7 (the `launcherOnPlay` part, including the startup source: `ensureFriendsEnabled` in `launcherWindow.ts`, `resolveFriendsEnabled` in `onPlay.ts`), 10.8 and 10.9 against all scenarios.
  - Works with F3 merged and F4 not yet merged: with the mock in "disabled" (default scenario) and no Friends page ever opened, "close" on play still closes; with `?mock=freunde` it minimizes.
  - The opt-in cannot finish without "Verstanden", and without third-party consent when n0 relays are listed.
  - `onPlay.check.mjs` covers the cases listed in 13.2, including the null path (fetch rejects or times out → minimize) and the "not enabled" path (fetch resolves false → close).
  - Rotate and reset use confirms; the rotate confirm names revoked codes, dropped waiting requests and ended sessions (10.8). PrivacyNotice lists the relays and sessionserver.
  - **Done (Wave 1)**; open: Appendix E, E4 and E5 (moved to F4). `usePlay.ts` and `useGameEvents.ts` still call the now async `applyLauncherOnPlay()`/`restoreLauncherAfterPlay()` without `await`; both functions catch their own errors (D.3).

### Wave 2
**R4, rust-friends: service, requests, hello endpoints, presence, outbox, block, core commands, lifecycle** (depends R1, R2, R3)
- Files:
  - `services/friends/{service.rs, requests.rs, hello.rs, status.rs, control.rs, outbox.rs, limits.rs, events.rs, tests.rs}` (append to `mod.rs`).
  - `src-tauri/src/friends_commands.rs`.
  - `src-tauri/src/lib.rs`: register the commands; construct `Friends` with `NetOptions::production()` and start it in `setup` when enabled; leave the marker `// friends: session wiring (R5)`; the cross-platform `RunEvent::Exit` handler.
  - Append `pub friends: Friends` to `state.rs`.
  - Appendix E, E1 and E2: `services/p2p/endpoint.rs` (the idle-timeout field only) and `services/p2p/tests.rs` (the new tests), handed over from R1.
- Acceptance:
  - Sections 3.7, 4 and 5.1-5.3 (control and hello). The 8.4 commands `friends_state` through `friends_retry_now`.
  - Appendix E, E1 and E2 resolved (and 3.3, 3.7, 8.7 updated through the change rule for E1).
  - The extension seam of 8.7 (`PeerStreamHandler`, `SessionControl`, `Lifecycle` with its normative order, `send_control`, `connection`, `dial_friend`), accepted with a fake handler and a fake lifecycle subscriber; no reference to R5 code.
  - The events `friends-changed`, `friends-network`, `friend-presence`, `friend-request`.
  - The bridge starts and stops with the feature. R4 tests of 13.1, including the in-process-relay hello flow.

**R6, rust-friends: manifest, matching, Modrinth lookup, skins, mod install (library only)** (depends R2)
- Files: `services/friends/{manifest.rs, matching.rs, lookup.rs, avatar.rs, modinstall.rs, tests_match.rs}` (append to `mod.rs`), `src-tauri/src/services/modrinth.rs` (add a sha512 `version_files` lookup next to `versions_by_hash`).
- Acceptance: 5.5, 5.6, 11.5 and the skin rules of 12.2 as pure or trait-backed functions per 8.7; R6 tests of 13.1, including the full matching table; no commands and no `lib.rs` change.

**F4, frontend: invites, join, mod confirm, global events** (depends F1, F2)
- Files: `src/app/Layout.tsx`, `src/hooks/useFriendEvents.ts`, `src/components/friends/{FriendDialogs.tsx, InviteDialog.tsx, ModConfirmDialog.tsx}`, `src/hooks/usePlay.ts` (the `friendJoin` entry only), `src/i18n/{de,en}/friendsInvite.ts`.
  - Handed over from F2 and F3 (finished): `src/pages/friends/useFriendsLive.ts` (delete once `useFriendEvents` covers its four events) and its call in `useFriendsNav.ts`; `src/pages/friends/FriendsGate.tsx` and `src/pages/Friends.tsx` (Appendix E, E3); `src/pages/settings/FriendsTab.tsx` (remove `useLiveNetwork`; Appendix E, E4 and E5); `src/i18n/{de,en}/friends.ts` and `friendsSettings.ts` (only the keys these changes need).
- Acceptance: 10.4 in the mock for every verdict (ready, missingContent with both lists, noInstance + createVanilla, versionUnsupported, lookupFailed); offline account guard; install before `inviteJoin` for an uninstalled instance (10.4 step 3); the Friends page's "Beitreten" (`useInviteRequest`) opens the InviteDialog; revoke closes the dialog; never two dialogs at once (queue); every event invalidates or updates the right query keys (listed in the PR); Appendix E, E3-E5 resolved.

**F5, frontend: hosting UI, session chip, close confirm** (depends F1, F2)
- Files: `src/pages/detail/WorldsTab.tsx`, `src/pages/detail/ShareSection.tsx`, `src/pages/detail/ShareDialog.tsx`, `src/app/TitleBar.tsx`, `src/components/friends/SessionChip.tsx`, `src/i18n/{de,en}/friendsHost.ts`.
- Acceptance: 10.5, 10.6 and the close confirm of 10.7 in the mock (version gate, port wait, manual port, verified-port line with PID, invite at most 7, kick, kicked and declined guests with "Erneut einladen", stop, all four mod states); fixed widths; layout shift < 0.001 with the chip.

**D2, docs-ci: mod CI and release workflow** (depends M1)
- Files: `.github/workflows/ci.yml` (append the `mod` job), `.github/workflows/mod-release.yml`.
- Acceptance: the `mod` job installs Temurin 25 (`setup-java`), caches Gradle (including `~/.gradle/caches/fabric-loom`, because Loom downloads Minecraft 26.3), and runs `./gradlew build test` in `mod/`; the release is manual-dispatch only, in the environment `modrinth-release` with a required reviewer; nothing publishes automatically.

### Wave 3
**R5, rust-friends: hosting, joining, mc protocol checks, invites, mod link, session commands** (depends R4, R6)
- Files:
  - `services/friends/{hosting.rs, joining.rs, mcproto.rs, invites.rs, mod_link.rs, tests_session.rs}` (append to `mod.rs`).
  - `src-tauri/src/friends_session_commands.rs`.
  - `src-tauri/src/lib.rs` (append `generate_handler!` entries; fill R4's marker `// friends: session wiring (R5)`: construct `FriendSessions` with `JoinTimers::production()`, `register_stream_handler`, `subscribe_lifecycle`).
  - `src-tauri/src/state.rs` (append `pub sessions: FriendSessions`).
  - No other R4 file is edited. If R5 needs more from R4, the seam in 8.7 is extended through the change rule first.
- Acceptance:
  - Sections 5.3-5.4 (invites, closed invites, manifest serving), 6 and 7.3/7.4 (launcher side).
  - The 8.4 commands `friend_skin` and `lan_status` through `friends_mod_confirm`, with their events.
  - Hosting and joining reach the network only through the 8.7 seam; lifecycle events end sessions with the reasons of 6.1/6.2.
  - R5 tests of 13.1, including every row of 6.5, kick/decline admission, and the join timers on real time with `JoinTimers`.

### Wave 4
**I1, docs-ci: end-to-end verification and release readiness** (depends R0b, R5, F3, F4, F5, M1, D1, D2)
- Files: `docs/friends/VERIFICATION.md` (results; add a G3 table, which does not exist yet), `docs/ARCHITECTURE.md` (Friends section), `src-tauri/src/services/p2p/relays.rs` (our relay as index 0, `quic_port: Some(7842)`, in **both** `RELAY_MAP` variants; handed over from R1), `src/pages/settings/AboutTab.tsx` (the Appendix C disclaimer line, still missing there; the mod's `fabric.mod.json` already has it), `docs/friends/SPEC.md` (deviation write-back).
- Acceptance:
  - The owner has recorded G1 and the 13.4 table, all pass, including E8b (the recorded vanilla refusal message) and E10 (every item of the mod GUI checklist 13.3.2; run first against `java scripts\FakeLauncher.java`, then `.\gradlew.bat runClient` with the printed env line, as `mod/README.md` says; no GUI behaviour has been verified by an agent).
  - G3 verified (`RELAY-OPS.md` section 8: spike `--relay` on both PCs, the QAD line equals each PC's public IP).
  - The Appendix C checklist (drafted in `PRIVACY.md` section 8) is ticked, and the owner has confirmed the approval scope (G4).
  - The release binary size delta is re-measured with the real endpoints (3.1).
  - The doc-sync checklist (13.5.5) is complete.

```
Wave 0: R0a ─┬─────────────► R1 ──┐
        R0b ─┘ (R1 also)          │
        R0a ───────────────► R3 ──┼──► R4 ──┐
        F1 ─► R2 ─────────────────┘         ├──► R5 ─► I1
              R2 ────────────────► R6 ──────┘          ▲
        F1 ─► F2 ─► F4/F5 ─────────────────────────────┤
        F1 ─► F3 ──────────────────────────────────────┤
        M1 ─► D2 ──────────────────────────────────────┤
        D1 ────────────────────────────────────────────┤
        R0b (owner run, G1) ───────────────────────────┘
```
Edges into R4: R1, R2, R3 (as its `dependsOn` states). Edges into R5: R4, R6. R0a is also an input of R2 (via the stubs) and of every Rust package through `shared_types.rs`.

### Hand-off facts after Waves 0 and 1 (normative for Waves 2-4)
Waves 0 and 1 (R0a, R0b agent part, F1, R1, R2, R3, M1, D1, F2, F3) are merged on `feat/friends`. Later packages build on the real code and on these facts; 8.7 lists the exact signatures.

**R4**
- Transport: `p2p::PeerNet` per endpoint (3.3). Main endpoint: `NetConfig { secret: identity.secret_bytes(), alpns: vec![b"pumpkin/peer/1"], relay_map, relays: All, relay_only: always_relay, relay_tls }`. Hello endpoint: `secret: identity.hello_secret(&salt)`, `alpns: vec![b"pumpkin/hello/1"]`, `relays: Only(code.relay_index)`, `relay_only: hello_relay_only` (`hello_net_config`). Retired endpoint: retired key, `alpns: vec![]`, `relays: All`, `relay_only: true`.
- Announce `PeerNet::home_relay()` as `homeRelay`; map `NetState` per the table in 3.4; `find_relay(&net.relay_map, index)` turns an index into the host for `RelayInfo` and `NetworkStatus`.
- `Gate::admit` is synchronous (3.5); a `Drop` arrives at the dialer as `CloseReason::Peer(NORMAL)`. Keep calling `PeerNet::accept()`; a `PeerNet` must outlive its `PeerConn`s; call `close(CloseCode::SHUTDOWN)` before dropping or rebinding.
- Frames: use `BiStream::read_frame(limit)` and `frame::write`; define the per-context limits of 5.1 in the friends service; close the connection with `PROTOCOL` on a hello/control frame error.
- Identity and codes (R2): `identity::availability(secrets, config.enabled || stores.any())`; `code::issue` (store `salt` hex, `secret_digest()` as `secretSha256`, `tail()`); on `friend_add`: `code::parse`, then `ensure_relay_known(|i| find_relay(map, i).is_some())` and `ensure_not_own(&own hello ids)`; on the hello endpoint: `code::secret_matches(record.secret_sha256, request.secret)`; `identity::renew` for rotate and reset; `identity::create` only after checking availability. `friendRequest.secret` = `parts.secret_hex()`; `RequestRecord.helloId` = hex of `parts.hello_id`.
- Every peer string through `sanitize` (12.3); the own name through `sanitize::own_display_name`. Fill `FriendsConfig.settings.display_name` (default `""`) from `FriendsEnableInput.displayName`.
- Convert R2's `String` ids with `PeerId::from_str`; reuse `p2p::PeerId` everywhere, never a second id type.
- Start/stop `state.bridge` with the feature; subscribe to `state.signals` (a broadcast of 256; handle `RecvError::Lagged`).
- Tests: copy `test_relay()` from `services/p2p/tests.rs` (3.7); every endpoint in tests binds `127.0.0.1` only; `MemorySecretStore` and `friends/test_support.rs` (`TempDir`, `error_key`) are available to in-crate tests. A fresh worktree's first `cargo test` takes about 5 min; check free disk space first (`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` keep debug builds small).
- Events: `friend-presence` is the only event for presence/path changes; do not send `friends-changed` for them (8.5).

**R5**
- `bridge.push(instance, LauncherToMod::Snapshot{..})` with real peer ids; the bridge aliases them, keeps the latest snapshot per launch, debounces to 250 ms and disconnects a mod whose 64-message queue overflows. R5 sanitises names and caps friends (50) and invites (20) itself (7.3); `ModPresence`/`ModGuestState` mapping per 7.3.
- `GameSignal::ModRequest` ids are real peer ids already filtered by the bridge (7.3). The first-share confirmation is per launch, not per connection (7.4).
- `LanOpened` (log or mod) is only a hint: always `lan_detect::verify_port` (6.1). `Spawned.online_account` = non-empty `account_id`; friend joins and hosting need it.
- Guest side: `LocalListener` with `ListenerLimits { before_first_valid: 1, after_first_valid: 4 }`; `admit` returns the peeked bytes, which `bridge` writes into the stream first; `open` sends the open frame and maps an `error` frame to `TunnelError::Refused(code)` (6.2). Host side: write the validated buffer to the LAN socket, then `bridge` with an empty prefix (6.1). `sockowner::connects_from` and `listens` block on Linux/macOS: `spawn_blocking`.
- Join timers: `LaunchProgress` comes only from `instance_launch` phase boundaries (8.6); the install runs before `invite_join` (10.4).
- The crash rows of 6.5 need Appendix E, E1 (R4) first.

**R6**
- Mod id `pumpkin_friends`; dev jar `mod/build/libs/pumpkin_friends-0.1.0.jar`; `MOD_PROJECT_ID` stays `""` until the owner creates the Modrinth project (`ModState::Unavailable`). Confirm the sessionserver host (`sessionserver.mojang.com`) used in `PRIVACY.md` and the PrivacyNotice.

**F4**
- Hooks: `src/hooks/useFriends.ts` (queries and `useXxx` mutations). `useFriendEvents` handles: `friends-changed` (invalidate `friendKeys.all`), `friend-request` (invalidate requests), `friend-presence` (patch `friendKeys.list`), `friends-network` (write into `friendKeys.state`, then remove `useLiveNetwork` from `FriendsTab.tsx`), `friend-invite`/`friend-invite-revoked` (invites), `host-session`, `host-session-ended`, `join-session` (session store), `lan-changed` (`setQueryData` on `friendKeys.lan`), `friends-mod` (invalidate `friendKeys.modStatus`), `friends-mod-confirm` (dialog). Then delete `src/pages/friends/useFriendsLive.ts` (double handling meanwhile is harmless).
- Read `useInviteRequest` in `FriendDialogs` and clear it. `friendsUi` exports `useFriendsUi` and `setFriendsEnabled`.
- `LaunchOptions.friendJoin` is optional in TS; `usePlay` sets it. `types.ts` re-exports `friends-types.ts` with `export *`: a type of the same name added to `types.ts` collides.
- Reuse `FriendAvatar`, `SelfAsserted`, `Fingerprint` and the `friendsModel.ts` helpers.

**F5**
- `friendsModInstall` resolves to `void`; wrap it for `useBackgroundTask` (8.4). Mock host instance `inst-survival` (10.10).

**D2**
- `mod/`: Gradle 9.7.1 pinned with `distributionSha256Sum`; `gradlew` is committed with the executable bit (100755); JUnit 6.1.3 via the junit-bom; the tests open loopback sockets only and take about 5 s.

**All frontend packages:** `pnpm build` regenerates `src-tauri/icons/icon.icns` (branding sync); never commit it. A fresh worktree needs `pnpm install --frozen-lockfile` once and a placeholder `dist/index.html` before `cargo` can build the Tauri crate without `pnpm build`.

---

## 15. v1.1 backlog (non-normative)
- **Automatic build of a matching modded instance** from the host's manifest, after consent. Preconditions recorded from the security review:
  - A Modrinth reputation gate: project `approved`, version `listed`; refuse drafts and archived items; flag mods younger than 14 days, with fewer than 1k downloads, or with a recent owner change.
  - Show author, downloads and first-publish date. Reworded warning ("Modrinth moderiert, das ist keine Garantie").
  - Fabric and vanilla only (no installer processors).
  - A total download cap (1 GB or 300 mods) and a per-mod size cap.
  - Mod files written as `mods/<sanitised leaf>.jar` using the file that matched the hash.
  - Re-consent on a manifest hash change.
- `shareActivity`, `appearOffline` (with a distinct `UNAVAILABLE` close code that never sets `removedByPeer`, and an exemption for active host sessions).
- Alias UI beyond rename, per-friend relay mode, deep links, the verified-account badge.
- A Quilt build, a second MC version for the mod, in-game join from the mod (`joinInvite`/`joinReady`).
- A random-loopback nonce on macOS (needs lo0 aliases), and named pipes instead of env tokens.
- Dedicated-server hosting (v2, see 1.4).

---

## Appendix A: error keys (`src/i18n/{de,en}/errors.friends.ts`, created by R0a)

| Key | Params | German source text (en twin required) |
|---|---|---|
| `errors.friends.disabled` | | Freunde sind nicht aktiviert |
| `errors.friends.unavailable` | | Auf diesem System gibt es keinen Schlüsselbund; Freunde sind hier nicht verfügbar |
| `errors.friends.identityLost` | | Deine Freunde-Identität fehlt im Schlüsselbund; setze sie in den Einstellungen zurück |
| `errors.friends.msAccountRequired` | | Dafür brauchst du ein Microsoft-Konto |
| `errors.friends.relayConsentRequired` | | Bitte stimme der Nutzung der genannten Relay-Server zu |
| `errors.friends.networkUnavailable` | | Keine Verbindung zum Relay-Server; Freunde sind gerade nicht erreichbar |
| `errors.friends.displayNameInvalid` | `min`, `max` | Anzeigename: {min} bis {max} Zeichen |
| `errors.friends.codeInvalid` | | Dieser Freundescode ist ungültig |
| `errors.friends.codeUsed` | | Dieser Freundescode wurde schon von jemand anderem benutzt |
| `errors.friends.codeOwn` | | Das ist dein eigener Code |
| `errors.friends.tooManyCodes` | `max` | Höchstens {max} offene Codes; widerrufe zuerst einen |
| `errors.friends.alreadyFriends` | | Ihr seid schon befreundet |
| `errors.friends.alreadyRequested` | | An diesen Code geht schon eine Anfrage |
| `errors.friends.friendLimit` | `max` | Höchstens {max} Freunde |
| `errors.friends.requestsFull` | | Diese Person nimmt gerade keine Anfragen an |
| `errors.friends.rateLimited` | | Zu viele Versuche; bitte später noch einmal |
| `errors.friends.peerOffline` | `name` | {name} ist gerade nicht erreichbar |
| `errors.friends.protocolUnsupported` | | Dieser Code oder Launcher ist zu alt oder zu neu; bitte beide aktualisieren |
| `errors.friends.notFound.friend` | `id` | Freund „{id}“ wurde nicht gefunden |
| `errors.friends.notFound.request` | `id` | Anfrage „{id}“ wurde nicht gefunden |
| `errors.friends.notFound.code` | `id` | Code „{id}“ wurde nicht gefunden |
| `errors.friends.notFound.blocked` | `id` | Sperre „{id}“ wurde nicht gefunden |
| `errors.friends.notFound.invite` | `id` | Einladung „{id}“ gibt es nicht mehr |
| `errors.friends.gameNotRunning` | | Starte zuerst die Instanz und öffne die Welt |
| `errors.friends.versionUnsupported` | `min` | Welten teilen und beitreten geht erst ab Minecraft {min} |
| `errors.friends.lanPortUnknown` | | Der LAN-Port ist noch unbekannt; öffne die Welt im Spiel für LAN oder gib den Port ein |
| `errors.friends.portInvalid` | `min`, `max` | Port: {min} bis {max} |
| `errors.friends.portNotGame` | `port` | Port {port} gehört nicht zu diesem Minecraft |
| `errors.friends.lanUnreachable` | | Die LAN-Welt antwortet nicht; ist sie noch geöffnet? |
| `errors.friends.sessionActive` | | Es wird schon eine Welt geteilt |
| `errors.friends.sessionNotFound` | | Diese geteilte Welt gibt es nicht mehr |
| `errors.friends.guestLimit` | `max` | Höchstens {max} Freunde gleichzeitig |
| `errors.friends.inviteExpired` | | Diese Einladung ist abgelaufen |
| `errors.friends.notInvited` | | Du bist zu dieser Welt nicht eingeladen |
| `errors.friends.instanceMismatch` | | Diese Instanz passt nicht zur Welt deines Freundes |
| `errors.friends.manifestInvalid` | | Die Angaben zur Instanz deines Freundes sind ungültig |
| `errors.friends.joinAddressInvalid` | | Ungültige Beitrittsadresse |
| `errors.friends.tunnelFailed` | | Die Verbindung zu deinem Freund ist abgebrochen |
| `errors.friends.hostStopped` | | Dein Freund teilt die Welt nicht mehr |
| `errors.friends.modNotAvailable` | `version` | Die Freunde-Mod gibt es für Minecraft {version} noch nicht |
| `errors.friends.modConfirmDenied` | | Teilen aus dem Spiel wurde im Launcher abgelehnt |

Keys are added only together with both languages (append rule, section 14).

## Appendix B: golden vectors

**Friend code.** version `0x02`, relay index `0x00`, hello id = bytes `00 01 02 … 1f`, secret = `a0 a1 a2 a3 a4 a5 a6 a7 a8`. Then check = `d6 db`, and:
```
pumpkin-aiaaaaicamcakbqhbaequcymbuha6earcijrifiwc4mbsgq3dqor4h5augrkhjffu2t2rvw3      (80 chars)
grouped body: aiaa aaic amca kbqh baeq ucym buha 6ear cijr ifiw c4mb sgq3 dqor 4h5a ugrk hjff u2t2 rvw3
```
Parsing must accept the grouped form (with spaces or `-` inside the body) and an upper-case variant. Flipping any body character must give `codeInvalid`.

**Hello key.** identity secret = bytes `40 41 … 5f`, salt = bytes `00 01 … 0f`:
`SHA-256("pumpkin/hello-key/2" || secret || salt) = 0fc118eef8a72afd5f595deba158b70a7a0bf925ed85176b5ec3ef430499d80f`

## Appendix C: compliance checklist (ticked by I1 in VERIFICATION.md)
- [ ] The launcher About page and the mod description carry "NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT."
- [ ] No Minecraft logo or Mojang branding in the friends UI or the mod. The name "Pumpkin Friends" does not suggest officialness.
- [ ] Free, with no paid perks or gating. No game files are distributed between peers. Each client downloads from Mojang and Modrinth only.
- [ ] Online-mode only. Offline accounts are refused before launch (E8a, plus the R3 unit test), and the host's game refuses them at login (E8b, with the recorded vanilla message).
- [ ] Child-account behaviour recorded (E13). The feature does not bypass Xbox or Mojang multiplayer restrictions (it uses the vanilla join path).
- [ ] The Usage Guidelines were re-read at release time (date recorded).
- [ ] The owner confirmed that the Microsoft/Mojang app approval covers sharing player names and UUIDs between users (G4).
- [ ] The Modrinth API is used with the launcher User-Agent and within its rate limits.

## Appendix D: Changelog (v1 → v2, and the Wave 0/1 sync)

Status values: **applied** (in v2 as described), **partly** (applied with a stated exception), **deferred** (moved to the v1.1 backlog or v2, section 15/1.4), **rejected** (not taken, with the reason). IDs: `S<n>` = security review finding n, `F<n>` = feasibility review finding n (zero-based, in review order).

### D.1 Review findings on v1

| ID | Finding (short) | Status | Reason / where |
|---|---|---|---|
| S0 | Peer-supplied `homeRelay` URL dialed (IP leak, SSRF) | applied | Peers send only a relay-map index; unknown indexes ignored; test that nothing outside the map is dialed (3.2, 5.3, 13.1 R1). |
| S1 | Modrinth hash check treated as safety for friend-triggered builds | deferred | **Automatic modded build cut from v1** (OD-1). Reputation gate, vanilla/Fabric-only, size caps, hash-matched file and re-consent are mandatory preconditions in 15. |
| S2 | Tunnel could target any local service via a spoofed port | applied | Every port source must be a LISTEN socket of the game PID and answer a server list ping; re-checked on change and by a 15 s liveness probe (6.1). |
| S3 | Any local process could use the guest's loopback listener | partly | Single-owner listener on random `127.a.b.c`, handshake nonce + PID check, no stream before validation (6.2). macOS has no random-address nonce (only `127.0.0.1` on lo0); lo0 aliases are backlog (15). |
| S4 | Strangers learn IP and presence through hello and gates | applied | Permanent id not in the code; per-code relay-only hello endpoints; silent drops; wording corrected; residual exposure documented (3.3, 3.5, 4.2, 10.9, 12.1). |
| S5 | Hostile mod in the same JVM can use the IPC token | applied | IPC treated as untrusted: launcher confirmation for the first share per launch, 3/min after, opaque aliases, connection caps, token dropped on exit (7.1, 7.4). |
| S6 | Stolen identity cannot be revoked | applied | Signed rotate and reset through a retired-key outbox for 14 days; `identityChanged` notice; thief rejected after rotation (4.6). |
| S7 | Hello rate limits bypassable; codes consumable by others | applied | Hello id only inside the code; secret checked on the first frame; limits per code and id; handshake cap; `codeUsed`; UI warning (4.3, 10.3, 12.4). |
| S8 | Self-asserted names and UUIDs allow spoofing | applied | Sanitising of every peer string; fingerprint next to names in dialogs; rename notice; duplicate-name suffix; "selbst angegeben" tooltip (5.3, 10, 12.3). |
| S9 | Game exposed to raw pre-auth traffic; old versions allowed | applied | Minimum 1.20; Handshake + Login Start validated before connecting; offline-account refusal unit-tested; login refusal by the game verified in E8b (6.1, 8.6, 12.2, 13.4). |
| S10 | Relay ToS and GDPR gaps | applied | n0 relays only in debug/closed beta with explicit opt-in; own relay with no access logs, truncated IPs, 24 h retention, abuse contact, limits, fallback domain (3.2, 12.5, D1). |
| S11 | Local interface addresses leak on direct paths | partly | Wording names LAN/VPN addresses; `homeRelay` is an index. Rejected: filtering iroh's candidate addresses (needs an iroh patch); "always relay" is the stated remedy (12.1). |
| S12 | Unsafe file-name handling | applied | Manifest `fileName` is display only; mod install writes a sanitised leaf of the hash-matched file; build path rule moved to 15 (5.5, 11.5). |
| S13 | SHA-1 as content identity | applied | sha512 in manifest, Modrinth lookup and matching (5.5, 5.6). |
| S14 | Resource exhaustion on streams and persistence | applied | 16 bidi / 0 uni streams, 5 request streams per friend per minute, cached manifest, debounced writes, 20 new tunnel streams per minute (3.3, 4.4, 5.3, 12.4). |
| S15 | Mod supply chain (slug-based install, unprotected token) | applied | Pinned `MOD_PROJECT_ID`, listed versions only, release environment with required reviewer and 2FA; matching ignores our mod only by verified project id (5.5, 11.5). |
| S16 | Mojang/MS compliance; v2 whitelist fed by self-asserted UUIDs | partly | Compliance checklist (Appendix C) and gate G4 applied. The whitelist concern is deferred with dedicated-server hosting to v2 (1.4), which is non-normative. |
| F0 | No early real-world viability gate | applied | Wave 0 R0b spike run by the owner on 3 network pairs; release gates G1-G5 (OD-5, 1.3). |
| F1 | v1 too large | partly | Trimmed per OD-1 (no auto-build, activity, appear offline, Quilt, in-game join, keybinding; minimal rename and block). **Rejected part: cutting the mod.** The owner explicitly keeps it (OD-1); its risk is contained by the untrusted-IPC rules (7.4) and an agent-verifiable M1 scope (13.3.1). |
| F2 | Contract types cannot compile or serialise | partly | One serde rule set, no `AppError` in payloads, shared JSON fixtures checked by Rust and `tsc` (8.1-8.3). Rejected: ts-rs generation, because it would serialise F1 behind R2. |
| F3 | "Appear offline" makes friends look removed | deferred | **Appear offline is cut from v1.** The distinct `UNAVAILABLE` close code and the host-session exemption are recorded in 15. |
| F4 | Friend code arithmetic wrong | applied | 45-byte payload, 72 base32 chars, 80 with prefix; one fixture-checked constant set; golden vectors (4.2, Appendix B). |
| F5 | LAN log spoofable; quitting to title missed | applied | Whole-message parser on Server thread/INFO in XML and plain forms; "Stopping server" ends the session; PID check and liveness (6.1, 6.4). |
| F6 | Join listener timeout too short | applied | Timer starts at `Spawned` (10 min). Amended in D.2 (V6, V10): injectable `JoinTimers`, spawn wait extended by launch progress up to 30 min, `LaunchFailed` ends the join (6.2). |
| F7 | Missing `TCP_NODELAY` | applied | Required on every local socket; ping-pong p99 test (6.3, 13.1). |
| F8 | dev-env used a Mojang JRE without `javac` | applied | Full Temurin 25 JDK in `mod/.jdk`, SHA-256 verified (11.1, OD-3). |
| F9 | Relay lacked UDP 7842 QUIC address discovery | applied | In the RelayMap config, D1 compose and runbook, and G3 (3.2, 12.5). |
| F10 | Redeeming a code needed the inviter online | applied | Request stays `delivering` and is retried for 14 days; code TTL 7 days (4.3). Amended in D.2 (V5, V14): immediate retry and the expired-code hint. |
| F11 | `last_quick_play` written for friend joins | applied | `LaunchOptions.friendJoin` skips it; tested (8.6). |
| F12 | Exact match too strict | applied | Match on MC version + loader + required sha512 set, with missing/extra lists and a normative table (5.6). |
| F13 | Privacy wording overpromised | applied | Skins fetched in Rust; LAN-port note in the share dialog and PRIVACY.md; hello relay-only (10.2, 10.5, 12.1). |
| F14 | Presence cost at startup | applied | Cap of 50 friends, eager dialing only for recent or pending peers, lazy hourly otherwise, load test (4.4, 13.1). |
| F15 | Identity edge cases (keyring missing, data present) | partly | `noSecretStore` / `identityLost` states with explicit reset, never a silent new key (4.1). **Deviation: `Capabilities.friends` is not added.** `Capabilities` is a static, synchronous object (`allCapabilities(true)` in `backend-tauri.ts`) and cannot reflect a runtime keyring probe, so the signal is `FriendsState.availability = "noSecretStore"`, which hides the area the same way (4.1, 8.5, 10.1). |
| F16 | Work-package ownership inconsistent | applied | R0a owns stubs and Cargo changes, append-only table, R0a/R0b split, namespaces owned per package, spec in `docs/friends/SPEC.md` (14). Amended in D.2 (V1, V2, V13). |
| F17 | CI and test claims wrong | applied | CI facts corrected, zero-new-warnings rule, `Dialer` seam, real sockets on real time (13.1). Amended in D.2 (V6): no paused time with real sockets. |
| F18 | Acceptance criteria not testable | applied | 6.5 table asserted by tests, layout-shift hook, E2E table with fixture mods, G1 with 3 pairs, doc-sync checklist (13). Amended in D.2 (V5, V7, V11). |
| F19 | `launcherWindow` read `friendsState` before it loaded | applied | `effectiveOnPlay` helper with null treated as enabled (10.7). Amended in D.2 (V12): `ensureFriendsEnabled` fetches at decision time, so null occurs only on failure. |
| F20 | v2 section normative; open questions while frozen | applied | 1.4 non-normative; owner decisions recorded in the header; open-questions section removed. |

### D.2 Verifier findings on the v2 draft (2026-10-03)

| ID | Finding (short) | Status | Where fixed |
|---|---|---|---|
| V1 | Shared types owned by a package the consumer does not depend on | applied | Neutral `services/shared_types.rs` (R0a) for `PathKind`, `PortSource`, `ModLoader` re-export; defining-file table for `FriendJoin`, `ModRequest`, `LauncherToMod` (8.1, 8.2, 8.6, 8.7, 14 R0a/R2/R3). |
| V2 | No extension seam between R4 and R5 | applied | `PeerStreamHandler`, `SessionControl`, `Lifecycle` with a normative order; R5 wiring limited to `state.rs` + the `lib.rs` marker; R4 test with fake handler and subscriber (5.3, 8.7, 13.1 R4, 14). |
| V3 | Hello flow not testable (relay-only, compile-time map) | applied | `NetOptions { relay_map, hello_relay_only, relay_tls }` with an in-process relay; R1 relay-only binding test; R4 hello flow through the relay (3.2, 3.7, 8.7, 13.1). |
| V4 | Rotate left active codes unusable | applied | Rotate revokes and deletes codes and old-id-bound requests; confirm text says so; R4 test (4.6, 10.8, 13.1 R4). |
| V5 | E1 contradicted the backoff | applied | `friends_retry_now`, "Jetzt zustellen", retry on page open; E1 asserts 30 s after the press (4.3, 4.4, 8.4, 10.2, 13.4). |
| V6 | Paused time mixed with real QUIC sockets | applied | Injectable `JoinTimers`; time rule in 13.1; real-time tests with small values, paused-time tests without sockets (6.2, 8.7, 13.1 R5). |
| V7 | M1 acceptance needed GUI work | applied | 13.3.1 agent-verifiable (build, JUnit, `BridgeHarnessTest`, 26.3 signatures); 13.3.2 owner GUI checklist run in I1/E10 (11.2, 13.3, 13.4, 14 M1/I1). |
| V8 | Changelog referenced but missing | applied | This appendix (header, 8.5). |
| V9 | Kick not enforced at admission | applied | Kick and decline close the invite; `kicked: true`; `notInvited` until `host_invite`; R5 test (5.4, 6.1, 6.5, 8.2, 8.3, 10.5, 13.1 R5). |
| V10 | Pre-spawn wait too short; launch failure not an end trigger | applied | Spawn wait restarted by `LaunchProgress`, 30 min cap, `LaunchFailed` ends the join; R3 and R5 tests (6.2, 6.5, 8.6, 8.7, 13.1). |
| V11 | "Game rejects offline guests" claim untested | applied | E8b: manual Direct Connect with an offline account, message recorded (12.2, 13.4, 14 I1, Appendix C). |
| V12 | `friendsEnabled` startup source unowned; unsafe default | applied | `ensureFriendsEnabled` via `queryClient.fetchQuery` with a 1.5 s timeout, fallback only on failure; F3 owns it; `onPlay.check.mjs` null path (10.7, 13.2, 14 F1/F3). |
| V13 | SPEC.md ownership, missing R2→R4 edge, fixture typing | applied | SPEC.md row in the shared-file table; R2→R4 edge in the diagram; `FriendsFixtureTypes` in the TS mirror; fixture key table (8.2, 8.3, 14). |
| V14 | Silent `delivering` for expired codes; 6.5 disabled row incomplete | applied | Expired-code hint after 7 days, retries kept to 14 days; 6.5 rows for host-disables, guest-disables and rebind/rotate (4.3, 6.5, 10.2, 10.10). |

### D.3 Wave 0/1 implementation notes (2026-10-03)

The ten packages of Waves 0 and 1 reported 109 deviations. IDs: `<package> D<n>` = deviation n of that package's result. Each one was decided as **(a)** reality wins, the normative text now describes the implementation (89), **(b)** the code must change, listed in Appendix E (3), or **(c)** harmless, one line below (17). Two Appendix E items (E1, E5) come from the packages' notes for the next waves, not from a deviation.

**D.3.1 Write-back index (a)**

| Package | Deviations | Written back in |
|---|---|---|
| R0a | D2, D3, D6 | 3.1 (+4.9 MiB), 3.2 (`[features]`), 12.2 (`deny.toml`), 14 R0a |
| R0b | D2-D9, D11-D13 | 3.1 (`unstable-net-report`), 3.3 (accept loop, keep-alive, multi-relay dial), 3.4 (relay unreachable), 3.5 (`Drop`, outgoing hook, reject seen by the dialer), 3.6 (close before endpoint close), 13.1 R0b row, 14 R0b (spike defaults) |
| F1 | D3, D4, D6 | 4.2 (TS helpers), 8.4 (`friendsModInstall` returns `void`), 8.5 (presence emits only `friend-presence`), 10.5, 10.10 |
| R1 | D1-D15, D17 | 3.2 (map state, `RelaySelection`, `find_relay`), 3.3, 3.4 (`NetState`), 3.5, 3.6 (`CloseCode`, `CloseReason`), 3.7 (test seam, loopback binding), 4.1/8.1 (`PeerId`), 4.4 (`duplicate_survivor`), 5.1 (stream reset vs connection close, limits in friends), 6.3 (`bridge` prefix and stop, `'static` bounds, `TunnelError`), 8.7, 13.1 R1 row, 14 R1 (`conn.rs`, `peer_id.rs`, `bytes`) |
| R2 | D1-D8 | 4.1 (`SecretStore`, malformed entry, `Identity::sign`, `renew`, `availability`), 4.2 (code API, `secretSha256`), 8.7, 9 (config default and corrupt file, `RecordStores`, outbox key), 14 R2 (`getrandom`, `test_support.rs`) |
| R3 | D1, D3-D12 | 6.1 (ping check, owner lookup fails closed), 6.2 (progress at phase boundaries, install before join), 6.4 (raw stdout), 7.1 (loopback by construction, ignored lines), 7.3 (bridge filtering), 8.6 (address check, `online_account`, signal order), 8.7 (`spawn` with seven parameters, `start`/`stop`), 10.4 step 3, 14 R3 (`connection.rs`, `worlds/auto.rs`) |
| M1 | D1-D11 | 7.2, 7.3 (ping timing, mod tolerance), 7.5 (env validity, backoff after reject), 11.2 (extra files, `startIfLaunched`, lang keys), 11.3 (b, c, e, f), 11.4 (writer queue), 12.3 (mod-side sanitising), 13.3.1 cases 3 and 5 |
| D1 | D1-D9 | 12.1/12.5 (ACME on 443, healthz, rx limits only, no stored logs, daily id set, image build, IPv4 only), 14 D1 (files, PRIVACY.md section 8, open container items) |
| F2 | D2-D11 | 10.2 (gates incl. `noSecretStore`, "Einladen" rule, order, notice rows, block confirm, `inviteRequest`, `useFriendsLive`), 10.3 (hint, `.code` class), 14 F2/F4 |
| F3 | D1, D2, D4-D6, D8, D9 | 10.7 (`GameTab` warning), 10.8 (tab order, off state, `useLiveNetwork`, danger area), 10.9 (mount-only-while-open, operator names), 14 F3/F4 |

**D.3.2 Harmless notes (c)**

| ID | Note |
|---|---|
| R0a D1, R0b D1, F1 D1 | The worktrees started at `main`; each package fast-forwarded its own branch to `feat/friends` to get this spec. No history was rewritten. |
| R0a D4 | The first baseline build embedded an empty `dist/` and is not comparable; the documented size delta compares two builds with the same frontend. "Unused dependencies add nothing" is reasoned (LTO), not measured. |
| R0a D5 | The binary size was measured on Windows only; I1 re-measures (3.1). |
| R0a D7 | Drive E: briefly filled up while three agents built into the shared target dir; one release build was re-run. Check free space before cold builds. |
| R0b D10 | `RelayQuicConfig` is not re-exported by iroh; the QUIC port is set through `RelayConfig::from(url)` and `config.quic`, as 3.2 describes. No `iroh-relay` dependency is needed. |
| R0b D14, D1 D10 | These packages did not edit SPEC.md; their differences are collected in IROH-NOTES.md section 10 and RELAY-OPS.md section 2 and written back here. |
| R3 D2, F3 D10 | No conflict with IROH-NOTES (these packages do not touch iroh). |
| F1 D2 | The mock's error texts use `mock.friends.*` keys (F1's own namespace), because `errors.friends.*` did not exist when F1 ran. They exist now; switching is optional. |
| F1 D5 | `src-tauri/icons/icon.icns` is regenerated by `pnpm build`/`pnpm dev` (branding sync) and is never committed. |
| R2 D9 | `RecordStores::any()` counts readable records only. A store with only unreadable entries of a newer version counts as empty; `identityLost` still triggers through `config.enabled`, which is true whenever records were created. |
| M1 D12 | `build.gradle`: `options.encoding = 'UTF-8'`, `-Xlint:all,-classfile,-serial` (Gson's missing errorprone annotations), the test source set sees `sourceSets.client.output`, JUnit pinned at 6.1.3 through the junit-bom. |
| M1 D13 | M1's commits carry the session's required co-author trailer instead of the one in the task text. |
| F3 D7 | `usePlay.ts` and `useGameEvents.ts` call the now async `applyLauncherOnPlay()`/`restoreLauncherAfterPlay()` without `await`; both catch their own errors, and the window action only happens a moment later. |

## Appendix E: Open code fixes

Deviations (and gaps found in the packages' notes) where the code has to change. The normative text above still describes the required behaviour; it does **not** describe these items as done. The owner package resolves each item and removes its row in the same PR.

| # | Owner | Source | Fix |
|---|---|---|---|
| E1 | R4 (takes over `p2p/endpoint.rs` for this field) | R1 note N3; needed by 13.1 R4 (presence crash) and 6.5 / 13.1 R5 (crash rows) | The idle timeout is the constant `IDLE_TIMEOUT_MS = 40_000` in `p2p/endpoint.rs`, so the "short idle timeout" crash tests have no seam. Add `pub idle_timeout: Duration` to `NetConfig` (used by `transport_config` instead of the constant; the keep-alive interval becomes `min(15 s, idle_timeout / 3)` so that a short test value cannot idle out an alive connection) and `pub idle_timeout: Duration` to `NetOptions` (`production()` = 40 s; no setting). R4 copies it into every `NetConfig`. Update 3.3, 3.7 and 8.7 through the change rule in the same PR. |
| E2 | R4 (takes over `p2p/tests.rs` for this test) | R1 D16 | The pre-handshake cap of 8 (3.5, 12.4) is implemented but untested. Add a test that keeps 8 handshakes in flight (for example a test `Gate` whose `admit` waits on a `std::sync::Barrier`, on a multi-thread runtime) and asserts that a 9th dialer gets no answer (its dial runs into `DIAL_TIMEOUT` or a shorter test timeout) while the first 8 are admitted after the barrier is released. |
| E3 | F4 (takes over `src/pages/friends/FriendsGate.tsx`, `src/pages/Friends.tsx`) | F2 D1 | "Freunde aktivieren" on the Friends page is a link to `/settings?tab=freunde`, where the user must flip the switch again. Open the opt-in on the page instead: `{optingIn && <FriendsOptInDialog onClose={() => setOptingIn(false)} />}` (10.2, 10.9). |
| E4 | F4 (takes over `src/pages/settings/FriendsTab.tsx`) | F3 D3 | The "Immer über Relay" confirm checks only `useHostSessions`, so an active join is ended by the rebind without a warning. Extend the check to an active join (F4's join-session store) and name the join in the confirm text (10.8). |
| E5 | F4 (same file) | D1 note N4 | Settings shows only the 16-char fingerprint. Add an action next to "Mein Fingerabdruck" that copies the full 64-char peer id (`FriendsState.me.peerId`), with keys in `friendsSettings` (de + en). An abuse report to the relay needs it (10.8, 12.5, `RELAY-OPS.md` section 13). |
