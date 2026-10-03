# Freunde-Verzeichnis (Cloudflare Worker)

Macht "Freund per Namen hinzufügen" möglich: Der Worker weist über Mojang nach, welchem Minecraft-Konto ein Launcher
gehört, führt die Liste derer, die per Namen auffindbar sein wollen (nur ihre Minecraft-UUID), und verwahrt
Freundesanfragen bis zu 14 Tage, auch wenn die andere Person gerade offline ist. Ein Brief trägt den einmaligen
Freundescode des Absenders; die Freundschaft selbst entsteht danach im Launcher über den normalen P2P-Ablauf, bei dem
beide Seiten ihr Minecraft-Konto gegenseitig bei Mojang beweisen. Der Worker kann deshalb Briefe verlieren oder
verschicken, sich aber nie als jemand anderes ausgeben. Entwurf und Begründung: [`docs/friends/BYNAME.md`](../docs/friends/BYNAME.md).

Der Worker ist getrennt von [`proxy/`](../proxy) (eigener Name, eigene Geheimnisse, nie mit dem CurseForge-Schlüssel
vermischt). Ohne ihn gehen Freundescodes, Anwesenheit, Einladungen und Tunnel unverändert weiter.

## Was gespeichert wird

| Daten | Tabelle | Aufbewahrung |
|---|---|---|
| UUID einer auffindbaren Person, erste Anmeldung, letzte Auffrischung | `users` | bis zum Ausschalten, bis zum Abmelden von Friends oder 30 Tage ohne Auffrischung |
| Briefe: Absender (UUID, Name, Peer-ID), Empfänger, Code-Teile, Anzeigename, Signatur | `letters` | bis beantwortet, zurückgezogen, gesperrt oder 14 Tage |
| Sperren: Besitzer → gesperrte UUID | `blocks` | bis zum Entsperren oder Abmelden |
| Sendeprotokoll: von, an, Zeit | `sends` | 7 Tage |

**Nicht gespeichert:** Namen auffindbarer Personen (Name → UUID löst der Launcher bei Mojang auf), IP-Adressen,
Anwesenheit, Freundeslisten, der Ausgang einer Anfrage (Annehmen und Ablehnen sehen für den Worker gleich aus),
Token und Herausforderungen (beide sind zustandslos). Die Protokollierung von Cloudflare ist abgeschaltet
(`[observability] enabled = false`), der Worker schreibt nichts in Logs.

Gelöschte Zeilen bleiben über D1 Time Travel 7 Tage (Free) bzw. 30 Tage (Paid) wiederherstellbar; das lässt sich
nicht abschalten und gehört in die Datenschutzerklärung.

## Routen

Nur JSON, Körper höchstens 2 KiB. Jede Anfrage mit `Origin`-Header (also aus einer Webseite) wird mit 403 abgelehnt,
unbekannte Methoden oder Pfade mit 404. Fehler sind immer `{"error":"<Code>"}`. Geschützte Routen brauchen
`Authorization: Bearer <Token>` (sonst 401).

| Route | Anmeldung | Antwort | Fehler |
|---|---|---|---|
| `POST /v1/auth/challenge` `{peerId}` | nein | 200 `{challenge, serverId, expiresAt}` | 400 `invalid` |
| `POST /v1/auth/session` `{challenge, name, signature}` | nein | 200 `{token, expiresAt, uuid, name}` | 400 `invalid` / `challengeExpired`, 401 `badSignature` / `notJoined`, 503 `mojangUnavailable` |
| `PUT /v1/me` `{}` | ja | 200 `{findable, refreshedAt}`: auffindbar machen oder auffrischen | |
| `DELETE /v1/me` | ja | 204: löscht den Eintrag, das Postfach und die Sperren | |
| `POST /v1/outbox` (Brief) | ja | 202 `{id, expiresAt}` | 400 `invalid` / `self` / `badSignature` / `clock`, 404 `notFindable`, 409 `recipientFull`, 429 `sendQuota` / `pairCooldown` / `rateLimited` |
| `DELETE /v1/outbox/{id}` | ja | 204 immer: zieht einen eigenen Brief zurück | |
| `GET /v1/inbox` | ja | 200 `{letters}`: höchstens 20, älteste zuerst | 404 `notRegistered` |
| `DELETE /v1/inbox/{id}` | ja | 204 immer: löscht einen Brief an mich | |
| `PUT /v1/blocks/{uuid}` | ja | 204: sperrt und löscht wartende Briefe dieser UUID | 404 `notRegistered`, 409 `blockListFull` (1 000) |
| `DELETE /v1/blocks/{uuid}` | ja | 204 immer | |

