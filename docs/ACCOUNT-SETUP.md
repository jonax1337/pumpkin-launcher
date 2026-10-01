# Microsoft-Anmeldung einrichten

Pumpkin Launcher meldet Microsoft-Konten im **Browser** an (Anmeldeseite von Microsoft, danach Rücksprung auf `http://localhost`); als Rückfall gibt es den **Gerätecode** (Code auf microsoft.com/link eingeben). Dafür braucht Pumpkin Launcher eine **eigene Azure-App** (Client-ID), die Microsoft/Mojang für die Minecraft-API freigeschaltet hat. Der offizielle Build bringt seine mit; die Schritte unten brauchst du nur für einen **Fork**. Fremde Client-IDs anderer Launcher dürfen nicht verwendet werden.

Solange die Freigabe fehlt, klappen Microsoft-Login, Xbox Live und XSTS, aber der letzte Schritt (`api.minecraftservices.com/authentication/login_with_xbox`) antwortet mit **403**. Pumpkin Launcher zeigt dann: „Microsoft hat diesen Launcher noch nicht für Minecraft freigeschaltet.“

## 1. App im Azure-Portal registrieren (einmalig, ca. 10 Minuten)

1. <https://portal.azure.com> öffnen und mit einem Microsoft-Konto anmelden (ein privates Konto reicht; ggf. wird ein kostenloser Azure-/Entra-Mandant angelegt).
2. Nach **„App-Registrierungen“** (Microsoft Entra ID → App registrations) suchen → **„Neue Registrierung“**.
3. Ausfüllen:
   - **Name:** `Pumpkin Launcher`
   - **Unterstützte Kontotypen:** **„Nur persönliche Microsoft-Konten“** (*Personal Microsoft accounts only*).
   - **Umleitungs-URI:** hier leer lassen, sie kommt in Schritt 5 dazu.
4. **Registrieren**. Auf der Übersichtsseite die **Anwendungs-ID (Client-ID)** kopieren – Format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.
5. Links **„Authentifizierung“** (*Authentication*):
   - **Plattform hinzufügen** → **„Mobil- und Desktopanwendungen“** → Umleitungs-URI `http://localhost` (nur diese, ohne Port: Microsoft ignoriert bei localhost den Port, den der Launcher pro Anmeldung frei wählt).
   - ganz unten **„Öffentliche Clientflows zulassen“** (*Allow public client flows*) auf **Ja** (nötig für Browser und Gerätecode).
   - **Speichern**.
6. Kein Client-Geheimnis anlegen: Pumpkin Launcher ist ein öffentlicher Client, ein Geheimnis gehört nicht in eine Desktop-App.

## 2. Freigabe für die Minecraft-API beantragen

- Formular: <https://aka.ms/mce-reviewappid> (leitet auf ein Microsoft-Forms-Formular weiter, Stand 29.09.2026 geprüft).
- Angeben: die Client-ID aus Schritt 1.4, den Namen „Pumpkin Launcher“, kurz den Zweck (eigener Minecraft-Java-Launcher, Anmeldung im Browser mit Rücksprung auf localhost und per Gerätecode, Scope `XboxLive.signin`), die Kontakt-E-Mail.
- Die Freigabe gilt einmal für die App, nicht pro Spieler, und ist kostenlos. Laut Berichten dauert sie einige Tage bis Wochen; eine Bestätigung kommt per E-Mail.

