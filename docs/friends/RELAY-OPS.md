# Pumpkin Friends relay operations

Last updated: 2026-10-06.

This runbook describes the deployment in [infra/relay](../../infra/relay/). The source's production `RELAY_MAP` is currently empty; official tagged packages separately enable `beta-relays`, as described in [release packaging](../../CONTRIBUTING.md#release-packaging). An empty own-relay map does not mean every published user must deploy a relay. This runbook does not establish a verified live Pumpkin-operated service. Data/legal requirements are in [PRIVACY.md](PRIVACY.md).

## Responsibilities and configuration

The relay forwards end-to-end encrypted packets and provides QUIC address discovery. It is an open general-purpose iroh relay, not an authenticated Minecraft-account service; anyone knowing its URL can use it. It cannot inspect world traffic or recover a user's identity from nonexistent connection logs.

| File | Purpose |
| --- | --- |
| `infra/relay/relay.toml` | TLS/ACME, discovery, bandwidth and aggregate metrics configuration |
| `infra/relay/Dockerfile` | Pinned `iroh-relay` server build, unprivileged runtime user |
| `infra/relay/docker-compose.yml` | Ports, certificate volume, capabilities, healthcheck, no stored logs |
| `infra/relay/docker-compose.debug.yml` | Temporary warning output with a capped log |
| `src-tauri/src/services/p2p/relays.rs` | Compiled endpoint map; URL/index rollout through launcher updates |

iroh-relay is pinned to 1.3.0 by the deployment. Keep it compatible with the launcher's locked iroh version. The Dockerfile builds the crate with `--locked --features server`; no unverified third-party container image is assumed.

## Ports and limits

| Port | Protocol | Purpose | Exposure |
| --- | --- | --- | --- |
| 80 | TCP | `/generate_204` captive-portal probe | Optional public access |
| 443 | TCP | Relay HTTPS/WSS and ACME TLS-ALPN-01 | Public |
| 7842 | UDP | QUIC address discovery | Public |
| 9090 | TCP | Prometheus metrics | Host loopback only |

ACME uses **443**, not HTTP port 80. `/healthz` lives on the public HTTPS listener and exposes version/status; it is not independently bound to localhost. Metrics have a separate bind and Compose publishes them only on `127.0.0.1:9090`.

`limits.client.rx` provides backpressure at 4 MiB/s sustained and 8 MiB burst per client. The `accept_conn_limit`/`accept_conn_burst` options in iroh-relay 1.3.0 are not implemented and do not enforce connection-per-IP limits. Use provider DDoS protection or host/kernel controls without logging if needed; do not advertise unused options as protection.

An initial sizing assumption is 2 vCPU, 2 GB RAM, 20 GB disk and a 1 Gbit/s port with adequate included transfer, in the EU. It is not a measured capacity guarantee. One hundred clients at the configured individual cap exceed the network port's capacity. Budget with:

```text
monthly relayed GB = sessions × average hours × 3600
                     × average combined KB/s / 1,000,000
```

Direct-session traffic does not consume relay forwarding bandwidth. Real relay share and sustainable throughput are unknown until observed in deployment. Set provider transfer/billing alerts; use current provider prices, not old proposal estimates.

## Host and first deployment

Use a patched Linux host with Docker Engine/Compose, NTP, an EU hosting arrangement and the required processor agreement. Allow 80/tcp, 443/tcp and 7842/udp publicly; restrict SSH to operator addresses and deny other inbound ports. Do not expose metrics.

Disable firewall connection logging and do not collect flow/conntrack logs. Provider-level retention must be established separately; container logging settings cannot control a provider's network logs.

The supplied relay binds IPv4. Docker IPv6 discovery/source-address behavior has not been established here, so publish an A record unless IPv6 is deliberately configured and supported. The container's low-port sysctl, non-root volume ownership and ACME behavior are deployment prerequisites, not proof from a Compose syntax check.

1. Obtain the primary relay domain, an operator mailbox and optionally a fallback domain at another registrar/TLD. Enable renewal/lock and applicable DNSSEC. A fallback name becomes usable by launchers only after it is appended to the compiled map in an update.
2. Point `relay-eu1.<relay-domain>` at the host. Replace domain/mailbox placeholders in `relay.toml`; use the configured version arguments in Compose.
3. Build from `infra/relay/` with `docker compose build`.
4. For initial failure diagnosis, start with `docker compose -f docker-compose.yml -f docker-compose.debug.yml up -d` and inspect `docker compose logs`. DNS, occupied ports, ACME and unsupported sysctl settings can prevent startup.
5. End diagnostic logging with `docker compose up -d --force-recreate`. Certificates persist in `relay-data`; the old container log is removed.
6. Configure the actual URL as Pumpkin index 0 in both production and debug/beta maps. Use `quic_port: Some(7842)`. Existing indexes are never renumbered/reused; retired entries leave gaps. Publish the actual operator/privacy/abuse contacts with the rollout.

