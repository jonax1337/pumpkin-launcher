# Pumpkin Friends specification

Last updated: 2026-10-06. This is the central reference for the implemented Friends contracts. Exact serialized fields live in the linked Rust/TypeScript types and shared fixtures; update those together with this reference when a contract changes. Bridge injection and its local protocol are documented in [Pumpkin Bridge](../bridge/README.md).

Paths in this document are relative to the repository root. This specification replaces the separate by-name proposals, certificate-login addenda, dependency notes and implementation work-package logs.

Jump to [boundaries](#boundaries-and-source-map), [transport](#transport),
[identity and codes](#identity-codes-and-friendship), [peer wire protocol](#peer-wire-protocol),
[invites and matching](#invites-manifests-and-matching), [LAN lifecycle](#lan-tunnel-and-lifecycle),
[Directory API](#directory-api), [letters and acceptance](#letters-and-acceptance)
or [persistence and limits](#persistence-and-operational-limits).

## Boundaries and source map

Friends provides mutual-consent friendships, presence and invitation-only LAN-world tunnels. It is off by default, requires a Microsoft account and exposes no peer/relay networking or private data before opt-in. The independent loopback Bridge may already be running. No chat, voice, public directory listing, arbitrary network forwarding, file transfer or automatic modpack construction is provided.

| Contract | Source |
| --- | --- |
| Frontend state, commands and events | `src-tauri/src/services/friends/contract.rs`, `src/lib/friends-types.ts`, `src/lib/backend.ts`, `src/lib/friends-fixtures.ts` |
| Command adapters | `src-tauri/src/friends_commands.rs`, `friends_session_commands.rs`, `ingame_commands.rs` |
| Peer frames | `services/friends/control.rs`, `hello.rs`, `requests.rs`, `manifest.rs`; paths under `src-tauri/src/` |
| Transport and framing | `services/p2p/`, `services/friends/limits.rs` |
| Persistent records | `services/friends/records.rs`, `config.rs` |
| Directory HTTP shapes | `services/friends/directory/wire.rs`, `api.rs`, `directory/src/` |
| Signed byte layouts | `services/friends/identity.rs`, `directory/proof.rs`, `directory/src/auth.js`, `letters.js` |
| Directory golden vectors | `directory/test/cert-vectors.json`, `directory/test.mjs` and the Rust proof/certificate tests |

Rust/TypeScript domain fields use camelCase. Tagged unions use `type`; command errors use coded `errors.friends.*` errors, not errors embedded in state/events. All untrusted strings are sanitized before storage, display or forwarding. IDs and hashes are format-checked independently of text cleanup.

## Transport

The launcher uses iroh 1.3: QUIC/TLS 1.3 with Ed25519 endpoint IDs, NAT traversal and relays. Endpoints use `presets::Minimal`, not DNS/pkarr address lookup. The locked dependency versions are in `src-tauri/Cargo.lock`; the relay and launcher need compatible iroh versions. No third-party audit of the complete Friends stack is claimed.

Relay entries are compiled in `services/p2p/relays.rs`. Peers exchange one-byte indexes, never URLs. Indexes are append-only and never reused: 0-99 for Pumpkin, 200-209 for n0. Unknown indexes are ignored, not interpreted as remote destinations.

The production map is currently empty. Debug/`beta-relays` builds include indexes 200-203 for `use1-1`, `usw1-1`, `euc1-1`, `aps1-1` under `relay.n0.iroh.link`; UDP discovery uses 7842. Enabling Friends with any n0 entry requires `acceptThirdPartyRelays`. Empty selection disables relays; nonempty selection uses an explicit custom map, never iroh's implicit defaults.

Official tagged builds enable `beta-relays` through [release packaging](../../CONTRIBUTING.md#release-packaging), so the empty Pumpkin-operated production map does not mean published users must deploy their own relay.

| Endpoint | Identity | Accepted ALPN | Network/lifetime |
| --- | --- | --- | --- |
| Main | Permanent Friends key | `pumpkin/peer/1` | While enabled and available; direct IP transports unless `alwaysRelay` |
| Hello | Derived per-code key | `pumpkin/hello/1` | One per active code; always relay-only, selected code relay |
| Retired | Previous key | None inbound | Dial-only, relay-only, while delivering rotation/removal work |

Dial addresses use only the configured relay URLs. A bare ID without lookup/relay addresses is not dialable. All endpoints maintain an accept loop. Idle timeout is 40 seconds, connection keep-alive 15 seconds, dial timeout 8 seconds and initial relay reachability wait 5 seconds. No reachable relay produces `degraded/relayUnreachable`; established direct traffic may continue. The endpoint allows 16 bidirectional streams and no unidirectional streams.

Admission runs synchronously after authenticated TLS handshakes. Outgoing connections bypass the application gate. Main inbound connections require a nonblocked stored friend or a matching outgoing request awaiting acceptance. Hello peers are dropped for blocks/rate limits before checking the secret. At most eight handshakes are in flight; additional incoming handshakes are ignored.

QUIC close codes: `0 NORMAL`, `1` reserved, `2 NOT_FRIEND`, `3 DUPLICATE`, `4 PROTOCOL`, `5 RATE_LIMITED`, `6 SHUTDOWN`. A post-handshake silent application drop still sends QUIC close code 0 with no application frame; it is not a frameless transport drop. Closing an endpoint alone uses code 0, so shutdown first closes tracked connections with code 6.

## Identity, codes and friendship

The permanent 32-byte Ed25519 key is kept through `SecretStore` in the OS keyring under service `dev.laux.launcher`, entries `friends-identity` and `friends-identity-retired`. Peer IDs are exactly 64 lowercase hex characters. Fingerprints show the first 16 characters in four groups; logs use shortened IDs.

A missing/unusable keyring produces `noSecretStore`. Missing identity with existing Friends data produces `identityLost`; it is never silently replaced. Bridge-only settings/status remain accessible in those states. Reset is an explicit user operation.

The first stored Microsoft account supplies the Friends Minecraft name and UUID. There is no independently editable self-display-name. Legacy `displayName` output/signature fields remain on the wire but carry the account-derived name. Ordinary peer profiles are self-asserted; by-name acceptance additionally proves the expected Mojang UUID. Local aliases are private and capped at 32 characters.

Friend code encoding:

```text
payload = version(0x02, 1 byte) || relayIndex(1) || helloId(32)
          || secret(9) || check(2)
check   = SHA-256(version || relayIndex || helloId || secret)[0..2]
code    = "pumpkin-" + 72 RFC 4648 base32 characters without padding
```

A code is 80 characters, single-use and valid for 604800 seconds (seven days), with at most three active codes. It does not reveal the permanent peer ID. The inviter persists a secret hash and derivation salt; the plaintext code is shown once. A recipient's pending delivery record retains the secret needed for retries.

The invitee redeems the hello endpoint, then waits for the inviter's acceptance. The reply binds the code endpoint to the inviter's permanent key:

```text
binding = Ed25519(permanentKey,
                  "pumpkin/bind/1" || helloId(32) || inviteePeerId(32))
```

The recipient verifies both ID and binding before trusting the result. Friendship requires acceptance, not possession of a code alone. Pending requests expire after 1209600 seconds (fourteen days). Delivery backoff is 30 seconds, 2, 5, 15 and 30 minutes, then remains at 30 minutes. The graph cap is 50 friends; by-name outgoing pending requests also count toward capacity, with at most five open name requests.

Remove/block closes access; rotation/reset uses the retired-key outbox to deliver signed identity changes/removal. Rotation binds the new ID to the old key and requires acknowledgment. Key changes revoke sessions, stale grants and directory tokens. Pending incoming by-name requests belong to their sender and can survive recipient rotation; outgoing requests bound to the previous key cannot.

## Peer wire protocol

Both ALPNs currently use protocol 1. An incompatible peer protocol change requires a new ALPN. Compatible additions are optional/defaulted; unknown control message types are ignored, unknown request types return `unsupported`.

A frame is a four-byte big-endian JSON byte length followed by UTF-8 JSON with a `type` field. The reader checks length before allocation. Frame failures reset the stream with `PROTOCOL`; hello/control failure also closes the connection.

| Context | Maximum frame |
| --- | --- |
| Hello | 4 KiB |
| Control | 16 KiB |
| Request/response | 512 KiB |
| Stream open/tunnel response | 1 KiB |

The hello ALPN exchanges `friendRequest{protocol,secret,profile}` and `received{peerId,binding,profile}` or `error{code}`. Wrong secrets, blocked senders and rate-limited attempts receive no application response.

Each peer bi-stream begins with `control`, `request`, or `tunnel{sessionId}`. One control stream per connection exchanges `hello{protocol,features,launcher,profile,homeRelay}`, then `status`, `profile`, `invite`, `inviteRevoke`, `inviteDecline`, `unfriend`, `identityRotated` and `ack`. The profile contains `displayName`, nullable `mcName` and nullable `mcUuid`. `homeRelay` is a nullable known index, not a dial address.

Request streams exchange `manifestRequest{sessionId}`, `manifest{manifest}` or `error{code}`. Tunnel streams receive `tunnelOk` or an error before raw Minecraft bytes. Full message shapes are defined in the source map above. First-frame and hello waits are ten seconds; request/response wait is thirty seconds.

Rate limits include three hello attempts per peer/code in ten minutes, ten per code/hour, fifty control frames/ten seconds, five request streams per friend/minute and five link replacements/minute. Invalid frame/ID/hash handling must not be bypassed by a new message type.

## Invites, manifests and matching

A host invites selected confirmed online friends only. At most seven seats are admitted; invites expire after 7200 seconds (two hours). Receive limits are ten invites per friend/hour and twenty total open invites. A kick or decline deletes the host's open invite and rejects later manifest/tunnel requests until an explicit new invitation. A guest who simply leaves can rejoin while the invite remains valid.

The manifest carries Minecraft release, loader, nullable loader version and enabled mod entries `{sha512,fileName}`. It excludes worlds, configs, JVM arguments and resource/shader packs. Names are display-only, never destination paths. SHA-512 is 128 lowercase hex, deduplicated; guests accept at most 500 mods. An unreadable host file is skipped with a warning; an oversized manifest is rejected by guests rather than silently truncated.

Matching requires the same Minecraft release and loader. Loader-version equality is not required. Required SHA-512 sets must be equal: a mod is client-only only when Modrinth resolves its hash to a project with `server_side == unsupported`; unknown/unreachable lookups conservatively make it required. Lookup results are cached for one hour. Results distinguish `ready`, `missingContent`, `noInstance` and `versionUnsupported`, with missing/extra entries and `lookupFailed`. Vanilla with no candidate can offer creation of a Vanilla instance. No files are downloaded from the host or automatically installed by matching.

The current release-time floor is Minecraft 1.16.5 (`MIN_MC_RELEASE_TIME = 2021-01-14T16:05:32+00:00`), not the older proposal's 1.20 floor. Bridge injection additionally needs an exact supported node. The injected Bridge JAR is outside instance content and needs no hash/matching exception; a manually installed copy is ordinary content and triggers the duplicate-injection gate.

## LAN tunnel and lifecycle

Hosting requires a running Microsoft-account instance, a supported release and a single active host session. Every port hint from the mod, raw game-log parser or manual input passes the same checks: port 1024-65535, a listening socket owned by the spawned game PID and a valid Minecraft status ping on `127.0.0.1`. Ownership failures fail closed. Two failed fifteen-second liveness probes end sharing.

The raw log parser accepts whole INFO messages from the Server thread only: `Started serving on <port>`, `Published LAN server on port <port>`, `Stopping server` or `Unpublishing integrated server`. Chat, other threads and multiline message continuations cannot supply a port. Closing signals immediately revoke sharing; an arbitrary hint never chooses a remote target.

Each Minecraft TCP connection uses one QUIC bi-stream with `TCP_NODELAY`. Host admission requires an open invitation/session, at most seven guests, four concurrent streams/guest and twenty new streams/guest/minute. Before touching the LAN server it parses a bounded Minecraft handshake/login start: maximum 2 KiB buffer, five-second deadline, status/login only, valid username, no transfer state or legacy ping. The destination is always the verified local LAN port.

The guest binds a random `127.a.b.c:0` on Windows/Linux, or `127.0.0.1:0` on macOS, then returns a `JoinTicket` used by the launch options/Quick Play. Each local socket is checked against the game PID and handshake address/port before a QUIC stream opens. Guest ownership lookup errors retain the handshake-address check rather than claiming a malware-proof PID boundary.

Join timing: ten-minute spawn wait reset by launch progress, thirty-minute absolute cap, ten minutes for the first valid connection after spawn, thirty-second host-offline grace. Installation finishes before `invite_join`; download progress does not extend the join timer. Failed launch/timer closes the listener immediately. Guest listeners allow one unvalidated connection before the first valid one and four thereafter.

Stop, kick, world close, game exit, disable, rebind, identity change and shutdown cancel the appropriate streams/listeners. Invites are revoked before the old endpoint is torn down. Ending the launcher tunnel does not necessarily unpublish the Vanilla LAN world; before Minecraft 26.2 it remains LAN-accessible until the world is left.

## Directory API

The Cloudflare Worker is an opt-in exact-name mailbox, not a peer discovery/presence service. It makes no Mojang subrequests. `DEFAULT_DIRECTORY` is empty; `PUMPKIN_FRIENDS_DIRECTORY` selects an HTTPS base URL at runtime or build time (runtime wins). An invalid override does not fall back to another endpoint. Deployment and migrations: [directory README](../../directory/README.md).

Common rules: JSON; 2048-byte request limit, except certificate session login at 4096 bytes; declared oversize refused before reading and streaming reads capped. `Origin` is refused. Unknown method/path is 404. Missing `DB`, `LIMITER_IP`, `LIMITER_ACCOUNT` or `TOKEN_KEY` fails closed with 503 `notConfigured`. Errors are `{"error":"<code>"}`; the launcher translates codes, never server prose. Protected routes use `Authorization: Bearer <token>`.

UUIDs are 32 lowercase hex, peer/hello IDs 64, nonces 32, secrets 18 and Ed25519 signatures 128. Letter IDs are canonical lowercase UUID v4. Times are Unix seconds except certificate expiry, which is epoch milliseconds.

| Route | Request | Success |
| --- | --- | --- |
| `POST /v2/auth/challenge` | `{peerId}` | 200 `{challenge,serverId,expiresAt}` |
| `POST /v2/auth/session` | `{challenge,uuid,certificate:{publicKey,expiresAt,mojangSignature},certSignature,signature}` | 200 `{token,expiresAt,uuid}` |
| `POST /v1/auth/challenge`, `POST /v1/auth/session` | Retired login | 410 `gone` |
| `PUT /v1/me` | `{}` | 200 `{findable:true,refreshedAt}` |
| `DELETE /v1/me` | None | 204; deletes registration, inbox and owned blocks |
| `POST /v1/outbox` | Signed letter | 202 `{id,expiresAt}` |
| `DELETE /v1/outbox/{id}` | None | 204; retract if sender owns it |
| `GET /v1/inbox` | None | 200 `{letters}`; oldest first, at most twenty unexpired |
| `DELETE /v1/inbox/{id}` | None | 204; delete if recipient owns it |
| `PUT /v1/blocks/{uuid}` | None | 204; block and delete that sender's pending letters |
| `DELETE /v1/blocks/{uuid}` | None | 204 |

Login's nested/top-level keys must match exactly. The challenge is sealed with `TOKEN_KEY`, bound to the peer ID, includes sixteen random bytes and expires in 120 seconds. Its `serverId` is the first forty hex characters of `HMAC-SHA256(TOKEN_KEY,"server-id" || challenge)`.

Both login signatures cover domain plus these fixed parts:

```text
SHA-256(directoryHostname)[0..16] || serverId(40 ASCII bytes)
|| peerId(32 bytes) || uuid(16 bytes)
```

- L1 domain `pumpkin/directory-auth/2`: Ed25519 with the permanent Friends key.
- L2 domain `pumpkin/directory-cert/1`: RSASSA-PKCS1-v1_5/SHA-256 with the certificate private key.
- L3, Mojang's certificate signature: SHA1withRSA over `uuid(16) || expiresAt(int64 BE, milliseconds) || SPKI DER`.

Hostname binding prevents relaying login proofs to a different directory. Certificate material uses padded standard Base64. The public key must be RSA `rsaEncryption` SPKI with 2048-4096 bits, maximum 800 decoded bytes; signatures are capped at 1024 decoded bytes. The Worker verifies shape, challenge MAC/expiry, L1, strict certificate expiry, Mojang's signature against pinned keys and L2, in that order. RSA-SPKI and safe-integer checks prevent a Mojang-signed textures payload from being treated as a certificate.

Session tokens are `v2.` plus a sealed `{u:uuid,p:peerId,exp}` payload; expiry is the earlier of six hours or certificate expiry. No token/certificate state is stored by the Worker. Clients keep tokens only in memory and drop them on 401, account/identity changes or disable. `TOKEN_KEY` rotation invalidates every challenge/token.

The launcher fetches `/player/attributes` and `/player/certificates` directly from Mojang, never sends its access token to the Worker and caches certificates only in memory. Refused multiplayer/friends attributes fail; unknown attributes cannot register/poll. A modified launcher can bypass that client-side gate, but by-name acceptance still requires Mojang `join` account proof. While a game link is active, all by-name paths use cached certificates only and never fetch a new one that could disturb the game's chat key. Empty/stale cache then means `directoryUnavailable`.

### Letters and acceptance

Outgoing letter keys are exactly `to,nonce,helloId,relayIndex,secret,displayName,createdAt,signature`. Despite removal of the old `from_name` column, `displayName` is still signed, processed and stored. It is not a trusted directory name lookup. The inbox adds `id`, `from:{uuid,peerId}` and `expiresAt`, stamped from the sender session. The recipient retrieves the canonical sender name from Mojang after validation/local blocking checks.

```text
letter signature = Ed25519(permanentKey,
  "pumpkin/name-request/1" || to(16) || senderUuid(16) || nonce(16)
  || helloId(32) || relayIndex(1) || secret(9)
  || createdAt(u64 BE, seconds) || displayName(UTF-8))
```

`displayName` is 1-64 UTF-16 units without control characters; clients additionally sanitize it. Clock skew is at most 600 seconds. Expiry is creation plus fourteen days. Sender quotas are checked before recipient facts: ten sends/24 hours and one send per pair/seven days. Unknown/unfindable recipients return `notFindable` and consume daily quota without pair cooldown. Blocked recipients get the same 202 shape as delivery, with a random ID and no stored letter. The mailbox cap is twenty; block-list cap is 1000. One stored letter per sender/recipient pair is replaced on a later permitted send.

Clients poll after activation, then every fifteen minutes while enabled, available and findable; retries are bounded. Recipient UUID, sender IDs, relay index, signature, timestamps and expiry are checked before surfacing a letter. Unknown relay index leaves a letter untouched. Invalid/blocked letters are deleted; transient sender-name lookup failure is not grounds to destroy a valid request. Decline deletes silently; cancel retracts; acceptance redeems the hello endpoint and proves both Minecraft accounts before adding the friendship.

```text
redeemer serverId = hex(SHA-256("pumpkin/name-proof/redeemer/1"
  || helloId(32) || redeemerPeerId(32) || secret(9)))[0..40]
owner serverId = hex(SHA-256("pumpkin/name-proof/owner/1"
  || helloId(32) || redeemerPeerId(32) || secret(9)))[0..40]
```

`redeemerPeerId` is the authenticated hello TLS identity, not a Worker-supplied replacement. Each launcher performs Mojang `join`/`hasJoined` and compares the returned UUID with the expected account. A compromised Worker can drop letters, expose metadata and spam, but knowing a request secret alone cannot impersonate the account at acceptance. A `join` can briefly interfere with another simultaneous server login.

HTTP business errors include `invalid`, `self`, `badSignature`, `clock`, `notFindable`, `recipientFull`, `sendQuota`, `pairCooldown`, `notRegistered`, `blockListFull`, `challengeExpired`, `badCertificate`, `certificateExpired` and `unauthorized`. IP/account rate limiters are approximate per Cloudflare location: sixty requests/minute/IP and thirty/minute/account, with `Retry-After: 60`; exact send quotas use D1.

## Persistence and operational limits

Local records are separate JSON files under `friends/`, not a single `friends.json`. Configuration holds settings and pending directory cleanup work; record stores hold friends, requests, codes, blocks and the retired-key outbox. Presence, live sessions and invitations are not persisted. Newer unreadable records survive writes; missing fields use explicit defaults. Exact schemas are `records.rs` and `config.rs`.

D1 tables are `users`, `letters`, `blocks` and `sends`, defined by ordered migrations in `directory/migrations/`. Apply migrations before deploying code that needs them; migration 0002 removes the old `from_name` column, not `displayName` in signed letter bodies. Registration refreshes at most daily; inactive registrations expire after thirty days, letters after fourteen and sends after seven. Daily cron cleanup is bounded to 5000 rows per deletion statement. Opt-out deletes registration/inbox/blocks but does not erase outgoing letters or the abuse-prevention send log prematurely. D1 restore history can retain deleted rows beyond visible deletion; details in [PRIVACY.md](PRIVACY.md).

Pinned Mojang keys live in `directory/src/mojang-keys.js`, not an environment trust-root override. `directory/scripts/mojang-keys.mjs` and the scheduled key workflow maintain them. Missed rotation makes by-name login fail with `badCertificate` until a Worker key update is deployed; codes and P2P acceptance are separate. Certificate lifetime, restricted-account responses and provider/legal approvals must not be inferred from fixture or local Bridge success.

Do not log tokens, codes, secrets, hello IDs, private keys or peer IPs. Text sanitation performs NFC/control/bidi cleanup and context-specific bounds in `sanitize.rs`. Scopes do not protect against malicious same-user code. [PRIVACY.md](PRIVACY.md) is the canonical data/security disclosure; [RELAY-OPS.md](RELAY-OPS.md) is the relay runbook.

Real-network Friends behavior, non-Windows runtime behavior, production relay availability and the operator's Microsoft/Mojang approval scope are not established by the embedded Bridge support index. Release preparation must retain those limitations instead of substituting old verification tables or declaring them passed.