Quellen: [Minecraft Wiki – Microsoft authentication](https://minecraft.wiki/w/Microsoft_authentication) (Kontotyp „consumers“, öffentliche Clientflows, Formular aka.ms/mce-reviewappid, 403 ohne Freigabe). Microsoft-Q&A-Beiträge aus 2026 ([1](https://learn.microsoft.com/en-us/answers/questions/5971906/xboxlive-signin-minecraft-services-access-for-an-i), [2](https://learn.microsoft.com/en-gb/answers/questions/5768276/how-to-get-xboxlive-signin-permission-for-azure-ap)) verweisen teils zusätzlich auf <https://aka.ms/AppRegInfo> (leitet auf einen Minecraft-Hilfeartikel) bzw. das Xbox-Entwicklerprogramm. Falls das Formular nicht mehr erreichbar ist, dort nachsehen.

## 3. Client-ID im Quelltext eintragen (Forks)

Die Client-ID der Azure-App „Pumpkin Launcher“ (`5e27ee41-3be2-4c3a-a156-a3c61dbef8dc`, registriert am 30.09.2026, nur persönliche Konten, öffentliche Clientflows an) ist als `DEFAULT_CLIENT_ID` in `src-tauri/src/services/auth.rs` eingebaut; in den Einstellungen gibt es dafür kein Feld. Ein Fork registriert eine eigene Azure-App (Schritte 1 und 2) und ersetzt diese Konstante, danach neu bauen. Schon angemeldete Konten behalten die Client-ID, mit der sie angemeldet wurden (`clientId` in `accounts.json`), denn nur mit ihr lässt sich das Refresh-Token erneuern.

Die Client-ID ist kein Geheimnis; das Refresh-Token dagegen schon – es liegt nur im Schlüsselbund des Systems (Windows-Anmeldeinformationsverwaltung, macOS-Schlüsselbund bzw. Secret Service unter Linux; Dienst `dev.laux.launcher`, Benutzer = Minecraft-UUID), nie in `accounts.json`.

## Spielen ohne Konto (Offline-Spielername)

Ein offizieller Build (`pnpm tauri build`) startet Minecraft **nicht** mit einem bloßen Spielernamen. Das Backend (`auth::offline_allowed`, erzwungen in `instance_launch`) erlaubt es nur, wenn

- es ein **Debug-Build** ist (`pnpm tauri dev`, auch `pnpm tauri build --debug`), oder
- ein Microsoft-Konto angemeldet ist, dessen Besitz beim Login geprüft wurde (Eintrag im Schlüsselbund). Dann sind Spielernamen für LAN, Einzelspieler und Tests erlaubt.

Die Oberfläche blendet Spielername-Dialog und Onboarding-Namensfeld aus, sobald das Backend „nein“ sagt. Der Quelltext ist offen, die Sperre ist also eine Richtlinie des offiziellen Builds und kein Kopierschutz.

## 4. Danach testen

1. Pumpkin Launcher starten, Microsoft-Anmeldung wählen. Der Browser öffnet die Anmeldeseite (Rückfall „Stattdessen Code verwenden“: ein Code und `https://www.microsoft.com/link`).
2. Mit einem Konto anmelden, das **Minecraft: Java Edition** besitzt; der Browser zeigt danach eine Bestätigung, der Launcher übernimmt das Konto.
3. Erwartung: Konto erscheint in der Liste (`ms_accounts`), `%APPDATA%\dev.laux.launcher\accounts.json` enthält nur `id`, `username`, `kind`, `clientId`.
4. In der Windows-**Anmeldeinformationsverwaltung** → Windows-Anmeldeinformationen → Generische: Eintrag `dev.laux.launcher` vorhanden.
5. Eine Instanz mit diesem Konto starten: im Spiel Mehrspieler → ein Online-Server (z. B. ein bekannter öffentlicher Server) muss ohne „Invalid session“ beitreten lassen. Skin sollte sichtbar sein.
6. Nach 24 h (Minecraft-Token abgelaufen) erneut starten: Pumpkin Launcher erneuert die Sitzung still über das Refresh-Token.
7. Konto entfernen: Eintrag in `accounts.json` und in der Anmeldeinformationsverwaltung ist weg.

Mögliche Meldungen und was sie bedeuten:

| Meldung beginnt mit | Ursache |
|---|---|
| „Microsoft kennt diese Launcher-App nicht …“ | Client-ID (`DEFAULT_CLIENT_ID`) falsch, „Öffentliche Clientflows“ nicht auf Ja oder `http://localhost` nicht als Umleitungs-URI eingetragen |
| „Microsoft hat diesen Launcher noch nicht für Minecraft freigeschaltet“ | Freigabe (Schritt 2) fehlt noch |
| „Zu diesem Microsoft-Konto gibt es noch kein Xbox-Profil“ | XErr 2148916233 – einmal auf xbox.com anmelden |
| „Das Konto gehört einem Kind …“ | XErr 2148916238 – Konto zu einer Microsoft-Familie hinzufügen |
| „Dieses Microsoft-Konto besitzt Minecraft: Java Edition nicht“ | kein Kauf / kein Game Pass |
