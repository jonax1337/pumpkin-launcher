# CurseForge-Proxy (Cloudflare Worker)

Hält den CurseForge-API-Schlüssel, damit er nie in der App oder im Repo steckt. Der Launcher fragt diesen Worker
statt `api.curseforge.com`; der Worker lässt nur die wenigen Abfragen durch, die der Launcher braucht, begrenzt
sie pro Nutzer und hängt den Schlüssel selbst an.

Einrichten (einmalig, Cloudflare-Konto nötig):

```sh
cd proxy
npx wrangler login
npx wrangler deploy
npx wrangler secret put CURSEFORGE_API_KEY   # Schlüssel einfügen, er wird nirgends angezeigt oder gespeichert
```

`wrangler deploy` nennt die Adresse des Workers. Der Launcher kennt die Adresse dieses Projekts fest
(`DEFAULT_PROXY` in `curseforge.rs`); wer einen eigenen Worker nutzt, setzt `PUMPKIN_CF_PROXY=<adresse>` (zur Laufzeit oder beim Bauen).
Es gibt keinen eigenen Schlüssel im Launcher: CurseForge läuft immer über den Worker.

Die Logik lässt sich ohne Cloudflare prüfen: `node test.mjs` (simuliert Cloudflare und CurseForge).

Der Worker läuft für dieses Projekt unter `https://pumpkin-curseforge.jonas-laux.workers.dev`. Der Schlüssel liegt dort als
Secret; ersetzen kannst du ihn jederzeit mit `npx wrangler secret put CURSEFORGE_API_KEY`.

Erlaubt sind nur: `GET /v1/mods/search`, `/v1/mods/{id}`, `/v1/mods/{id}/description`, `/v1/mods/{id}/files`,
`/v1/mods/{id}/files/{fileId}` und `POST /v1/mods`, `/v1/mods/files` (Listen bis 200 Nummern).
