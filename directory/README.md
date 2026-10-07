# Friends directory

Cloudflare Worker for optional friend lookup by Minecraft name. It verifies Mojang-signed player certificates offline, stores findable UUIDs and holds signed friend-code letters for up to 14 days. Friendship itself is established by the launcher's authenticated peer-to-peer flow; the directory cannot impersonate a peer.

The Worker makes no subrequests. The launcher fetches its player certificate from Mojang and sends only its public part. Pinned keys in `src/mojang-keys.js` verify Mojang's signature. This service is separate from the [CurseForge proxy](../proxy/README.md); friend codes, presence, invitations and tunnels do not require the directory.

The full wire contract is in [SPEC.md](../docs/friends/SPEC.md#directory-api).

## Stored data and limits

| Table | Contents | Retention |
|---|---|---|
| `users` | Findable UUID, first login and last refresh | Until removal or 30 days without refresh |
| `letters` | Sender UUID/peer id, recipient, code parts, signed `displayName` and signature | Until removal or 14 days |
| `blocks` | Owner-to-blocked UUID relationship | Until unblocked or owner registration removed (including findability/Friends opt-out) |
| `sends` | Sender, recipient and send time | 7 days |

The Worker retains the signed sender `displayName` inside pending letter bodies; it is not a verified Minecraft name. It does not retain certificates, IP addresses, presence, friend lists, tokens, challenges or acceptance outcomes. Logging is disabled. D1 Time Travel can retain deleted rows for 7 days on Free or 30 days on Paid; account for this in the service privacy policy.

Findability/Friends opt-out **queues** removal of the registration, inbox and owned blocks;
visible remote deletion requires successful processing by the service. Ordinary account
sign-out is not an immediate-erasure guarantee. If an account is removed before queued
cleanup succeeds, data can remain until inactive retention expires. See
[Retention and deletion](../docs/friends/PRIVACY.md#retention-and-deletion) for outgoing-letter,
send-history and backup limits.

Quotas are 10 letters per sender per day, one letter per pair in seven days and 20 pending letters per inbox. Coarse Cloudflare limits are 60 requests/minute per IP and 30 per account. Blocks suppress delivery while preserving the normal 202 response. Daily cleanup runs at 03:17 UTC.

## Routes

JSON bodies are limited to 2 KiB, or 4 KiB for certificate login. An `Origin` header returns 403; unknown routes/methods return 404. Protected routes require a bearer token. Errors use `{"error":"<code>"}`.

| Route | Purpose |
|---|---|
| `POST /v2/auth/challenge` | Issue a stateless account-proof challenge |
| `POST /v2/auth/session` | Verify peer/certificate signatures and issue a token |
| `POST /v1/auth/challenge`, `POST /v1/auth/session` | Retired login; 410 `gone` |
| `PUT /v1/me` | Register or refresh findability |
| `DELETE /v1/me` | Remove registration, inbox and blocks |
| `POST /v1/outbox` | Submit a signed friend-code letter |
| `DELETE /v1/outbox/{id}` | Retract an own letter |
| `GET /v1/inbox` | List up to 20 pending letters, oldest first |
| `DELETE /v1/inbox/{id}` | Remove a received letter |
| `PUT /v1/blocks/{uuid}` | Block an account and delete its waiting letters |
| `DELETE /v1/blocks/{uuid}` | Unblock an account |

All active routes need `DB`, `LIMITER_IP`, `LIMITER_ACCOUNT` and `TOKEN_KEY`; missing configuration returns 503 `notConfigured`. Throttling returns 429 with `Retry-After: 60`. Tokens last at most six hours and never outlive the player certificate. Login signatures are bound to the directory hostname, so changing the client-facing hostname changes the signature audience.

## Deployment

Requires a Cloudflare account and Wrangler 4.36 or later. For a new installation, from this directory:

```sh
npx wrangler login
npx wrangler d1 create pumpkin-friends-directory --jurisdiction eu
```

Set the returned database id in `wrangler.toml`; jurisdiction is selected at creation. Apply migrations before deploying code that relies on them:

```sh
npx wrangler d1 migrations apply pumpkin-friends-directory --remote
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put TOKEN_KEY
npx wrangler deploy
```

Migration `0002_letters_without_name.sql` removes the legacy required name column. It must be applied before certificate-login code that omits that column.

The source `DEFAULT_DIRECTORY` in `src-tauri/src/services/friends/directory/mod.rs` is
**empty**. Official tagged builds supply `PUMPKIN_FRIENDS_DIRECTORY` through the
[release workflow](../.github/workflows/release.yml); [local Friends development](../CONTRIBUTING.md#development-setup)
uses a wrapper default. Neither setting proves service availability.

Forks deploy their own service and set `PUMPKIN_FRIENDS_DIRECTORY` to its HTTPS base URL
before building or launching the desktop app. Runtime wins over the compiled build-time
value, which wins over the empty source default. An empty or invalid selected value disables
directory access; it does **not** fall back to the compiled/official address or cause a Worker
error response. The launcher then has no configured by-name directory; friend codes remain independent.

For example, from the repository root in PowerShell, substitute your deployed hostname:

```powershell
$env:PUMPKIN_FRIENDS_DIRECTORY = 'https://your-directory.example'
pnpm tauri dev
```

The same environment assignment before `pnpm tauri build` embeds the address; setting it
in the installed launcher's process environment overrides that embedded value. A custom
domain works when the launcher uses that same hostname. Service deployment does not resolve
Mojang approval or privacy obligations; see [PRIVACY.md](../docs/friends/PRIVACY.md).

Updating `TOKEN_KEY` invalidates all tokens and challenges immediately; clients authenticate again. After compromise, database remediation and redeployment are separate operational decisions.

## Mojang keys and developer tools

- `node scripts/mojang-keys.mjs check`: compare pinned keys with Mojang's current list; exit 0 for a match, 1 for a difference and 2 for unavailable upstream.
- `node scripts/mojang-keys.mjs update`: refresh `src/mojang-keys.js` and `test/mojang-publickeys.json`. Updated keys take effect after Worker deployment, without a launcher release.
- `node test.mjs`: offline Node 24 route, quota, cleanup and certificate fixtures using `node:sqlite`; no Cloudflare account or network is needed. `MOJANG_PUBLICKEYS=<file>` supplies another saved key-list answer.

The full-inbox replacement test selects a sender whose letter remains after deleting the
observed oldest letter. Equal timestamps are ordered by letter UUID, not sender creation
order; the test must not assume which sender's letter was deleted.

`.github/workflows/mojang-keys.yml` monitors upstream keys. A new signing key can cause `401 badCertificate` until the pinned-key update is deployed; friend codes remain independent of directory login. Advance publication of keys is not guaranteed.
