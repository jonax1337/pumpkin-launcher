# Friends directory (Cloudflare Worker)

Makes "add a friend by name" possible. The Worker checks which Minecraft account a launcher holds, keeps the list of
those who want to be findable by name (only their Minecraft UUID), and holds friend requests for up to 14 days, even
while the other person is offline. A letter carries the sender's single-use friend code; the friendship itself is then
made in the launcher through the normal P2P flow, in which both sides prove their Minecraft account to each other at
Mojang. The Worker can therefore lose or deliver letters, but never pose as someone else. Design and reasoning:
[`docs/friends/BYNAME.md`](../docs/friends/BYNAME.md) and, for the login,
[`docs/friends/BYNAME-ATTEST.md`](../docs/friends/BYNAME-ATTEST.md).

**The Worker makes no subrequests.** Mojang answers every request from Cloudflare Workers with 403, so the Worker
checks accounts offline: the launcher fetches its Mojang-signed player certificate itself, and the Worker verifies
Mojang's signature with keys pinned in its source (`src/mojang-keys.js`).

The Worker is separate from [`proxy/`](../proxy) (own name, own secrets, never mixed with the CurseForge key). Without
it, friend codes, presence, invites and tunnels keep working unchanged.

## What is stored

| Data | Table | Kept |
|---|---|---|
| UUID of a findable person, first login, last refresh | `users` | until switched off, until signing out of Friends, or 30 days without refresh |
| Letters: sender (UUID, peer id), recipient, code parts, display name, signature | `letters` | until answered, retracted, blocked or 14 days |
| Blocks: owner → blocked UUID | `blocks` | until unblocked or signed out |
| Send log: from, to, time | `sends` | 7 days |

**Not stored:** player names (the directory handles none: senders' names are looked up by the recipient's launcher at
Mojang, name → UUID by the sender's launcher), player certificates and their signatures (checked, then dropped), IP
addresses, presence, friend lists, the outcome of a request (accepting and declining look the same to the Worker),
tokens and challenges (both are stateless). Cloudflare logging is off (`[observability] enabled = false`), and the
Worker writes nothing to logs.

Deleted rows stay recoverable through D1 Time Travel for 7 days (Free) or 30 days (Paid); this cannot be switched off
and belongs in the privacy policy.

## Routes

JSON only, bodies at most 2 KiB (4 KiB for `/v2/auth/session`, which carries a certificate). Every request with an
`Origin` header (that is, from a web page) gets 403, unknown methods or paths get 404. Errors are always
`{"error":"<code>"}`. Protected routes need `Authorization: Bearer <token>` (otherwise 401).

| Route | Login | Answer | Errors |
|---|---|---|---|
| `POST /v2/auth/challenge` `{peerId}` | no | 200 `{challenge, serverId, expiresAt}` | 400 `invalid` |
| `POST /v2/auth/session` `{challenge, uuid, certificate: {publicKey, expiresAt, mojangSignature}, certSignature, signature}` | no | 200 `{token, expiresAt, uuid}` | 400 `invalid` / `challengeExpired`, 401 `badSignature` / `badCertificate` / `certificateExpired`, 413 `tooLarge` |
| `POST /v1/auth/challenge`, `POST /v1/auth/session` | – | 410 `gone`: the 2.0.0 login, retired | |
| `PUT /v1/me` `{}` | yes | 200 `{findable, refreshedAt}`: become findable or refresh | |
| `DELETE /v1/me` | yes | 204: deletes the entry, the inbox and the blocks | |
| `POST /v1/outbox` (letter) | yes | 202 `{id, expiresAt}` | 400 `invalid` / `self` / `badSignature` / `clock`, 404 `notFindable`, 409 `recipientFull`, 429 `sendQuota` / `pairCooldown` / `rateLimited` |
| `DELETE /v1/outbox/{id}` | yes | 204 always: retracts an own letter | |
| `GET /v1/inbox` | yes | 200 `{letters}`: at most 20, oldest first; `from` is `{uuid, peerId}` | 404 `notRegistered` |
| `DELETE /v1/inbox/{id}` | yes | 204 always: deletes a letter to me | |
| `PUT /v1/blocks/{uuid}` | yes | 204: blocks and deletes waiting letters from that UUID | 404 `notRegistered`, 409 `blockListFull` (1,000) |
| `DELETE /v1/blocks/{uuid}` | yes | 204 always | |

All routes except the retired ones: 429 `rateLimited` with `Retry-After: 60`, and 503 `notConfigured` when `DB`,
`LIMITER_IP`, `LIMITER_ACCOUNT` or `TOKEN_KEY` is missing (the Worker would rather not answer than work unprotected).
A body above the limit is refused as soon as its `Content-Length` or the bytes read so far exceed it.

**Login in short** (BYNAME-ATTEST sections 1-3): the Worker hands out a stateless challenge and a `serverId`. The
launcher fetches its player certificate from Mojang (`api.minecraftservices.com/player/certificates`, from the
player's own IP) and sends its public part with two signatures over the same 128 bytes,
`domain ‖ SHA-256(host)[0..16] ‖ serverId ‖ peerId ‖ uuid`: one with its friends key (Ed25519, domain
`pumpkin/directory-auth/2`) and one with the certificate's private key (RSA PKCS#1 v1.5 / SHA-256, domain
`pumpkin/directory-cert/1`). `host` is the directory's hostname as the launcher addresses it, so signatures made for
another directory are useless here. The Worker checks, cheapest first: the body's shape (including an RSA
SubjectPublicKeyInfo of 2048-4096 bits and a safe-integer expiry), the challenge, the Ed25519 signature, the
certificate's expiry, Mojang's SHA1withRSA signature over `uuid ‖ expiresAt ‖ SPKI` with a pinned key, and the
certificate-key signature. The token (6 hours at most, never past the certificate's expiry, only in the launcher's
memory) carries UUID and peer id and is sealed with `TOKEN_KEY` by HMAC.

