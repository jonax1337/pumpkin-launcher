# iroh 1.3 API notes (R0b)

Where `SPEC.md` names an iroh call, this file is authoritative for the **spelling**; the spec stays
authoritative for the **behaviour** (SPEC 3.1). Everything below was compiled against
**iroh 1.3.0** (the newest 1.3 release on 2026-10-03, locked in `tools/p2p-spike/Cargo.lock`) and
is exercised by a test in `tools/p2p-spike/tests/` (named in each row, `file::test`). Where a
statement comes from reading the iroh source rather than from a test, it says **(source)**.

Run the evidence with `cd tools/p2p-spike && cargo test` (Windows, no network needed; about 10 s).

## 0. Crate and features

| Need | Spelling |
|---|---|
| Launcher dependency | `iroh = "1.3"` with default features (`tls-ring`, `metrics`, `portmapper`, `fast-apple-datapath`). |
| In-process test relay and certificate skip (SPEC 3.7) | dev-dependency `iroh = { version = "1.3", features = ["test-utils"] }`. |
| Relay-observed public address | needs the feature `unstable-net-report` (spike only, see 5.3). |
| Imports used below | `iroh::{Endpoint, EndpointAddr, EndpointId, RelayConfig, RelayMap, RelayMode, RelayUrl, SecretKey, TransportAddr, Watcher}`, `iroh::endpoint::{presets, Builder, Connection, ConnectError, ConnectWithOptsError, ConnectionError, ApplicationClose, EndpointHooks, AfterHandshakeOutcome, Side, QuicTransportConfig, VarInt, PathEvent, ReadError, ReadToEndError, RecvStream, SendStream}`, `iroh::tls::CaTlsConfig`, `iroh::defaults`. |

`RelayQuicConfig` is **not** re-exported by `iroh`; see 2.2 for how to set the port without it.

## 1. Identity (SPEC 4.1, 8.7 `NetConfig.secret`, `PeerId`)

| Item | Spelling | Test |
|---|---|---|
| Key from the 32 stored bytes | `SecretKey::from_bytes(&secret)` (`&[u8; 32]`), back with `key.to_bytes()` | `identity::secret_bytes_give_the_same_id_every_time` |
| Key from 64 hex chars | `hex.parse::<SecretKey>()` | `identity::secret_key_parses_from_64_hex_chars` |
| Endpoint id | `key.public()` or `endpoint.id()`, type `EndpointId` (= `PublicKey`) | same |
| `PeerId` string | `id.to_string()` is exactly 64 lowercase hex; `text.parse::<EndpointId>()` reads it back | `identity::id_displays_as_64_lowercase_hex_and_parses_back` |
| Endpoint key | `Builder::secret_key(key)` | used by `p2p-spike listen` |

## 2. Relay map (SPEC 3.2, 3.7)

### 2.1 Map and mode

| Item | Spelling | Test |
|---|---|---|
| URL | `"https://relay-eu1.example.org/".parse::<RelayUrl>()` | `relay::relay_map_from_urls_uses_the_default_quic_port` |
| Map from URLs | `RelayMap::from_iter(urls)` (each entry gets QUIC port 7842) | same |
| Empty map, merge | `RelayMap::empty()`, `map.extend(&other)` (interior mutability, `&self`) | `relay::address_with_several_relays_reaches_the_peer_on_any_of_them` |
| Read back | `map.urls::<Vec<RelayUrl>>()`, `map.get(&url) -> Option<Arc<RelayConfig>>`, `map.is_empty()` | `relay::relay_map_from_urls_uses_the_default_quic_port` |
| Use it | `builder.relay_mode(RelayMode::Custom(map))`; the spike maps an empty map to `RelayMode::Disabled` | every relay test |
| `RelaySelection::Only(i)` (hello endpoints) | a `RelayMap` that contains only that entry | `relay::relay_only_endpoint_is_reachable_only_through_the_relay` |
| n0 production relays (debug and beta builds) | `iroh::defaults::prod::default_relay_map()`; hosts `use1-1`, `usw1-1`, `euc1-1`, `aps1-1` `.relay.n0.iroh.link.` (consts `NA_EAST_RELAY_HOSTNAME`, `NA_WEST_RELAY_HOSTNAME`, `EU_RELAY_HOSTNAME`, `AP_RELAY_HOSTNAME` in `iroh::defaults::prod`) | `relay::empty_url_list_means_the_n0_production_relays` |

