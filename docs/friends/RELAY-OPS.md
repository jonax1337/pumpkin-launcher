# Pumpkin Friends relay: operations

Work package D1. This is the runbook for our own `iroh-relay` (SPEC 3.2, 12.5, OD-2). The
legal text (GDPR, logs, abuse contact) is in [`PRIVACY.md`](PRIVACY.md). The deployable files are
in [`infra/relay/`](../../infra/relay/). **Nothing here is deployed yet, and no domain is
registered.** The owner does both (section 7) and records the G3 result in `VERIFICATION.md`.

## 1. What the relay is, and is not

- It forwards encrypted QUIC datagrams between launchers that cannot reach each other directly,
  and it tells a launcher its public address (QUIC address discovery, "QAD", UDP 7842) so that hole
  punching works. It never sees content (SPEC 12.1).
- It is an **open relay**: a launcher has no secret that could authenticate it, so anyone who
  knows the URL can use it. The limits in section 5 and the abuse steps in section 13 are the
  controls.
- The launcher only ever dials URLs from its compiled-in `RELAY_MAP`. A peer can send an index, never
  a URL (SPEC 3.2). A release build lists `https://relay-eu1.<relay-domain>/` as index 0, with
  `quic_port: Some(7842)`. I1 sets the real domain once this relay is deployed.

## 2. What was verified, and where this differs from SPEC 12.5

Source of truth: the `iroh-relay` 1.3.0 crate (`src/main.rs`, `src/server.rs`,
`src/server/streams.rs`, `src/server/http_server.rs`), read from the cargo registry. In addition the
binary was built from that crate (`cargo install iroh-relay --version =1.3.0 --locked --features
server`) and started on this PC with `infra/relay/relay.toml` (ports shifted to 18080, 18443, 17842
and 19090, ACME pointed at a dead URL). It parsed every option, bound TCP 18443/18080 and UDP 17842,
answered `/generate_204` with 204 on the HTTP port and `/metrics` on the metrics port.

| Topic | Spec 12.5 said | iroh-relay 1.3.0 does | What we do |
|---|---|---|---|
| ACME | TCP 80 (ACME) | `tokio-rustls-acme` uses the **TLS-ALPN-01** challenge, which runs on **443**. Port 80 is not used by ACME. | Port 80 stays open: the server always binds an HTTP port, and with TLS it serves only `/generate_204` (captive-portal probe). Closing it is possible and harmless for certificates. |
| healthz | "Metrics and healthz bound to localhost" | Metrics have their own bind address (`metrics_bind_addr`). `/healthz` has none: it is a handler on the **public HTTPS port** and returns `{"status":"ok","version":"1.3.0","git_hash":"unknown"}`. | Metrics are localhost-only (compose publishes `127.0.0.1:9090`). `/healthz` stays public: it only discloses the version. The container healthcheck uses the local metrics port instead. |
| Connection-rate limit | "Per-client rate and bandwidth limits configured" | `limits.accept_conn_limit` and `accept_conn_burst` exist in the config, but the source says "Not currently implemented, setting this has no effect". Only `limits.client.rx` (bytes per second per client, back pressure, drops nothing) works. | We set only `limits.client.rx`. A connections-per-IP limit has to come from the host or the provider (section 6). It is not part of iroh-relay. |
| Logs | no access logs; error logs without IPs or with truncated IPs, at most 24 h | No access log at the default level. But the connection spans carry the peer address (`conn{peer=...}` in `http_server.rs`, `qad-conn{remote_addr=...}` in `quic.rs`), so an error or warning logged inside such a span prints the client IP. There is no option to truncate it. | The standing deployment stores **no** relay log at all (`logging: driver: none`, `RUST_LOG=error`). A temporary debug override keeps one 1 MiB file with IPs for at most 24 h (section 11). |
| Image | "docker compose for iroh-relay" | `iroh-relay` is a crate with a `server` feature. A Docker image published by n0 is **not verified** here. | `infra/relay/Dockerfile` builds the pinned crate version from crates.io. |

Not verified (no Docker daemon was running on the development PC, so the container was not built or
started): the Docker image build, the non-root user binding ports 80 and 443 through the
`net.ipv4.ip_unprivileged_port_start` sysctl, the named volume's ownership, and the healthcheck inside
the container. `docker compose config` validates for both compose files. The first deployment step
(section 7, step 6) therefore uses the debug override to see start-up errors. Also unverified: IPv6
(the config binds IPv4 only, see section 6), the sizing numbers and prices in section 4, and that
the rate-limit values suit real Minecraft traffic.

## 3. Files

