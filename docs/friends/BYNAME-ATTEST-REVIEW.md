# By-name login: review findings that amend BYNAME-ATTEST.md

These findings come from an independent security review of `BYNAME-ATTEST.md` (verdict: fixable). **Each one is binding for the implementation**: where a finding contradicts the addendum text, the finding wins and the implementer records the change in the package's deviations. Section numbers refer to `BYNAME-ATTEST.md`.

## [major] §5.3/§5.4/§6/§7 ("Malicious launcher" row): the Worker no longer enforces Mojang's multiplayer restriction or 

§5.3/§5.4/§6/§7 ("Malicious launcher" row): the Worker no longer enforces Mojang's multiplayer restriction or bans. Before, a refused `join` (InsufficientPrivileges or UserBanned) stopped login on the server side. Now the only gate is the client-side `/player/attributes` check, and it fails open: errors, a missing field or garbage all count as allowed. It reads only `privileges.multiplayerServer` and ignores `banStatus.bannedScopes` (authlib reads it, scratchpad authlib-YggdrasilUserApiService.java:163) and `friendsPreferences.friends/acceptInvites` (lines 141-148). A modified client skips it entirely. §5.4 step 3 also falls back to a cached certificate on any `Err`, including a 403 NotAllowed, and step 1 skips the attributes check while the cache is fresh (about 40 h). As a result a banned or child account can register as findable, receive letters from strangers (free-text displayName and sender name) and send letters. §6 says the OD-N9 property 'holds end to end', but that is true only for completing a friendship, not for the contact itself.

**Required fix:** Parse attributes into three results: explicit allowed, explicit refused, unknown. Refuse with NotAllowed when `multiplayerServer.enabled == false`, when `banStatus.bannedScopes` contains MULTIPLAYER, or when `friendsPreferences.friends`/`acceptInvites` is disabled. Treat unknown as refused for registering and polling (findable), at least until O-7 has run. Never fall back to the cached certificate after `Err(NotAllowed)`. Re-run the attributes check on every handshake, not only on certificate fetch. Rewrite §6/§7 and OD-N9 to say plainly that enforcement against a modified client is gone server-side, and record that the owner accepts this residual risk.

## [minor] §7 'Stolen certificate' row says the theft 'adds no new exposure' because every leak path also yields the acce

§7 'Stolen certificate' row says the theft 'adds no new exposure' because every leak path also yields the access token. That is false for disk. Older vanilla releases wrote the key pair to `<gameDir>/profilekeys/<uuid>.json` in production; current vanilla only deletes it (scratchpad vanilla-AccountProfileKeyPairManager.java, writeProfileKeyPair writes only `IS_RUNNING_IN_IDE`). The file never contains the access token. Pumpkin's mrpack export (`services/mrpack.rs export` with a user-chosen `include`) and templates contain no `profilekeys` exclusion (grep finds none). A shared pack or backup can therefore leak a certificate private key alone. With it an attacker can open sessions for up to 48 h (a 6 h token lifetime before): read the inbox (who wants to befriend the victim, sender peer ids and secrets), delete letters, unregister, and block.

**Required fix:** Always exclude `profilekeys/` from instance export, templates and any backup or zip path. Correct the §7 text so it names this exposure and its bound: no friendship and no impersonation at acceptance, but inbox, deletion and registration control for up to 48 h.

## [minor] §2 L3 / §7 'SHA-1' row says Mojang signs nothing attacker-influenced with the pinned key

§2 L3 / §7 'SHA-1' row says Mojang signs nothing attacker-influenced with the pinned key. In scratchpad mojang-publickeys.json, `playerCertificateKeys[0]` is byte-identical to `profilePropertyKeys[0]`, so the same key also signs textures property values, which carry user-influenced data (name, skin). A Mojang-signed textures blob does not decode as L3: the int64 slot would be ASCII and above 2^53, and the rest is not SPKI DER. But that protection is accidental, and neither the document nor the tests state it.

**Required fix:** State the shared key in §2/§7 and name the structural barriers: `Number.isSafeInteger(expiresAt)`, and an SPKI that must parse as rsaEncryption with a 2048-4096-bit modulus (ideally exact length 294 or 550 and a canonical re-encode). Check the SPKI structure in step 1, before step 6. Add a Worker test that feeds a textures-style payload, ASCII uuid/expiresAt/'SPKI' bytes signed by fake key A, and expects 400 invalid or 401 badCertificate.

## [minor] §2 cross-protocol argument for L2

§2 cross-protocol argument for L2. (a) It skips the 1.19.0 (protocol 759) chat format salt(8)‖uuid(16)‖epochSeconds(8)‖JSON, which has no version prefix and variable length. It is not exploitable, because the uuid slot would be the ASCII bytes 'directory-cert/1', but the argument as written is incomplete. (b) Neither L1 nor L2 binds the directory's identity. The directory URL can be overridden at runtime (`PUMPKIN_FRIENDS_DIRECTORY`), and any fork or third-party directory the same account logs in to receives L1+L2 signatures over a serverId it chooses. It can relay the official Worker's challenge live and obtain a 6 h bearer token for the victim's UUID and peer id on the official directory.

**Required fix:** Add 1.19.0 to the §2 list. Put the directory host into both layouts, for example `domain ‖ SHA-256(host)[0..16] ‖ serverId ‖ peerId ‖ uuid` (the length stays fixed). The Worker checks it against its own host (or a constant), so signatures made for another directory are useless at this one. Update vectors A.2 and A.5.

## [minor] §3.1 early warning