Do not use `RelayMode::Default`: it switches to n0's staging relays when the environment variable
`IROH_FORCE_STAGING_RELAYS` is set **(source)**. Copy the URLs from `defaults::prod` instead.

### 2.2 QUIC address discovery per entry (`RelayEntry.quic_port`)

| `quic_port` | Spelling | Test |
|---|---|---|
| `Some(7842)` | `RelayConfig::from(url)` (7842 = `iroh::defaults::DEFAULT_RELAY_QUIC_PORT`) | `relay::relay_map_from_urls_uses_the_default_quic_port` |
| `Some(other)` | `let mut c = RelayConfig::from(url); if let Some(q) = c.quic.as_mut() { q.port = other; }` (works without depending on `iroh-relay`) | `relay::relay_config_takes_another_quic_port_without_the_iroh_relay_crate` |
| `None` | `RelayConfig::new(url, None)` | `relay::relay_config_without_quic_skips_address_discovery` |

`RelayConfig` is `#[non_exhaustive]`: no struct literal, but its `pub` fields can be read and mutated.

## 3. Endpoint builder (SPEC 3.3, 8.7 `PeerNet::bind`)

```rust
let endpoint = Endpoint::builder(presets::Minimal)        // no address lookup (no pkarr, no DNS)
    .secret_key(SecretKey::from_bytes(&secret))
    .alpns(vec![b"pumpkin/peer/1".to_vec()])              // Vec<Vec<u8>>, not Vec<&[u8]>
    .relay_mode(RelayMode::Custom(relay_map))
    .transport_config(transport_config)                  // see 3.1
    .clear_ip_transports()                               // only for relay-only endpoints
    .bind()
    .await?;                                             // Result<Endpoint, BindError>
```

| Item | Spelling and behaviour | Test |
|---|---|---|
| No address lookup | `presets::Minimal` sets only the crypto provider; relays stay off until `relay_mode`. `presets::N0` adds pkarr publishing, pkarr and DNS lookup and n0 relays, so it must not be used **(source)**. | every test (all endpoints use `Minimal`) |
| Relay-only (`alwaysRelay`, hello, retired) | `Builder::clear_ip_transports()`. The endpoint then has no UDP socket: `endpoint.bound_sockets()` is empty and `endpoint.addr().ip_addrs()` yields nothing; only `addr().relay_urls()` is set. | `relay::relay_only_endpoint_is_reachable_only_through_the_relay` |
| Relay-only without any relay | `bind()` fails ("no valid address available"). | `loopback::relay_only_without_relays_cannot_bind` |
| Dial-only endpoint (retired key) | `.alpns(Vec::new())`: dialing works. | `loopback::endpoint_without_alpns_can_dial` |
| Hooks (Gate) | `Builder::hooks(gate)`, see 6. | `loopback::after_handshake_reject_reaches_the_dialer_as_application_close` |
| Test relay certificates (`RelayTls::InsecureForTests`) | `Builder::ca_tls_config(iroh::tls::CaTlsConfig::insecure_skip_verify())`; exists only with the `test-utils` feature, so a release build cannot call it. | every test in `relay.rs` |
| Tests bound to loopback only | `.clear_ip_transports().bind_addr("127.0.0.1:0")?` (avoids firewall prompts) | `tests/common/mod.rs::loopback` |

### 3.1 Transport config

```rust
QuicTransportConfig::builder()
    .keep_alive_interval(Duration::from_secs(15))
    .max_idle_timeout(Some(Duration::from_secs(40).try_into()?))   // IdleTimeout: TryFrom<Duration>
    .max_concurrent_bidi_streams(VarInt::from_u32(16))
    .max_concurrent_uni_streams(VarInt::from_u32(0))
    .build()
```