Alle Routen: 429 `rateLimited` mit `Retry-After: 60`, 503 `notConfigured`, wenn `DB`, `LIMITER_IP`, `LIMITER_ACCOUNT`
oder `TOKEN_KEY` fehlen (der Worker antwortet dann lieber gar nicht, als ungeschützt zu arbeiten).

Anmeldung in kurz: Der Worker gibt eine zustandslose Herausforderung und eine `serverId` aus; der Launcher ruft damit
Mojangs `join` auf und signiert die Herausforderung mit seinem Freundeschlüssel; der Worker prüft die Signatur und fragt
Mojangs `hasJoined` (5 s Zeitlimit, ohne `ip`). Das Token (6 Stunden, nur im Speicher des Launchers) trägt UUID, Name und
Peer-ID und wird mit `TOKEN_KEY` per HMAC gesichert.

Grenzen: höchstens 10 Briefe je Absender in 24 Stunden, 1 Brief je Absender und Empfänger in 7 Tagen, 20 wartende Briefe
je Postfach. Das zählt die Datenbank exakt; die `[[ratelimits]]` (60 Anfragen pro Minute und IP, 30 je Konto) sind nur
eine grobe Bremse je Cloudflare-Standort. Eine Anfrage an jemanden, der den Absender gesperrt hat, wird wie eine
Zustellung beantwortet (202), aber nichts wird abgelegt.

Täglich um 03:17 UTC räumt ein Cron-Lauf auf: abgelaufene Briefe, Sendeprotokoll älter als 7 Tage, Einträge ohne
Auffrischung seit 30 Tagen samt Postfach und Sperren.

## Einrichten (einmalig, Cloudflare-Konto und Wrangler ab 4.36 nötig)

```sh
cd directory
npx wrangler login
npx wrangler d1 create pumpkin-friends-directory --jurisdiction eu
```

Die ausgegebene `database_id` kommt in `wrangler.toml` anstelle des Platzhalters. Die Region (`eu`) lässt sich nur beim
Anlegen festlegen. Dann:

```sh
npx wrangler d1 migrations apply pumpkin-friends-directory --remote
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put TOKEN_KEY
npx wrangler deploy
```

Das Geheimnis wird nirgends angezeigt oder gespeichert. `wrangler deploy` nennt die Adresse des Workers (zuerst
`pumpkin-friends-directory.<konto>.workers.dev`, optional später eine eigene Domain). Diese Adresse kommt als
`DEFAULT_DIRECTORY` in den Launcher (ein Einzeiler im Pull Request); dazu und zu den Prüfungen danach siehe
[`OWNER-CHECKLIST.md`](../docs/friends/OWNER-CHECKLIST.md).

Offene Entscheidungen, die vor einem Release geklärt sein müssen (Mojang-Freigabe, Datenschutzerklärung, Kontaktadresse
für Auskunftswünsche): [`BYNAME.md`](../docs/friends/BYNAME.md), Abschnitt 12.

**Forks** nutzen dieses Verzeichnis nicht automatisch: Der Launcher bringt die Adresse nur in offiziellen Builds mit;
wer selbst baut, richtet einen eigenen Worker ein und setzt `PUMPKIN_FRIENDS_DIRECTORY=<adresse>` (zur Laufzeit oder
beim Bauen).

Schlüssel wechseln (etwa nach einem Leck): `npx wrangler secret put TOKEN_KEY` mit einem neuen Wert. Alle Token und
Herausforderungen sind sofort ungültig; die Launcher melden sich einfach neu an. Bei einem Einbruch zusätzlich neu
deployen und die Datenbank leeren.

## Prüfen

`node test.mjs` prüft alle Routen, Grenzen, den Cron-Lauf und die Testvektoren aus
[`BYNAME.md`](../docs/friends/BYNAME.md), Anhang A (Node 24; kein Cloudflare-Konto, kein Netz). D1 wird mit
`node:sqlite` nachgebildet (`test/d1.mjs`), Mojang mit einem falschen `fetch`, die Schlüssel kommen aus WebCrypto.
Der Worker liest die Uhrzeit aus `env.NOW`, wenn sie gesetzt ist; das nutzen nur die Tests.