| File | Purpose |
|---|---|
| `infra/relay/relay.toml` | The `iroh-relay` configuration: TLS via Let's Encrypt, QAD on UDP 7842, per-client rate limit, metrics address, `access = "everyone"`. |
| `infra/relay/Dockerfile` | Builds `iroh-relay` at `IROH_RELAY_VERSION` (default `1.3.0`) with `--locked --features server`, runs it as an unprivileged user. |
| `infra/relay/docker-compose.yml` | The service: ports, volume, no logging, dropped capabilities, healthcheck. |
| `infra/relay/docker-compose.debug.yml` | Temporary override with warnings and a size-capped log (section 11). |

## 4. Sizing, costs and ports

### Ports (all inbound; outbound is unrestricted)
| Port | Protocol | Use | Public |
|---|---|---|---|
| 80 | TCP | `/generate_204` captive-portal probe (not ACME, see section 2) | yes (optional) |
| 443 | TCP | relay traffic over HTTPS/WSS, ACME TLS-ALPN-01 | yes |
| 7842 | **UDP** | QUIC address discovery, TLS | yes |
| 9090 | TCP | metrics | **no**, published on `127.0.0.1` only |

### Sizing (starting point, unverified)
- The relay is network-bound, not CPU-bound. Start with 2 vCPU, 2 GB RAM, 20 GB disk and a
  1 Gbit/s port with at least 10 TB monthly traffic included, in an EU data centre (one relay,
  `relay-eu1`).
- Memory: the key cache defaults to 1,048,576 entries, about 56 MB (`defaults.rs`). That is fine, and
  the config leaves it alone.
- Traffic: only sessions that fail to hole-punch use the relay. The share of such sessions is
  **unknown until the owner's G1 runs and a beta** (the G1 table records path `direct` or `relay`).
  Budget with this formula and re-do it with real numbers: relayed GB per month = relayed
  sessions per month x average session hours x 3600 x average KB/s per session (both directions
  together) / 1,000,000. Example with assumed values: 500 relayed sessions x 2 h x 3600 x 100 KB/s
  / 1,000,000 = 360 GB per month.
- Rate limit: `limits.client.rx` is 4 MiB/s sustained with an 8 MiB burst per client. At that cap 100
  clients saturating at once need about 400 MiB/s, far above a 1 Gbit/s port, so the port is the real
  limit. The values are a first guess. Check them with the spike's `--throughput` run (G3) and the
  metrics `relayserver_bytes_rx_ratelimited_total` and `relayserver_conns_rx_ratelimited_total`: if
  many connections are limited during normal play, raise `bytes_per_second`.