- Used by every spike endpoint, so every test runs with it. The 16-stream limit is enforced: the
  17th `open_bi()` waits until a stream ends (`loopback::seventeenth_bidi_stream_waits_for_a_free_slot`).
  Zero uni streams did not disturb the loopback, relay or tunnel tests. Hole punching between two
  real networks is what the owner's G1 run checks with this same config.
- `keep_alive_interval` is connection-wide. iroh additionally keeps every **path** alive every 5 s
  and abandons an idle path after at most 15 s; larger values are ignored or clamped **(source:
  `endpoint/quic.rs`, `default_path_keep_alive_interval`, `default_path_max_idle_timeout`)**. The
  15 s / 40 s timings themselves are not measured by a spike test.

## 4. Dialing (SPEC 3.3, 8.7 `PeerNet::dial`)

| Item | Spelling and behaviour | Test |
|---|---|---|
| Address of a friend | `EndpointAddr::from_parts(id, urls.into_iter().map(TransportAddr::Relay))`, or `EndpointAddr::new(id).with_relay_url(url)` for one relay | `relay::address_with_several_relays_reaches_the_peer_on_any_of_them` |
| **Multi-relay address** | Works: with the friend's home relay among several URLs the dial succeeds. `EndpointAddr.addrs` is a `BTreeSet`, so "home first" cannot be expressed and is not needed: before a path is selected iroh sends the first packets to every known address at once **(source: `remote_state.rs`, `handle_msg_send_datagram`)**. The SPEC fallback "dial each relay in turn" is therefore not needed. | same |
| Only a foreign relay | The dial does not succeed (a relay only forwards to its own clients). | `relay::address_with_only_a_foreign_relay_does_not_reach_the_peer` |
| Id without any address | Fails at once with `ConnectError::Connect { source: ConnectWithOptsError::NoAddress { .. }, .. }` (no address lookup is configured). | `relay::relay_only_endpoint_is_reachable_only_through_the_relay` |
| Connect | `endpoint.connect(addr, alpn).await -> Result<Connection, ConnectError>`, always inside `tokio::time::timeout(Duration::from_secs(8), …)` | every connect test; `p2p-spike dial` |
| Dialing a peer that never calls `accept()` | `connect` stays pending (until the idle timeout); there is no refusal. | `loopback::dialing_an_endpoint_that_never_calls_accept_hangs` |

## 5. Endpoint state (SPEC 3.3, 3.4, 8.7 `id`, `home_relay`, `status`)

### 5.1 Online and home relay

| Item | Spelling and behaviour | Test |
|---|---|---|
| Online | `endpoint.online().await` (no time limit of its own; wrap in `timeout(5 s)`) | `relay::relay_only_endpoint_is_reachable_only_through_the_relay` |
| Home relay | `endpoint.addr().relay_urls()` (map the URL back to its index), or `endpoint.home_relay_status().get()`: one `RelayStatus` per home relay with `url()` and `is_connected()` | same |
| `relayUnreachable` | When no relay of the map can be reached, `online()` never completes **and** `home_relay_status().get()` stays **empty** (an unreachable relay is never chosen as home relay), so there is no `last_error()` to show. Detect it by the `online()` timeout. | `relay::unreachable_relay_never_becomes_a_home_relay` |
| Watching | `Watcher` trait (`iroh::Watcher`, must be in scope): `get()`, `updated().await` | `relay::relay_reports_the_public_address_through_quic_address_discovery` (via `observe::public_address`) |

### 5.2 Direct addresses

`endpoint.addr().ip_addrs()` lists the endpoint's direct (IP) addresses; `endpoint.bound_sockets()`
lists the local UDP sockets. Both are empty for a relay-only endpoint
(`relay::relay_only_endpoint_is_reachable_only_through_the_relay`). The address **type**
(local, QAD, port-mapped) is not reachable through the public API **(source: `DirectAddrType`
is only used internally)**.

### 5.3 Relay-observed public address (QUIC address discovery)

Only with the feature `unstable-net-report` (not covered by semver):

```rust
let mut reports = endpoint.net_report();                 // Watcher<Value = Option<NetReport>>
let report: Option<NetReport> = reports.get();           // iroh::unstable_net_report::NetReport
report.global_v4 /* Option<SocketAddrV4> */; report.global_v6 /* Option<SocketAddrV6> */;
```