§3.1 early warning. GitHub automatically disables scheduled workflows in public repositories after 60 days without repository activity, so `mojang-keys.yml` can stop silently, and with it the only detection of a key rotation. 'Mojang publishes a key before it is used' is presented as fact but is not backed by any source in the addendum. When it does not hold, every login fails with `badCertificate` until the owner notices.

**Required fix:** Add a keepalive (for example a monthly step that re-enables the workflow with `gh workflow enable`, or a scheduled commit-free keepalive action) and a line in OWNER-CHECKLIST to confirm the workflow is enabled. Mark the pre-publication claim as unverified. Make the launcher log a distinct warn line per `badCertificate` so the owner can spot a rotation outage in user reports.

## [minor] §1.2/§10, 2.0.0 install base

§1.2/§10, 2.0.0 install base. A1 is unchanged, so 2.0.0 launchers with findable on keep doing A1, then a Mojang `join` (by_name.rs:242, before A2), then the rejected A2 on every 15-minute tick (`tick` → `ensure_registered` → `session`) until they update. That is two Worker requests per tick counted against the Free-plan 100k/day that 2.0.1 now depends on, plus a pointless `join` side effect (N R2) from every stale client.

**Required fix:** Version the auth routes (`/v2/auth/challenge` and `/v2/auth/session`, with `/v1/auth/*` answering 404 or 410) or require a new field in A1. 2.0.0 then fails at A1, before `join`. Check in 2.0.0 api.rs that 404/410 maps to Unreachable or Invalid without a retry loop, and add Worker test 11 for the A1 rejection. Make the `SELECT COUNT(*)` 0,0 check a mandatory step before migration 0002.

## [minor] §3.1 test override: `env.MOJANG_CERT_KEYS ?? PLAYER_CERTIFICATE_KEYS` lets a plain environment variable (wrang

§3.1 test override: `env.MOJANG_CERT_KEYS ?? PLAYER_CERTIFICATE_KEYS` lets a plain environment variable (wrangler `[vars]` or a dashboard variable) replace the trust root in production. A string value would be iterated character by character and every login would get a 500. The per-isolate `Map<string, Promise<CryptoKey>>` also caches a rejected import promise for the life of the isolate.

**Required fix:** Inject the keys through a test-only module seam (for example an exported `setPinnedKeysForTest`, or honour the variable only when `env.NOW` is also set), or ignore anything that is not an array of base64 strings. Remove a cache entry when its import promise rejects.

## [minor] §1.3/§3.2 'every field is length-checked before any crypto runs', but `readBody` (index.js:73-76) reads the en

§1.3/§3.2 'every field is length-checked before any crypto runs', but `readBody` (index.js:73-76) reads the entire `arrayBuffer()` before comparing it with `maxBody`. Memory is therefore unbounded up to Cloudflare's request limit on an unauthenticated route, and the rate limiter is approximate and per location. This is pre-existing, but the addendum rewrites `readBody` anyway.

**Required fix:** In the new `readBody(request, maxBody)`, reject at once when `content-length` exceeds maxBody, and otherwise read the stream with a running byte cap, aborting past maxBody.

## [minor] Privacy statements (AT-D1, AT-F1, release notes)

Privacy statements (AT-D1, AT-F1, release notes). 'The access token never leaves the PC' is false: it goes to api.minecraftservices.com on every certificate and attributes call. The new `/player/attributes` call is not named anywhere. The texts also omit that the recipient's launcher sends each sender's UUID, from the recipient's IP, to sessionserver for every new letter, and that the Worker now receives the player-certificate public key, a 48 h pseudonymous identifier (processed, not stored).

**Required fix:** Use the wording 'the access token is only sent to Mojang, never to the directory'. List `/player/certificates`, `/player/attributes` and `sessionserver …/profile/{uuid}` with their purpose in PRIVACY.md and datenschutz.html. Add 'certificate public key and signatures (processed, not stored)' to the directory's data table.

## [minor] §4.3 sender-name lookup

§4.3 sender-name lookup. One `Ok(None)` (204/404) leads straight to `DeleteMail`, which is irreversible, so a single anomalous answer from Mojang's edge permanently destroys a legitimate letter. The rules also do not order the lookup after the local-block check, so the launcher may contact Mojang about blocked senders.

**Required fix:** Run the profile lookup only after `validate_letter` and after the local block and already-friend checks. Delete only after `None` on two polls in a row (keep a per-letter miss counter in memory), or confirm via `api.minecraftservices.com/minecraft/profile/lookup/{uuid}`.

## [minor] §7 'Mojang outage' row says a Mojang outage of about 40 h does not stop directory logins

§7 'Mojang outage' row says a Mojang outage of about 40 h does not stop directory logins. The certificate cache is memory-only (§5.4) and is refetched on every start, so this holds only for a launcher that keeps running. Also, §8.2 says A.6 'verifies with ring … against the fakeMojang SPKI', but ring's RSA `UnparsedPublicKey` expects a PKCS#1 RSAPublicKey, not an SPKI. As written the test fails, or quietly verifies against a different key.

**Required fix:** Reword the §7 row: 'while the launcher keeps running'. Do not persist the private key to make it true. In §8.2, specify `&spki[24..]` (after asserting `len == 294`) for the A.6 ring check, as fake.rs already does.

## Facts that stay unverified until the owner tests with a real account

- Certificate lifetime is about 48 hours (unverified)
- Which accounts (banned/child/multiplayer-disabled) get 401/403 from /player/certificates (unverified)
- Using /player/certificates from a third-party client is explicitly permitted by Mojang ToS (unverified)
- Mojang returns the same certificate key until refreshedAfter and fetching a certificate has no side effects on a running game (unverified)
- /player/certificates refuses child or multiplayer-disabled accounts (unverified)
- Production D1 holds no rows from 2.0.0 (unverified)