Limits: at most 10 letters per sender in 24 hours, 1 letter per sender and recipient in 7 days, 20 waiting letters
per inbox. The database counts these exactly; the `[[ratelimits]]` (60 requests per minute and IP, 30 per account)
are only a coarse brake per Cloudflare location. A letter to someone who blocked the sender is answered like a
delivery (202), but nothing is stored.

A cron run cleans up daily at 03:17 UTC: expired letters, send log entries older than 7 days, and entries without a
refresh for 30 days together with their inbox and blocks.

## Setup (once; needs a Cloudflare account and Wrangler 4.36 or later)

```sh
cd directory
npx wrangler login
npx wrangler d1 create pumpkin-friends-directory --jurisdiction eu
```

The printed `database_id` replaces the placeholder in `wrangler.toml`. The region (`eu`) can only be set at creation.
Then:

```sh
npx wrangler d1 migrations apply pumpkin-friends-directory --remote
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put TOKEN_KEY
npx wrangler deploy
```

The secret is never shown or stored. `wrangler deploy` prints the Worker's address (first
`pumpkin-friends-directory.<account>.workers.dev`, optionally a custom domain later). That address goes into the
launcher as `DEFAULT_DIRECTORY` (a one-line pull request); for that and the checks afterwards see
[`OWNER-CHECKLIST.md`](../docs/friends/OWNER-CHECKLIST.md). The launcher binds its login signatures to this hostname:
a custom domain works as long as the launcher addresses the Worker by it.

Open decisions that must be settled before a release (Mojang approval, privacy policy, contact address for access
requests):
[`BYNAME.md`](../docs/friends/BYNAME.md), section 12.

**Forks** do not use this directory automatically: the launcher only ships the address in official builds; whoever
builds it themselves sets up their own Worker and sets `PUMPKIN_FRIENDS_DIRECTORY=<address>` (at run time or build
time).

Rotating the key (for example after a leak): `npx wrangler secret put TOKEN_KEY` with a new value. All tokens and
challenges become invalid at once; launchers simply log in again. After a break-in, also redeploy and empty the
database.

## Updating the deployed Worker to the certificate login (migration 0002)

The certificate login no longer writes `letters.from_name`, which is `NOT NULL` until migration
`0002_letters_without_name.sql` drops it. The order is therefore fixed, in `directory/`:

1. **Check that D1 holds no rows from 2.0.0** (mandatory; no 2.0.0 login ever succeeded, so `0, 0` is expected):
   `npx wrangler d1 execute pumpkin-friends-directory --remote --command "SELECT (SELECT COUNT(*) FROM users),(SELECT COUNT(*) FROM letters)"`.
   Stop and investigate if it is not `0, 0`.
2. `npx wrangler d1 migrations apply pumpkin-friends-directory --remote` (applies 0002).
3. `npx wrangler deploy`, **only after** step 2.
4. `curl -s -X POST https://pumpkin-friends-directory.jonas-laux.workers.dev/v1/auth/session -H "content-type: application/json" -d "{}"`
   prints `{"error":"gone"}`.

## Mojang's keys

`src/mojang-keys.js` holds Mojang's `playerCertificateKeys` from `GET https://api.minecraftservices.com/publickeys`,
in Mojang's order; `test/mojang-publickeys.json` is the saved answer they came from. There is no environment override:
the tests inject their own keys through a test-only module seam.

- `node scripts/mojang-keys.mjs check` compares the pinned keys with Mojang's live list: exit 0 with
  "ok: N keys match", 1 with a diff, 2 when Mojang cannot be reached.
- `node scripts/mojang-keys.mjs update` rewrites `src/mojang-keys.js` (with the date) and
  `test/mojang-publickeys.json` from the live answer.

**Key update procedure** (when the check fails): `node scripts/mojang-keys.mjs update`, then `node test.mjs`, a pull
request, and after the merge `npx wrangler deploy`. No launcher release is needed. Until the deploy, a certificate
signed with a new key gets `401 badCertificate`, and by-name login fails for everyone; friend codes keep working.

**Early warning:** the workflow `.github/workflows/mojang-keys.yml` runs the check daily at 05:23 UTC (and on
demand), and a failing run e-mails the owner. GitHub disables scheduled workflows of a public repository after 60
days without activity; the workflow's `keepalive` job re-enables itself through the API on every run to prevent
that. **Owner:** confirm now and then under GitHub › Actions › "Mojang keys" that the workflow is enabled and green.
That Mojang publishes a new key in `/publickeys` before signing with it is an assumption (vanilla refetches the list
every 24 hours), not a documented promise, so a rotation can still cause an outage until the update is deployed.

## Testing

`node test.mjs` checks all routes, limits, the cron run, the certificate login and the golden vectors of
[`BYNAME.md`](../docs/friends/BYNAME.md), Appendix A, and [`BYNAME-ATTEST.md`](../docs/friends/BYNAME-ATTEST.md),
section 2 (Node 24; no Cloudflare account, no network). D1 is emulated with `node:sqlite` (`test/d1.mjs`, all
migrations in order), player certificates come from fake Mojang keys, and `fetch` records and throws: the run fails
if the Worker attempts any subrequest. `test/cert-vectors.json` holds the fixed test-only RSA keys and the vectors
the launcher's tests reproduce byte for byte (host `directory.example`). With
`MOJANG_PUBLICKEYS=<file> node test.mjs` the pinned keys are compared with another saved `/publickeys` answer. The
Worker reads the time from `env.NOW` when it is set; only the tests do that.