Against the in-process relay on loopback the reported address equals the endpoint's own socket
(`relay::relay_reports_the_public_address_through_quic_address_discovery`). A relay-only endpoint
has no UDP socket, so it never gets a report (seen in the smoke run, 9). The launcher does not
need this value; the spike prints it for G3.

## 6. Admission gate (SPEC 3.5, `EndpointHooks::after_handshake`)

```rust
#[derive(Debug)]
struct Gate { /* … */ }                                  // EndpointHooks: Debug + Send + Sync
impl EndpointHooks for Gate {
    async fn after_handshake<'a>(&'a self, conn: &'a Connection) -> AfterHandshakeOutcome {
        if conn.side() == Side::Client { return AfterHandshakeOutcome::Accept; }   // outgoing
        // conn.remote_id(): authenticated EndpointId; conn.alpn(): negotiated ALPN
        AfterHandshakeOutcome::Reject { error_code: VarInt::from_u32(2), reason: b"".to_vec() }
    }
}
```

| Behaviour | Test |
|---|---|
| The hook runs for **incoming and outgoing** connections. A gate that must not touch outgoing connections returns `Accept` for `Side::Client`. | `loopback::hook_on_the_dialer_also_sees_outgoing_connections` |
| `Reject { error_code, reason }`: on the dialer `connect()` **succeeds**, then `conn.closed().await == ConnectionError::ApplicationClosed(ApplicationClose { error_code, reason })`. On the listener `incoming.await` returns an error, so the accept loop never sees the connection. | `loopback::after_handshake_reject_reaches_the_dialer_as_application_close` |
| `Admission::Drop` ("code 0, no frame"): not possible after the handshake. `Reject { error_code: 0, reason: empty }` still sends a QUIC CONNECTION_CLOSE; the dialer sees `ApplicationClosed { error_code: 0, reason: "" }`, which is identical to a `NORMAL` close. No application frame is sent. | `loopback::silent_drop_still_sends_a_close_with_code_zero` |
| Pre-handshake drop: `endpoint.accept().await` yields an `Incoming`; `incoming.ignore()` sends nothing at all, and the dialer's `connect` stays pending (it never learns why). The handshake (and the hook) only runs when the `Incoming` is awaited, so "handshakes in flight" = `Incoming`s being awaited; count them in the accept loop. | `loopback::ignored_incoming_leaves_the_dialer_without_any_answer` |
| An endpoint that accepts with an empty ALPN list fails the handshake at once. | `loopback::accepting_on_an_endpoint_without_alpns_fails_the_handshake` |

## 7. Connections and streams (SPEC 3.6, 5, 6.3, 8.7 `PeerConn`)