### Costs (indicative, check the provider's price list when ordering)
| Item | Estimate |
|---|---|
| VPS, EU, 2 vCPU / 2 to 4 GB, traffic included | about 4 to 8 EUR per month |
| Primary domain (renewal) | about 10 to 15 EUR per year |
| Fallback domain (renewal), another registrar and TLD | about 10 to 15 EUR per year |
| TLS certificate | free (Let's Encrypt) |
| Excess traffic | depends on the provider, set a billing alert |

## 5. Limits that exist

| Layer | Limit | Where |
|---|---|---|
| Relay, per client | 4 MiB/s sustained, 8 MiB burst, back pressure | `relay.toml`, `[limits.client.rx]` |
| Relay, new connections | none in iroh-relay 1.3.0 (option exists, no effect) | section 2 |
| Launcher | at most 8 handshakes in flight, rate limits of SPEC 12.4 | SPEC 3.5, 12.4 |
| Host or provider | connections per source IP, DDoS protection | section 6 |

## 6. Host setup

- A plain Linux host with Docker Engine and the Compose plugin. Keep it patched
  (unattended security updates).
- Firewall: allow 80/tcp, 443/tcp, 7842/udp and SSH from the owner's addresses only. Deny the rest.
  **Turn firewall logging off** (for `ufw`: `ufw logging off`) and do not run tools that log
  connections (fail2ban on these ports, netflow exporters, conntrack logging). They would store client
  IPs and defeat the log policy (`PRIVACY.md`).
- Per-IP connection limits are not available inside iroh-relay (section 2). If abuse needs them, use
  the provider's DDoS protection or in-kernel rate limits **without logging**. This was not tested.
- IPv6: `relay.toml` binds `0.0.0.0` (IPv4). Docker's default bridge network has no IPv6, and
  binding `[::]` there was not verified. Publish only an `A` record for now. Adding IPv6 means enabling
  it in the Docker daemon and in the compose network, and testing QAD over it.
- Time: keep NTP on (certificate validity).
- Hosting contract: EU region, and a data processing agreement (AVV, Art. 28 GDPR) with the
  provider, see `PRIVACY.md`.

## 7. First deployment (owner)

1. **Domains.** Register the primary domain `<relay-domain>` and a **fallback domain** at a different
   registrar and under a different TLD, with auto-renew on and a registrar lock. Enable DNSSEC if the
   registrar offers it. The fallback domain is not in the launcher until a launcher update adds it
   to `RELAY_MAP` as a new, appended index (SPEC 3.2: indexes are stable, entries are only
   appended). It can already be served by the same relay: list both names in `hostname` (see the comment
   in `relay.toml`) and point both at the server.
2. **DNS.** `relay-eu1.<relay-domain>` as an `A` record to the server (and the fallback name likewise).
   Low TTL (300 s) for the first week.
3. **Server and firewall** as in section 6.
4. **Configure.** Copy `infra/relay/` to the server. In `relay.toml` replace `<relay-domain>` and
   `<ops-mailbox>`. In `docker-compose.yml` leave the version arguments as they are.
5. **Build.** `docker compose build` (compiles the crate, a few minutes).
6. **First start with logs**, because the standing setup stores none:
   `docker compose -f docker-compose.yml -f docker-compose.debug.yml up -d`, then
   `docker compose logs`. The certificate is ordered by the relay itself (ACME), and a failed order
   shows up as an `acme` error in this log. If the container exits at once, the log says why (typical: DNS not yet
   pointing at the server, a port already in use, or the sysctl in the compose file not accepted by the
   host).
7. **Switch to the standing setup** (this also deletes the debug log):
   `docker compose up -d --force-recreate`. The certificate stays, it lives in the `relay-data` volume.
8. **Check** (section 8), then hand the domain to I1 for `RELAY_MAP`.

## 8. Acceptance check (G3 input)

1. From any machine: `curl -i https://relay-eu1.<relay-domain>/generate_204` returns `204`, and
   `curl https://relay-eu1.<relay-domain>/healthz` returns `{"status":"ok","version":"1.3.0",...}`.
2. On the server: `curl -s http://127.0.0.1:9090/metrics | head` answers, and
   `curl -m 3 http://<server-public-ip>:9090/metrics` from outside does **not**.
3. With the R0b spike (`tools/p2p-spike/README.md`, section 10), on both PCs of a G1 pair:
   ```
   .\p2p-spike.exe listen --relay https://relay-eu1.<relay-domain>/
   .\p2p-spike.exe dial <id> --relay https://relay-eu1.<relay-domain>/ --echo 1000
   ```
   Required output: `Relay connected after ... ms` (so `online()` completed) and a line
   `Public address seen by the relay: <ip:port>` that equals the PC's public address (check with any
   "what is my IP" page). That line proves QAD on UDP 7842, including that Docker did not rewrite the
   source address. A relay without the UDP port shows `none reported`.
4. Dial once with `--relay-only` and run the throughput test (`--throughput 50`). Note the MiB/s, and look
   whether `relayserver_conns_rx_ratelimited_total` rose.
5. Record the rows in `docs/friends/VERIFICATION.md` (G1 table with this relay, and the G3 line).

## 9. Updates (lockstep)

The relay and the launcher use the same iroh minor version, and the spec requires lockstep updates.
`src-tauri/Cargo.lock` pins iroh 1.3.0 today.

1. When iroh in the launcher changes (`cargo update -p iroh` or a new release), look up the
   matching `iroh-relay` version on crates.io (today both are 1.3.0).
2. Change `IROH_RELAY_VERSION` and the `image:` tag in `docker-compose.yml` together.
3. `docker compose build && docker compose up -d`. The relay restarts in a few seconds and launchers
   reconnect on their own. Do it at a quiet hour: running sessions on a direct path keep
   running, sessions on the relay path drop and recover.
4. Re-run section 8, steps 1 and 3.
5. **Rollback:** keep the previous image (it keeps its tag). Set the old version back in the compose
   file and `docker compose up -d`.
6. Release order for a protocol-relevant iroh change: deploy the relay first, then ship the
   launcher. Whether an old launcher works against a newer relay was not tested, so run the spike
   of the old build against the new relay before relying on it.

## 10. Monitoring and backup

- **Uptime:** an external check on `https://relay-eu1.<relay-domain>/healthz` every minute from a
  service in the EU, alarm after 3 failures. Use a monitor that does not keep request logs of its own
  longer than needed.
- **Metrics** (Prometheus text, localhost only): `relayserver_accepts`, `relayserver_disconnects`,
  `relayserver_bytes_sent`, `relayserver_bytes_recv`, `relayserver_send_packets_dropped`,
  `relayserver_conns_rx_ratelimited_total`, `relayserver_qad_connections`,
  `relayserver_qad_connections_errored`, `relayserver_unique_client_keys`. They contain no client
  addresses. Read them with `curl` over SSH. A dashboard is out of scope for v1.
