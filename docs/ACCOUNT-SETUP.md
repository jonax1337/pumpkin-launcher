# Microsoft-Anmeldung einrichten

Voxlet meldet Microsoft-Konten per **Gerätecode** an (Code auf microsoft.com/link eingeben). Dafür braucht Voxlet eine **eigene Azure-App** (Client-ID), die Microsoft/Mojang für die Minecraft-API freigeschaltet hat. Fremde Client-IDs anderer Launcher dürfen nicht verwendet werden.

Solange die Freigabe fehlt, klappen Microsoft-Login, Xbox Live und XSTS, aber der letzte Schritt (`api.minecraftservices.com/authentication/login_with_xbox`) antwortet mit **403**. Voxlet zeigt dann: „Microsoft hat diesen Launcher noch nicht für Minecraft freigeschaltet.“

## 1. App im Azure-Portal registrieren (einmalig, ca. 10 Minuten)

1. <https://portal.azure.com> öffnen und mit einem Microsoft-Konto anmelden (ein privates Konto reicht; ggf. wird ein kostenloser Azure-/Entra-Mandant angelegt).
2. Nach **„App-Registrierungen“** (Microsoft Entra ID → App registrations) suchen → **„Neue Registrierung“**.
3. Ausfüllen:
   - **Name:** `Voxlet`
   - **Unterstützte Kontotypen:** **„Nur persönliche Microsoft-Konten“** (*Personal Microsoft accounts only*).
   - **Umleitungs-URI:** leer lassen (der Gerätecode-Flow braucht keine).
4. **Registrieren**. Auf der Übersichtsseite die **Anwendungs-ID (Client-ID)** kopieren – Format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.
5. Links **„Authentifizierung“** (*Authentication*) → ganz unten **„Öffentliche Clientflows zulassen“** (*Allow public client flows*) auf **Ja** → **Speichern**.
6. Kein Client-Geheimnis anlegen: Voxlet ist ein öffentlicher Client, ein Geheimnis gehört nicht in eine Desktop-App.

## 2. Freigabe für die Minecraft-API beantragen

- Formular: <https://aka.ms/mce-reviewappid> (leitet auf ein Microsoft-Forms-Formular weiter, Stand 29.09.2026 geprüft).
- Angeben: die Client-ID aus Schritt 1.4, den Namen „Voxlet“, kurz den Zweck (eigener Minecraft-Java-Launcher, Anmeldung per Gerätecode, Scope `XboxLive.signin`), die Kontakt-E-Mail.
- Die Freigabe gilt einmal für die App, nicht pro Spieler, und ist kostenlos. Laut Berichten dauert sie einige Tage bis Wochen; eine Bestätigung kommt per E-Mail.

Quellen: [Minecraft Wiki – Microsoft authentication](https://minecraft.wiki/w/Microsoft_authentication) (Kontotyp „consumers“, öffentliche Clientflows, Formular aka.ms/mce-reviewappid, 403 ohne Freigabe). Microsoft-Q&A-Beiträge aus 2026 ([1](https://learn.microsoft.com/en-us/answers/questions/5971906/xboxlive-signin-minecraft-services-access-for-an-i), [2](https://learn.microsoft.com/en-gb/answers/questions/5768276/how-to-get-xboxlive-signin-permission-for-azure-ap)) verweisen teils zusätzlich auf <https://aka.ms/AppRegInfo> (leitet auf einen Minecraft-Hilfeartikel) bzw. das Xbox-Entwicklerprogramm. Falls das Formular nicht mehr erreichbar ist, dort nachsehen.

## 3. Client-ID in Voxlet eintragen

Zwei Wege, einer genügt:

- **Fest einbauen (empfohlen für Releases):** beim Bauen die Umgebungsvariable setzen, z. B. in PowerShell
  `$env:VOXLET_MS_CLIENT_ID = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"; pnpm tauri build`
  (wird per `option_env!` beim Kompilieren übernommen; nach Änderung neu bauen).
- **Zur Laufzeit:** das Frontend übergibt sie an `ms_login_start({ clientId })`. Hat es eine Client-ID, gilt diese vor der eingebauten.

Die Client-ID ist kein Geheimnis; das Refresh-Token dagegen schon – es liegt nur in der Windows-Anmeldeinformationsverwaltung (Dienst `dev.laux.launcher`, Benutzer = Minecraft-UUID), nie in `accounts.json`.

## 4. Danach testen

1. Voxlet starten, Microsoft-Anmeldung wählen. Es erscheinen ein Code und `https://www.microsoft.com/link`.
2. Code im Browser eingeben, mit einem Konto anmelden, das **Minecraft: Java Edition** besitzt.
3. Erwartung: Konto erscheint in der Liste (`ms_accounts`), `%APPDATA%\dev.laux.launcher\accounts.json` enthält nur `id`, `username`, `kind`, `clientId`.
4. In der Windows-**Anmeldeinformationsverwaltung** → Windows-Anmeldeinformationen → Generische: Eintrag `dev.laux.launcher` vorhanden.
5. Eine Instanz mit diesem Konto starten: im Spiel Mehrspieler → ein Online-Server (z. B. ein bekannter öffentlicher Server) muss ohne „Invalid session“ beitreten lassen. Skin sollte sichtbar sein.
6. Nach 24 h (Minecraft-Token abgelaufen) erneut starten: Voxlet erneuert die Sitzung still über das Refresh-Token.
7. Konto entfernen: Eintrag in `accounts.json` und in der Anmeldeinformationsverwaltung ist weg.

Mögliche Meldungen und was sie bedeuten:

| Meldung beginnt mit | Ursache |
|---|---|
| „Microsoft kennt diese Launcher-App nicht …“ | Client-ID falsch oder „Öffentliche Clientflows“ nicht auf Ja |
| „Microsoft hat diesen Launcher noch nicht für Minecraft freigeschaltet“ | Freigabe (Schritt 2) fehlt noch |
| „Zu diesem Microsoft-Konto gibt es noch kein Xbox-Profil“ | XErr 2148916233 – einmal auf xbox.com anmelden |
| „Das Konto gehört einem Kind …“ | XErr 2148916238 – Konto zu einer Microsoft-Familie hinzufügen |
| „Dieses Microsoft-Konto besitzt Minecraft: Java Edition nicht“ | kein Kauf / kein Game Pass |