| Item | Spelling and behaviour | Test |
|---|---|---|
| Accept | `while let Some(incoming) = endpoint.accept().await { let conn = incoming.await?; }` | `tests/common::serve_one`, `loopback::connected_pair` |
| Remote id, ALPN | `conn.remote_id()` (authenticated `EndpointId`), `conn.alpn()` (`&[u8]`) | `loopback::accepted_connection_knows_the_remote_id_and_alpn` |
| Streams | `conn.open_bi().await? -> (SendStream, RecvStream)`, `conn.accept_bi().await?`. The peer sees a new stream only after the first byte is written **(source: `Endpoint` docs)**, so the opener writes its open frame at once. | `loopback::echo_runs_over_a_direct_loopback_path` |
| Stream IO | `SendStream::write_all`, `finish()`; `RecvStream::read_exact`, `read_to_end(limit)`; both implement tokio `AsyncWrite`/`AsyncRead` | `loopback::upload_is_confirmed_byte_for_byte` |
| `bridge` (6.3) | `tcp.set_nodelay(true)?; let mut quic = tokio::io::join(recv, send); tokio::io::copy_bidirectional(&mut tcp, &mut quic).await` | `loopback::tunnel_reaches_a_local_tcp_server` |
| Stream reset (`PROTOCOL`) | `send.reset(VarInt::from_u32(code))`; the peer's read returns `ReadError::Reset(code)` (`read_to_end`: `ReadToEndError::Read(ReadError::Reset(code))`) | `loopback::unknown_stream_mode_is_reset_with_its_code` |
| Close with a code | `conn.close(VarInt::from_u32(code), reason)`; the peer's `conn.closed().await` returns `ApplicationClosed(ApplicationClose { error_code, reason })` | `loopback::closing_the_connection_before_the_endpoint_keeps_its_code` |
| `SHUTDOWN` on exit | `endpoint.close().await` alone closes all open connections with **code 0**. To send `SHUTDOWN` (6), close every connection with code 6 first, then close the endpoint. | `loopback::endpoint_close_alone_ends_open_connections_with_code_zero`, `loopback::closing_the_connection_before_the_endpoint_keeps_its_code` |
| Endpoint lifetime | Dropping the last `Endpoint` clone ends its connections locally (`ConnectionError::LocallyClosed`), even while a `Connection` is still held. Keep the endpoint alive as long as its connections. | `loopback::dropping_the_endpoint_closes_its_connections_locally` |
| Path (`PathKind`) | `conn.paths().iter().find(|p| p.is_selected())`, then `p.is_ip()` (Direct) / `p.is_relay()` (Relay), `p.remote_addr()` (`TransportAddr::Ip` or `TransportAddr::Relay`) | `loopback::echo_runs_over_a_direct_loopback_path` (Direct), `relay::relay_only_endpoint_is_reachable_only_through_the_relay` (Relay) |
| RTT | `p.rtt()` of the selected path | `p2p-spike dial` |
| Path changes | `conn.path_events()` (`'static` stream of `PathEvent::Selected { .. }`, `Opened`, `Closed`, `Lagged`; all `#[non_exhaustive]`), or `conn.paths_stream()` (snapshots, borrows `conn`) | `p2p-spike dial` and `listen` (smoke run, 9) |

## 8. In-process test relay (SPEC 3.7)

```rust
let (relay_map, relay_url, _server) = iroh::test_utils::run_relay_server().await?;   // keep _server alive
let endpoint = Endpoint::builder(presets::Minimal)
    .relay_mode(RelayMode::Custom(relay_map))
    .ca_tls_config(iroh::tls::CaTlsConfig::insecure_skip_verify())
    /* … */
    .bind().await?;
```

- The server listens on `127.0.0.1` with a self-signed certificate and QUIC address discovery on a
  random port; the returned map already carries that port. To build a `RelayEntry` (index 0,
  operator `Pumpkin`) take `relay_url` and
  `relay_map.get(&relay_url).unwrap().quic.as_ref().map(|quic| quic.port)`.
- Works for relay-only endpoints, several relays in one process, and loopback QAD
  (all tests in `relay.rs`, about 5 s in total).

## 9. Smoke run of the CLI (not G1 data)

2026-10-03, developer PC, `listen` and `dial` on the **same** PC, both `--relay-only`, through n0's
`euc1-1` relay: relay connected after about 1.1 s, connect 54 ms, echo p50 43.9 ms / p99 47.8 ms,
upload 2.0 MiB/s, and a TCP round trip through `--forward`/`--local` worked. This only shows that
the CLI works against real relays; G1 needs two PCs in different networks (README).

## 10. Where iroh differs from the spec (input for R1 and SPEC write-back)

1. **`Drop` cannot be frameless** (3.5). After the handshake every rejection sends a QUIC close;
   code 0 with an empty reason looks exactly like `NORMAL`. Truly silent is only `Incoming::ignore()`
   before the handshake, when the peer id is not known yet.
2. **`after_handshake` also runs for outgoing connections** (3.5 "Outgoing connections are not
   gated"): the gate must accept `Side::Client`.
3. **`Endpoint::close` sends code 0**, not `SHUTDOWN`: close each connection with 6 first.
4. **No relay reachable** shows only as an `online()` timeout; `home_relay_status()` stays empty.
5. **Never leave an endpoint without an accept loop**: dialers of an endpoint that never calls
   `accept()` hang instead of being refused (relevant for hello and retired endpoints).
6. **The relay-observed public address** needs `unstable-net-report`; the launcher's default
   features do not expose it.
7. **Per-path keep-alive stays at 5 s** whatever the connection-wide 15 s keep-alive says (source).
