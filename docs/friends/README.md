# Pumpkin Friends

An opt-in feature of the launcher: add friends with a one-time code, see who is online, and open a
singleplayer world (through the in-game mod or vanilla "Open to LAN") so that invited friends in other
networks can join it. It is off by default and needs a Microsoft account. It adds no chat, no voice, no
public links and no telemetry. Status: built, but not called stable until the owner's real-network
verification ([`VERIFICATION.md`](VERIFICATION.md)) is filled in.

## Architecture in ten lines

1. Transport is [iroh](https://github.com/n0-computer/iroh) 1.3: QUIC with Ed25519 ids, hole punching, and a relay as fallback. Friends are dialed by id; there is no address lookup service.
2. Identity is one permanent key in the OS keyring. A friend code (`pumpkin-` + 72 base32 characters) is single use, valid 7 days, and carries a per-code relay-only hello endpoint, not your permanent id.
3. A friendship needs mutual consent: the invitee redeems the code, the inviter accepts in the UI.
4. Presence runs over one connection per online friend (keep-alive 15 s, idle timeout 40 s).
5. Hosting: the launcher finds the game's LAN port (mod hint, log parser or manual), accepts it only if the game process owns it and it answers a server list ping, then tunnels each Minecraft TCP connection through one QUIC stream.
6. Joining: a single-owner loopback listener on the guest; the game connects with Quick Play. Only into an instance that already matches (Minecraft version, loader, non-client-only mods by sha512).
7. The relay map is compiled in with stable one-byte indexes; peers exchange indexes, never URLs. Release builds list only our relay; debug and `beta-relays` builds add n0's public relays (opt-in).
8. The in-game mod (client only) shows friends, share and guests in the pause menu. Planned ([`INGAME.md`](INGAME.md)): the launcher embeds the mod, injects it into Microsoft-account launches through loader start-up options (Fabric, NeoForge, Forge; only for verified Minecraft versions), and the player installs nothing. Today it is still a hand-installed Fabric mod for Minecraft 26.3. It talks to the launcher over loopback JSON lines only, and the launcher treats it as untrusted.
9. The webview never touches the network for friend data; Rust fetches and caches skins.
10. Hosting and joining need online mode: offline accounts are refused before launch, and the host's game refuses them at login.

## Privacy in one paragraph

On a direct connection friends see each other's public IP and local interface addresses; "Immer über
Relay verbinden" (always relay) hides them at the cost of latency. Relays see ids, IPs and who talks to
whom, never content, and our relay stores no log. Details: [`PRIVACY.md`](PRIVACY.md).

## Documents

| Document | What it is |
|---|---|
| [`SPEC.md`](SPEC.md) | The frozen design and protocol spec, the source of truth (release gates in 1.3, tests in 13) |
| [`IROH-NOTES.md`](IROH-NOTES.md) | How the iroh 1.3 API behaves, as checked by the spike's tests |
| [`DEPENDENCIES.md`](DEPENDENCIES.md) | New Rust dependencies and why |
| [`RELAY-OPS.md`](RELAY-OPS.md) | Runbook for our own relay (ports, deployment, limits, logs, abuse) |
| [`PRIVACY.md`](PRIVACY.md) | Privacy, relay legal text and the Mojang compliance checklist |
| [`OWNER-CHECKLIST.md`](OWNER-CHECKLIST.md) | Everything only the owner can do before a release, in order (German) |
| [`VERIFICATION.md`](VERIFICATION.md) | The tables for gates G1 to G5 that the owner fills in |
| [`INGAME.md`](INGAME.md) | Concept for the in-game friends menu: a mod the launcher injects by itself (launcher-only, no install). Supersedes `MOD2.md` |
| [`../../mod/README.md`](../../mod/README.md) | The current Fabric mod: build, test, `FakeLauncher`, GUI checklist (replaced by the node build of `INGAME.md`) |
| [`../../tools/p2p-spike/README.md`](../../tools/p2p-spike/README.md) | The two-PC spike for gate G1 |
| [`../../infra/relay/`](../../infra/relay/) | `relay.toml`, `Dockerfile` and compose files for the relay |
