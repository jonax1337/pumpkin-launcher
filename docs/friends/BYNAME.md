# Pumpkin Friends: Addendum "Friend by name" (directory, mailbox, Mojang proof)

**Status: DRAFT for owner review, 2026-10-03.** Addendum to `docs/friends/SPEC.md` v2 (frozen). Package N-D0 copies it to `docs/friends/BYNAME.md` and makes the contract edits named in section 9.10 in `SPEC.md` first (change rule of SPEC.md). Section numbers like "SPEC 4.3" point into `SPEC.md`; "N 7.2" points into this addendum.

**Goal.** You type `Steve` and hit "Anfrage senden". Steve gets the request in his launcher, even if he is offline right now, and accepts it. Both launchers then become friends through the **existing** P2P handshake (SPEC 4.3, 5.2, 5.3). Friend codes stay as they are and remain the fallback.

**One-sentence architecture.** A small Cloudflare Worker (`directory/`) does three things only: it proves Minecraft account ownership through Mojang's `join`/`hasJoined` handshake, it keeps an opt-in list of findable Minecraft UUIDs, and it holds signed friend-request **letters** for up to 14 days. A letter contains a single-use friend code of the sender, so the recipient finishes through the normal hello flow with the roles swapped. At that point both launchers prove their Minecraft accounts to each other directly through Mojang, **without trusting the Worker**.

Verified facts (web, 2026-10-03), used throughout:
- `POST https://sessionserver.mojang.com/session/minecraft/join` with `{"accessToken","selectedProfile" (UUID without hyphens),"serverId"}` returns **204** on success. 403 bodies carry `InsufficientPrivilegesException` (multiplayer disabled, e.g. child accounts), `UserBannedException`, `InvalidCredentialsException` (token expired) or `ForbiddenOperationException`. 429 means rate limited. There is a **per-account limit of 6 joins per 30 s**. Sources: minecraft.wiki Mojang API, azalea `sessionserver.rs`.
- `GET https://sessionserver.mojang.com/session/minecraft/hasJoined?username=&serverId=[&ip=]` returns **200** with the profile (`id` without hyphens, `name`, `properties`) when that account joined with that `serverId`, and **204** otherwise. `username` is case-insensitive. No format rule for `serverId` is documented; the game uses up to 41 chars of hex. We use exactly 40 lowercase hex chars.
- `GET https://api.minecraftservices.com/minecraft/profile/lookup/name/{name}` returns 200 `{id, name}`, or **404** when no player has that name. Most of the Mojang API is limited to **200 requests per 2 min per IP**. The launcher already uses this URL (`skins.rs` `PLAYER_LOOKUP`).
- Cloudflare Free plan: Workers allow 100,000 requests/day, **10 ms CPU** per request, 50 subrequests and 5 cron triggers. **KV**: 1,000 writes/day, eventually consistent (unusable for a mailbox). **D1**: 5 M rows read and 100 k rows written per day, 5 GB, strongly consistent. **Durable Objects** are available on Free with the SQLite backend (100 k requests/day). D1 can be created with `--jurisdiction eu` (since 2025-11). D1 **Time Travel is always on**: 7 days of history on Free, 30 on Paid, and it cannot be disabled. The Rate Limiting binding is GA (Wrangler ≥ 4.36), has periods of 10 or 60 s only, and is "permissive, eventually consistent, not for accurate accounting", with counters per location. WebCrypto in Workers supports `Ed25519` verify and `HMAC`.
- Turnstile is a browser widget for websites and does not apply to a desktop launcher. The Sybil cost here comes from the Mojang proof instead: one paid Minecraft account per identity, and banned or multiplayer-restricted accounts cannot join.

---

## 0. Decisions at a glance

| Topic | Decision |
|---|---|
| Where | New Worker `directory/` (sibling of `proxy/`, separate Worker, separate secrets, never merged with the CurseForge key). Name `pumpkin-friends-directory`. |
| Storage | **D1** (one database, created with `--jurisdiction eu`). KV is rejected (1 k writes/day, eventual consistency). Durable Objects are rejected (per-user objects and cross-user quotas need extra routing code; D1 gives the same consistency with plain SQL). |
| Proof of account | Worker-issued challenge → the launcher calls Mojang `join` with its Minecraft token → the Worker calls `hasJoined` and gets the verified UUID and name. The launcher also signs the challenge with its **permanent friends key**, so the session binds UUID ↔ peer id. |
| Session | Stateless HMAC token, **6 h**, held in memory only, never on disk. No refresh token: when it expires, the launcher runs the handshake again. |
| Name → UUID | Resolved **by the launcher through Mojang** (`lookup/name`). The Worker has **no name index**: no squatting, no stale names, no name enumeration through us. Mojang is the only authority for name → UUID. |
| Findable | Opt-in setting "Per Minecraft-Namen auffindbar", **default off**. Off means no row in the directory. A non-findable or unknown UUID gets `404 notFindable`, the same as an unregistered one. |
| Lookup | **No separate lookup route.** Sending is the lookup: every probe of a findable person delivers a real request that the person sees. There is no listing and no partial search. |
| Request transport | A letter in the recipient's mailbox. It carries a **single-use friend code of the sender** (hello id, relay index, secret), signed with the sender's permanent key. The Worker stamps the sender's verified UUID, name and peer id from the token. |
| Acceptance | The recipient **redeems the sender's code** through the existing hello flow (SPEC 4.3, roles swapped). The sender auto-accepts because it already consented. The recipient's permanent id goes to the sender only after acceptance. |
| End-to-end check | At redemption, **both launchers prove their Minecraft account to each other through Mojang** (`join` with a deterministic `serverId` derived from the hello id, the redeemer id and the secret, then `hasJoined` by the other side). A compromised Worker can spam or drop letters, but it **cannot impersonate** anyone. |
| Decline | Silent: the recipient deletes the letter. The sender keeps "wartet auf Antwort" until the 14-day expiry. |
| Block | Local block by peer id, plus a server-side block by UUID. Further letters from that UUID get `202` and are dropped (indistinguishable from delivery). |
| Limits | 10 letters per sender per 24 h; 1 letter per sender→recipient pair per 7 d; 20 pending letters per recipient; at most 5 open by-name requests per launcher; rate-limit bindings per IP and per account. |
| Fallback | Codes are untouched. Nothing in presence, invites or the tunnel touches the Worker. Worker down = by-name unavailable, everything else works. |

---

## 1. Scope

**In:** add by exact Minecraft name, opt-in findability, offline delivery (14 days), silent decline, server-side block, cancel, the end-to-end Mojang proof at acceptance, settings, UI, mock, docs, Worker, tests.

**Out (non-goals):** search by partial name, suggestions, "people you may know", friends-of-friends, public profiles, presence or online status in the directory, chat, any data about friendships after acceptance, more than one directory, federation, a web UI. The directory never sees tunnel traffic, presence, invites or friend lists.

**SPEC 1.2 changes:** "Public links, adding by bare id, discovery" becomes "Public links, adding by bare id, discovery beyond the exact Minecraft name of a player who opted in (N)".

---

## 2. Flow overview

```
Sender S ("Alex")                    Worker (directory)                     Recipient R ("Steve", findable)
friend_add_by_name("Steve")
 1 Mojang lookup/name/Steve -> uuid_R, "Steve"   (from S's IP, no Worker)
 2 code::issue -> NameRequest code (hello endpoint, relay-only, 14 d)
 3 (session token, N 3)
 4 POST /v1/outbox {to: uuid_R, helloId, relayIndex, secret, nonce, displayName, createdAt, sig_S}
                                     verify token, sig_S, quotas, block list
                                     store letter + stamp from{uuid_S, name_S, peerId_S}
   <- 202 {id, expiresAt}            (404 notFindable if uuid_R not registered)
 S shows "Anfrage an Steve: wartet auf Antwort"
                                                                          poll GET /v1/inbox (15 min, page open)
                                                                          verify letter (sig_S vs stamped peerId_S)
                                                                          -> incoming request "Alex (Minecraft: Alex)"
                                                                          ... R clicks "Annehmen" ...
                                                                          R: Mojang join(serverId_R = H(redeemer, helloId, peerId_R, secret))
 S's hello endpoint (relay-only) <==== hello/1 friendRequest{secret, profile{mcName: "Steve"}} ==== R main endpoint
 S: hasJoined("Steve", serverId_R) == uuid_R ?  (no: silent close)
 S: Mojang join(serverId_S = H(owner, ...)); store Friend{R, unconfirmed}
 ==== received{peerId_S, binding, profile{mcName: "Alex"}} ====>          R: peerId == stamped peerId_S, binding ok,
                                                                             hasJoined("Alex", serverId_S) == stamped uuid_S ?
                                                                          R: Outgoing{awaitingAnswer, peerId_S}; close
 S dials R on peer/1 (R's Gate: awaitingAnswer -> Accept), control hello -> both confirmed (SPEC 4.3, unchanged)
                                                                          DELETE /v1/inbox/{id} (job, N 7.6)
```

---

## 3. Proof of account ownership and sessions

