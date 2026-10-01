# CurseForge-Proxy (Cloudflare Worker)

Hält den CurseForge-API-Schlüssel, damit er nie in der App oder im Repo steckt. Der Launcher fragt diesen Worker
statt `api.curseforge.com`; der Worker lässt nur die wenigen Abfragen durch, die der Launcher braucht, begrenzt
sie pro Nutzer und hängt den Schlüssel selbst an.

Regeln aus den [API-Bedingungen von CurseForge](https://support.curseforge.com/en/support/solutions/articles/9000207405-curse-forge-3rd-party-api-terms-and-conditions):

- **Kein Zwischenspeicher.** Abschnitt 3(e) verbietet, Daten aus der API zu speichern oder zu cachen. Der Worker reicht
  jede Antwort nur durch, der Launcher legt keinen Katalog auf der Platte ab (er merkt sich nur, welche Datei in
  welcher Instanz steckt).
- **Keine Dateien über den Worker.** Mods und Packs lädt der Launcher direkt vom CurseForge-CDN. Eine Download-Route
  im Worker gäbe es nur mit schriftlicher Erlaubnis von CurseForge.
- **Offen auftreten.** Der Worker meldet sich bei CurseForge mit einem eigenen User-Agent samt Repo-Adresse.
- **Nur der Launcher.** Anfragen mit `Origin`-Header (also aus Browser-Seiten) werden abgelehnt, Suchparameter streng
  geprüft (bekannte Felder, Seiten bis 50, `index + pageSize` bis 10 000), Antworten von CurseForge nach 15 s abgebrochen.

Einrichten (einmalig, Cloudflare-Konto und Wrangler ab 4.36 nötig):

```sh
cd proxy
npx wrangler login
npx wrangler deploy
npx wrangler secret put CURSEFORGE_API_KEY   # Schlüssel einfügen, er wird nirgends angezeigt oder gespeichert
```

`wrangler deploy` nennt die Adresse des Workers. Der Launcher kennt die Adresse dieses Projekts fest
(`DEFAULT_PROXY` in `curseforge.rs`). Es gibt keinen eigenen Schlüssel im Launcher: CurseForge läuft immer über einen Worker.

**Forks** nutzen diesen Worker nicht. Der Schlüssel ist an dieses Projekt vergeben; wer den Launcher weitergibt,
[beantragt einen eigenen Schlüssel](https://console.curseforge.com/) bei CurseForge, richtet einen eigenen Worker ein
und setzt `PUMPKIN_CF_PROXY=<adresse>` (zur Laufzeit oder beim Bauen).

Die Logik lässt sich ohne Cloudflare prüfen: `node test.mjs` (simuliert Cloudflare und CurseForge).

Der Worker läuft für dieses Projekt unter `https://pumpkin-curseforge.jonas-laux.workers.dev`. Die Begrenzung (60 Anfragen
pro Minute und IP) steht als `[[ratelimits]]` in `wrangler.toml`; gedrosselte Anfragen bekommen `Retry-After` mit diesem
Zeitraum (`LIMIT_PERIOD` im Worker, bei Änderungen beides anpassen).

Schlüssel wechseln (etwa nach einem Leck oder wenn CurseForge ihn erneuert): neuen Schlüssel in der CurseForge-Konsole
anlegen, `npx wrangler secret put CURSEFORGE_API_KEY` ausführen und einfügen; der Worker nutzt ihn sofort, ein neues
Deploy ist nicht nötig. Danach den alten Schlüssel in der Konsole löschen.

Erlaubt sind nur: `GET /v1/mods/search`, `/v1/mods/{id}`, `/v1/mods/{id}/description`, `/v1/mods/{id}/files`,
`/v1/mods/{id}/files/{fileId}` und `POST /v1/mods`, `/v1/mods/files` (Listen bis 200 Nummern).