- **Certificate:** `relay-data` holds the Let's Encrypt account and certificates. Renewal is
  automatic. Back it up once after the first issue (`docker run --rm -v pumpkin-relay_relay-data:/d -v
  $PWD:/b debian:bookworm-slim tar czf /b/relay-data.tgz -C /d .`). Losing it only costs a new issue,
  which is fine unless Let's Encrypt rate limits hit. It contains no user data.
- **Restore a dead server:** new host, section 6, copy `infra/relay/`, restore the volume (or let it
  re-issue), move the DNS `A` record.

## 11. Log policy and debug sessions

Standing deployment: no relay log is stored. `logging: driver: none` in compose, `RUST_LOG=error` in the
container. The metrics are aggregate counters.

Debug session (only when something is broken):
1. `docker compose -f docker-compose.yml -f docker-compose.debug.yml up -d` (warnings only, one
   file of at most 1 MiB, which contains client IPs).
2. Read it with `docker compose logs`. Do not copy the log anywhere, and do not paste IPs into
   tickets or chats.
3. **End the session within 24 hours**: `docker compose up -d --force-recreate`. Recreating the
   container deletes its log. Write the start and end time in the ops notes (not the IPs).

Never set `RUST_LOG` to `info` or `debug` on the server: the connection-opened lines print the peer
address.

One thing is kept in memory regardless of logging: `ClientCounter` (`server/client.rs`) holds the set of
endpoint ids seen since 00:00 UTC to feed `relayserver_unique_client_keys`. It holds no IP addresses, is
cleared at UTC midnight and lost on restart. `PRIVACY.md` section 3.4 states it.

## 12. If the relay is down

Launchers show `Degraded { relayUnreachable }` and all friends appear offline (SPEC 3.4). Sessions
that are already on a direct path continue. New sessions need hole punching, which needs the relay.
Steps: check `docker compose ps`, run a debug session (section 11), check the certificate and DNS,
fall back to the previous version (section 9). If the server is lost, restore it (section 10). If the
primary domain is lost or blocked, ship a launcher update that appends the fallback domain to
`RELAY_MAP` (the fallback name must already resolve to a working relay, section 7, step 1).

## 13. Abuse handling

The abuse contact is `abuse@<relay-domain>` (a placeholder until the domain exists; the owner
creates the mailbox and keeps it monitored, and `PRIVACY.md` publishes it).

- The relay carries only ciphertext and keeps no log, so it can neither read a complaint's content
  nor look up who was connected. A report needs the **full 64-character PeerId** of the offending
  endpoint (the fingerprint shown in the UI is only its first 16 characters, which is not enough).
  If the report lacks it, answer that we cannot act without it and cannot look anyone up.
- To block an endpoint: replace `access = "everyone"` in `relay.toml` with
  `access.denylist = ["<64 hex PeerId>"]` (several ids in the list), then `docker compose up -d`
  (the config is read at start, so connected clients reconnect). This is supported by 1.3.0
  (`AccessConfig::Denylist`, tested in the crate). An id is free to create, so a block is
  only a speed bump.
- Bandwidth abuse shows as a rising `relayserver_conns_rx_ratelimited_total`. Lower
  `bytes_per_second` in `relay.toml` if needed.
- Requests from authorities: answer that no content and no connection records exist (Art. 11 GDPR
  in `PRIVACY.md`), and forward any legal request to the owner.
- The launcher UI needs a way to copy the full PeerId for a report (hand-off to F3, see
  `PRIVACY.md`, section 6).

## 14. Traceability: every item of SPEC 12.5

| 12.5 item | Where |
|---|---|
| `iroh-relay` at the launcher's iroh version, lockstep | Section 9, `Dockerfile` arg `IROH_RELAY_VERSION`, compose `image` tag |
| Ports TCP 80, TCP 443, UDP 7842 with QAD and TLS | Section 4 (80 is not ACME, section 2), `relay.toml` (`enable_quic_addr_discovery`, `[tls]`), compose `ports` |
| Per-client rate and bandwidth limits | Section 5, `relay.toml` `[limits.client.rx]`; connection-rate limit unavailable (section 2) |
| Open relay, only ciphertext, no amplification | Section 1, `relay.toml` `access` |
| No access logs; error logs without IPs or truncated, at most 24 h | Section 11, compose `logging`, `RUST_LOG`, debug override; the 1.3.0 limitation in section 2 |
| Metrics and healthz on localhost | Metrics: `metrics_bind_addr` and the compose `127.0.0.1` publish. `/healthz` cannot be bound separately (section 2) |
| Legal basis, info text and abuse contact in `PRIVACY.md` | `PRIVACY.md` section 3 (legal basis 3.3, logs and retention 3.4, abuse address 3.7) and section 7 (texts) |
| Domain auto-renewed, fallback domain registered, adding it needs a launcher update | Section 7, step 1, section 12 |