### 3.1 Handshake (Worker = "server")
1. `POST /v1/auth/challenge {peerId}`. The Worker returns `{challenge, serverId, expiresAt}`. The challenge is **stateless**: `challenge = b64url(json{p: peerId, exp: now+120, r: 16 random bytes hex}) + "." + b64url(HMAC-SHA256(TOKEN_KEY, "challenge" || payload))`, and `serverId = hex(HMAC-SHA256(TOKEN_KEY, "server-id" || challenge))[0..40]`. Nothing is stored. Replaying a challenge only yields another token for the same account and key, so it is harmless.
2. The launcher calls Mojang `join` with `{accessToken, selectedProfile: own uuid, serverId}` (Rust only; the token never leaves Rust and is never sent to the Worker).
3. The launcher signs `sign_permanent("pumpkin/directory-auth/1", [serverId as 40 ASCII bytes, peer id 32 bytes])` (`Identity::sign`, SPEC 4.1).
4. `POST /v1/auth/session {challenge, name, signature}`. The Worker checks the challenge MAC and expiry, recomputes `serverId`, and verifies the Ed25519 signature against `p`. It then calls `hasJoined?username={name}&serverId={serverId}` (5 s timeout, **no `ip` parameter**). A 200 gives `{id, name}`: that is the verified `uuid` (lowercase, no hyphens) and the canonical `name`.
5. The Worker returns the token `v1.` + `b64url(json{u: uuid, n: name, p: peerId, exp: now+21600})` + `.` + `b64url(HMAC-SHA256(TOKEN_KEY, "token" || payload))`.

- **Why the peer id is bound:** letters are stamped with `peerId` from the token. The signature proves that the launcher holding this Minecraft session also holds that friends key.
- **No refresh token** and no storage on either side. The launcher keeps `{token, expiresAt, uuid, name, peerId}` in memory (`Core.directory_session`); `Debug` redacts the token; it is never logged. It is dropped on identity change (rotate/reset), on a change of the first Microsoft account, on disable, and on any `401`. Then the next directory call runs the handshake again.
- **Auth lock:** at most one handshake at a time per process (a tokio `Mutex`), so Mojang's 6-joins-per-30-s limit is never hit by us. A handshake costs one Mojang `join` from the user's IP and one `hasJoined` from the Worker.
- **Mojang refusals** (`InsufficientPrivilegesException`, `UserBannedException`) → `DirectoryState::NotAllowed` and `errors.friends.directoryNotAllowed`. The feature inherits Mojang's multiplayer restriction on purpose (compliance, SPEC Appendix C). `InvalidCredentialsException` → refresh the session once (`auth::session`), then `errors.app.auth.relogin`.
- **Rotating `TOKEN_KEY`** (owner, `wrangler secret put TOKEN_KEY`) invalidates every token and challenge at once. Clients just re-authenticate.

### 3.2 Peer-to-peer Mojang proof at acceptance (normative, N 7.4)
Pure functions in `directory/proof.rs`, golden vectors in N Appendix A:
```
serverId_redeemer = hex(SHA-256("pumpkin/name-proof/redeemer/1" || hello_id(32) || redeemer_peer_id(32) || secret(9)))[0..40]
serverId_owner    = hex(SHA-256("pumpkin/name-proof/owner/1"    || hello_id(32) || redeemer_peer_id(32) || secret(9)))[0..40]
```
- Both values bind the redeemer's **authenticated** peer id (the TLS identity of the hello connection). Someone who knows the secret (the Worker) cannot make the real account `join` with a `serverId` that contains the attacker's id. There is no replay, because each value is unique per redeemer.
- The names passed to `hasJoined` come from the other side's hello frame (`profile.mcName`, self-asserted). That is safe because the check compares the **UUID** returned by Mojang with the expected UUID. Renames therefore cost at most one failed attempt.
- Each side uses `McIdentity.name` (from `auth::session`, refreshed with the profile) as its own `profile.mcName` in the name flow.

---

## 4. Worker API (`directory/`, base URL `https://<directory-host>`)

**Common rules.** JSON only, `content-type: application/json`. Request bodies ≤ 2 KiB (`413 tooLarge`). Any request with an `Origin` header gets `403` (same rule as `proxy/`). Unknown method or path gets `404`. Missing bindings or secrets (`DB`, `LIMITER_IP`, `LIMITER_ACCOUNT`, `TOKEN_KEY`) fail closed with `503 notConfigured`. Errors are always `{"error":"<code>"}` with a machine code; the launcher translates (it never shows Worker text). All ids and hashes are format-checked: `uuid` = 32 lowercase hex, `peerId`/`helloId` = 64 lowercase hex, `nonce` = 32 hex, `secret` = 18 hex, `signature` = 128 hex, letter `id` = canonical lowercase UUID v4. Authenticated routes need `Authorization: Bearer <token>`, otherwise `401 unauthorized` (also for an expired or tampered token). Timestamps are unix seconds.

| # | Route | Auth | Request | Success | Errors |
|---|---|---|---|---|---|
| A1 | `POST /v1/auth/challenge` | — | `{"peerId":"<64 hex>"}` | `200 {"challenge":"<≤256 chars>","serverId":"<40 hex>","expiresAt":n}` | 400 invalid |
| A2 | `POST /v1/auth/session` | — | `{"challenge":"…","name":"Steve","signature":"<128 hex>"}` | `200 {"token":"…","expiresAt":n,"uuid":"<32 hex>","name":"Steve"}` | 400 invalid / challengeExpired, 401 badSignature, 401 notJoined (hasJoined 204), 503 mojangUnavailable (timeout, 429, 5xx) |
| M1 | `PUT /v1/me` | yes | `{}` | `200 {"findable":true,"refreshedAt":n}`: register or refresh (upsert `users`) | — |
| M2 | `DELETE /v1/me` | yes | — | `204`: deletes the `users` row, all letters **to** me and my blocks | — |
| O1 | `POST /v1/outbox` | yes | Letter (below) | `202 {"id":"<uuid>","expiresAt":n}` | 400 invalid / self / badSignature / clock, 404 notFindable, 409 recipientFull, 429 sendQuota / pairCooldown / rateLimited |
| O2 | `DELETE /v1/outbox/{id}` | yes | — | `204` always: deletes the letter if I am its sender (retract) | — |
| I1 | `GET /v1/inbox` | yes | — | `200 {"letters":[InboxLetter…]}`: at most 20, oldest first, only unexpired letters to my uuid | 404 notRegistered |
| I2 | `DELETE /v1/inbox/{id}` | yes | — | `204` always: deletes the letter if it is addressed to me (accept and decline look the same) | — |
| B1 | `PUT /v1/blocks/{uuid}` | yes | — | `204`: block row, and deletes pending letters from that uuid to me | 404 notRegistered, 409 blockListFull (1,000) |
| B2 | `DELETE /v1/blocks/{uuid}` | yes | — | `204` always | — |

Letter (O1 body, every field required):
```json
{"to":"069a79f444e94726a5befca90e38aaf5","nonce":"000102030405060708090a0b0c0d0e0f",
 "helloId":"<64 hex>","relayIndex":0,"secret":"a0a1a2a3a4a5a6a7a8","displayName":"Alex",
 "createdAt":1790000000,"signature":"<128 hex>"}
```
`signature = sign_permanent("pumpkin/name-request/1", [to(16 B), from_uuid(16 B, = token u), nonce(16 B), helloId(32 B), [relayIndex](1 B), secret(9 B), createdAt(u64 BE, 8 B), displayName(UTF-8)])`. All parts except the last have a fixed length, so the concatenation is unambiguous. The Worker verifies it with the token's `p` before storing anything.

InboxLetter (I1 element):
```json
{"id":"<uuid>","from":{"uuid":"853c80ef3c3749fdaa49938b674adae6","name":"Alex","peerId":"<64 hex>"},
 "to":"069a79f444e94726a5befca90e38aaf5","nonce":"…","helloId":"…","relayIndex":0,"secret":"…",
 "displayName":"Alex","createdAt":1790000000,"expiresAt":1791209600,"signature":"…"}
```
`from` is the Worker's stamp from the sender's token. `expiresAt = createdAt + 1,209,600` (= `REQUEST_TTL_SECS`).

**O1 semantics (order matters, so that nothing leaks):**
1. Validate the shape. `to == token u` → `400 self`. `|createdAt - now| > 600` → `400 clock`. A bad signature → `400 badSignature`. `displayName` must be 1-64 UTF-16 units with no control characters (the client sanitises; the Worker only caps).
2. Sender quotas, counted exactly in D1 `sends`: more than 10 sends by `u` in 24 h → `429 sendQuota`; any send `u→to` in the last 7 d → `429 pairCooldown`. These reveal only the sender's own history, never anything about the recipient.
3. `to` has no `users` row → `404 notFindable` (unknown, unregistered and not findable are identical). This step still inserts a `sends` row with `to_uuid = '-'`, so probing costs the daily quota. It does not start a pair cooldown, so a retry after the person turns findability on is not blocked.
4. `to` blocked `u` → **`202` with a fresh random id and the normal `expiresAt`, nothing stored**. The response shape and timing class are identical to a real delivery (the same D1 round trips are made, see the test in N 10.1).
5. The recipient already has 20 pending letters → `409 recipientFull` (maps to the existing `errors.friends.requestsFull`).
6. Upsert by `(to_uuid, from_uuid)` (one pending letter per pair; a re-send after the cooldown replaces it), insert into `sends`, return `202`.

**Rate limiting (Workers Rate Limiting binding, coarse, per Cloudflare location):** `LIMITER_IP` = 60 requests / 60 s, keyed by `cf-connecting-ip` (`"unbekannt"` when it is missing), applied to **every** route before anything else, exactly as in `proxy/`. `LIMITER_ACCOUNT` = 30 requests / 60 s, keyed by the token's `u`, applied after token verification. Excess → `429 rateLimited` with `Retry-After: 60`. Exact business quotas (step 2, step 5) are D1 counts, because the binding is documented as approximate.