Do not send a placeholder domain to users or claim a Pumpkin-operated relay is live merely because its deployment files exist. The production map and the official build's beta-relay feature are separate configuration paths.

## Service endpoints and diagnostics

`https://relay-eu1.<relay-domain>/generate_204` should return 204; `/healthz` reports server status/version. `http://127.0.0.1:9090/metrics` is available on the host and must remain inaccessible from the public network.

Encrypted forwarding and UDP discovery are different paths. Healthy HTTPS alone does not prove QAD works. The [P2P tool](../../tools/p2p-spike/README.md) can report relay reachability, relay-observed public address and throughput. `none reported` for the public address can indicate blocked UDP 7842 or NAT/container behavior; a completed direct path does not prove relay-only forwarding capacity.

Useful aggregate metrics include `relayserver_accepts`, `relayserver_disconnects`, `relayserver_bytes_sent`, `relayserver_bytes_recv`, `relayserver_send_packets_dropped`, `relayserver_conns_rx_ratelimited_total`, `relayserver_qad_connections`, `relayserver_qad_connections_errored` and `relayserver_unique_client_keys`. Watch rate-limited/dropped traffic during ordinary play before raising limits. The daily unique-client set is held in process memory, cleared at UTC midnight/restart and contains IDs, not IPs.

## Logging and monitoring

Standing deployment stores no relay output: Compose uses `logging: driver: none` and `RUST_LOG=error`. Error/warning spans can contain full client IP addresses; iroh-relay has no truncation option. Never mistake a low log level for IP redaction.

For a temporary diagnostic session:

1. Start with the debug Compose override; it retains one capped 1 MiB warning log.
2. Inspect locally. Do not paste client IPs or copy raw logs into public reports.
3. Within 24 hours, recreate the standing container without the override. Record diagnostic start/end times in operational records, not users' addresses.

Do not set server logging to info/debug for routine operation. Configure external `/healthz` monitoring with an alarm after repeated failures (for example three failed minute checks), and establish that monitor's own retention. Keep metrics access through localhost/SSH.

## Updates, rollback and backup

When launcher iroh changes, choose a compatible relay release and change the Docker build argument and image tag together. Deploy at a quiet time: direct paths can continue, relay-dependent sessions may drop and reconnect. For protocol-relevant changes, deploy the relay before rolling out the launcher, but do not assume old-client compatibility without evidence.

Update with `docker compose build && docker compose up -d`. Preserve the prior tagged image. Rollback restores the prior version/tag in Compose and runs `docker compose up -d`; TLS data stays in the named volume.

`relay-data` holds the ACME account and certificates, not Friends user content. Back it up after initial issuance; protect it as credential material. A backup command from `infra/relay/` is:

```sh
docker run --rm -v pumpkin-relay_relay-data:/d -v "$PWD:/b" debian:bookworm-slim tar czf /b/relay-data.tgz -C /d .
```

For a lost host, provision the same network/configuration policy and restore the protected
archive into the named volume **before starting the relay**. From `infra/relay/` on the
replacement host, with `relay-data.tgz` in that directory and no relay container writing to
the volume:

```sh
docker volume create pumpkin-relay_relay-data
docker run --rm -v pumpkin-relay_relay-data:/d -v "$PWD:/b:ro" debian:bookworm-slim tar xzf /b/relay-data.tgz -C /d
docker compose up -d --build
```

These names follow Compose's `name: pumpkin-relay` and `relay-data` volume; use an empty
replacement volume, not a merge into an active one. Preserve the archive's file ownership
for the unprivileged server. Alternatively obtain a fresh certificate, subject to ACME
limits, then move DNS. Losing certificates does not lose friend records: they are on the clients.

## Outage and abuse handling

When relay reachability is lost, launchers show `relayUnreachable` and friends may appear offline. Existing direct paths can continue; new connection discovery still depends on configured relays. Inspect container status, DNS, certificate validity, firewall/UDP path and temporary diagnostics, then rollback or restore the host. If a domain is lost/blocked, a launcher update must append a functioning fallback URL under a new stable index.

An abuse report needs the endpoint's full 64-character PeerId. The displayed fingerprint is too short. Without an ID the relay has no connection log to search. To deny a known endpoint, replace `access = "everyone"` in `relay.toml` with `access.denylist = ["<64 hex PeerId>"]` and restart the service. A new endpoint ID is cheap, so this is friction, not an account ban.

Bandwidth abuse can justify lowering `limits.client.rx` or applying nonlogging host/provider controls. Respond to lawful requests with the actual retained-data policy and involve the operator; never promise content disclosure from an encrypted, logless relay. Maintain a real monitored abuse mailbox and the privacy contact named in the published notice.
