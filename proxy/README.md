# CurseForge proxy

Cloudflare Worker that keeps the CurseForge API key out of the launcher and repository. It forwards only the catalog requests the launcher uses, adds the key server-side and rate-limits callers. The separate [Friends directory](../directory/README.md) uses different bindings and secrets.

## Setup

Requires a Cloudflare account and Wrangler 4.36 or later. From this directory:

```sh
npx wrangler login
npx wrangler deploy
npx wrangler secret put CURSEFORGE_API_KEY
```

Store the key as a Cloudflare secret, never in source or launcher settings. The official
launcher uses `DEFAULT_PROXY` in `src-tauri/src/services/providers/curseforge/proxy.rs`.
Forks need their own CurseForge key and Worker. Set `PUMPKIN_CF_PROXY` to that Worker's
HTTPS base URL before building or launching the desktop app, for example from the repository root:

```powershell
$env:PUMPKIN_CF_PROXY = 'https://your-proxy.example'
pnpm tauri dev
```

Runtime configuration takes precedence over the compiled build-time value. Unlike the
Friends directory, an empty/invalid selected proxy value falls back to `DEFAULT_PROXY`,
not to a disabled proxy or the lower-priority build-time value. Set a valid own endpoint
for a fork; an invalid override is not a way to prevent requests to the official Worker.

The `LIMITER` binding in `wrangler.toml` permits 60 requests per minute per IP. Missing binding returns 503; missing API key returns 500. Requests without `cf-connecting-ip` share a fallback bucket. Rate-limited responses include `Retry-After: 60`.

## API and constraints

Allowed routes:

- `GET /v1/mods/search`
- `GET /v1/mods/{id}` and `/v1/mods/{id}/description`
- `GET /v1/mods/{id}/files` and `/v1/mods/{id}/files/{fileId}`
- `POST /v1/mods` with `modIds`, and `/v1/mods/files` with `fileIds`, up to 200 positive ids

Unknown methods/paths return 404; requests carrying an `Origin` header return 403. Search parameters are allowlisted, page size is at most 50 and `index + pageSize` at most 10,000. Upstream requests time out after 15 seconds.

The Worker does not cache or store API data, and does not proxy file downloads. The launcher downloads mods and packs directly from CurseForge's CDN. These constraints follow the [CurseForge third-party API terms](https://support.curseforge.com/en/support/solutions/articles/9000207405-curse-forge-3rd-party-api-terms-and-conditions). Upstream requests identify the project with a User-Agent.

## Maintenance

To rotate the key, create its replacement in the CurseForge console, update `CURSEFORGE_API_KEY` with Wrangler and revoke the old key. A redeploy is not needed for the secret update. `node test.mjs` is the offline Worker/CurseForge simulation tool.