**Mojang subrequest:** `fetch(hasJoined)` with `AbortSignal.timeout(5000)`, `user-agent: pumpkin-friends-directory (+https://github.com/jonax1337/pumpkin-launcher)`. `compatibility_flags = ["global_fetch_strictly_public"]` as in `proxy/` (harmless if Mojang is not behind Cloudflare).

**Cron (`[triggers] crons = ["17 3 * * *"]`, daily):** delete letters with `expires_at <= now`; delete `sends` older than 7 d; delete `users` with `refreshed_at < now - 30 d`, together with their letters and blocks. Each statement is batched with `LIMIT 5000` so that one run stays inside the 10 ms CPU limit (D1 time is I/O, not CPU).

**Logging:** `[observability] enabled = false` in `wrangler.toml`. No `console.*` with request data. Workers analytics (counts only) stay on.

---

## 5. Storage, retention, deletion, GDPR

### 5.1 Schema (`directory/migrations/0001_init.sql`, applied with `wrangler d1 migrations apply`)
```sql
CREATE TABLE users  (uuid TEXT PRIMARY KEY, created_at INTEGER NOT NULL, refreshed_at INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE letters(id TEXT PRIMARY KEY, to_uuid TEXT NOT NULL, from_uuid TEXT NOT NULL, from_name TEXT NOT NULL,
                     from_peer TEXT NOT NULL, body TEXT NOT NULL /* signed fields as JSON */, created_at INTEGER NOT NULL,
                     expires_at INTEGER NOT NULL, UNIQUE (to_uuid, from_uuid));
CREATE INDEX letters_from ON letters(from_uuid);
CREATE INDEX letters_expiry ON letters(expires_at);
CREATE TABLE blocks (owner_uuid TEXT NOT NULL, blocked_uuid TEXT NOT NULL, created_at INTEGER NOT NULL,
                     PRIMARY KEY (owner_uuid, blocked_uuid)) WITHOUT ROWID;
CREATE TABLE sends  (from_uuid TEXT NOT NULL, to_uuid TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX sends_from ON sends(from_uuid, at);
CREATE INDEX sends_pair ON sends(from_uuid, to_uuid, at);
```

### 5.2 What is stored, and why nothing else
| Data | Where | Why | Kept |
|---|---|---|---|
| UUID of a findable user, first registration, last refresh | `users` | the opt-in itself; needed to answer O1 | until opt-out, disable, or 30 d without a refresh (the launcher refreshes at most once per 24 h while running) |
| Letters: sender uuid, name, peer id (stamp), recipient uuid, nonce, hello id, relay index, secret, display name, times, signature | `letters` | offline delivery | until answered, retracted, blocked, or 14 d |
| Blocks: owner uuid → blocked uuid | `blocks` | server-side refusal | until unblock or unregister |
| Send log: from, to, time | `sends` | exact anti-spam quotas | 7 d (also for non-findable senders) |

