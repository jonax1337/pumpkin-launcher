# Friends and Pumpkin Bridge privacy

Last updated: 2026-10-06.

This is the technical privacy reference for Friends, the directory and the shared in-game Bridge. It is not a completed operator-specific legal notice or legal advice. The public controller/contact details are maintained on the [website privacy page](../../website/privacy/index.html). Relay hosting/provider/contact details and Microsoft/Mojang approval scope still require operator confirmation; an undeployed relay must not be described as a live service.

## Your choices at a glance

In **0.3.0**, the **Pumpkin Bridge** setting controls a menu of in-game features that can load before Friends opt-in; this does not enable Friends networking or private actions. This reference describes 0.3.0's privacy controls and technical contracts.

Friends is optional and off by default. If you turn it on, confirmed friends see your Minecraft name, skin and online/playing status. Invited friends also see your game's version, loader and required mod list. Friends does not send them your world files or configuration files. There is no Friends chat, advertising or telemetry.

Make these choices in **Settings > Friends**:

- **Friends:** switch it off to stop Friends networking while keeping your friends. This also queues deletion of your directory registration, inbox and owned blocks; remote deletion depends on connectivity and has [retention exceptions](#retention-and-deletion). To delete local friends, requests, codes and blocks and replace your identity, use **Danger zone > Reset identity and delete all friends > Reset**. Reset cannot be undone.
- **Always connect through a relay:** hide your public and local IP addresses from peers. A relay forwards encrypted traffic; its operator still sees connection metadata (IP addresses, connected endpoints and timing), not content. Direct connections reveal those addresses to peers. Changing this setting ends active sharing/joining.
- **Findable by Minecraft name:** allow anyone who knows your exact name to send a request through the directory. Turn it off to request deletion of your registration, inbox and owned blocks. Remote deletion waits until the service can be reached; outgoing requests and abuse-prevention history keep their normal expiry. See [Retention and deletion](#retention-and-deletion) for the full limits.
- **Pumpkin Bridge / Actions in the game:** control the in-game integration and whether it must ask before taking Friends actions. **Allow** also allows every mod in that game process to use those actions; it is not protection against malicious mods. Use only mods you trust.

You can **Block** a person from their friend menu and manage blocked people in **Settings > Friends > Blocked**. Open **Settings > About > Privacy** for the launcher's service notice. For data-rights enquiries, use the controller contact on the [website privacy page](../../website/privacy/index.html); directory enquiries need your Minecraft UUID.

Jump to: [Before opt-in](#what-happens-before-opt-in) · [Data map](#data-map) · [Address visibility](#address-visibility-and-lan-exposure) · [Relays](#relay-processing-and-operations) · [Directory and Mojang](#directory-and-mojang) · [Retention and deletion](#retention-and-deletion) · [Local-mod risks](#local-mods-and-residual-security-risks).

## What happens before opt-in

Friends is off by default. Before opt-in the launcher creates no Friends UDP endpoint, relay connection or Friends-related Mojang request. The independent Pumpkin Bridge listener may already bind an IPv4 loopback TCP port and the bundled client mod may load in supported Microsoft-account launches, subject to its global/per-instance switches. This is not consent to Friends networking.

The Pumpkin logo button opens the menu of in-game features. Private Friends data and actions are withheld until opt-in. Known-UUID heads, when displayed, can use Minecraft's native Mojang profile/skin services. Friends without a UUID use local default heads, not a display-name lookup.

There is no Friends telemetry, chat, voice, public player listing, partial-name search, tracking or advertising. World tunnels are encrypted between launchers; relays cannot read their content.

## Data map

| Data | Recipient | Storage/retention |
| --- | --- | --- |
| Account-derived Minecraft name/UUID, local alias | Friends receive the announced name/UUID; aliases stay local | Local Friends records; normal peer profiles remain self-asserted |
| Online/playing state | Confirmed friends | Live state in memory; local `lastSeen` can persist |
| Invite, version/loader and required mod manifest | Selected invited friends | Live session state; no world/config/file transfer |
| Permanent private Friends identity | OS keyring; not relays/peers | Until explicit identity change/reset; old key temporarily supports pending notifications |
| Friend code | Anyone the user gives it to | Inviter stores hash/derivation data; plaintext shown once, seven-day single-use lifetime |
| Pending request secret | Recipient/holder, and directory for name requests | Local retry record or directory letter, at most fourteen days |
| Public/local interface addresses | Direct peers | Connection metadata, not a Pumpkin connection log |
| IP/port, endpoint IDs, counterpart and timing | Relay while routing; Cloudflare while handling directory requests | Relay memory, provider-specific metadata processing; see below |
| Friend/sender UUID | Mojang sessionserver and native game profile services | Skin cache on the PC; Mojang sees requester IP and requested UUID |
| Directory registration | Cloudflare Worker/D1 | UUID plus first/last refresh, until opt-out or thirty days without refresh |
| Directory letter | Worker/D1 and recipient | Sender/recipient UUIDs, bound peer ID, signed `displayName`, code parts, times and signature, until answer/retract/block or fourteen days |
| Directory block/send log | Worker/D1 | Blocks until removal/opt-out; send history seven days |
| Public player certificate/login signatures | Worker during authentication | Processed, not stored by the Worker; launcher memory cache only |
| Directory session token | Launcher and Worker verifier | Stateless at Worker, launcher memory, at most six hours and never beyond certificate expiry |
| Friends state delivered to game | Bridge and any other mod in that JVM | Game memory; already delivered bytes cannot be recalled |

Local Friends data lives in separate files under `<app-data>/friends/`, not a single `friends.json`. Presence, host/join sessions and invitations are not persisted there. Tokens, private keys, codes, secrets and peer IPs must not enter launcher logs. Exact record fields: `src-tauri/src/services/friends/{records,config}.rs`.

## Address visibility and LAN exposure

On a direct connection both peers learn public IP and local interface addresses, including VPN/container interfaces. Code hello endpoints are relay-only, so a code holder cannot get the inviter's interface addresses from the hello connection. The invitee's main endpoint can reveal its addresses to the code owner unless **Always connect through a relay** is enabled.

Always-relay hides peer addresses from other peers, with additional latency. Relay operators still see who connects and which endpoint forwards to which endpoint, not contents. Anyone who previously learned a permanent ID can attempt to determine whether that endpoint is online; removal does not erase knowledge of the ID.

Opening a world to LAN binds Minecraft's game port on local interfaces, as in Vanilla. The launcher tunnel does not make that LAN port private. Local devices/router forwards and firewall profiles still matter; Minecraft online-mode authentication remains essential. Stopping a tunnel before Minecraft 26.2 leaves the LAN world open until the player leaves it.

## Relay processing and operations

The source's own-production relay map is currently empty. Official tagged release builds enable `beta-relays`, which includes n0's `use1-1`, `usw1-1`, `euc1-1` and `aps1-1` hosts under `relay.n0.iroh.link`, with explicit separate consent; debug builds also include them. The official release workflow configures a directory address, unlike ordinary source builds without configuration. These build settings do not establish service uptime or reliable cross-network play. n0 is a separate controller. Its current operator details, server locations, retention and transfer terms must be confirmed before describing a beta's legal basis; third-country transfers cannot be inferred away.

The own-relay deployment is specified in [RELAY-OPS.md](RELAY-OPS.md). It processes IP/port and endpoint IDs for encrypted forwarding and UDP address discovery. It receives no Minecraft access tokens or private Friends keys. It is a general-purpose relay, not a user-account service; the main endpoint ID differs from a code's ephemeral endpoint ID.

The intended standing deployment discards relay output (`logging: driver: none`, `RUST_LOG=error`), publishes only aggregate metrics on localhost and disables host firewall/flow logging. This is a configuration policy, not a claim that a running provider has been audited.

| Surface | Policy |
| --- | --- |
| Relay access/error output | No stored standing log |
| Temporary diagnostics | One size-capped 1 MiB log, can contain full client IPs, deleted by container recreation within 24 hours |
| Metrics | Aggregate counters, no per-client IP/ID labels; local-only port |
| Relay memory | Active connection metadata; set of endpoint IDs seen that UTC day for unique-client counts, cleared at midnight/restart |
| Certificate volume | ACME account/certificates, no Friends content |
| Host/provider logs | Operator must establish actual provider retention; no invented zero-retention guarantee |

The relay purpose is connectivity requested by the user. The proposed legal basis is GDPR Art. 6(1)(b), with Art. 6(1)(f) for operation/security as appropriate; the operator must confirm applicability. Own EU hosting requires processor/provider details and an Art. 28 agreement. Relay notice/contact details must identify the actual operator, address, privacy and monitored abuse contact before launch.

Access/erasure requests cannot normally retrieve connection records that are not retained (Art. 11). Rights of access, correction, erasure, restriction, portability, objection and supervisory-authority complaint still apply. An abuse report needs the full 64-character peer ID; the sixteen-character fingerprint is insufficient, and the relay cannot recover an ID from nonexistent logs.

## Directory and Mojang

The directory is an exact-name opt-in mailbox on Cloudflare Workers/D1. D1 is configured for EU jurisdiction; Worker execution and transient IP/rate-limit processing occur at Cloudflare's worldwide edge. `[observability] enabled=false` disables Worker request logging, not every provider-level analytic/restore facility. Cloudflare processor terms must be accepted by the operator.

The directory makes no Mojang subrequests. Certificate authentication sends no account name in its session body/token and does not use the former `from_name` database column. **Letters nevertheless process and store a signed `displayName` field.** Saying that the directory handles or stores no names at all is inaccurate. The recipient separately looks up the sender's current canonical Minecraft name.

Your launcher contacts Mojang from your IP:

| Endpoint | Purpose |
| --- | --- |
| `POST api.minecraftservices.com/player/certificates` | Fetch account certificate; cache until refresh/expiry, memory-only |
| `GET api.minecraftservices.com/player/attributes` | Check multiplayer/friends restrictions at directory authentication |
| `GET api.minecraftservices.com/minecraft/profile/lookup/name/{name}` | Resolve exact recipient name to UUID |
| `GET sessionserver.mojang.com/session/minecraft/profile/{uuid}` | Resolve validated sender name and friend profiles/skins |
| `POST sessionserver.mojang.com/session/minecraft/join`, `GET .../hasJoined` | Mutual account proof when accepting a name request |
| `textures.minecraft.net` | Skin textures, locally cached |

The access token is sent only to Mojang, never the directory; the certificate private key is never sent to the directory. Public certificate material can identify the certificate holder across uses for its lifetime (often described as about forty-eight hours, not an owner-verified guarantee here).

While a game link is active, the by-name service uses only a cached certificate and refuses an empty/stale cache rather than fetch a new chat-signing certificate. A simultaneous account `join` proof can briefly interfere with a server login. A launcher restart during a Mojang outage loses the memory-only certificate cache.

### Retention and deletion

Findability/registration refresh is at most daily; inbox polling is normally every fifteen minutes. Switching off findability/Friends queues deletion of the user's registration, inbox and owned blocks. Visible deletion waits for successful remote processing when the service is unavailable; an account removed before cleanup can leave data until thirty-day inactive retention.

Letters are deleted on answer, retract, block or expiry (fourteen days). Accept and decline both look like deletion to the Worker; it does not learn the completed friendship outcome. Opt-out does not erase outgoing letters and abuse-prevention send history before their normal expiry. Send history is kept seven days, including nonfindable senders. D1 Time Travel can restore deleted rows for seven days on Free or thirty days on Paid; that window is not the same as visible row retention.

Proposed legal bases are consent for findability (Art. 6(1)(a)), requested contact/authentication service (Art. 6(1)(b)) and legitimate interest in abuse prevention for the seven-day send history (Art. 6(1)(f)). These are operator/legal determinations, not automated test results. Directory access/erasure enquiries use the controller contact and Minecraft UUID. The user sees their own incoming requests in the launcher.

## Local mods and residual security risks

The Bridge's own transport connects only to `127.0.0.1` on this PC. Friend identities, peer networking, directory access and host/join checks stay in Rust. Process ownership, per-launch aliases, narrow operations, rate limits and launcher consent limit accidental/semi-trusted API abuse.

They do not isolate malicious mods. Every mod in a JVM executes as the OS user, can read the inherited token/port, speak the same local channel and inspect delivered Friends state. On Windows/Linux same-user programs can also read unlocked keyring entries. Do not claim scopes protect the permanent identity from malware.

Older Vanilla versions cache player certificates including private keys in `<gameDir>/profilekeys/`. A stolen certificate key can open directory sessions until certificate expiry: register/unregister, read/delete/send letters. It cannot alone complete the P2P Mojang acceptance proof, which additionally needs the access token. Pumpkin excludes `profilekeys/` from instance exports/templates; it does not make the user's existing game directory unreadable to local code.

Disabling Friends, reset and rotation revoke private work and grants without shutting down the shared listener. Data already sent to game memory remains accessible to that process. Identity changes, privacy switches and full-ID disclosure are launcher-only.

The Worker verifies account certificates offline, not Mojang's current multiplayer restrictions itself. Official launcher attribute checks restrict findability, but a modified launcher can skip them. Completing a name-based friendship still uses Mojang's online account proof. Certificate lifetime, restricted-account responses and the approval to use certificates/attributes or share names/UUIDs are not established by fixture tests.

## Product/legal constraints

Pumpkin is not an official Minecraft product and must not imply Mojang/Microsoft endorsement. Friends is free, does not distribute game files between users and does not bypass Minecraft ownership/online-mode requirements. Forks need their own approved OAuth application and provider/service configuration. Applicable Minecraft Usage Guidelines, app approval scope, processor arrangements and operator-specific notices must be resolved by the operator, not replaced by a completed-looking checklist.

The website and in-app notice should reflect these actual recipients and limits. In particular, distinguish Bridge loopback availability before Friends opt-in, signed `displayName` storage, directory deployment status, cached-only certificate behavior during a game and still-unproven authenticated cross-network behavior.
