# By-name login without calling Mojang from the Worker

**Status:** decided by the architect on 2026-10-03, for the 2.0.1 hotfix. This is an addendum to `docs/friends/BYNAME.md` ("N"). It replaces N 3.1 (handshake) and the A2 row of N 4. It also changes N 2, 4, 5.1/5.2, 7.2, 8, 9 and 10 as listed in section 4.5 and in the work packages.

**Verdict: GO, with owner tests.** Every fact the design needs was verified by the research, by the prototypes, or again by me in the scratchpad (`attest-vectors.mjs`, `attest-bench.mjs`).

Three facts are still open. None can be settled by an agent, and none blocks the design:
- the live private-key encoding (the design accepts both PKCS#8 and PKCS#1);
- which restricted accounts get 401/403 (the design maps both);
- whether a certificate fetch affects a running game's chat key.

Owner tests O-3, O-5 and O-7 settle them before or right after the release.

---

## 0. Problem and decision

**Symptom (user report on 2.0.0).** With "Per Minecraft-Namen auffindbar" on, the status line says "Verzeichnis nicht erreichbar; neuer Versuch läuft". Sending by name fails with `directoryUnavailable`.

**Cause.**
- Mojang answers every request from Cloudflare Workers with `403 Service unavailable` (Azure Front Door, probe of 2026-10-03). Two unrelated public Workers report the same: CherryPicking relay, commit 6d89f2b233, and FloydAddons cosmetics-service.
- So `directory/src/auth.js` `fetchHasJoined` can never succeed. Every A2 call ends in `503 mojangUnavailable`, which the launcher maps to `DirectoryState::Unreachable` (`by_name.rs` `note_failure`).
- Nothing else in the friends feature touches the Worker, so friend codes keep working.

**Decision.** The Worker stops calling Mojang entirely. The launcher proves the account with Mojang's **player certificate**:
- The launcher fetches it from `POST https://api.minecraftservices.com/player/certificates` (client IP, Minecraft access token, the same service the launcher already uses).
- The certificate is a Mojang-generated RSA key pair. Mojang signs its public key, the account UUID and the expiry with a key from `playerCertificateKeys`.
- The launcher signs the Worker's challenge with the certificate's **private** key. It sends the certificate's public part plus that signature.
- The Worker verifies everything offline, using Mojang keys pinned in its source.

Results:
- The Worker makes **no subrequest at all**.
- The Minecraft access token never leaves the launcher (as before).
- Login no longer performs a `join`, so the N R2 "join side effect" is gone from login. It remains only at acceptance (section 6).

---

## 1. Wire protocol

Common rules of N 4 apply unchanged, with one exception: the body limit for **A2 only** is 4096 bytes (section 1.3).

### 1.1 A1 `POST /v1/auth/challenge` (unchanged)

- Request: `{"peerId":"<64 lowercase hex>"}`.
- Response: `200 {"challenge":"<sealed, ≤ 256 chars>","serverId":"<40 lowercase hex>","expiresAt":<unix s>}`.
- Error: `400 invalid`.

`serverId` keeps its derivation: `hex(HMAC-SHA256(TOKEN_KEY, "server-id" ‖ challenge))[0..40]`. It is no longer passed to Mojang. It is the per-challenge nonce that both signatures cover. The challenge TTL stays at 120 s.

### 1.2 A2 `POST /v1/auth/session` (new body)

Request (every key required, no other keys, at both levels):
```json
{"challenge":"<the A1 challenge string, ≤ 256 chars>",
 "uuid":"069a79f444e94726a5befca90e38aaf5",
 "certificate":{"publicKey":"MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA…",
                "expiresAt":1790172800123,
                "mojangSignature":"<base64, 512 bytes today>"},
 "certSignature":"<base64, 256 bytes for an RSA-2048 certificate key>",
 "signature":"<128 lowercase hex>"}
```

| Field | Encoding and limits | Content |
|---|---|---|
| `challenge` | string, 1-256 chars | The A1 challenge, verbatim. |
| `uuid` | 32 lowercase hex | The account UUID (`McIdentity.uuid`). It must be the UUID Mojang signed. |
| `certificate.publicKey` | standard base64 (RFC 4648 §4, `+/`, `=` padding, length % 4 == 0), at most 1100 chars, decodes to 1-800 bytes | The DER bytes of Mojang's `keyPair.publicKey`. The PEM label says `RSA PUBLIC KEY` but the body is X.509 SubjectPublicKeyInfo. The launcher sends exactly the decoded PEM body, never a re-encoded key. |
| `certificate.expiresAt` | JSON integer, `Number.isSafeInteger`, > 0 | Mojang's `expiresAt` (ISO-8601 with up to 9 fraction digits) as epoch **milliseconds, truncated** (Java `Instant.toEpochMilli`). |
| `certificate.mojangSignature` | standard base64, decodes to 1-1024 bytes | Mojang's `publicKeySignatureV2`, decoded and re-encoded. |
| `certSignature` | standard base64, decodes to 1-1024 bytes | RSASSA-PKCS1-v1_5 / SHA-256 with the certificate private key over layout L2 (section 2). |
| `signature` | 128 lowercase hex | Ed25519 with the permanent friends key over layout L1. |

Success: `200 {"token":"v2.<sealed>","expiresAt":<unix s>,"uuid":"<32 hex>"}`. There is no `name`, because the certificate does not prove one (section 4).

| Status | Code | When |
|---|---|---|
| 400 | `invalid` | Bad JSON shape, missing or extra key, bad encoding, unreadable challenge MAC |
| 400 | `challengeExpired` | challenge `exp <= now` |
| 401 | `badSignature` | Ed25519 (L1) or certificate signature (L2) does not verify |
| 401 | `badCertificate` | No pinned Mojang key verifies L3, or the SPKI cannot be imported as an RSA key |
| 401 | `certificateExpired` | `certificate.expiresAt <= now × 1000` |
| 413 | `tooLarge` | Body > 4096 bytes |
| 429 | `rateLimited` | Unchanged |
| 503 | `notConfigured` | Unchanged |

Removed codes: `notJoined` and `mojangUnavailable`.

**2.0.0 compatibility.** A 2.0.0 launcher sends `{challenge,name,signature}` and gets `400 invalid`. It maps that to `Invalid` and shows "Verzeichnis nicht erreichbar", the same as today. No compatibility shim is needed: no 2.0.0 login ever succeeded, so no tokens, letters or registrations from 2.0.0 exist.

### 1.3 Body limit

The 2048-byte limit stays for every route except A2, which gets **4096 bytes**. Measured sizes (`attest-vectors.json` `bodyBytes`, with a 256-char challenge):
- 1,974 bytes for today's case: RSA-2048 certificate key, RSA-4096 Mojang key. That is 74 bytes below the old limit.
- 2,658 bytes if Mojang ever moves certificates to RSA-4096.

4096 covers both with room to spare. The cost is negligible: the body is parsed once and every field is length-checked before any crypto runs.

Implementation:
- `route()` gets an options object `{ authenticated, maxBody }`.
- `readBody(request, maxBody)`.
- `MAX_BODY = 2048` and `MAX_SESSION_BODY = 4096`.

### 1.4 Session token

The token is `"v2." + seal(TOKEN_KEY, "token", {u, p, exp})`:
- `u` = the certificate-proven UUID (32 hex).
- `p` = the peer id from the challenge.
- `exp = min(now + 21600, floor(certificate.expiresAt / 1000))`.

The old `n` (name) is gone. The prefix moves from `v1.` to `v2.` because the claim shape changed. `authenticate` accepts only `^Bearer (v2\.\S+)$`. A `v1.` token gets `401 unauthorized`; none exist anyway.

---

## 2. Signed byte layouts

All three layouts have fixed lengths after a fixed ASCII prefix, so the concatenation is unambiguous. `serverId` is validated as exactly 40 lowercase hex characters by both sides. The launcher refuses to sign anything else: `proof::auth_parts` and `proof::cert_parts` return `None`, which becomes `Invalid("serverId")`.

**L1, Ed25519 (friends key), proves "this peer id logs in for this UUID with this challenge":**
```
"pumpkin/directory-auth/2" (24 ASCII bytes) ‖ serverId (40 ASCII bytes) ‖ peerId (32 bytes) ‖ uuid (16 bytes)    = 112 bytes
```
- This uses `Identity::sign(AUTH_DOMAIN, parts)`, the SPEC 4.1 rule (domain prepended).
- The domain moves from `/1` to `/2` because the UUID was added.
- Worker side: `verifySignature(p, AUTH_DOMAIN, [utf8(serverId), fromHex(p), fromHex(uuid)], signature)`.

**L2, RSASSA-PKCS1-v1_5 / SHA-256 (certificate private key), proves "the holder of Mojang's key for this UUID logs in with this peer id and challenge":**
```
"pumpkin/directory-cert/1" (24 ASCII bytes) ‖ serverId (40 ASCII bytes) ‖ peerId (32 bytes) ‖ uuid (16 bytes)    = 112 bytes
```

Why L2 can never be mistaken for a Minecraft chat signature (the certificate key is the player's chat-signing key):
- 1.19.3+ signed-chat payloads start with the int32 version `00 00 00 01`. L2 starts with `70 75 6d 70` ("pump").
- 1.19.1/1.19.2 header payloads are 48 or 304 bytes long. L2 is 112.
- The only part the Worker chooses is `serverId`, and the launcher restricts it to 40 lowercase hex characters.

A compromised Worker therefore cannot obtain a signature usable as chat. We never reuse a Mojang message format.

**L3, SHA1withRSA by Mojang. Verified, never produced by us:**
```
uuid msb (8 bytes BE) ‖ uuid lsb (8 bytes BE) ‖ expiresAt epoch ms (int64 BE) ‖ certificate SPKI DER     = 24 + 294 bytes today
```
Sources:
- vanilla `ProfilePublicKey.Data.signedPayload`, Velocity `IdentifiedKeyImpl` (V2), node-minecraft-protocol `login.js`;
- re-verified with the real lodestone vector: pinned key #0 gives true, key #1 gives false, the payload is 318 bytes, SHA-1 is `663448b0…0ce8`.

The 32-hex `uuid` decoded to 16 bytes is exactly msb‖lsb.

**Golden vectors.** Computed with Node 24 by `scratchpad/attest-vectors.mjs`, stable on rerun, and cross-checked with WebCrypto. Common inputs are those of N Appendix A:
- seed `40..5f`;
- peer id `2543b92f…559d`;
- `serverId = "0123456789abcdef0123456789abcdef01234567"`;
- `uuid = 069a79f444e94726a5befca90e38aaf5`;
- `expiresAt = 1790172800123`.

The test RSA keys are in `scratchpad/attest-testkeys.json`: keys `certificate`, `fakeMojang` and `other`, each RSA-2048 as `pkcs8`, `pkcs1` and `spki` base64. They are **test only**.

| Id | Layout | Value |
|---|---|---|
| A.2 (replaces the old A.2) | L1 Ed25519 | `e1cbdb7924912f3a6ae133340d7afe80c4bfc5c38305cccfc9f3e871e2a5fcd4f3109798e9c40dc3e9b59d841c69076ac9c21080591e67d9b1c60bec7a645f0f` |
| A.5 | L2 with key `certificate` | message SHA-256 `81aee71b0528c9c7e41f78837679464ac3e522268c694bb930c2c5e8af9383e6`; signature (base64) `NyqeEl0F1VZtl5siVrh0fH/gUusrz457tMlf9zzhFtjifyPtlwSnxMy0Drxff8xU0X6YrC8Nx4CHBxP3OV71NE7Dd1eCNzkOGFJgdn+QkFD8CwkI6Oz+czQDS9HypNP1ds2aIo04WnQmesfOTZb4GyEpOVR6qcyALbnIpjCc2lS9QI1saZ8ljihrEh7armTTvb+VKBliYEUPFI0EhLl+KvlH+j1JE5jjJ+b7/uN2S6JBxvAUPEymlplA7oR8zLx+CCrmX51iJ6F8T+eYvNutCCpIsED2FNbBF1ZdwnNNT46lMZ/koGZjRax/ixBpr5baXEBFi70+8kX7/cRV6uvCgQ==` |
| A.6 | L3 with key `fakeMojang` over the `certificate` SPKI | payload 318 bytes; signature (base64) `QJjGF+s4plfeaP86H8pRdNi8p+fuAUiNoE7t4lN3e4qjQ0qV0z5eCng5F8aNaYLDzvceSOunKStmxA7UGSxnz/lcGcO/JmOGLN+vVIwIOy4xmAZE61odLGi7Ta97VjKpW28ojWY1W7FpKHPc4jpl/eIF6FO9ylF63sCeCjTyL0zJ24dA+gbQu7v4oCu7CBzxNk7SMwwiHE89uVGumRTBmza1kAfSReExXKyI8Q/0mD1aNscv7ktYwzaWeL96iCCc92Q6RlrLOP/AOyTlYSAyTdBPFRuhCvMkoCCcr2IAY4gt61l99sJ9V1MCBeCXWQaH4Q4Nu0gBeZRWcEPabU0uHg==` |

Notes on the vectors:
- PKCS#1 v1.5 is deterministic, so ring (Rust) must reproduce A.5 byte for byte.
- The real lodestone vector is **not** copied into the repo: it is GPL-3.0, and the repo is Apache-2.0. Its result is recorded above, and owner test O-3 covers the real-key path.

---

## 3. Worker verification

### 3.1 Pinned Mojang keys

**New file `directory/src/mojang-keys.js`:**
```js
// Mojangs playerCertificateKeys (GET https://api.minecraftservices.com/publickeys, Stand 2026-10-03), Base64 DER SPKI.
// Der Worker kann sie nicht abrufen (Mojang sperrt Cloudflare). Aktualisieren: node scripts/mojang-keys.mjs update
export const PLAYER_CERTIFICATE_KEYS = Object.freeze([
  "MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAylB4B6m5lz7j…", // sha256 4a3f31581c5b9bce0e53dd79a98d2da53fa5e116c3a16c3c36db991f152b2554 (signs today)
  "MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAt4t9NPuu7ckt…", // sha256 fd012be7ae5fb9974219f2d9dda1918f2174c1275db28beec555ed835d103f20
]);
```
- The full strings are `playerCertificateKeys[i].publicKey` from `scratchpad/mojang-publickeys.json`, in that order.
- `auth.js` reads `env.MOJANG_CERT_KEYS ?? PLAYER_CERTIFICATE_KEYS`. The `env` override is test only, like `env.NOW`, and must be an array.
- Imported keys are cached per isolate in a module-level `Map<string, Promise<CryptoKey>>`. Each is imported with `crypto.subtle.importKey("spki", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-1" }, false, ["verify"])`.
- A pinned key that fails to import throws, and the request answers `500 internal`. The self-check test catches this.

**`directory/test/mojang-publickeys.json`** is a byte copy of `scratchpad/mojang-publickeys.json`. That is public Mojang data, unauthenticated, fetched on 2026-10-03.

**Self-check in `test.mjs`.** It reads `process.env.MOJANG_PUBLICKEYS ?? "test/mojang-publickeys.json"` and asserts three things:
1. `PLAYER_CERTIFICATE_KEYS` deep-equals `playerCertificateKeys.map(k => k.publicKey)`, in order.
2. Every pinned key imports as RSASSA-PKCS1-v1_5 / SHA-1 SPKI.
3. The SHA-256 fingerprints are printed.

With `MOJANG_PUBLICKEYS=<scratchpad>/mojang-publickeys.json`, the same test fails as soon as the pinned keys differ from the saved file.

**Owner update path: `directory/scripts/mojang-keys.mjs`.** It uses only Node built-ins and `fetch`, and runs from a normal IP, never from the Worker.
- `node scripts/mojang-keys.mjs check` fetches the live `/publickeys` and compares `playerCertificateKeys` with the pinned list. It exits 0 with "ok: N keys match", 1 with a diff, or 2 when the fetch fails.
- `node scripts/mojang-keys.mjs update` rewrites `src/mojang-keys.js` (with the date) and `test/mojang-publickeys.json` from the live response.
- After an update: `node test.mjs`, then a PR, then `npx wrangler deploy`. No launcher release is needed.
- The pinned list always equals Mojang's current list. Mojang publishes a key there before it is used and removes it when it stops trusting it.

**Early warning: new workflow `.github/workflows/mojang-keys.yml`.**
- Triggers: `schedule: cron "23 5 * * *"` (daily) and `workflow_dispatch`.
- Job: `node directory/scripts/mojang-keys.mjs check` (Node 24, read-only permissions).
- A failing scheduled run e-mails the owner (GitHub default), usually before Mojang starts signing with a new key.

### 3.2 `openSession` algorithm (in this order; cheap checks first)

1. **Shape.** `parseObject(text)` and `validSessionBody`:
   - exact keys `challenge, uuid, certificate, certSignature, signature`, and `certificate` with exact keys `publicKey, expiresAt, mojangSignature`;
   - the formats of section 1.2;
   - `fromBase64` (new strict helper in `util.js`: regex `^[A-Za-z0-9+/]*={0,2}$`, length % 4 == 0, `atob` in try/catch, then the byte-length bounds).
   - Any failure → `400 invalid`.
2. **Challenge.** `unseal(TOKEN_KEY, "challenge", challenge)` gives `{p, exp}`, otherwise `400 invalid`. `exp <= now` → `400 challengeExpired`.
3. `serverId = serverIdFor(env, challenge)`.
4. **Peer binding.** Ed25519 over L1 with `p` → otherwise `401 badSignature`.
5. **Expiry.** `certificate.expiresAt <= now * 1000` → `401 certificateExpired`. The rule is strict, with no grace period: vanilla's 8 h grace applies to chat sessions only. Clock skew is not a concern here: both `expiresAt` (Mojang-signed) and `now` (Cloudflare) are server clocks, and the launcher's clock is never consulted.
6. **Mojang signature.** `payload = concat(fromHex(uuid), int64BE(expiresAt), spki)`. For each pinned key in list order (key #0 first; it signs today), `crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, mojangSignature, payload)`. The first `true` wins. None → `401 badCertificate`.
7. **Challenge signature.** `importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])`. If that throws → `401 badCertificate`. Then `verify(certSignature, L2)`, otherwise `401 badSignature`.
8. **Mint the token** (section 1.4). Return `{token, expiresAt: exp, uuid}`.

**Cost.** Measured in Node: worst case is 2 imports + 2 verifications with 4096-bit keys + 1 import and verification with a 2048-bit key, median 0.81 ms; the first call in a process takes 5.3 ms because of crypto initialisation. Cached imports keep warm isolates far below the 10 ms Free-plan CPU limit. O-6 checks it on Cloudflare.

**Replay protection** stays as in N 3.1: stateless challenge, 120 s TTL, nothing stored. No single-use store is added, because:
- both signatures cover `serverId` (unique per challenge), the peer id and the UUID;
- replaying a captured body within 120 s (that needs a TLS break) yields only a token for the same UUID and peer id the legitimate launcher already received;
- someone holding the certificate private key does not need a replay at all (section 7).

**Removed from `auth.js`:** `HAS_JOINED`, `USER_AGENT`, `MOJANG_TIMEOUT_MS`, `MojangUnavailable`, `joinedProfile`, `fetchHasJoined`, `parseProfile`, `isMinecraftName`/`MINECRAFT_NAME` (now unused), and the `n` claim.

`grep -rn "fetch(" directory/src` must find nothing.

`wrangler.toml` keeps `global_fetch_strictly_public` (harmless). Its comment and `index.js`'s header no longer mention Mojang calls.

---

## 4. Session contents, names, and impact on N 2-4

### 4.1 What the token carries

The token carries `{u, p, exp}`:
- `u` comes from the verified certificate;
- `p` comes from the challenge and is bound by L1 and L2.

The certificate contains **no player name**.

### 4.2 Decision on names: the Worker handles no names at all

- A2 sends no name. The token, the letter stamp and D1 hold none.
- This is stricter than before: previously the Worker stored the sender's name in `letters.from_name`.
- A sender-asserted name is rejected as an option: it would let anyone show "Notch" as the sender to a recipient. The acceptance proof (N 3.2) compares only UUIDs.

### 4.3 Where each launcher gets names (all from Mojang, from the client IP)

| Name | Source | Change |
|---|---|---|
| Own name | `McIdentity.name` (`auth::session`) | unchanged |
| Target name when sending | `lookup/name/{name}` (N 7.1 step 2) | unchanged |
| **Sender name of an incoming letter** | **new:** `GET https://sessionserver.mojang.com/session/minecraft/profile/{from.uuid}` (`skins::SESSION_PROFILE`, already used for friends' skins) via `MojangSessions::profile` | replaces the Worker stamp |
| Names after acceptance | `hasJoined` (N 7.4) | unchanged |

**Rules for the new lookup** in `poll_inbox`, for each letter that passed `validate_letter` and is not yet filed:
- `Ok(Some(profile))` with `profile.uuid == from.uuid` → file it, with `mc_name = profile.name`.
- `Ok(None)` (204/404: the account no longer exists) → `DeleteMail`.
- `Err(_)` → leave the letter on the server and try again on the next poll (like `UnknownRelay`).

At most 20 letters are filed per poll, so there are at most 20 profile calls per 15 minutes, far below Mojang's per-IP limit.

### 4.4 Wire changes that follow

- `InboxLetter.from = {"uuid","peerId"}`; `name` is removed. The I1 example in N 4 changes accordingly.
- `DirectorySession` loses `name`. `SessionRequest` takes the shape of section 1.2.
- D1: the new migration `directory/migrations/0002_letters_without_name.sql` contains `ALTER TABLE letters DROP COLUMN from_name;`. `store.js` `storeLetter` (INSERT and ON CONFLICT) and `readInbox` drop the column.
- Fallback if `--remote` apply rejects DROP COLUMN: replace 0002 with a no-op comment, keep writing `''` into `from_name`, and record the deviation.
- The test harness `test/d1.mjs` applies every file in `migrations/` in name order.

### 4.5 Impact on N 2-4 and on the findable and letters flows

- **N 2 (flow):**
  - step 3 becomes "(session token, ATTEST)";
  - the Worker line becomes "stamp from{uuid_S, peerId_S}";
  - R gains a step "Mojang profile/uuid_S → name_S" before "incoming request".
- **N 3.1:** replaced by sections 1-3 of this addendum. The auth lock stays (one handshake at a time). The "Mojang refusals" bullet moves to section 5.4.
- **N 3.2:** unchanged (section 6).
- **N 4:**
  - A1 is unchanged; A2 follows section 1.2;
  - common rules: "≤ 2 KiB, A2 ≤ 4 KiB";
  - InboxLetter without `from.name`;
  - the "Mojang subrequest" paragraph becomes "The Worker makes no subrequests."
- **Findable flow (N 6), M1/M2, B1/B2, O1/O2, I1/I2:** unchanged apart from the `from` stamp. These routes only use `u` and `p` from the token. Registration stays keyed by the certificate-proven UUID.
- **N 7.2:** `validate_letter` drops the `from.name` rule and gains the profile lookup of section 4.3.

---

## 5. Launcher side (Rust)

### 5.1 Dependencies

Add `ring = "0.17"` and `time = { version = "0.3", features = ["parsing"] }` as direct dependencies of `src-tauri/Cargo.toml`. Both are already in `Cargo.lock` (ring 0.17.14 through rustls; time 0.3.55 with `parsing`), so no new crate enters the lock.

The `rsa` crate stays out: RUSTSEC-2023-0071 would fail `cargo deny check advisories`.

### 5.2 New `services/friends/directory/certificate.rs` (pure, ring)

```rust
/// Mojangs Spielerzertifikat: ein von Mojang erzeugtes RSA-Schlüsselpaar, dessen öffentlicher Teil mit UUID und Ablauf
/// von Mojang signiert ist. Nur im Speicher; der private Schlüssel verlässt den Launcher nie.
pub struct PlayerCertificate {
    pub uuid: String,              // 32 lowercase hex: the account it was fetched for
    pub public_key: Vec<u8>,       // SPKI DER, exactly the PEM body
    pub expires_at_ms: i64,
    pub refreshed_after_ms: i64,
    pub mojang_signature: Vec<u8>, // publicKeySignatureV2
    key_pair: Arc<ring::signature::RsaKeyPair>,
}
impl fmt::Debug for PlayerCertificate { /* uuid and times only; "<verborgen>" for keys */ }
pub fn parse(uuid: &str, body: &[u8]) -> Option<PlayerCertificate>;
impl PlayerCertificate {
    pub fn needs_refresh(&self, now_ms: i64) -> bool;     // now_ms >= refreshed_after_ms
    pub fn is_usable(&self, now_ms: i64) -> bool;         // now_ms + USE_MARGIN_MS (10 min) < expires_at_ms
    pub fn sign(&self, message: &[u8]) -> Option<Vec<u8>>; // RSA_PKCS1_SHA256, SystemRandom, len = modulus_len
    pub fn proof(&self) -> CertificateProof;              // wire.rs, base64 STANDARD
}
```

`parse` rules (any failure gives `None`):
- The JSON must have `keyPair.privateKey`, `keyPair.publicKey`, `publicKeySignatureV2`, `expiresAt` and `refreshedAfter`. `publicKeySignature` (V1) is ignored.
- `pem_body(text)`: drop lines starting with `-----`, trim and join the rest, then decode with `base64::STANDARD`. Labels are ignored: Mojang labels PKCS#8 as `RSA PRIVATE KEY` and SPKI as `RSA PUBLIC KEY`.
- Private key: `RsaKeyPair::from_pkcs8(der)`, falling back to `RsaKeyPair::from_der(der)` (PKCS#1). ring accepts 2048-8192 bits.
- The public key is 1-800 bytes, and `public_key.ends_with(key_pair.public().as_ref())`, so the pair is consistent and we never sign with a key the Worker would reject.
- `mojang_signature` is 1-1024 bytes.
- Times: `OffsetDateTime::parse(s, &Rfc3339)?.unix_timestamp_nanos() / 1_000_000`, as `i64`. Integer division truncates (positive values), matching `toEpochMilli`.

### 5.3 `directory/mojang.rs`

Additions to `MojangSessions`:
```rust
fn certificate<'a>(&'a self, session: &'a McIdentity) -> BoxFuture<'a, Result<PlayerCertificate, MojangError>>;
fn multiplayer_allowed<'a>(&'a self, session: &'a McIdentity) -> BoxFuture<'a, Result<bool, MojangError>>;
fn profile<'a>(&'a self, uuid: &'a str) -> BoxFuture<'a, Result<Option<MojangProfile>, MojangError>>;
```

**`certificate`:**
- `POST https://api.minecraftservices.com/player/certificates` with `bearer_auth(access_token)` and `.body(Vec::new())`, so `Content-Length: 0` is sent.
- Timeout 10 s, body limit 16 KiB, through `MojangHttp::fetch`.
- `parse_certificate(status, body, uuid)`: 200 → `certificate::parse` (`None` → `Unreachable`); 401 → `InvalidSession`; 403 → `NotAllowed`; 429 → `RateLimited`; anything else → `Unreachable`.

**`multiplayer_allowed`:**
- `GET https://api.minecraftservices.com/player/attributes` with bearer, limit 16 KiB. Vanilla authlib `YggdrasilUserApiService.fetchProperties` reads `privileges.multiplayerServer` (`UserFlag.SERVERS_ALLOWED`) from this route. The JSON key names `privileges.multiplayerServer.enabled` are confirmed by the Drasl emulator (`playerAttributesPrivileges`; scratchpad `drasl-services.go`). What restricted accounts actually receive is unverified (O-7), which is why the parser is lenient.
- `parse_attributes(status, body)` returns `Ok(false)` **only** for 200 with `privileges.multiplayerServer.enabled == false`. Everything else returns `Ok(true)`.
- This check can add a refusal but never breaks login. It replaces the multiplayer gate the old `join` gave at login.

**`profile`:**
- `GET {SESSION_PROFILE}{uuid}`, uuid validated as 32 lowercase hex first, limit 64 KiB.
- 200 → `profile_of` (it must return the same uuid, else `Unreachable`); 204 or 404 → `None`; 429 → `RateLimited`; anything else → `Unreachable`.

`join`, `has_joined` and `lookup_name` stay (N 3.2 and 7.1).

### 5.4 `by_name.rs`: handshake, cache, retries

- `DirectoryClient` gains `certificate: Mutex<Option<PlayerCertificate>>`. It lives in memory only and is cleared by `forget_session` (identity rotate/reset, account change, disable) and before the certificate retry below.
- `fn current_certificate(core, deps, account) -> Result<PlayerCertificate, Failure>`:
  1. If the cached certificate has `uuid == account.uuid` and `!needs_refresh(now)`, use it.
  2. Otherwise run `deps.mojang.multiplayer_allowed(account)`. `Ok(false)` → `Failure::Mojang(NotAllowed)`; errors are ignored (see 5.3).
  3. Then `deps.mojang.certificate(account)`. `Ok` → cache it and use it. `Err(e)` → if the cached certificate (same uuid) `is_usable(now)`, use it, else `Failure::Mojang(e)`.

  `refreshedAfter` is about 40 h after issue. Handshakes happen about every 6 h, so a running launcher fetches about one certificate per 40 h, and on each start. No separate hourly throttle is needed: the auth lock plus the 15-minute loop cap retries at 4 per hour.
- `handshake(deps, identity, core)`, in this order:
  1. `tokens.minecraft_session()`;
  2. `current_certificate`;
  3. `api.challenge(peer_id)`;
  4. `proof::auth_parts(serverId, peer_id, uuid)` and `proof::cert_parts(...)` (`None` → `Invalid("serverId")`);
  5. `identity.sign(AUTH_DOMAIN, …)` and `certificate.sign(cert_parts)` (`None` → `Failure::Local`);
  6. `api.session(&SessionRequest{…})`;
  7. check `opened.uuid == account.uuid` (unchanged).

  The certificate comes before the challenge so that its fetch does not eat into the 120 s challenge TTL. **No `join` happens at login.**
- `session()` retry policy (one retry at most):

| First failure | Action before the retry | If the retry fails the same way |
|---|---|---|
| `Mojang(InvalidSession)` (certificate 401) | `deps.tokens.forget_minecraft_session()`, so `auth::session` refreshes the Minecraft token | Convert to `Mojang(NotAllowed)`: a freshly refreshed token was still refused |
| `Directory(BadCertificate \| CertificateExpired)` | Clear the cached certificate (a fresh fetch follows) | Return it unchanged; `warn!` "Das Verzeichnis erkennt Mojangs Zertifikat nicht an" (code only) |
| anything else | no retry | — |

  `Mojang(NotAllowed)` → `set_health(NotAllowed)`, as today.
- `AccountTokens` (`directory/mod.rs`) gains `fn forget_minecraft_session(&self);`.
  - Production (`friends_commands.rs` `AppAccountTokens`) calls the new `services::auth::forget_session(&state, &stored.id)`, which is `lock(&state.ms.sessions).remove(id)`.
  - This also closes the known gap that a 401 never evicted the cached Minecraft session.
- `Failure::keeps_job`: remove `MojangUnavailable` and `NotJoined`; add `BadCertificate` and `CertificateExpired` (both transient until a retry or a Worker update).
- Incoming letters: the name lookup of section 4.3. `incoming_letter` takes the resolved `MojangProfile`. `file_letters` becomes async: it is already called from the async `poll_inbox`.

### 5.5 `wire.rs`, `proof.rs`, `api.rs`, `mod.rs`

- **`wire.rs`:**
  - `SessionRequest { challenge, uuid, certificate: CertificateProof, cert_signature, signature }` with `#[serde(rename_all = "camelCase")]`;
  - `CertificateProof { public_key: String, expires_at: i64, mojang_signature: String }`;
  - `DirectorySession { token, expires_at, uuid }`;
  - `LetterFrom { uuid, peer_id }`.
- **`proof.rs`:**
  - `AUTH_DOMAIN = "pumpkin/directory-auth/2"` and `CERT_DOMAIN = "pumpkin/directory-cert/1"`;
  - `auth_parts(server_id, peer_id, uuid)` and `cert_parts(server_id, peer_id, uuid)` (both 112 bytes with the domain);
  - `validate_letter` without the name rule; `StampedLetter` loses `from_name`;
  - vectors A.2 (new), A.5 and A.6 (section 2).
- **`api.rs`:**
  - `map_error` maps `badCertificate` → `DirectoryError::BadCertificate` and `certificateExpired` → `DirectoryError::CertificateExpired`;
  - the `notJoined` and `mojangUnavailable` arms are deleted;
  - `INVALID_REQUEST_CODES` is unchanged (`badSignature` and `challengeExpired` stay `Invalid`).
- **`mod.rs`:**
  - `DirectoryError` loses `NotJoined` and `MojangUnavailable` and gains `BadCertificate` and `CertificateExpired`, both mapped to `errors.friends.directoryUnavailable`;
  - `AccountTokens::forget_minecraft_session`.

### 5.6 States and messages

No new UI state and no new error key. `DirectoryState` and its TS twin are unchanged; only the definition text of `NotAllowed` widens.

| Cause | Failure | `directory.state` | Message (existing key) |
|---|---|---|---|
| `/player/attributes` says multiplayer off; certificate 403; certificate 401 twice (second time after a token refresh) | `Mojang(NotAllowed)` | `notAllowed` (polling pauses until toggle or restart) | `errors.friends.directoryNotAllowed` |
| Certificate 429, 5xx or network error, and no usable cached certificate | `Mojang(RateLimited \| Unreachable)` | `unreachable` | `errors.friends.directoryUnavailable` |
| Refresh token dead | `Local(relogin)` | `unreachable` | `errors.app.auth.relogin` |
| Worker `badCertificate` or `certificateExpired` after one retry with a fresh certificate | `Directory(BadCertificate \| CertificateExpired)` | `unreachable` | `directoryUnavailable` (+ warn log) |
| Worker `badSignature` or `invalid` | `Directory(Invalid(code))` | `unreachable` | `directoryUnavailable` (+ warn log, existing) |

**Accounts that cannot get a certificate:** by name is unavailable (`notAllowed` or `unreachable`), and friend codes work unchanged. This is the same contract as OD-N9.

`SPEC.md`'s `NotAllowed` definition becomes: "Mojang refused the account: multiplayer disabled in `/player/attributes`, no player certificate (403, or 401 after a token refresh), or `join` refused at acceptance".

---

## 6. Mutual proof at acceptance (unchanged)

N 3.2 and N 7.4 stay exactly as specified. Both launchers `join` with the deterministic `serverId_redeemer` or `serverId_owner` and check the other side with `hasJoined` from their **own** IPs. The Worker is not involved, and Mojang does not block client IPs.

What improves:
- The expected UUID (`mc_uuid`, the Worker stamp) is now certificate-proven instead of `hasJoined`-proven. Its strength is equivalent: both are Mojang statements about the UUID, now checked offline.
- The recipient's displayed `mc_name` now comes from Mojang directly (section 4.3) instead of the Worker.

The `join` side effect (N R2) remains only here, once per acceptance, and is still measured by N9.

A restricted account that somehow obtains a certificate (unverified, section 5.6) still cannot complete a friendship: its `join` at acceptance is refused (`InsufficientPrivilegesException` → `NotAllowed`). The compliance property of OD-N9 therefore holds end to end.

---

## 7. Security analysis

| Threat | Analysis |
|---|---|
| **Stolen certificate (private key + certificate)** | It is a signing key bound to one UUID until `expiresAt` (about 48 h; the lifetime is undocumented, so we design for whatever `expiresAt` says). With it, an attacker can open directory sessions as that UUID with **any** peer id. The attacker can then read that UUID's inbox (letter metadata and senders' single-use codes), send letters as that UUID (burning its quota), register or unregister it, and block or unblock others: the power of a stolen 6 h token today, for up to 48 h. The attacker **cannot** make friends as the victim: redeeming a code or answering a redemption requires a Mojang `join` as the victim (N 3.2), which needs the access token, not the certificate. Where it could be stolen: launcher memory, a malicious mod in the game, or vanilla's own `profilekeys/` cache on disk. Each of these can already take the Minecraft access token, which is strictly stronger, so this adds no new exposure. Recovery: the certificate expires on its own, and the user's next refresh does not revoke it (Mojang offers no revocation). |
| **Certificate public part is public** | Every multiplayer server, and every player on it, receives the public key, `expiresAt` and the Mojang signature (chat session). That alone is useless: L2 requires the private key, and L1 requires the friends key. |
| **Replay** | Section 3.2: the challenge has a 120 s TTL; both signatures cover `serverId`, peer id and UUID. A replay yields nothing new. |
| **Malicious or modified launcher** | It can do exactly what its own account can do. It cannot present another account's certificate (no private key). It can skip the `/player/attributes` gate for its own account; acceptance still enforces `join` (section 6). |
| **Compromised Worker** | Unchanged from N 8, with two additions. It still cannot impersonate anyone. It cannot obtain chat-usable signatures from L2 (section 2). It now sees certificate public keys, which are pseudonymous for about 48 h and also sent to every server the player joins; they are not stored. |
| **SHA-1 in Mojang's signature** | This is Mojang's choice. A collision attack would need Mojang to sign attacker-influenced data, but Mojang generates the key pair itself, so the attacker controls no byte of L3. A forgery would need a second-preimage on SHA-1, which is not practical. |
| **Mojang key rotation** | If Mojang starts signing with a key that is not pinned, every login fails with `401 badCertificate`, and launchers show "Verzeichnis nicht erreichbar" after one retry. This is an outage of by-name only; codes and the acceptance proof are unaffected. Detection: the daily `mojang-keys.yml` check fails as soon as `/publickeys` changes (Mojang publishes keys before using them; vanilla refetches them every 24 h). Fix: `node scripts/mojang-keys.mjs update`, then test, PR and `wrangler deploy`, in minutes, with no launcher release. History: `playerCertificateKeys` has been unchanged for 2.7 years, and key #0 has existed since 2022. |
| **Access token** | It never leaves the launcher. The Worker receives only the certificate's public part and two signatures. |
| **Name spoofing** | Impossible through the directory: it carries no names, and recipients resolve names at Mojang by the proven UUID (section 4). |
| **Mojang outage** | Login uses a cached certificate while it is usable (until 10 min before `expiresAt`), so a Mojang outage of up to about 40 h does not stop directory logins. |

---

## 8. Tests

### 8.1 Worker (`node directory/test.mjs`; Node built-ins only, no network)

**Harness (`test/world.mjs`).**
- `createMojang` is replaced by a **certificate factory**: `generateKeyPairSync("rsa", { modulusLength: 2048 })` for fake Mojang key A, fake Mojang key B and per-account certificate keys.
- `crypto.sign("sha1", L3payload, mojangKey)` builds the Mojang signature; `crypto.sign("sha256", L2, certKey)` builds `certSignature`.
- `env.MOJANG_CERT_KEYS = [A.spki, B.spki]`.
- `globalThis.fetch` is replaced by a stub that **records and throws**.
- `sessionBody(account, {overrides})` builds valid or tampered bodies.

**Cases** (each prints `ok`/`FAIL`):
1. Happy path → 200 `{token, expiresAt, uuid}`. The token payload has exactly `u, p, exp`, and the prefix is `v2.`.
2. `exp == now + 21600` normally; `exp == floor(cert.expiresAt / 1000)` when the certificate expires sooner.
3. A certificate signed by pinned key B (rotation) → 200.
4. A certificate signed by an unpinned key → `401 badCertificate`.
5. Tamper with each of `uuid`, `expiresAt` (+1 ms) and `publicKey`. In each case the test re-signs L1 and L2 with the tampered value, so that only Mojang's signature is wrong → `401 badCertificate`. With an un-re-signed uuid the expected result is `401 badSignature`, because the uuid is part of L1 and step 4 runs first.
6. Expiry: `expiresAt == now * 1000` → `401 certificateExpired`; `now * 1000 + 1` → 200.
7. `certSignature` by another key, or over another `serverId`, peer id, uuid or domain → `401 badSignature`.
8. Ed25519 over another uuid or with the old `/1` domain → `401 badSignature`.
9. A `publicKey` that is valid base64 but not an SPKI → `401 badCertificate`.
10. Shape: missing or extra keys at either level; uppercase uuid; `expiresAt` as a string, a float, negative, or above 2^53; base64url alphabet; bad padding; oversized fields → `400 invalid`.
11. The 2.0.0 body `{challenge, name, signature}` → `400 invalid`.
12. Challenge expired or tampered → as before.
13. Body sizes: a real-size RSA-4096-certificate body of 2,658 bytes → not 413; 4,097 bytes on A2 → 413; 2,049 bytes on `/v1/outbox` → 413 (limit unchanged).
14. A `v1.` token → `401 unauthorized`.
15. Letters: the stamp is `{uuid, peerId}` only. The inbox JSON has no `name`. `PRAGMA table_info(letters)` has no `from_name` after all migrations.
16. **No subrequest:** the fetch stub was called 0 times over the whole run.
17. **Production keys are used by default:** with `MOJANG_CERT_KEYS` unset, a synthetic certificate → `badCertificate`.
18. **Pinned-key self-check** (section 3.1), with the `MOJANG_PUBLICKEYS` override.
19. **Golden vectors:** A.2 (Ed25519), A.5 (WebCrypto verify of the given signature with the `certificate` test key), A.6 (WebCrypto SHA-1 verify with `fakeMojang`). The keys come from `directory/test/cert-vectors.json` (a copy of `scratchpad/attest-testkeys.json` plus the three values).

Existing routing, fail-closed, abuse, cron and `console` cases stay. The "fail closed" cases assert no fetch call.

### 8.2 Rust (`cargo test`, all three OSes in CI)

Test keys: `services/friends/directory/testdata/rsa-test-keys.json`, a copy of `scratchpad/attest-testkeys.json`, loaded with `include_str!` in `#[cfg(test)]` code only. ring cannot generate keys or sign SHA-1.

- **`certificate.rs`:**
  - parse a synthetic `/player/certificates` body with a PKCS#8 body under the `RSA PRIVATE KEY` label, and again with a PKCS#1 body;
  - `publicKey` under the `RSA PUBLIC KEY` label;
  - mismatched private/public pair → `None`;
  - a missing `publicKeySignatureV2` → `None`;
  - times: `"2022-04-30T00:11:32.174783069Z"` → `1651277492174`; no fraction; `+00:00` offset;
  - `sign` reproduces A.5 byte for byte;
  - `Debug` shows no key bytes;
  - `needs_refresh` and `is_usable` boundaries.
- **`mojang.rs`:**
  - `parse_certificate` table: 200 ok, 200 garbage → `Unreachable`, 401 → `InvalidSession`, 403 → `NotAllowed`, 429 → `RateLimited`, 500 → `Unreachable`;
  - `parse_attributes` table: enabled false → false; enabled true, field missing, garbage, 401 or 500 → true;
  - `parse_profile` table: 200 same uuid; 200 other uuid → `Unreachable`; 204/404 → `None`; 429; 500.
- **`proof.rs`:** A.2 (new) and A.5 message bytes (length 112, SHA-256 as given); `auth_parts` and `cert_parts` refuse a non-hex or 41-character `serverId`; `validate_letter` table without the name rule; A.6 verifies with `ring::signature::RSA_PKCS1_2048_8192_SHA1_FOR_LEGACY_USE_ONLY` against the `fakeMojang` SPKI (proves the L3 layout in Rust too).
- **`wire.rs`:** `SessionRequest` serialises exactly to the key set of section 1.2 (nested); `DirectorySession` without `name`; `InboxLetter` without `from.name` parses.
- **`api.rs` / `http_tests.rs`:** the `map_error` table with `badCertificate` and `certificateExpired`; `session_posts_…` posts the new body.
- **`fake.rs`:**
  - `FakeMojang::certificate` issues certificates from the fixed test keys (the `certificate` key by default, `other` for a second account) and records `(uuid, spki, expires_at_ms)`, with switchable 401/403/429 answers and a `multiplayer` flag;
  - `FakeMojang::profile` answers from its account table, with rename support;
  - `FakeDirectory::session` checks the challenge and L1 as today, then the presented certificate against FakeMojang's **issued** list (the stand-in for L3), expiry against the fake clock, and L2 **for real** with `ring::signature::UnparsedPublicKey::new(&RSA_PKCS1_2048_8192_SHA256, &spki[24..])` (2048-bit test keys, so `spki.len() == 294` is asserted);
  - mutation tests: unknown certificate → `BadCertificate`; expired → `CertificateExpired`; another account's certificate → `BadCertificate`; wrong private key → `badSignature`.
- **`tests_by_name.rs`:** the existing 13 cases are adapted (case 10 now triggers `notAllowed` through a certificate 403). New cases:
  - 14: one certificate fetch serves several handshakes until `refreshedAfter` (the fake clock moves past it, then exactly one more fetch);
  - 15: the Worker answers `certificateExpired` once → the cache is cleared, one refetch, success;
  - 16: `badCertificate` twice → `directoryUnavailable`, state `unreachable`, the job is kept;
  - 17: certificate 401 then 200 → exactly one `forget_minecraft_session`, success; 401 twice → `notAllowed`;
  - 18: `/player/attributes` with multiplayer false → `notAllowed`, and no certificate is fetched;
  - 19: an incoming letter's `mcName` is the Mojang profile name (rename after sending is shown); profile `Unreachable` → not filed, filed on the next poll; profile `None` → `DeleteMail`;
  - 20: login performs **zero** `join` calls (FakeMojang join count); acceptance still performs its two;
  - 21: a certificate fetch failure with a usable cached certificate → login succeeds.

### 8.3 Owner-verified (results in `docs/friends/VERIFICATION.md`, table N, rows replaced or added)

| # | Steps | Pass |
|---|---|---|
| O-1 | `cd directory && node test.mjs`; `node scripts/mojang-keys.mjs check` | all `ok`; "ok: 2 keys match" |
| O-2 | `npx wrangler d1 migrations apply pumpkin-friends-directory --remote`, **then** `npx wrangler deploy`. Then `curl -s -X POST https://pumpkin-friends-directory.jonas-laux.workers.dev/v1/auth/session -H "content-type: application/json" -d "{\"challenge\":\"x\",\"name\":\"Steve\",\"signature\":\"00\"}"` | migration 0002 applied; curl prints `{"error":"invalid"}` |
| O-3 | Real login before the release: in PowerShell `$env:PUMPKIN_FRIENDS_DIRECTORY="https://pumpkin-friends-directory.jonas-laux.workers.dev"; npm run tauri:remote` (or `pnpm tauri dev`). Sign in with the real Microsoft account, enable Friends, Settings › Freunde › "Per Minecraft-Namen auffindbar" on. Then `npx wrangler d1 execute pumpkin-friends-directory --remote --command "SELECT uuid FROM users"` | Status "Auffindbar als <name>" within 30 s; the query lists your UUID (no hyphens) and nothing else. This proves the live key encoding, the pinned key #0 and the L3 layout. If it fails, note the launcher log line (code only) and stop the release. |
| O-4 | N3 with two PCs and two accounts on the 2.0.1 build: A sends to B by name while B's launcher is closed; B starts | The request shows "Minecraft: <A's current name>" within 30 s of opening Friends; accepting makes both friends within 30 s |
| O-5 | Running game: start a 1.20+ instance, join an online server, send a chat message. Restart the launcher while the game keeps running (this forces a new certificate fetch at the next handshake), wait until the status is "Auffindbar". Send another chat message, and stay 2 min | Chat works; no "chat validation error" kick. Record the result (it settles "certificate fetch affects the running game") |
| O-6 | Cloudflare dashboard › Workers › pumpkin-friends-directory › Metrics after O-3/O-4 | CPU time p99 < 10 ms; subrequests 0 |
| O-7 | A child or multiplayer-disabled account, if available | `notAllowed` shown; codes still work |
| O-8 | GitHub › Actions › "Mojang keys" › Run workflow | green |

---

## 9. Work packages

Exclusive file ownership while a package runs. Every package follows the clean-code skill, writes German code comments like the surrounding code, and keeps CI green.

| Id | Area | Title | Files (exclusive) | Depends | Acceptance (agent-verifiable) |
|---|---|---|---|---|---|
| AT-W1 | worker | Worker: offline certificate login | `directory/src/{auth.js, index.js, letters.js, store.js, util.js, mojang-keys.js (new)}`, `directory/migrations/0002_letters_without_name.sql` (new), `directory/test.mjs`, `directory/test/{world.mjs, d1.mjs, mojang-publickeys.json (new), cert-vectors.json (new)}`, `directory/scripts/mojang-keys.mjs` (new), `directory/README.md`, `directory/wrangler.toml` (comments only), `.github/workflows/mojang-keys.yml` (new) | — | `node directory/test.mjs` exits 0 with every case of 8.1; `MOJANG_PUBLICKEYS=<scratchpad>/mojang-publickeys.json node directory/test.mjs` exits 0; `grep -rn "fetch(\|sessionserver\|hasJoined\|from_name" directory/src` finds nothing; `node directory/scripts/mojang-keys.mjs check` exits 0 (unauthenticated GET of `/publickeys` only); the A2 route reads at most 4096 bytes, every other route 2048; README route table and runbook mention migration 0002 before deploy and the key update procedure |
| AT-R1 | rust | Launcher: certificate login, name lookup, errors | `src-tauri/Cargo.toml` (`ring`, `time`), `src-tauri/Cargo.lock`, `src-tauri/src/services/friends/directory/{certificate.rs (new), testdata/rsa-test-keys.json (new), mod.rs, mojang.rs, proof.rs, wire.rs, api.rs, fake.rs, http_tests.rs}`, `src-tauri/src/services/friends/{by_name.rs, tests_by_name.rs, test_support.rs (only if an AccountTokens fake lives there)}`, `src-tauri/src/friends_commands.rs` (`AppAccountTokens::forget_minecraft_session`), `src-tauri/src/services/auth/mod.rs` (append `pub fn forget_session`) | — (protocol fixed by this addendum; runs in parallel with AT-W1) | `cargo test --manifest-path src-tauri/Cargo.toml` green, including every case of 8.2 and vectors A.2/A.5/A.6; `cargo clippy --all-targets -- -D warnings` clean; `git diff src-tauri/Cargo.lock` adds no `[[package]]` entry; `cargo deny check advisories` passes; `grep -rn "NotJoined\|MojangUnavailable\|notJoined\|mojangUnavailable" src-tauri/src` finds nothing; no `join` call reachable from `handshake` (test 20) |
| AT-F1 | frontend | Privacy and request texts | `src/i18n/{de,en}/friendsSettings.ts` (`privacy.sessionserverProof`, `privacy.nameLookupName`, `privacy.nameLookup`), `src/i18n/{de,en}/friends.ts` (`requests.nameChecked`), `src/components/PrivacyNotice.tsx` (comments only) | — | `pnpm build` and `pnpm check:lib` green; strings exactly as follows. de `sessionserverProof`: "Kontonachweis beim Annehmen einer Anfrage per Name und die Namen der Absender." en: "Account proof when accepting a request by name, and the names of senders." de `nameLookupName`: "Minecraft-Namenssuche und Kontonachweis" / en "Minecraft name lookup and account proof". de `nameLookup`: "Name → UUID beim Senden per Name; ein von Mojang signiertes Spielerzertifikat als Kontonachweis für das Verzeichnis" / en "Name → UUID when sending by name; a Mojang-signed player certificate as account proof for the directory". de `nameChecked`: "Konto per Mojang-Zertifikat vom Verzeichnis geprüft, Name direkt bei Mojang nachgeschlagen; beim Annehmen prüfen beide Launcher das Konto noch einmal bei Mojang" / en "Account checked by the directory with Mojang's certificate, name looked up at Mojang; on accepting, both launchers check the account at Mojang again" |
| AT-D1 | docs | Spec, privacy, website | `docs/friends/{BYNAME.md, SPEC.md, PRIVACY.md, OWNER-CHECKLIST.md, VERIFICATION.md}`, `website/datenschutz.html`, `docs/ARCHITECTURE.md` (only lines naming the directory's Mojang call) | AT-W1, AT-R1, AT-F1 (writes back deviations) | BYNAME.md: a revision note (2026-10-03, why), plus sections 0, 2, 3.1, 4 (common rules, A2 row, I1 example, "no subrequests"), 5.1 (migration 0002), 5.2, 7.2, 8, 9.1, 9.6, 9.8, 9.9, 10.1, 10.2, 10.4 and 12 (R1 rewritten as "pinned Mojang keys", R2 limited to acceptance) and Appendix A (A.2 replaced, A.5/A.6 added) all match this addendum. SPEC.md: `NotAllowed` definition (section 5.6) and the 12.1/12.4 bullets. PRIVACY.md and datenschutz.html state: the directory never contacts Mojang; ownership is proven with a player certificate **signed by Mojang** that the launcher fetches at `api.minecraftservices.com`; the access token never leaves the PC; the directory stores no names; senders' names are looked up by the recipient's launcher at `sessionserver.mojang.com`. `grep -n "hasJoined" docs/friends/BYNAME.md` hits only N 3.2/7.4/9.9 (acceptance). `pnpm check:website` green |
| AT-REL | docs | Version 2.0.1 | `package.json` (`version`), `src-tauri/tauri.conf.json` (`version`), `src-tauri/Cargo.toml` (`[package] version` only), `src-tauri/Cargo.lock` (root version only) | AT-R1, AT-F1, AT-D1 | all three files say `2.0.1`; `cargo check` refreshed the lock; the tag-message text below is handed to the owner |

Waves: **1** AT-W1 ∥ AT-R1 ∥ AT-F1 → **2** AT-D1 → **3** AT-REL.

AT-W1 and AT-R1 share no files. They agree only through sections 1-2 and the vectors.

---

## 10. Rollout

**Order: Worker first.**
- 2.0.0 launchers cannot log in today and cannot log in afterwards: 400 instead of 503, the same message.
- 2.0.1 launchers need the new Worker.
- Deploying the Worker first lets the owner prove the real path (O-3) with a dev build **before** tagging.
- There is no staging Worker: production is fully broken today, so a deploy cannot regress anything.

1. Merge AT-W1. Owner, in `directory/`:
   - `npx wrangler d1 migrations apply pumpkin-friends-directory --remote`. Run this **before** the deploy: the new code no longer writes `from_name`, which is NOT NULL until 0002 runs.
   - `npx wrangler deploy`.
   - Run O-1 and O-2.
   - Optionally, check that D1 holds no 2.0.0 rows: `npx wrangler d1 execute pumpkin-friends-directory --remote --command "SELECT (SELECT COUNT(*) FROM users),(SELECT COUNT(*) FROM letters)"`. The expected result is `0, 0`.
2. Merge AT-R1 and AT-F1. Owner runs **O-3** against the deployed Worker with a dev build.
   - **Gate:** if O-3 fails and the cause is not a quick fix, use the fallback in the Fallback section below.
3. Merge AT-D1 and AT-REL, then follow `docs/RELEASING.md`:
   - `git tag -a v2.0.1 -F notes.md`, then `git push origin v2.0.1`;
   - approve the three build jobs in the `release` environment;
   - check the draft and *Publish release*.

   The updater delivers 2.0.1 to 2.0.0 users. The website deploys `datenschutz.html` through `website.yml` on the push to `main`.

   `notes.md`:
   ```
   Pumpkin Launcher 2.0.1

   - Freunde per Minecraft-Namen funktioniert jetzt: Die Anmeldung am Freunde-Verzeichnis scheiterte in 2.0.0 immer („Verzeichnis nicht erreichbar“). Dein Konto wird jetzt mit einem von Mojang signierten Spielerzertifikat nachgewiesen; das Verzeichnis fragt Mojang nicht mehr selbst und speichert keine Namen.
   - Friends by Minecraft name now works: in 2.0.0, logging in to the friends directory always failed ("directory unavailable"). Your account is now proven with a player certificate signed by Mojang; the directory no longer contacts Mojang itself and stores no names.
   ```
4. After publishing: run O-4, O-5, O-6 and O-8 (and O-7 if an account is available), and record them in `VERIFICATION.md`.

**Owner actions summary:**
- D1 migration and Worker deploy (step 1);
- dev-build login test O-3 (step 2);
- tag, release approvals and publish (step 3);
- O-4 to O-8;
- in future, react to a failing "Mojang keys" workflow with `node directory/scripts/mojang-keys.mjs update` → test → PR → `npx wrangler deploy`.

### Fallback (only if O-3 shows that the certificate path cannot work)

**F1 (same day).** Ship 2.0.1 without by-name:
- remove `PUMPKIN_FRIENDS_DIRECTORY` from `.github/workflows/release.yml`;
- `DirectoryState::Unavailable` then hides the Name tab and the switch;
- codes are unaffected;
- users no longer see a broken switch.

**F2 (later).** Move only the `hasJoined` call to an egress that Mojang does not block, for example a tiny HTTPS relay on a non-Cloudflare host, and restore the old A2.

F2 is not needed while O-3 passes.