**Not stored:** names of findable users (resolution goes through Mojang, N 0), peer ids of findable users (only senders' peer ids, inside their own letters), relay indexes of findable users (nobody dials a recipient from the directory), IP addresses, presence, friend lists, outcomes (accept and decline are both a plain `DELETE`), tokens, challenges.

### 5.3 Deletion paths
- Findable **off**, `friends_disable`, or the 30-day retention → `DELETE /v1/me` (users row, inbox, blocks).
- A letter is deleted on answer, retract, block, or expiry.
- If the Minecraft account was removed from the launcher before an unregister could run, the 30-day retention removes it. There is no mail-based process.
- **D1 Time Travel** keeps deleted rows restorable for **7 days (Free) / 30 days (Paid)**. This cannot be disabled and must be stated in `PRIVACY.md`.

### 5.4 GDPR notes (owner reviews; not legal advice)
- The owner, as operator, becomes **controller** for the directory. Cloudflare is the processor (Cloudflare's self-serve DPA). The data lives in D1 with `jurisdiction eu`. The Worker runs at the edge worldwide, and transient IP processing by Cloudflare is stated.
- Legal basis: consent for findability (Art. 6(1)(a), opt-in, default off, withdrawable with one switch that deletes at once). For sending a letter, the sender's request to contact someone (Art. 6(1)(b)/(f)). For the `sends` log, legitimate interest in abuse prevention (Art. 6(1)(f)), 7 days.
- Data subject requests: everything is keyed by UUID. Access: the user sees their own inbox in the launcher. Erasure: the switch, plus a contact address in `PRIVACY.md` (owner decision OD-N4).
- `PRIVACY.md` gains a section "Freunde-Verzeichnis" with the table of 5.2, the Time Travel note, the retention values and the Mojang calls (N 9.8).

---

## 6. Findable by name (opt-in)

- `FriendsSettings.findableByName` (default `false`) is changed through `friends_update_settings`, or through an optional checkbox in the opt-in dialog (`FriendsEnableInput.findableByName`, default unchecked).
- **Asynchronous:** the command saves the setting and returns at once. The directory loop (N 7.6) registers within seconds (`PUT /v1/me`), or queues `Unregister` on off. The UI reads `FriendsState.directory.state` (`friends-changed` on every change).
- Off is always effective locally at once. If the Worker cannot be reached, the `Unregister` job stays queued and is retried. Sending by name still works while you are not findable.
- **Non-findable users:** O1 answers `404 notFindable`, exactly as for a UUID that was never registered. The UI says "{name} ist nicht per Name auffindbar" and offers the code tabs.
- **No "only accept requests from …" options** in this version. Options like friends-of-friends would need the social graph on the server, which this design refuses to store. The controls are the switch, block, the per-pair cooldown and the global caps. (Owner can revisit; N 12.)

---

## 7. By-name request end to end

### 7.1 Sender: `friend_add_by_name(name)` (synchronous, returns the outgoing `FriendRequest`)
1. `ensure_enabled`, identity available, directory attached (else `directoryUnavailable`). `name.trim()` must match `^[A-Za-z0-9_]{1,16}$` (else `nameInvalid`).
2. Mojang `lookup/name/{name}` (Rust, 10 s, body ≤ 16 KiB). 404 → `nameUnknown{name}`; network error → `directoryUnavailable`. From here on, the canonical name and UUID are used.
3. UUID == own account UUID → `nameOwn`. A friend with `mcUuid == uuid` → `alreadyFriends`. An open by-name request to that UUID → `alreadyRequestedName{name}`. At most `MAX_NAME_REQUESTS = 5` open by-name outgoing requests (`tooManyNameRequests{max}`). The friend cap of 50 counts them (`friendLimit`).
4. `code::issue(identity, code_relay(core))` → `CodeRecord { id, …, expires_at: now + REQUEST_TTL_SECS, name_request_to: Some(uuid) }`.
5. Session (N 3.1). Build and sign the letter (nonce from `getrandom`), then `POST /v1/outbox`. On any error, delete the `CodeRecord` and map the error (N 9.6).
6. Bind the code's hello endpoint (`bind_code`, unchanged, relay-only). Insert `RequestRecord { id: <same id as the CodeRecord>, direction: Outgoing, state: AwaitingAnswer, via: Name, peer_id: None, mc_name: canonical, mc_uuid: uuid, mail_id: Some(letter id), expires_at: letter expiresAt, … }`. Emit `friends-changed`. Return the view.

Nothing else is sent. The sender's IP and peer id never reach the recipient before the recipient accepts, except the peer id inside the letter (shown as a fingerprint, like the invitee's id in SPEC 4.3).

### 7.2 Recipient: fetching the inbox (`by_name::poll`)
Runs only while the feature is enabled and available, the directory is attached, and `findableByName` is true. It runs 10 s after activation, then every `poll_interval` (production **15 min**, injected), and from `friends_retry_now` when the last poll is more than 60 s old. Each letter is checked:
- `to == own uuid`; `from.uuid` 32 hex and `!= own`; `from.name` matches the mcName rule; `from.peerId` parses (`PeerId::from_str`) and is not our own id; `helloId` parses; `relayIndex` is in the map (`find_relay`; otherwise the letter is ignored, not deleted); `createdAt <= now + 600`; `now < expiresAt <= createdAt + REQUEST_TTL_SECS + 600`; the signature verifies with `identity::verify(from.peerId, "pumpkin/name-request/1", parts)`. Invalid → queue `DeleteMail`, and ignore it.
- Locally blocked peer id, or a blocked record with `mc_uuid == from.uuid` → queue `DeleteMail` + `Block{from.uuid}` (idempotent).
- Already a friend with `from.peerId` → queue `DeleteMail`.
- Already stored (`mail_id` equals the letter id) → skip. Pending incoming requests ≥ 20 → leave it on the server (it comes back on a later poll).
- Otherwise insert `RequestRecord { direction: Incoming, state: Pending, via: Name, peer_id: Some(from.peerId), hello_id, relay_index, secret, display_name: sanitize::display_name(displayName, peerId), mc_name: from.name, mc_uuid: from.uuid, mail_id, created_at, expires_at }` and emit `friends-changed` + `friend-request`.
- **Vanished letters:** a pending by-name incoming request whose `mail_id` is no longer in the inbox (retracted by the sender, answered on another PC of the same account, blocked, expired) is deleted locally (`friends-changed`).

### 7.3 Recipient answers
- **Accept** (`friend_request_answer(id, true)` on a `via: name` incoming request): `ensure_friend_capacity`. The record turns into `Outgoing / Delivering / via Name`, keeping `peer_id` (= stamped sender id, the **expected** peer), `hello_id`, `relay_index`, `secret`, `mc_name`, `mc_uuid` and `expires_at`. Then `dial_now(Target::Request(id))` and queue `DeleteMail{mail_id}`. Delivery uses the existing backoff (SPEC 4.3: 30 s … 30 min, `friends_retry_now`, 14 days). The UI shows "{name}: wird verbunden, sobald {name} online ist".
- **Decline:** delete the record and queue `DeleteMail`. Nothing reaches the sender.
- **Block** (`friend_block(peerId)` on it): the existing local block, plus `mc_uuid` stored on `BlockedRecord`, plus queued `Block{uuid}` and `DeleteMail`.

### 7.4 Redemption with the end-to-end proof (changes in `requests.rs` `deliver` and `hello.rs`)
**Redeemer R** (`deliver` for a `via: Name` request in `Delivering`):
1. `tokens.minecraft_session()`, then Mojang `join(serverId_redeemer(hello_id, own_peer_id, secret))`. A failure counts as a failed attempt (backoff); `NotAllowed` also sets `DirectoryState::NotAllowed`.
2. Dial the hello id over `pumpkin/hello/1`. Send `friendRequest{protocol: 1, secret, profile{displayName, mcName: session.name, mcUuid: session.uuid}}` (unchanged wire shape, SPEC 5.2). Wait up to `HELLO_NAME_WAIT = 20 s` (the Mojang calls happen inside it).
3. On `received{peerId, binding, profile}`: `peerId` must equal the record's `peer_id`; the binding verifies (unchanged); Mojang `hasJoined(profile.mcName, serverId_owner(...))` returns a UUID equal to the record's `mc_uuid`. If any check fails → `Delivery::Failed` (retry, no change).
4. **Before closing the hello connection:** `mark_received` (state `AwaitingAnswer`, `mc_name` = the canonical name from Mojang), so that R's Gate already admits S when S dials. Then close with `NORMAL`.
5. `error{codeUsed|alreadyFriends|unsupported}` → delete the request (SPEC 4.3 rule). `error{full}` → keep and retry.

**Owner S** (`hello.rs` `decide`, now async for codes with `name_request_to = Some(uuid_R)`):
1. The secret matches (unchanged; a mismatch is silent).
2. `used_by == Some(other)` → `error{codeUsed}`. `used_by == Some(this peer)` → go to step 4 (idempotent retry).
3. Mojang `hasJoined(profile.mcName, serverId_redeemer(this hello id, conn.remote(), secret))` returns a UUID equal to `uuid_R`, else **close `NORMAL` with no frame** (as for a wrong secret). Friend capacity (else `error{full}`).
4. `tokens.minecraft_session()` + Mojang `join(serverId_owner(...))`. On failure: close silently (R retries).
5. Store `Friend{R, confirmed: false, display_name: sanitised profile.displayName, mc_name/mc_uuid from Mojang}`, set `used_by = R`, delete the outgoing `RequestRecord` with the code's id, and emit `friends-changed`.
6. Answer `received{peerId, binding, profile{…, mcName: session.name}}` and wait for R's close (≤ 20 s). **Only then** `dial_now(Target::Friend(R))`. From there on, SPEC 4.3 is unchanged: R's Gate admits S (`awaitingAnswer`), the control `hello` arrives, and both become confirmed.

**Unconfirmed grace (`status.rs`, applies to all friends):** `NOT_FRIEND` from an **unconfirmed** friend added less than 60 s ago counts as a failed dial (backoff), not as `removedByPeer`. This closes the last ordering race between step 6 and R's step 4.

**Privacy check against SPEC 12.1:** R's permanent id reaches S only in step 2, after R accepted. S's hello endpoint is relay-only, so R does not learn S's IP from it. R's main endpoint may reveal R's addresses to S unless "Immer über Relay" is on: the same statement as for code redemption. S's permanent id was in the letter (fingerprint display), which equals the invitee case of the code flow.

### 7.5 Cancel, expiry, identity operations, disable
- **Cancel (S):** `friend_request_cancel` on a `via: name` outgoing request deletes the request and its `CodeRecord` (closes the hello endpoint) and queues `Retract{mail_id}`. On its next poll, R's launcher deletes its pending copy (N 7.2). If R had already accepted, R's redemption gets no answer, and R's request expires after 14 d (same as a revoked code).
- **Expiry:** the hourly prune (SPEC 4.3) removes requests and codes past `expires_at`. The Worker removes letters itself.
- **Rotate (SPEC 4.6):** by-name outgoing requests are `AwaitingAnswer` and bound to the old key, so they are deleted, their codes deleted, and `Retract` jobs queued. **By-name incoming pending requests are kept** (`drop_requests_bound_to_old_id` skips `via: Name` incoming): they are bound to the sender's id, not ours. The session token is dropped (it carries the old peer id).
- **Reset:** as SPEC 4.6 (all records gone). Registration stays (it is keyed by UUID), and pending letters reappear on the next poll.
- **Disable:** `Lifecycle::Disabled` → drop the session, queue `Unregister`, run the job queue once (≤ 2 s budget), and keep `findableByName` so that re-enabling registers again. While disabled, nothing is polled or sent.
- **Account change** (first Microsoft account changes, the E7 seam): drop the session; if `registered_uuid` ≠ new uuid and the setting is on, queue `Unregister{old}` (only executable while the old account is still present, else dropped and covered by the 30-day retention) and register the new one.

### 7.6 Directory jobs (persistent, `config.json` → `directory.jobs`)
`DeleteMail{mailId, until}`, `Retract{mailId, until}`, `Block{uuid}`, `Unblock{uuid}`, `Unregister{uuid}`. They run in order at the start of every loop tick, and at once after the command that queued them. A `2xx`/`404` result removes a job. A network error, `5xx` or `429` keeps it. `until` (= the letter's expiry) drops stale ones. When findable turns on, `Block` jobs are re-queued for every local `BlockedRecord` with an `mc_uuid` (blocks exist server-side only while registered, N 4 B1).

---

## 8. Abuse and security

| Threat | Control |
|---|---|
| Spam from one account | 10 letters per 24 h per sender; 1 per pair per 7 d (also after cancel, so cancel/resend spam is impossible); recipient sees at most 20 pending; block by UUID server-side; decline costs nothing |
| Spam from many accounts | each needs a paid Minecraft account that may join multiplayer (Mojang proof); IP rate limit 60/min; recipient cap 20 pending (`requestsFull`) |
| Revealing a block | blocked sends get the normal `202` shape with a random id; the Worker test asserts identical responses and the same D1 round trips |
| Enumerating who uses Pumpkin | no lookup route, no listing, no name index; every successful probe delivers a visible request to the target and costs the prober's daily quota; UUIDs of non-findable users are indistinguishable from unknown ones |
| Name squatting, impersonation, renames | identity = Mojang UUID; name → UUID only through Mojang at send time; the stamped name comes from `hasJoined`; at acceptance both sides re-verify through Mojang (N 3.2); display names stay self-asserted and sanitised (SPEC 12.3) with the fingerprint shown |
| Re-registration, two PCs on one account | registration is keyed by UUID; both PCs see the same inbox; the first acceptance wins (`codeUsed` for the other), and the other PC's copy vanishes on its next poll |
| Stolen session token (local memory) | 6 h lifetime, scope limited to my own inbox, blocks and letters; it cannot make friends (needs the Mojang proof and the friends key) |
| Replay of a letter to someone else | the signature covers `to` and `from`; the client checks `to == own uuid` |
| Worker compromise (code, DB or `TOKEN_KEY`) | Can: read who wrote to whom and the findable UUIDs, inject or drop letters, mint tokens, redeem pending secrets. Cannot: become anyone's friend under a false account (N 3.2: the redeemer's and the owner's Mojang proofs are bound to the real peer ids; a redemption with the wrong account is closed silently), learn IPs of launchers beyond Cloudflare's view, or see any P2P traffic. Recovery: rotate `TOKEN_KEY`, redeploy, wipe D1 |
| Worker outage, free-tier exhaustion | `directoryUnavailable` on send; polling retries silently; codes, presence, invites and tunnels are unaffected (no code path in `p2p`, `hosting`, `joining` or `status` touches the directory) |
| Mojang outage | send (lookup), registration and acceptance wait and retry; existing friends are unaffected |
| What the Worker never sees | Minecraft access tokens, tunnel or control traffic, presence, invites, manifests, friend lists, IPs stored (Cloudflare processes them transiently), the outcome of a request |
| Logs | Rust: never log tokens, secrets, letters, hello ids; UUIDs and peer ids only as their first 8 hex chars. Worker: no request logging |

---

## 9. Client integration

### 9.1 Rust modules
```
src-tauri/src/services/friends/directory/
  mod.rs      DirectoryDeps, AccountTokens, McIdentity, DirectoryError (+ From for AppError, N 9.6),
              DEFAULT_DIRECTORY: &str = "" (owner fills after deploy), directory_url() (env PUMPKIN_FRIENDS_DIRECTORY,
              runtime then build-time, https only via services::endpoint_url::https_base)
  wire.rs     serde types of N 4 (Challenge, SessionRequest, DirectorySession, OutgoingLetter, InboxLetter, LetterFrom, ErrorBody)
  api.rs      trait DirectoryApi + WorkerApi (reqwest, 10 s timeout, body cap 64 KiB via transport::read_capped)
  mojang.rs   trait MojangSessions + MojangHttp (join, hasJoined, lookup/name; reuses skins::PLAYER_LOOKUP)
  proof.rs    pure: letter_parts, auth_parts, server_id_redeemer, server_id_owner, validate_letter (N 7.2), vectors
  fake.rs     #[cfg(test)] FakeDirectory (in-memory Worker semantics incl. quotas, blocks, a `compromised` switch),
              FakeMojang (join records (uuid, serverId); hasJoined answers like Mojang; lookup table; refusals)
  http_tests.rs #[cfg(test)] loopback HTTP/1.1 server (tokio TcpListener) serving canned Worker answers for WorkerApi
src-tauri/src/services/friends/by_name.rs        impl Friends { add_by_name } + session cache, poll loop, jobs, owner-side redemption
src-tauri/src/services/friends/tests_by_name.rs  #[cfg(test)] two-service tests (N 10.2)
src-tauri/src/services/endpoint_url.rs           https_base(raw) -> Option<String> (moved from curseforge/proxy.rs parse_proxy)
```

```rust
// directory/mod.rs
/// Gültige Minecraft-Sitzung des ersten Microsoft-Kontos; das Token verlässt Rust nie.
#[derive(Clone)] pub struct McIdentity { pub uuid: String /* 32 lowercase hex */, pub name: String, pub access_token: String }  // Debug redacts the token
pub trait AccountTokens: Send + Sync + 'static {
    fn minecraft_session(&self) -> BoxFuture<'_, AppResult<McIdentity>>;   // production: auth::session of account_profile()
}
pub struct DirectoryDeps { pub api: Arc<dyn DirectoryApi>, pub mojang: Arc<dyn MojangSessions>, pub tokens: Arc<dyn AccountTokens>, pub poll_interval: Duration }
impl DirectoryDeps { pub fn production(http: reqwest::Client, tokens: Arc<dyn AccountTokens>) -> Option<Self>; }  // None without a URL
pub const PRODUCTION_POLL: Duration = Duration::from_secs(900);
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DirectoryError { Unreachable, Unauthorized, NotFindable, NotRegistered, RecipientFull, SendQuota, PairCooldown,
                          RateLimited { retry_after: Option<u64> }, NotJoined, MojangUnavailable, Invalid(&'static str) }

// directory/api.rs; every method maps HTTP status + {"error"} to DirectoryError
pub trait DirectoryApi: Send + Sync + 'static {
    fn challenge<'a>(&'a self, peer_id: &'a str) -> BoxFuture<'a, Result<Challenge, DirectoryError>>;
    fn session<'a>(&'a self, request: &'a SessionRequest) -> BoxFuture<'a, Result<DirectorySession, DirectoryError>>;
    fn register<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>>;
    fn unregister<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>>;
    fn send<'a>(&'a self, token: &'a str, letter: &'a OutgoingLetter) -> BoxFuture<'a, Result<SentLetter, DirectoryError>>;
    fn retract<'a>(&'a self, token: &'a str, id: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>>;
    fn inbox<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<Vec<InboxLetter>, DirectoryError>>;
    fn delete<'a>(&'a self, token: &'a str, id: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>>;
    fn block<'a>(&'a self, token: &'a str, uuid: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>>;
    fn unblock<'a>(&'a self, token: &'a str, uuid: &'a str) -> BoxFuture<'a, Result<(), DirectoryError>>;
}

// directory/mojang.rs
#[derive(Debug, Clone, PartialEq, Eq)] pub struct MojangProfile { pub uuid: String, pub name: String }
#[derive(Debug, Clone, PartialEq, Eq)] pub enum MojangError { Unreachable, NotAllowed, InvalidSession, RateLimited }
pub trait MojangSessions: Send + Sync + 'static {
    fn join<'a>(&'a self, session: &'a McIdentity, server_id: &'a str) -> BoxFuture<'a, Result<(), MojangError>>;
    fn has_joined<'a>(&'a self, name: &'a str, server_id: &'a str) -> BoxFuture<'a, Result<Option<MojangProfile>, MojangError>>;
    fn lookup_name<'a>(&'a self, name: &'a str) -> BoxFuture<'a, Result<Option<MojangProfile>, MojangError>>;
}

// service.rs / by_name.rs
impl Friends {
    pub fn attach_directory(&self, deps: DirectoryDeps) -> Result<(), HandlerAlreadySet>;   // once; before or after start
    pub async fn add_by_name(&self, name: &str) -> AppResult<FriendRequest>;               // N 7.1
}
```
- **Wiring:** in `lib.rs` `setup`, before `start_friends`: `if let Some(deps) = DirectoryDeps::production(state.http.clone(), Arc::new(AppAccountTokens::new(app.handle().clone()))) { state.friends.attach_directory(deps) }`. `AppAccountTokens` lives in `friends_commands.rs`: `account_profile(&state)` → `auth::session(&state, &account.id)` → `McIdentity`. That breaks the `AppState` → `Friends` cycle through the `AppHandle`. Without a URL, nothing is attached and `DirectoryState::Unavailable` follows.
- The loop `by_name::spawn_directory_loop(core, runtime)` starts next to `spawn_hourly_prune` and stops with `runtime.stop`.
- `Core` gains `directory: OnceLock<DirectoryDeps>`, `directory_session: Mutex<Option<DirectorySession>>`, `directory_state: Mutex<DirectoryState>`, `auth_lock: tokio::sync::Mutex<()>`, and `last_poll: Mutex<Option<Instant>>`.
- `skins.rs`: `PLAYER_LOOKUP`, `valid_player_name` and `parse_player` become `pub(crate)`. `curseforge/proxy.rs` uses `endpoint_url::https_base` (same behaviour, its tests stay).

### 9.2 Records and config (append-only, all new fields `#[serde(default)]`; old files keep loading)
```rust
pub struct RequestRecord { …, #[serde(default)] pub via: RequestVia /* Code */, #[serde(default)] pub mail_id: Option<String> }
pub struct CodeRecord    { …, #[serde(default)] pub name_request_to: Option<String> /* target uuid; Some = by-name request code */ }
pub struct BlockedRecord { …, #[serde(default)] pub mc_uuid: Option<String> }
pub struct FriendsConfig { …, #[serde(default)] pub directory: DirectoryConfig }
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct DirectoryConfig { pub registered_uuid: Option<String>, pub refreshed_at: Option<u64>, pub jobs: Vec<DirectoryJob> }
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DirectoryJob { DeleteMail { mail_id: String, until: u64 }, Retract { mail_id: String, until: u64 },
                        Block { uuid: String }, Unblock { uuid: String }, Unregister { uuid: String } }
```
- `active_codes` (the 3-code cap, `friend_codes`) counts and lists only `name_request_to == None`. `bind_active_codes`, `own_hello_ids` and prune cover both kinds.
- `FriendsSettings.findable_by_name` is persisted through `config.settings` (`#[serde(default)]` on that field only, for old files).

### 9.3 Contract additions (SPEC 8.2; serde rules of 8.1)
```rust
pub const MAX_NAME_REQUESTS: usize = 5;  pub const MC_NAME_MAX: usize = 16;  pub const NAME_COOLDOWN_DAYS: u64 = 7;
pub enum RequestVia { Code, Name }                                                  // unit, camelCase
pub enum DirectoryState { Unavailable, Off, Active, Unreachable, NotAllowed }       // unit, camelCase
pub struct DirectoryStatus { pub state: DirectoryState, pub host: Option<String> /* for the PrivacyNotice; None if unavailable */ }
pub struct FriendsSettings { pub display_name: String, pub always_relay: bool, pub findable_by_name: bool }
pub struct FriendsEnableInput { pub display_name: String, pub always_relay: bool, pub accept_third_party_relays: bool, pub findable_by_name: bool }
pub struct FriendsState { …, pub directory: DirectoryStatus }
pub struct FriendRequest { …, pub via: RequestVia }
```
`DirectoryState`: `Unavailable` = no directory attached (no URL in this build); `Off` = `findableByName` false; `Active` = registered and the last directory call succeeded; `Unreachable` = the last register or poll failed (network, 5xx, 429); `NotAllowed` = Mojang refused `join` (polling and registration pause until the setting is toggled or the app restarts). `friends_state` computes it whether or not the feature is enabled.

TS (`friends-types.ts`):
```ts
export const FRIENDS_LIMITS = { …, maxNameRequests: 5, mcNameMax: 16, nameCooldownDays: 7 } as const;
export type RequestVia = "code" | "name";
export type DirectoryState = "unavailable" | "off" | "active" | "unreachable" | "notAllowed";
export interface DirectoryStatus { state: DirectoryState; host: string | null }
export interface FriendsSettings { displayName: string; alwaysRelay: boolean; findableByName: boolean }
export interface FriendsEnableInput { displayName: string; alwaysRelay: boolean; acceptThirdPartyRelays: boolean; findableByName: boolean }
// FriendsState += directory: DirectoryStatus;   FriendRequest += via: RequestVia
```

### 9.4 Commands and events
| Rust command | Args (TS) | Returns | TS method | Notes |
|---|---|---|---|---|
| `friend_add_by_name` | `name` | `FriendRequest` (`via: "name"`, `awaitingAnswer`, `peerId: null`) | `friendAddByName(name)` | synchronous, N 7.1; needs the feature (`disabled` else) |

- No other new command. Findability goes through `friends_update_settings` / `friends_enable`. Answer, cancel and block use the existing commands with `via`-specific behaviour (N 7.3, 7.5). `friends_retry_now` also triggers an inbox poll (≥ 60 s apart).
- **No new event.** Directory state changes and inbox arrivals use `friends-changed`; a new incoming by-name request also emits `friend-request` (SPEC 8.5, unchanged payloads).
- `backend-tauri.ts`: `friendAddByName: (name) => call("friend_add_by_name", { name })`.

### 9.5 Fixtures (SPEC 8.3 table, new and changed rows)
| Key | Type | Content |
|---|---|---|
| `friendsState.available` (changed) | `FriendsState` | `settings.findableByName: true`, `directory: {state: "active", host: "directory.example"}` |
| `friendsState.noSecretStore`, `.identityLost` (changed) | `FriendsState` | `directory: {state: "off", host: …}` resp. `{state: "unavailable", host: null}` (one each) |
| all `request.*` (changed) | `FriendRequest` | `via: "code"` |
| `request.nameIncoming` (new) | `FriendRequest` | `via: "name"`, `pending`, `peerId`/`fingerprint` set, `mcName`, `codeTail: null` |
| `request.nameOutgoing` (new) | `FriendRequest` | `via: "name"`, `awaitingAnswer`, `peerId: null`, `mcName` |
| `request.nameDelivering` (new) | `FriendRequest` | `via: "name"`, `delivering`, `peerId` set (accepted, waiting for the sender) |
| `constants` (changed) | | the three new constants |

### 9.6 Error keys (Appendix A additions, de source + en twin)
| Key | Params | German |
|---|---|---|
| `errors.friends.nameInvalid` | | Das ist kein gültiger Minecraft-Name |
| `errors.friends.nameUnknown` | `name` | Es gibt keinen Minecraft-Spieler „{name}“ |
| `errors.friends.nameNotFindable` | `name` | {name} ist nicht per Name auffindbar; tauscht stattdessen einen Freundescode aus |
| `errors.friends.nameOwn` | | Das ist dein eigener Minecraft-Name |
| `errors.friends.alreadyRequestedName` | `name` | An {name} geht schon eine Anfrage |
| `errors.friends.tooManyNameRequests` | `max` | Höchstens {max} offene Anfragen per Name; warte auf Antworten oder ziehe eine zurück |
| `errors.friends.nameCooldown` | `name`, `days` | Du hast {name} in den letzten {days} Tagen schon eine Anfrage geschickt |
| `errors.friends.directoryUnavailable` | | Das Freunde-Verzeichnis ist gerade nicht erreichbar; nutze einen Freundescode |
| `errors.friends.directoryNotAllowed` | | Mojang erlaubt diesem Konto keine Mehrspieler-Funktionen; Freunde per Name geht damit nicht |

Mapping: `NotFindable` → `nameNotFindable`; `RecipientFull` → existing `requestsFull`; `SendQuota` / `RateLimited` → existing `rateLimited`; `PairCooldown` → `nameCooldown{name, days: 7}`; `Unreachable` / `MojangUnavailable` / `NotRegistered` / `Invalid` → `directoryUnavailable` (`Invalid` also logs a warning: it means a client or Worker bug); `NotJoined` after one retry → `directoryUnavailable`; Mojang `NotAllowed` → `directoryNotAllowed`; `InvalidSession` → refresh once, then `errors.app.auth.relogin`; `Unauthorized` → re-auth once, then `directoryUnavailable`.

### 9.7 Frontend
- **AddFriendDialog** (`src/pages/friends/AddFriendDialog.tsx`, width 520, height 600): three `Tabs` in this order: **"Per Name"** (new `NameTab.tsx`, the default), "Code eingeben", "Mein Code". `AddFriendTab = "name" | "enter" | "mine"`. `AddFriendButtons`: the primary "Freund hinzufügen" opens `"name"` (or `"enter"` when `directory.state === "unavailable"`, in which case the Name tab is hidden).
  - Name tab: a `TextField` "Minecraft-Name" (placeholder "z. B. Steve", `maxLength 16`, shape check `isMcName` from `friendsModel.ts`, regex `^[A-Za-z0-9_]{1,16}$`). Primary "Anfrage senden" calls `friendAddByName`; on success, toast "Anfrage an {name} gesendet" and close.
  - Hint (always): "{name} sieht deinen Minecraft-Namen, deinen Anzeigenamen und deinen Fingerabdruck. Erst wenn {name} annimmt, verbinden sich eure Launcher. Das Pumpkin-Verzeichnis hält die Anfrage bis zu 14 Tage bereit."
  - `nameNotFindable` is shown **inline** (warning with symbol, not a toast) with the action "Meinen Code zeigen", which switches to "Mein Code". `directory.state === "unreachable"`: a `StatusPanel` with "Verzeichnis gerade nicht erreichbar; nutze einen Code". When my own `findableByName` is false, an info line: "Andere finden dich nur per Name, wenn du es in den Einstellungen erlaubst." with a link to `/settings?tab=freunde`.
- **RequestsSection** (`RequestsSection.tsx`, texts from `friendsModel.ts` `requestLine(request)`):
  - Incoming `via: name`: name + fingerprint + a "Minecraft: {mcName}" sub-line, with a tooltip "Vom Verzeichnis geprüft; beim Annehmen prüfen beide Launcher das Konto noch einmal bei Mojang". Actions "Annehmen", "Ablehnen", and "Blockieren" in the menu.
  - Outgoing `via: name` `awaitingAnswer`: "Anfrage an {mcName} · wartet auf Antwort" + "Zurückziehen". No expired-code hint.
  - Outgoing `via: name` `delivering`: "{mcName}: wird verbunden, sobald {mcName} online ist" + "Jetzt zustellen" + "Zurückziehen".
  - `codeMayBeExpired` returns false for `via: name`.
- **Settings > Freunde** (`FriendsTab.tsx`): a new `FormRow` "Per Minecraft-Namen auffindbar" `Switch` (hidden when `unavailable`), hint "Wer deinen Minecraft-Namen kennt, kann dir Anfragen schicken. Das Pumpkin-Verzeichnis speichert dafür nur deine Minecraft-UUID, solange das an ist; aus = sofort gelöscht." Status line: `active` "Auffindbar als {mcName}", `unreachable` "Verzeichnis nicht erreichbar; neuer Versuch läuft", `notAllowed` (warning with symbol) "Mojang erlaubt diesem Konto keine Mehrspieler-Funktionen".
- **Opt-in dialog** (`FriendsOptInDialog.tsx`): an optional checkbox "Per Minecraft-Namen auffindbar sein" (unchecked, hidden when `unavailable`) feeds `FriendsEnableInput.findableByName`. Text changes in N 9.8.
- **PrivacyNotice** (`components/PrivacyNotice.tsx`): a new `ServiceRow` "Freunde-Verzeichnis" with `directory.host` and the purpose "Nur wenn du per Name auffindbar bist oder jemandem per Name schreibst: Minecraft-UUID, Anfragen bis 14 Tage". The sessionserver row's purpose gains "Kontonachweis für das Verzeichnis und beim Annehmen". A new row "Minecraft-Namenssuche" with `api.minecraftservices.com` ("Name → UUID, nur beim Senden per Name").
- **Mock** (`mock-friends.ts`): `friendAddByName`: `Steve` → outgoing `awaitingAnswer`; `Herobrine` → `nameUnknown`; `Versteckt` → `nameNotFindable`; `Spammer` → `nameCooldown`; a name of an existing friend → `alreadyFriends`. `?mock=freunde` gets `findableByName: true`, `directory: {state: "active", host: "verzeichnis.pumpkin.example"}`, one incoming by-name and one outgoing by-name request. `?mock=freunde-leer` gets `findableByName: false` / `"off"`. A new `?mock=freunde-ohne-verzeichnis` gets `"unavailable"` (Name tab hidden). Hooks: `pumpkinMock.nameRequest(name)` (incoming via name), `pumpkinMock.nameAccepted(name)` (outgoing → friend, unconfirmed → online after 1 s), `pumpkinMock.directory("active"|"unreachable"|"notAllowed")`. `friendsUpdateSettings` with `findableByName` true → `"active"` after 800 ms.
- i18n: namespaces `friends` (dialog, rows) and `friendsSettings` (switch, status, opt-in, privacy), German source and English twin.

### 9.8 Privacy text (SPEC 12.1 and 10.9, normative wording basis)
SPEC 12.1 gains:
- Finding by name is off until you turn on "Per Minecraft-Namen auffindbar". Then the Pumpkin directory (Cloudflare Worker, database in the EU) stores your Minecraft UUID, and nothing else about you, and keeps requests to you for up to 14 days. Off deletes it at once (restore history up to 7/30 days, N 5.3).
- A request by name carries your Minecraft name, UUID, display name and friends id. The directory sees it, and sees who wrote to whom. It never sees whether the request was accepted, and never sees presence or connections.
- Whoever writes to you by name learns your friends id and (unless "Immer über Relay") your addresses only after you accept.
- To log in to the directory and on every acceptance, Mojang confirms your account, exactly like joining an online-mode server (`sessionserver.mojang.com`). Names are looked up at Mojang (`api.minecraftservices.com`).

Opt-in dialog, first bullet becomes: "Freunde über Codes, die ihr selbst austauscht, oder per Minecraft-Name, wenn die andere Person das erlaubt. Wer dir eine Anfrage schickt, sieht deine IP-Adresse dadurch nicht." Bullet 5 becomes: "Kein Chat, kein Tracking, keine öffentlichen Listen; die Suche per Name findet nur genaue Namen von Leuten, die das eingeschaltet haben. Jederzeit abschaltbar."

### 9.9 Mojang wire facts the Rust client relies on (`directory/mojang.rs`)
- `join`: 204 → Ok; 403 + `InsufficientPrivilegesException` | `UserBannedException` → `NotAllowed`; 403 + `InvalidCredentialsException` | 401 → `InvalidSession`; 429 → `RateLimited`; other → `Unreachable`. Timeout 10 s.
- `hasJoined`: 200 + JSON `{id, name}` (id 32 hex, name valid) → `Some`; 204 → `None`; other → `Unreachable`. Body ≤ 64 KiB.
- `lookup/name`: 200 → `Some`; 404 → `None`; 429 → `RateLimited`; other → `Unreachable`. Body ≤ 16 KiB.

### 9.10 SPEC.md edits (N-D0, before code)
1.2 (non-goals), 4.3 (pointer to N 7), 4.6 (rotate keeps by-name incoming, deletes by-name outgoing + retract), 8.2/8.3/8.4 (N 9.3-9.5), 9 (records/config fields of N 9.2), 10.3 (three tabs), 10.8/10.9 (switch, opt-in), 12.1 (N 9.8), 12.4 (directory rows), Appendix A (N 9.6), Appendix B (pointer to N Appendix A), section 14 (pointer to N 11).

---

## 10. Testing

### 10.1 Worker (`node directory/test.mjs`, no Cloudflare account and no network, Node 24 as in CI)
- **Harness:** `directory/test/d1.mjs` adapts `node:sqlite` `DatabaseSync` to D1's `prepare().bind().first/all/run` and `batch`, and loads `migrations/0001_init.sql`. Fake Mojang through a `globalThis.fetch` stub: the test "joins" `(uuid, name, serverId)`; `hasJoined` answers 200 or 204 like Mojang, with switchable 429/5xx/timeout. Real Ed25519 keys come from WebCrypto `generateKey`. Rate-limit fakes record their keys, as in `proxy/test.mjs`. A fake clock is injected through `env.NOW` (test only; production uses `Date.now()`).
- **Cases** (each prints `ok`/`FAIL`, exit code 1 on any FAIL):
  - Routing: unknown route 404, `Origin` 403, oversize 413.
  - Fail closed without `DB`, `LIMITER_IP`, `LIMITER_ACCOUNT` or `TOKEN_KEY` (503, no Mojang call).
  - Auth: challenge round trip; expired or tampered challenge; signature over a different peer id → 401 badSignature; hasJoined 204 → notJoined; 429/5xx/timeout → mojangUnavailable; token expiry and tamper → 401.
  - Directory and inbox: register / refresh / unregister (cascade inbox + blocks); send to unregistered → 404 = send to unknown (byte-equal bodies); self → 400; clock skew → 400; bad letter signature → 400 and nothing stored; stamp equals the token; inbox shows only own letters; delete or retract by a stranger has no effect.
  - Abuse: **blocked send → 202 with the same keys, status and D1 statement count as a real send, the recipient's inbox stays empty**; pair cooldown after cancel; daily quota 10; recipient full 409; blocks-list cap.
  - Cron and keys: cleanup (letters, 7-day sends, 30-day users with cascade); rate-limit keys (IP, uuid); no `console.*` calls during the run (spy).
  - Golden vectors of N Appendix A (letter and auth signatures verify).
- CI: append a step `node directory/test.mjs` to the Node job in `.github/workflows/ci.yml`.

### 10.2 Rust (CI on all three OSes; the time rule of SPEC 13.1 applies)
- `proof.rs`: vectors A.1-A.4, `validate_letter` table (every rule of N 7.2).
- `wire.rs`: JSON shapes against the examples of N 4.
- `mojang.rs`: parse tables of N 9.9 (pure functions over status + body).
- `api.rs` (`http_tests.rs`): loopback HTTP server, status/error mapping, bearer header, body cap, https-only URL parsing (`endpoint_url`), `PUMPKIN_FRIENDS_DIRECTORY` override.
- `tests_by_name.rs`: two `Friends` services with temp dirs, the in-process relay (SPEC 3.7), **one shared `FakeDirectory` and one shared `FakeMojang`** (the in-process fake directory):
  1. Full flow: S sends by name → R polls → accept → both friends, `confirmed`, verified `mcName`/`mcUuid` on both.
  2. S offline when R accepts → R stays `delivering`; S starts; `friends_retry_now` on R delivers within 5 s.
  3. Decline: S stays `awaitingAnswer`; S's hello endpoint sees no connection.
  4. Block: the server block exists, S's next send gets `Ok` (202) and R's inbox stays empty.
  5. Cancel by S: R's pending copy disappears on the next poll; R's late acceptance gets no answer.
  6. Compromised directory: a letter with a forged stamp (victim uuid, attacker peer id) → R's proof fails, no friendship. Attacker redeems S's code with the stolen secret → silent close, S has no new friend. A `received` peer id differing from the stamp → `Failed`.
  7. Rotate on S: by-name outgoing gone, `Retract` queued. Rotate on R: by-name incoming kept.
  8. Disable → `Unregister` executed. Findable on → registered within one loop tick. Jobs survive a restart (`config.json`).
  9. Directory down: `add_by_name` → `directoryUnavailable`; the code flow still works end to end in the same test.
  10. `NotAllowed` from Mojang → `directory.state = notAllowed`, polling paused.
  11. Two concurrent `add_by_name` → one Mojang `join` (auth lock); a cached token is reused; `401` → exactly one re-auth.
  12. Unconfirmed grace: `NOT_FRIEND` within 60 s does not set `removedByPeer`.
  13. Poll schedule with the fake clock (paused time, no sockets): 10 s, then the injected interval, retry_now ≥ 60 s apart.
- Records/config: old JSON without the new fields loads. Contract fixture test with the new rows (SPEC 8.3 mechanism).

### 10.3 Frontend
- `pnpm build` (fixtures via `satisfies`, i18n completeness); `pnpm check:lib` with `friendsModel.check.mjs` extended (`isMcName`, `requestLine` per via/state, default tab per directory state, `codeMayBeExpired` false for name).
- Mock pass, German and English, 900 px, forced colors: the three scenarios of N 9.7 and every hook. Layout shift rule of SPEC 13.2 unchanged.

### 10.4 Owner-verified (results in `VERIFICATION.md`, new table "N")
| # | Case | Pass |
|---|---|---|
| N1 | Deploy (D1 eu, migrations, secret, cron, rate limits); `curl` of an unknown route → 404, with `Origin` → 403 | as stated |
| N2 | Real handshake: findable on with a real Microsoft account | `active` within 30 s; the D1 `users` row has the right UUID and nothing else |
| N3 | Two PCs, two accounts: A sends to B's exact name while B's launcher is closed; B starts | the request appears within 30 s of the Friends page opening; accept → both friends within 30 s; Mojang names correct |
| N4 | Decline, then A re-sends | A sees `nameCooldown`; B sees nothing |
| N5 | Block A, A sends after the cooldown (or with the cooldown shortened in a test deploy) | A sees "gesendet", B's inbox stays empty |
| N6 | Findable off | D1 rows gone at once; A's send → `nameNotFindable` |
| N7 | Child account or multiplayer-disabled account, if available | `notAllowed` shown, codes still work |
| N8 | Worker stopped (`wrangler delete` on a test deploy, or wrong URL via env) | by-name shows `directoryUnavailable`; presence, invites and a tunnel join keep working |
| N9 | While Minecraft joins a real online server, trigger a directory login | record whether the server join is affected (risk R2) |

---

## 11. Work packages

Ownership rules as in SPEC 14 (exclusive files while a package runs; append-only shared files: `Cargo.toml`/`Cargo.lock`, `errors.friends.ts` (both languages), `services/friends/mod.rs`, `services/mod.rs`, `lib.rs` `generate_handler!`, `package.json` `check:lib`, `.github/workflows/ci.yml` (append a step only)). Every package follows the clean-code skill, adds its tests, and keeps CI green.

| Id | Title | Files (exclusive) | Depends | Acceptance (agent-verifiable) |
|---|---|---|---|---|
| **N-D0** | Spec into repo | `docs/friends/BYNAME.md` (this file), `docs/friends/SPEC.md` (sections of N 9.10 only) | — | SPEC.md contract sections equal N 9.2-9.6; the change rule is satisfied before any code package merges |
| **W1** | Worker `directory/` | `directory/**` (`README.md` German like `proxy/`, `wrangler.toml`, `migrations/0001_init.sql`, `src/{index,auth,letters,store,util}.js`, `test.mjs`, `test/d1.mjs`, `.gitignore`); `.github/workflows/ci.yml` (append) | N-D0 | `node directory/test.mjs` all ok (every case of N 10.1, vectors A.1/A.2); routes and JSON exactly N 4; `wrangler.toml` has D1 binding `DB`, `[[ratelimits]]` `LIMITER_IP` (60/60, namespace 1101) and `LIMITER_ACCOUNT` (30/60, namespace 1102), cron, `observability.enabled = false`, `global_fetch_strictly_public`; README has the owner runbook (N 11.1) and the route list; no dependency outside Node built-ins |
| **N-F1** | Frontend contract, mock, errors | `src/lib/friends-types.ts`, `src/lib/friends-fixtures.ts`, `src/lib/backend.ts`, `src/lib/backend-tauri.ts`, `src/lib/mock-friends.ts`, `src/hooks/useFriends.ts` (`useAddFriendByName`), `src/i18n/{de,en}/errors.friends.ts` (append), `src/i18n/{de,en}/mock.ts` | N-D0 | `pnpm build` + `pnpm check:lib` green; the types and fixture keys of N 9.3/9.5 exactly; mock scenarios and hooks of N 9.7 work in `pnpm dev` |
| **N-R1** | Rust contract, records, config, proof | `services/friends/{contract.rs, contract_tests.rs, records.rs, config.rs}`, `services/friends/directory/mod.rs` (stub + consts), `services/friends/directory/proof.rs`, `services/friends/mod.rs` (append `mod directory`) | N-F1 | fixture equality incl. the new rows; old JSON loads; vectors A.1-A.4 in Rust equal the Node values; `validate_letter` table; no behaviour change elsewhere (`cargo test` green) |
| **N-R2** | Directory and Mojang clients | `services/friends/directory/{mod.rs (fill), wire.rs, api.rs, mojang.rs, fake.rs, http_tests.rs}`, `services/endpoint_url.rs` (new), `services/mod.rs` (append), `services/providers/curseforge/proxy.rs` (use `https_base`), `services/skins.rs` (visibility only) | N-R1 (API shape from N 4; runs in parallel with W1) | the N 10.2 tests for wire/mojang/api green; `FakeDirectory` implements every O1 rule of N 4 (shared table test with the Worker's case list); zero new clippy warnings; existing proxy and skins tests green |
| **N-R3** | By-name flow in the friends service | `services/friends/{by_name.rs (new), tests_by_name.rs (new), hello.rs, requests.rs, service.rs, status.rs}`, `src-tauri/src/friends_commands.rs` (command + `AppAccountTokens`), `src-tauri/src/lib.rs` (handler + `attach_directory` in setup) | N-R2 | all 13 cases of N 10.2 `tests_by_name.rs`; the existing R4/R5 tests stay green; **takes over Appendix E E7 if still open** (both need account-change observation) and moves it to "Resolved" |
| **N-F2** | UI | `src/pages/friends/{AddFriendDialog.tsx, NameTab.tsx (new), RequestsSection.tsx, friendsModel.ts, friendsModel.check.mjs}`, `src/pages/settings/FriendsTab.tsx`, `src/components/friends/FriendsOptInDialog.tsx`, `src/components/PrivacyNotice.tsx`, `src/i18n/{de,en}/{friends,friendsSettings}.ts` | N-F1 | N 9.7 behaviour in the mock (all three scenarios, de/en, 900 px, forced colors); `check:lib` cases of N 10.3; layout shift < 0.001 on `/friends?mock=freunde` |
| **N-D1** | Docs final | `docs/friends/PRIVACY.md`, `docs/friends/OWNER-CHECKLIST.md`, `docs/friends/VERIFICATION.md` (table N), `docs/friends/BYNAME.md` (deviations written back) | W1, N-R3, N-F2 | PRIVACY.md has N 5.2/5.3/9.8; the owner checklist has N 11.1; the deviations of all packages are written back |
| **O1** | **Owner only** | Cloudflare account, D1, secret, route/domain, `DEFAULT_DIRECTORY` value, Mojang approval question, N 10.4 runs | W1 (deploy); N-R3, N-F2 (N2-N9) | `VERIFICATION.md` table N filled |

Waves: **0** N-D0 → **1** W1 ∥ N-F1 → **2** N-R1 → **3** N-R2 → **4** N-R3 ∥ N-F2 → **5** N-D1, O1. (W1 may finish any time before O1.)

### 11.1 Owner-only steps (in `directory/README.md` and `OWNER-CHECKLIST.md`)
1. `cd directory && npx wrangler login`
2. `npx wrangler d1 create pumpkin-friends-directory --jurisdiction eu` and put the `database_id` into `wrangler.toml`. The jurisdiction can only be set at creation.
3. `npx wrangler d1 migrations apply pumpkin-friends-directory --remote`
4. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put TOKEN_KEY`
5. `npx wrangler deploy` (Wrangler ≥ 4.36 for `[[ratelimits]]`).
6. Optional: custom domain or route. Then put the final URL into `DEFAULT_DIRECTORY` (one-line PR).
7. Answer OD-N3 (Mojang/Microsoft) and write the privacy-policy section (OD-N4).
8. Run N 10.4.

---

## 12. Risks and open owner decisions

**Risks (honest list)**
- **R1 Mojang dependency.** `join`/`hasJoined` are the game's session endpoints, used by every online-mode server, but they are undocumented for this purpose and could change or rate-limit. `hasJoined` comes from Cloudflare's shared egress IPs; if Mojang throttles those IPs (most of the API: 200 requests per 2 min per IP), registration fails with `mojangUnavailable` while the end-to-end proof (client IPs) still works. Mitigations: 6-hour tokens and one handshake per launcher per session.
- **R2 `join` side effect.** A `join` replaces the account's pending server join for a few seconds. If the user's game is logging in to a real server at that exact moment, that login can fail once ("Failed to verify username"). The window is tiny and the event rare; N9 measures it. A later mitigation could skip directory auth while an instance is in its first 60 s.
- **R3 Single operator.** One Worker means one point of failure and one point of trust. A compromise leaks metadata (who wrote to whom, findable UUIDs, pending secrets) and allows spam, but not impersonation (N 3.2). Codes keep working.
- **R4 Free-tier capacity.** About 4 polls per hour per running findable launcher, plus about 1 auth per 6 h. 100 k requests/day covers roughly 2,000-3,000 daily active findable users (8 h sessions). D1's 100 k written rows/day covers roughly 15 k letters/day. Beyond that, the Worker answers errors (by-name unavailable) until 00:00 UTC.
- **R5 GDPR duties.** The owner becomes controller of a hosted service: privacy policy, data subject requests, and a processor agreement with Cloudflare. D1 Time Travel keeps deleted rows up to 7/30 days.
- **R6 Self-asserted remainder.** Display names stay self-asserted. Only the Minecraft account is verified, and only at request and acceptance time (later `profile` changes are self-asserted as before).
- **R7 Latency.** Inbox polling makes delivery up to 15 min late unless the recipient opens the Friends page (`friends_retry_now`). Push is a non-goal for now.
- **R8 Multiple PCs per account.** They share one inbox; the first acceptance wins. Acceptable, but surprising.

**Open owner decisions**
| # | Decision | Proposal |
|---|---|---|
| OD-N1 | Who runs it, where: Cloudflare account, D1 jurisdiction, `workers.dev` vs custom domain | own account (as `proxy/`), D1 `eu`, `pumpkin-friends-directory.jonas-laux.workers.dev` first |
| OD-N2 | Plan: Free (hard daily caps, 7-day Time Travel) or Paid ($5/month, 30-day Time Travel, no hard caps) | Free for the closed beta; switch at about 1,500 daily active findable users |
| OD-N3 | Does the Microsoft/Mojang app approval cover `join`/`hasJoined` for directory auth and the sharing of names/UUIDs (extends G4)? | ask before release; a release gate for by-name only |
| OD-N4 | Retention values (30 d registration, 14 d letters, 7 d send log), privacy policy text, contact address for data requests | as proposed |
| OD-N5 | Forks: compile `DEFAULT_DIRECTORY` into every build from source, or only official builds (build-time env) | official builds only: `DEFAULT_DIRECTORY = ""`, release CI sets `PUMPKIN_FRIENDS_DIRECTORY` (like the fork rule in `proxy/README.md`) |
| OD-N6 | Token TTL 6 h and poll interval 15 min (cost vs latency) | as proposed |
| OD-N7 | Findable checkbox in the opt-in dialog, or settings only | both (opt-in unchecked) |
| OD-N8 | "Only accept requests from …" options | none in this version (N 6); revisit after the beta |
| OD-N9 | Excluding multiplayer-restricted (child) accounts from by-name | accept (inherits Mojang's restriction; codes still work) |
| OD-N10 | Ship by-name only after G1-G5 of SPEC 1.3, or as a separate later gate | separate gate N1-N8 on top of G1-G5 |

---

## Appendix A: golden vectors (computed with Node 24 `crypto` Ed25519/SHA-256; Rust `proof.rs` and `directory/test.mjs` assert them)

Key: Ed25519 seed = bytes `40 41 … 5f` (as SPEC Appendix B). Peer id (public key) = `2543b92ff1095511476adc8369db6ddc933665a11978dda1404ee1066ca9559d`.

**A.1 Letter signature.** `to = 069a79f444e94726a5befca90e38aaf5`, `from = 853c80ef3c3749fdaa49938b674adae6`, `nonce = 00 01 … 0f`, `helloId = 20 21 … 3f`, `relayIndex = 0`, `secret = a0 … a8`, `createdAt = 1790000000`, `displayName = "Alex"`, domain `pumpkin/name-request/1`:
`da54bc072f53090eff8de51d3bed6931509fa27d41e4e0cc9d8e80930eba82ce2354b99e3afadbfcb8e61d5ee3aa3a8aebb6b95ce20d4638111f9f5a09ae3c03`

**A.2 Auth signature.** `serverId = "0123456789abcdef0123456789abcdef01234567"` (40 ASCII bytes) followed by the peer id bytes, domain `pumpkin/directory-auth/1`:
`8b7c4551617ee1788f53e6a40929fb1a0bf2a7b1abce3e391740951277a5939c6de27a93afba50d548ef66eb43dd6922fa1f489c75728f7af9f566ce95681000`

**A.3 `serverId_redeemer`** with `hello_id = 20 … 3f`, `redeemer_peer_id = 60 61 … 7f`, `secret = a0 … a8`: `1173a19b66402ae0b58b86da1777f8ee4a797703`

**A.4 `serverId_owner`**, same inputs: `da7b9698d86d1aeb398af253249ef76dc60eecd5`

N-R1 first confirms that `Identity::from_secret_bytes(&[0x40..=0x5f])` gives the peer id above (iroh/ed25519-dalek and RFC 8032 agree); a mismatch is a spec bug to report, not to paper over.
