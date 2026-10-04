# Pumpkin Friends: Checkliste für den Eigentümer

Alles, was nur du tun kannst, bevor Friends veröffentlicht wird, in der Reihenfolge, in der es sinnvoll ist.
Du musst dafür kein Netzwerk-Experte sein: Jeder Schritt sagt, was du tippst, was herauskommen soll und wo
das Ergebnis hineingehört. Die Ergebnisse trägst du in [`VERIFICATION.md`](VERIFICATION.md) ein; diese Seite
ist nur die Anleitung. Die Quelle der Regeln ist [`SPEC.md`](SPEC.md) (Abschnitt 1.3 für die Gates G1 bis G5,
13.3.2 und 13.4 für die Tests, Anhang C für die Compliance).

**Lesehilfe.** Jeder Schritt hat eine Kopfzeile:

- **Wer:** `Du` (nur du), `Du + 2. Person` (zweiter PC, zweites Konto) oder `Agent` (ein Claude-Agent kann es
  tun, wenn du die Eingabe lieferst).
- **Wann:** vor welchem Schritt.
- **Blockiert:** was ohne diesen Schritt nicht erscheinen darf. `Release` und `geschlossene Beta` sind die
  beiden Build-Arten aus SPEC 1.3. `kein Gate` heißt: nicht in SPEC 1.3 genannt, aber der Schritt steht
  trotzdem im Weg (Begründung steht dabei).

## Was du insgesamt brauchst

- Zwei Windows-PCs in **verschiedenen Netzwerken** (zum Beispiel Zuhause und Büro, oder ein PC im
  Handy-Hotspot). Beide mit Minecraft Java Edition.
- Zwei **verschiedene Microsoft-Konten**, die Minecraft Java besitzen, eines pro PC. Dasselbe Konto auf zwei
  PCs wird vom Spiel gekickt.
- Zugang zum zweiten PC (jemand sitzt davor, oder Fernzugriff).
- Für den Relay-Teil: ein Linux-Server in der EU, eine Domain und ein zweiter, davon unabhängiger Domainname.
- Für die Mod im Spiel (Schritt 9): dasselbe zweite Microsoft-Konto wie oben und ein Windows-PC mit Java-Instanzen der Lader Fabric, NeoForge und Forge. **Kein Modrinth-Konto und kein Modrinth-Projekt mehr nötig**; die Mod steckt im Launcher (`INGAME.md`). Admin-Rechte im GitHub-Repository brauchst du weiterhin für Releases.

## Reihenfolge auf einen Blick

| Schritt | Thema | Wer | Blockiert |
|---|---|---|---|
| 1 | Echter Microsoft-Login-Test | Du | G2 (muss zuerst) |
| 2 | Spike auf zwei PCs (G1) | Du + 2. Person | Release, geschlossene Beta |
| 3 | Test-Build, End-to-End-Tabelle E1 bis E13, Mod-Oberfläche (G2) | Du + 2. Person | Release, geschlossene Beta |
| 4 | ~~Modrinth-Projekt, `MOD_PROJECT_ID`, GitHub-Umgebung, erste Mod-Version~~ **überholt** (nur nötig, solange die von Hand installierte Mod ausgeliefert wird; entfällt mit der Mod im Launcher) | - | kein Gate |
| 5 | Eigenes Relay deployen, `RELAY_MAP` Index 0 (G3) | Du, dann Agent | Release |
| 6 | Mojang-Compliance (G4) | Du | Release, geschlossene Beta |
| 7 | Entscheidungen zur geschlossenen Beta, Release | Du | je nach Entscheidung |
| 8 | Namens-Suche: Verzeichnis, Zertifikat-Login, Tests O-1 bis O-8 | Du (+ 2. Person) | Release 2.0.1 (die Namens-Suche), kein Gate aus SPEC 1.3 |
| 9 | Mod im Spiel (vom Launcher eingebaut): Test pro Release auf Windows | Du + 2. Person | Release, das die Mod im Spiel enthält (Gate M3, kein Gate aus SPEC 1.3) |

Das Relay (Schritt 5) hat die längste Vorlaufzeit (Domain, DNS, Zertifikat). Du kannst es parallel zu Schritt 2 und 3
anstoßen, weil Schritt 2 und 3 mit den öffentlichen n0-Relays laufen.

---

## 1. Echter Microsoft-Login-Test

**Wer:** Du. **Wann:** zuerst, vor allem anderen (SPEC 1.3, G2). **Blockiert:** G2, also Release und
geschlossene Beta.

Die Mojang-Freigabe für die Azure-App ist erteilt, ein echter Login wurde aber noch nicht getestet. Ohne
Login gibt es kein Friends: Hosten und Beitreten brauchen ein Microsoft-Konto.

Die Schritte stehen in [`../ACCOUNT-SETUP.md`](../ACCOUNT-SETUP.md), Abschnitt 4 „Danach testen“. Kurzfassung:

- [ ] Launcher starten, Microsoft-Anmeldung wählen, im Browser mit einem Konto anmelden, das Minecraft Java besitzt.
- [ ] Das Konto erscheint in der Liste. `%APPDATA%\dev.laux.launcher\accounts.json` enthält nur `id`, `username`, `kind`, `clientId`.
- [ ] Windows-Anmeldeinformationsverwaltung → Generische Anmeldeinformationen: Eintrag `dev.laux.launcher` vorhanden.
- [ ] Eine Instanz mit diesem Konto starten und einem öffentlichen Online-Server beitreten: kein „Invalid session“.
- [ ] Meldet der Launcher „Microsoft hat diesen Launcher noch nicht für Minecraft freigeschaltet“ (403), ist die Freigabe doch nicht wirksam: Stopp, erst das klären.

Das Datum trägst du in [`VERIFICATION.md`](VERIFICATION.md) unter G2 ein („Microsoft-Login getestet am“).

---

## 2. Spike auf zwei PCs (Gate G1)

**Wer:** Du + 2. Person. **Wann:** nach Schritt 1, vor Schritt 3. **Blockiert:** G1, also Release und geschlossene Beta.

Frage, die der Spike beantwortet: Können sich zwei PCs in verschiedenen Netzwerken erreichen, so wie der
Launcher es später tut (direkt, sonst über ein Relay)? Das Programm `p2p-spike` fasst weder den Launcher noch
deine Minecraft-Dateien an. Die ausführliche Anleitung mit Fehlertabelle ist
[`tools/p2p-spike/README.md`](../../tools/p2p-spike/README.md); hier steht der Ablauf.

### 2.1. Bauen (einmal, auf deinem Entwickler-PC)

```powershell
cd tools\p2p-spike
cargo build --release
```

Ergebnis: `tools\p2p-spike\target\release\p2p-spike.exe`. Kopiere diese eine Datei auf **beide** PCs, zum Beispiel
nach `C:\spike`. Eine Installation ist nicht nötig.

- [ ] `p2p-spike.exe` gebaut und auf beide PCs kopiert.

### 2.2. Ein Netzwerk-Paar messen

Auf beiden PCs: den Ordner `C:\spike` im Explorer öffnen, in die Adressleiste `powershell` tippen, Enter.
Wenn Windows die Datei blockiert: Rechtsklick → Eigenschaften → „Zulassen“ → OK.

**PC A** (wartet):

```powershell
.\p2p-spike.exe listen
```

Die Windows-Firewall fragt beim ersten Mal. Setze bei **Privat und Öffentlich** den Haken und wähle „Zugriff
zulassen“. PC A druckt eine Zeile `Your id: …` und darunter den Befehl für PC B.

**PC B** (wählt): genau die gedruckte Zeile einfügen, sie sieht so aus:

```powershell
.\p2p-spike.exe dial <id-aus-PC-A> --echo 1000 --throughput 50
```

Nach etwa einer Minute steht ein Block `=== RESULT ===` da. Was die Zahlen bedeuten:

| Zeile | Heißt | Gut ist |
|---|---|---|
| `path` | `direct` = PC zu PC, `relay` = über den Relay-Server | `direct`, aber `relay` ist auch in Ordnung |
| `connect time` | Zeit bis die Verbindung stand | unter 2000 ms |
| `direct after` | Zeit bis zum Wechsel vom Relay auf direkt. `never` = blieb 15 s auf dem Relay, `skipped` = du hast `--relay-only` benutzt | eine Zahl; `never` ist hinter strengen Routern normal |
| `echo p50 / p99` | Antwortzeit einer winzigen Nachricht: typisch (p50) und schlechtestes Prozent (p99). Minecraft fühlt sich unter etwa 100 ms gut an | p99 unter 150 ms |
| `throughput` | wie schnell 50 MiB von B nach A gingen | über 1 MiB/s |

Erscheint `WARNING: no relay reachable`, erreicht dieser PC das Relay nicht (gesperrtes Netz, Captive Portal).
Notiere das und probiere ein anderes Netz.

### 2.3. Relay-only-Lauf

Auf PC B denselben Befehl mit `--relay-only` (erzwingt den Relay-Weg):

```powershell
.\p2p-spike.exe dial <id-aus-PC-A> --relay-only --echo 1000 --throughput 50
```

### 2.4. Minecraft-LAN-Welt durch den Tunnel

Beide PCs mit **derselben** Minecraft-Version.

1. PC A: Einzelspielerwelt öffnen, **Esc → Für LAN öffnen → LAN-Welt starten**. Im Chat steht der Port (hier `54321`).
2. PC A: `listen` mit Strg+C beenden und neu starten:
   ```powershell
   .\p2p-spike.exe listen --forward 127.0.0.1:54321
   ```
3. PC B:
   ```powershell
   .\p2p-spike.exe dial <id-aus-PC-A> --local 127.0.0.1:25599
   ```
4. PC B: Minecraft → Mehrspieler → Direkt verbinden → `127.0.0.1:25599`.
5. Erwartung: PC B steht in der Welt von PC A, beide sehen sich, eine Minute herumlaufen. Dann Strg+C auf beiden.

### 2.5. Welche Netzwerk-Paare (Pflicht für G1)

Mindestens diese drei Zeilen, jeweils 2.2 bis 2.4:

| Paar | Aufbau |
|---|---|
| (a) | Zwei verschiedene Heimanschlüsse, oder Zuhause + Büro |
| (b) | PC A zuhause, PC B im **Handy-Hotspot** (LAN-Kabel von PC B abziehen). Mobilfunk nutzt meist CGNAT, der schwere Fall |
| (c) | Irgendein Paar aus (a) oder (b), gewählt mit `--relay-only` (2.3) |

### 2.6. Wohin mit den Zahlen

Pro Lauf eine Zeile in [`VERIFICATION.md`](VERIFICATION.md), Abschnitt **G1** (Spalten und was in welche gehört,
steht in `tools/p2p-spike/README.md`, Abschnitt 7). Am Ende „G1 met“ abhaken.

- [ ] Paar (a) eingetragen
- [ ] Paar (b) eingetragen
- [ ] Paar (c) eingetragen (`--relay-only`)
- [ ] Bei jeder Zeile steht „LAN join“ mit `yes` oder `no` plus Meldung

**Sicherheit nach dem Test:** Solange `listen --forward` läuft, erreicht jeder, der die id kennt, die LAN-Welt.
Mit Strg+C beenden und `spike-key.txt` löschen (neue id). Ohne `--relay` laufen die Tests über die öffentlichen
Relays von n0; die sehen beide IP-Adressen, aber nur verschlüsselte Daten.

**Wenn die Zahlen schlecht sind** (zum Beispiel `direct after: never` in jedem Paar): Das ist keine Fehlfunktion,
dann läuft der Verkehr über das Relay, und das Relay wird zum Kostenfaktor
([`RELAY-OPS.md`](RELAY-OPS.md), Abschnitt 4). Entscheide danach, ob Friends so verträglich ist. SPEC OD-5 sagt:
Ohne diese Zahlen kein Release.

---

## 3. Test-Build, End-to-End-Tabelle, Mod-Oberfläche (Gate G2)

**Wer:** Du + 2. Person. **Wann:** nach Schritt 1 und 2. **Blockiert:** G2, also Release und geschlossene Beta.

### 3.1. Test-Build auf beide PCs bringen

Dein eigenes Relay steht noch nicht (Schritt 5), und ein Release-Build hat ohne Relay eine leere `RELAY_MAP`
(`src-tauri/src/services/p2p/relays.rs`). Für die Tests brauchst du deshalb einen Build mit den n0-Relays:

```powershell
pnpm tauri build --features beta-relays --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Der Installer liegt danach unter `src-tauri\target\release\bundle\nsis\`. `--config` schaltet die
Updater-Dateien ab, damit du den Signaturschlüssel nicht brauchst (siehe [`../RELEASING.md`](../RELEASING.md),
„Lokal bauen“). Installiere **denselben Build** auf beiden PCs. Beim Einschalten von Friends muss auf beiden
die Zustimmung zu den Drittanbieter-Relays (n0) angehakt werden.

Alternative ohne Installer: `pnpm tauri dev` (ein Debug-Build hat ebenfalls die n0-Relays). Für die
Fernsteuerung des zweiten PCs ist `pnpm tauri:remote` gedacht.

- [ ] Beide PCs haben denselben Test-Build, Friends ist eingeschaltet, beide Konten sind angemeldet.

### 3.2. Die Tabelle E1 bis E13

Die Fälle stehen mit Pass-Kriterium in SPEC 13.4. Du trägst `pass` oder `fail`, Datum und gemessene Zeiten oder
genaue Meldungen in [`VERIFICATION.md`](VERIFICATION.md), Abschnitt **G2**, ein. Für G2 muss jede Zeile
`pass` sein. Wenn ein Fixture-Mod keine 26.3-Version hat, nimm einen anderen Modrinth-Mod mit derselben
Seiten-Einordnung und notiere das.

- [ ] **E1 Code-Austausch, Einladender offline.** Der Einladende ist beim Einlösen mindestens 5 Minuten offline und startet danach seinen Launcher. Sobald er online ist, drückt der Eingeladene „Jetzt zustellen“. *Erwartet:* Die eingehende Anfrage steht beim Einladenden innerhalb von 30 s nach dem Druck. Nach dem Annehmen zeigen beide Seiten den Freund innerhalb von 30 s.
- [ ] **E2 Präsenz.** *Erwartet:* online innerhalb von 10 s nach dem Start; offline innerhalb von 3 s nach normalem Beenden, innerhalb von 45 s, wenn du den Prozess killst.
- [ ] **E3 Vanilla-26.3-Host, Gast tritt über den Launcher bei (direkter Weg).** *Erwartet:* Gast ist in der Welt, Weg „Direkt“, RTT wird angezeigt.
- [ ] **E4 Wie E3, aber „Immer über Relay verbinden“ beim Gast an.** *Erwartet:* Weg „Relay“. Auf dem Host zeigt `netstat -an | findstr <IP-des-Gastes>` keine Verbindung von der Gast-IP.
- [ ] **E5 Fabric-26.3-Host mit `fabric-api, lithium, ferrite-core, sodium (client-only), modmenu (client-only)`; Gast-Instanz ohne sodium und modmenu.** *Erwartet:* Plan `ready`, Beitritt klappt.
- [ ] **E6 Dem Gast fehlt `lithium`.** *Erwartet:* Plan `missingContent`, fehlend = Lithium.
- [ ] **E7 Vanilla-Host, Gast hat die Instanz nicht.** „Vanilla-Instanz anlegen“, dann Beitritt. *Erwartet:* Beitritt klappt.
- [ ] **E8a Offline-Konto beim Gast.** *Erwartet:* Der Beitritt wird in der Oberfläche vor dem Start abgelehnt.
- [ ] **E8b Offline-Konto am Vanilla-Host.** Der Host teilt eine Vanilla-26.3-Welt. Ein Minecraft-26.3-Client mit **Offline-Konto** wählt „Direkt verbinden“ auf den geprüften LAN-Port des Hosts (von einem zweiten Gerät im Host-Netz auf `<LAN-IP-des-Hosts>:<Port>`, oder am Host-PC auf `127.0.0.1:<Port>`). *Erwartet:* Die Anmeldung scheitert, der Spieler kommt nie in die Welt. Notiere die genaue Meldung (erwartet „Failed to verify username!“ oder clientseitig „Invalid session“). Dieser Wert gehört auch in Schritt 6.
- [ ] **E9 Jede Zeile aus SPEC 6.5, die zwei PCs braucht** (Ereignisse wie dort angegeben). Spiele nacheinander durch und notiere pro Zeile `pass` oder `fail`: Host beendet das Teilen · Host wirft Gast raus · Gast lehnt die Einladung ab · Host verlässt die Welt zum Titelbildschirm · Host-Spiel beendet · Host-Launcher normal beendet · Host-Launcher abgestürzt (Prozess killen, Gast bekommt `hostOffline` nach etwa 70 s) · Gast verlässt · Gast-Spiel beendet · Gast-Launcher beendet · Gast-Start scheitert vor dem Spawn · Host schaltet Friends aus · Gast schaltet Friends aus · Host ändert „Immer über Relay“ oder rotiert/setzt die Identität zurück.
- [ ] **E10 Mod:** Teilen aus dem Pausenmenü mit Bestätigung im Launcher, Toasts, Rauswurf, Beenden. Dazu die ganze Mod-Checkliste in 3.3. *Erwartet:* alle zehn Punkte bestanden.
- [ ] **E11 Host verlässt die Welt zum Titelbildschirm.** *Erwartet:* Die Sitzung endet mit `lanClosed` innerhalb von 2 s (Log) oder 30 s (Lebenszeichen).
- [ ] **E12 Windows-Firewall-Abfrage beim ersten Einschalten.** Teste beide Antworten. *Erwartet:* Verhalten notiert; beide Antworten verbinden trotzdem (im Schlimmsten Fall über das Relay).
- [ ] **E13 Kinderkonto mit gesperrtem Mehrspieler** (nur, wenn du eines hast). *Erwartet:* Eine klare Vanilla-Meldung ist notiert. Gehört zu Schritt 6.

### 3.3. Mod-Oberfläche (E10, SPEC 13.3.2)

> **Gilt für die heutige, von Hand installierte Mod (nur Fabric 26.3).** Sobald der Launcher die Mod selbst einbaut,
> ersetzt Schritt 9 diese Liste (`INGAME.md`, Abschnitt 10, Ebene 5); die Punkte hier sind dann erledigt oder entfallen.

Kein Agent hat die Mod im Spiel gesehen; gebaut und mit JUnit geprüft ist sie. Die Liste steht auch in
[`mod/README.md`](../../mod/README.md), Abschnitt „Owner GUI checklist“. Erst gegen den Fake-Launcher, dann gegen
den echten Launcher.

Vorbereitung gegen den Fake-Launcher (zwei PowerShell-Fenster, jeweils im Ordner `mod`):

```powershell
# Fenster 1
.\scripts\dev-env.ps1
java scripts\FakeLauncher.java
# Fenster 2: dev-env laufen lassen, die vom Fake-Launcher gedruckte Umgebungszeile einfügen, dann
.\scripts\dev-env.ps1
.\gradlew.bat runClient
```

Der Fake-Launcher druckt `PUMPKIN_IPC_PORT`, `PUMPKIN_IPC_TOKEN` und `PUMPKIN_IPC_PROTOCOL` als fertige Zeile; der
Token ist bei jedem Start neu. Befehle im Fenster 1: `allow`, `deny`, `invite`, `online`, `offline`, `error <code>`,
`quit`. Den echten Launcher nimmst du, indem du das Spiel aus ihm startest.

- [ ] 1. Ohne Umgebungsvariablen: kein Button, kein Absturz, eine Logzeile.
- [ ] 2. Der Button erscheint nur, solange die Verbindung steht.
- [ ] 3. Veröffentlichen aus der Mod: Der Launcher zeigt den geprüften Port (Quelle `mod`).
- [ ] 4. Veröffentlichen über die Vanilla-Weltoptionen: dasselbe.
- [ ] 5. Erste Einladung aus der Mod: „Bestätige im Launcher“; nach dem Erlauben bekommt der Freund einen Toast mit Kopf.
- [ ] 6. Rauswurf und Beenden: Der Freund wird getrennt und bekommt einen Toast.
- [ ] 7. Launcher mitten in der Sitzung beenden: Die Oberfläche verschwindet, das Spiel läuft ohne Ausnahmen weiter.
- [ ] 8. Fenstergröße ändern bei offenem Pausenmenü: kein doppelter Button.
- [ ] 9. Deutsch und Englisch.
- [ ] 10. Ein Name mit `§c` und Bidi-Zeichen wird ohne Formatierung angezeigt.

Danach in `VERIFICATION.md`: „G2 met“ abhaken.

---

## 4. Modrinth-Projekt und Mod-Veröffentlichung (überholt)

> **Überholt durch `INGAME.md` (Abschnitte 3.2, 8 und 14, Entscheidung 4).** Die Mod wird im Launcher mitgebaut und
> vom Launcher selbst ins Spiel gelegt. Es gibt kein Modrinth-Projekt, keinen Token, keine Umgebung `modrinth-release`
> und keinen Workflow `mod-release.yml` mehr; dieser Schritt entfällt, sobald der Einbau ausgeliefert wird. Nichts davon
> musst du jetzt anlegen. Die Schritte unten gelten nur, falls die von Hand installierte Mod vorher noch veröffentlicht
> werden soll (heutiger Stand der Dokumente und des Codes); sonst überspringen.

**Wer:** Du (Schritte 4.1 bis 4.4 und 4.6), Agent (4.5). **Wann:** nach dem Merge von `feat/friends` nach `main`
(der Workflow läuft nur von `main`). **Blockiert:** kein Gate. Ohne Projekt-ID meldet der Launcher die Mod als
nicht verfügbar (`ModState::Unavailable`), und die Jar müsste von Hand in den `mods/`-Ordner. E10 geht mit der
Entwicklungs-Jar `mod\build\libs\pumpkin_friends-0.1.0.jar` von Hand, also darfst du Schritt 3 vor Schritt 4 machen.

- [ ] **4.1. Modrinth-Konto absichern.** Zwei-Faktor-Anmeldung einschalten.
- [ ] **4.2. Projekt anlegen.** Auf modrinth.com ein neues Projekt „Pumpkin Friends“: Fabric, Spielversion 26.3, Seite „nur Client“. Die Beschreibung enthält den Satz „NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.“ (steht auch in `mod/src/client/resources/fabric.mod.json`). Das Projekt muss öffentlich freigegeben sein, weil der Launcher die Versionen ohne Anmeldung abfragt; die Modrinth-Prüfung kann dauern.
- [ ] **4.3. Projekt-ID kopieren.** Die ID hat 8 Zeichen und steht in den Projekteinstellungen.
- [ ] **4.4. Token und GitHub-Umgebung.**
  - Modrinth: persönliches Zugriffstoken mit dem Recht „Create versions“ erzeugen (Einstellungen → Personal access tokens).
  - GitHub: Repository → Settings → Environments → neue Umgebung **`modrinth-release`**. Required reviewers: du. Bei einem Ein-Personen-Repository darf „Prevent self-review“ nicht an sein, sonst kannst du dich nicht selbst freigeben. Deployment-Branches auf `main` beschränken.
  - In dieser Umgebung das Secret **`MODRINTH_TOKEN`** mit dem Token anlegen (Environment secret, nicht Repository secret).
- [ ] **4.5. ID an zwei Stellen eintragen, im selben Commit** (Agent, mit deiner ID): `MOD_PROJECT_ID: ""` in `.github/workflows/mod-release.yml` und `pub const MOD_PROJECT_ID: &str = "";` in `src-tauri/src/services/friends/modinstall.rs`. Der Workflow bricht ab, wenn die beiden Werte voneinander abweichen oder nicht 8 Zeichen haben.
- [ ] **4.6. Erste Version veröffentlichen.** GitHub → Actions → „Mod release“ → Run workflow auf `main`, Kanal `release` (der Launcher installiert nur `release`), Changelog ausfüllen. Der Job `build` baut und testet die Jar ohne Zugriff auf das Token, der Job `publish` wartet auf deine Freigabe und lädt hoch. Läuft er in „Version … already exists“, hebe `version=` in `mod/gradle.properties` an (aktuell `0.1.0`).
- [ ] **4.7. Prüfen.** In einer Fabric-26.3-Instanz installiert der Launcher die Mod über „Mod installieren“, und `ModState` ist nicht mehr `Unavailable`.

---

## 5. Eigenes Relay (Gate G3)

**Wer:** Du (Domain, Server, Betrieb), Agent (Eintrag in `RELAY_MAP`). **Wann:** früh anstoßen, spätestens vor dem
Release. **Blockiert:** G3, also Release (die geschlossene Beta darf mit den n0-Relays laufen, siehe Schritt 7).

Was das Relay ist: ein Server, der verschlüsselte Verbindungen weiterleitet, wenn zwei Launcher sich nicht direkt
erreichen, und der ihnen ihre öffentliche Adresse nennt. Er sieht nie Inhalte. Alles Technische steht in
[`RELAY-OPS.md`](RELAY-OPS.md), die Dateien liegen in [`infra/relay/`](../../infra/relay/). **Noch ist nichts
deployt und keine Domain registriert.**

Kurzfassung der Schritte (Abschnitt 7 in `RELAY-OPS.md`):

- [ ] **5.1. Domains.** Hauptdomain `<relay-domain>` und eine **Ausweichdomain** bei einem anderen Registrar mit anderer Endung. Auto-Renew und Registrar-Lock an, DNSSEC falls angeboten.
- [ ] **5.2. DNS.** `relay-eu1.<relay-domain>` als `A`-Record auf den Server, TTL 300 s in der ersten Woche.
- [ ] **5.3. Server.** Linux in der EU mit Docker und Compose-Plugin, mit Auftragsverarbeitungsvertrag (AVV). Firewall: **80/tcp, 443/tcp, 7842/udp** und SSH nur von deinen Adressen. Firewall-Protokollierung **aus** (`ufw logging off`), kein fail2ban auf diesen Ports.
- [ ] **5.4. Konfigurieren.** `infra/relay/` auf den Server kopieren. In `relay.toml` `<relay-domain>` und `<ops-mailbox>` ersetzen.
- [ ] **5.5. Starten.** `docker compose build`, dann beim ersten Mal mit Log: `docker compose -f docker-compose.yml -f docker-compose.debug.yml up -d` und `docker compose logs`. Läuft es, auf den Dauerbetrieb ohne Log umstellen: `docker compose up -d --force-recreate`.
- [ ] **5.6. Abnahme (G3).** Von irgendeinem Rechner: `curl -i https://relay-eu1.<relay-domain>/generate_204` liefert `204`. Dann mit dem Spike auf beiden PCs eines G1-Paares:
  ```powershell
  .\p2p-spike.exe listen --relay https://relay-eu1.<relay-domain>/
  .\p2p-spike.exe dial <id> --relay https://relay-eu1.<relay-domain>/ --echo 1000
  ```
  Erwartet: `Relay connected after … ms` und `Public address seen by the relay: <ip:port>`, wobei die Adresse deiner öffentlichen IP entspricht (prüfe sie auf einer „Wie ist meine IP“-Seite). Das beweist die Adresserkennung auf UDP 7842. Zeigt der Spike `none reported`, ist der UDP-Port nicht offen. Mit `--relay-only` und `--throughput 50` noch einmal wiederholen.
- [ ] **5.7. Eintragen.** Zeilen in `VERIFICATION.md` (G1-Tabelle mit diesem Relay, G3-Abschnitt).
- [ ] **5.8. `RELAY_MAP` Index 0** (Agent, mit deiner Domain): In `src-tauri/src/services/p2p/relays.rs` ein Eintrag `RelayEntry { index: 0, url: Cow::Borrowed("https://relay-eu1.<relay-domain>/"), operator: RelayOperator::Pumpkin, quic_port: Some(7842) }` in **beiden** Varianten von `RELAY_MAP` (Release-Karte und Variante mit `beta-relays`/Debug). Indizes bleiben für immer; Einträge werden nur angehängt.
- [ ] **5.9. Datenschutz-Platzhalter in [`PRIVACY.md`](PRIVACY.md) füllen:** Betreiber (Name, Anschrift, E-Mail), Hoster, Postfächer `privacy@<relay-domain>` und `abuse@<relay-domain>` (das Abuse-Postfach muss existieren und beobachtet werden), Rechtsgrundlage bestätigen, Protokollierung beim Hoster klären.
- [ ] **5.10. Betrieb.** Externe Überwachung von `https://relay-eu1.<relay-domain>/healthz`, Sicherung des Volumes `relay-data` einmal nach der ersten Ausstellung des Zertifikats, Abrechnungsalarm beim Hoster. Updates immer gemeinsam mit der iroh-Version des Launchers (Abschnitt 9 in `RELAY-OPS.md`).

---

## 6. Mojang-Compliance (Gate G4)

**Wer:** Du. **Wann:** nach Schritt 3 (E8a, E8b und E13 liefern Belege), spätestens vor jedem Build für Nicht-Entwickler.
**Blockiert:** G4, also Release und geschlossene Beta.

Die Liste steht in SPEC Anhang C und in [`PRIVACY.md`](PRIVACY.md), Abschnitt 8, mit der Stelle, an der jeder
Punkt erfüllt wird. Hake sie in `VERIFICATION.md` ab.

- [ ] Die Über-Seite des Launchers und die Mod-Beschreibung tragen „NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.“ Die Mod hat den Satz schon (`mod/src/client/resources/fabric.mod.json`), die Über-Seite (`src/pages/settings/AboutTab.tsx`) **noch nicht**. Das ist eine Code-Änderung (Agent, I1); du prüfst das Ergebnis.
- [ ] Kein Minecraft-Logo und kein Mojang-Branding in der Friends-Oberfläche oder der Mod; der Name „Pumpkin Friends“ klingt nicht offiziell.
- [ ] Kostenlos, keine Vorteile gegen Geld, keine Spieldateien zwischen Spielern. Jeder Client lädt nur von Mojang und Modrinth.
- [ ] Nur Online-Modus: Offline-Konten werden vor dem Start abgelehnt (E8a) und vom Host-Spiel beim Anmelden abgewiesen (E8b, Meldung notiert).
- [ ] Verhalten von Kinderkonten notiert (E13), die Funktion umgeht keine Mehrspieler-Sperren von Xbox oder Mojang.
- [ ] Die Usage Guidelines von Mojang zum Release-Zeitpunkt noch einmal gelesen, Datum in `VERIFICATION.md` notiert.
- [ ] **Du hast bestätigt, dass die Freigabe von Microsoft/Mojang für die Azure-App auch das Weitergeben von Spielernamen und UUIDs zwischen Nutzern abdeckt** (siehe [`../ACCOUNT-SETUP.md`](../ACCOUNT-SETUP.md)). Das kann nur jemand mit Zugang zur Freigabe entscheiden; im Zweifel bei Mojang nachfragen.
- [ ] Die Modrinth-API wird mit dem Launcher-User-Agent und innerhalb der Limits benutzt (nur noch für die Einordnung „nur Client“ und Titel beim Abgleich; ein Mod-Download von dort entfällt mit Schritt 9).

---

## 7. Geschlossene Beta und Release: deine Entscheidungen

**Wer:** Du. **Wann:** nach Schritt 3 und 6. **Blockiert:** je nach Entscheidung.

Eine geschlossene Beta mit den öffentlichen n0-Relays braucht G1, G2, G4 und G5 sowie die ausdrückliche
Zustimmung der Nutzer zu den n0-Relays (SPEC 1.3, 3.2). **G3 braucht sie nicht**, sie ist das Tor für ein
Release. Ein Release für alle braucht G1 bis G5.

- [ ] **7.1 Beta ja oder nein?** Wenn ja: Die Feature-Flag `beta-relays` (`src-tauri/Cargo.toml`) nimmt die vier n0-Relays in die Karte (200 bis 203). Ohne sie ist die Release-Karte leer, und Friends kann nicht verbinden.
- [ ] **7.2 Wie wird der Beta-Build gebaut?** Der Workflow `.github/workflows/release.yml` übergibt keine Cargo-Features (`args: ""`). Entweder baust du die Beta lokal mit dem Befehl aus 3.1 (mit Signaturschlüssel für den Updater, siehe `RELEASING.md`), oder ein Agent ergänzt dem Workflow einen Schalter. Entscheide, was du willst. Ein normaler `v*`-Tag ohne Schalter erzeugt eine leere Release-Karte.
- [ ] **7.3 n0-Angaben prüfen.** Anschrift, Aufbewahrungsfristen und Standort der n0-Server wurden nicht geprüft. Lies die aktuellen Bedingungen und die Datenschutzerklärung von n0, bevor ein Beta-Build rausgeht, und trage den Betreiber in [`PRIVACY.md`](PRIVACY.md), Abschnitt 4, ein.
- [ ] **7.4 Texte freigeben.** Opt-in-Text und Datenschutzhinweis (SPEC 13.5, Punkt 4; Entwürfe in `PRIVACY.md`, Abschnitt 7) hast du gelesen und freigegeben. Der ehrliche Kern muss drinstehen: Bei einer direkten Verbindung sehen sich Freunde gegenseitig die IP, außer „Immer über Relay verbinden“ ist an; Relays sehen Metadaten, nie Inhalte.
- [ ] **7.5 CI grün (G5).** `ci.yml` läuft auf `main`, einschließlich des Jobs `mod`.
- [ ] **7.6 Binärgröße.** Der Agent misst die Größe des Release-Builds mit den echten Endpunkten neu (SPEC 3.1, I1).
- [ ] **7.7 Release.** Ablauf wie in [`../RELEASING.md`](../RELEASING.md): Version an drei Stellen anheben, annotierten Tag `v…` pushen, Entwurf prüfen, veröffentlichen. Vorher in `VERIFICATION.md` alle Gates G1 bis G5 abhaken.
- [ ] **7.8 Doc-Sync.** Für SPEC-Abschnitte 3 bis 9, 11 und Anhang A bestätigt jeweils der zuständige Agent „stimmt mit dem Code überein“ (SPEC 13.5, Punkt 5), Abweichungen stehen zuerst in `SPEC.md`.

## 8. Namens-Suche: Verzeichnis und Zertifikat-Login (Release 2.0.1)

**Wer:** Du (O-4 mit 2. Person und zweitem Konto). **Wann:** in der Reihenfolge unten: erst der Worker, dann der Dev-Build-Test O-3, dann Tag und Release, danach O-4 bis O-8. **Blockiert:** nichts aus SPEC 1.3; ohne diese Schritte bleibt die Suche per Namen kaputt („Verzeichnis nicht erreichbar“).

Warum es das gibt: Mojang beantwortet jede Anfrage von Cloudflare Workers mit 403. Der Worker kann Mojang deshalb nie selbst fragen, und die Namens-Suche aus 2.0.0 konnte sich nie anmelden. Seit 2.0.1 holt der Launcher bei Mojang ein signiertes Spielerzertifikat (`api.minecraftservices.com/player/certificates`), und der Worker prüft Mojangs Signatur offline mit fest eingebauten Schlüsseln. Der Entwurf steht in [`BYNAME-ATTEST.md`](BYNAME-ATTEST.md) (mit den bindenden Änderungen aus [`BYNAME-ATTEST-REVIEW.md`](BYNAME-ATTEST-REVIEW.md)), die Ergebnisse trägst du in [`VERIFICATION.md`](VERIFICATION.md), Abschnitt **N**, ein. Alle Befehle laufen in PowerShell im Repository-Wurzelordner; `wrangler` fragt nach der Anmeldung bei Cloudflare (`npx wrangler login`), falls nötig.

### 8.1. Vorher entscheiden und bestätigen

- [ ] **OD-N11: Restrisiko annehmen.** Der Worker setzt Mojangs Mehrspieler-Sperren nicht mehr selbst durch (früher scheiterte `join` für gesperrte Konten schon beim Anmelden). Jetzt prüft nur noch der Launcher `/player/attributes`; ein veränderter Launcher könnte das überspringen und dann auffindbar sein, Anfragen empfangen und senden. Eine Freundschaft kommt trotzdem nicht zustande, weil Mojang das `join` beim Annehmen ablehnt. Entscheide, ob du das annimmst, und notiere es in `VERIFICATION.md` (Abschnitt N). Der Vorschlag ist „annehmen“, aber **das ist nicht entschieden, bis du es notierst**.
- [ ] **OD-N3: Freigabe für das Zertifikat.** Ob der Launcher `/player/certificates` und `/player/attributes` nutzen darf, ist gegen Mojangs Bedingungen **nicht geprüft**. Frage bei Mojang nach oder lies die Bedingungen, und hake den Punkt in `PRIVACY.md`, Abschnitt 8, ab.
- [ ] **Datenschutztexte lesen.** `PRIVACY.md`, Abschnitt 9, und `website/datenschutz.html`, Abschnitt 4 („Suche per Minecraft-Namen“): stimmen Verantwortlicher, Cloudflare als Auftragsverarbeiter (Auftragsverarbeitungsvertrag angenommen?) und die Löschfrist von 7 Tagen (Cloudflare-Tarif Free) mit der Wirklichkeit überein?

### 8.2. Die Tests

Die Zeilen heißen wie in `BYNAME-ATTEST.md` 8.3. **Reihenfolge: O-1, O-2, O-3, dann Tag und Release (Schritt 8.3), dann O-4 bis O-8.**

- [ ] **O-1. Worker-Tests und Schlüsselabgleich.**
  ```powershell
  cd directory
  node test.mjs
  node scripts/mojang-keys.mjs check
  ```
  *Erwartet:* alle Zeilen `ok`, dann `ok: 2 keys match`. Bei einem Unterschied (Exit-Code 1) stehen die Schlüssel von Mojang und die eingebauten untereinander: Ablauf siehe 8.4.
- [ ] **O-2. Datenbank und Worker bereitstellen (Reihenfolge ist Pflicht).**
  ```powershell
  cd directory
  npx wrangler d1 execute pumpkin-friends-directory --remote --command "SELECT (SELECT COUNT(*) FROM users),(SELECT COUNT(*) FROM letters)"
  ```
  *Erwartet:* `0, 0` (kein 2.0.0-Login hat je geklappt). Steht dort etwas anderes: **anhalten und nachsehen**, nicht weitermachen. Dann:
  ```powershell
  npx wrangler d1 migrations apply pumpkin-friends-directory --remote
  npx wrangler deploy
  curl.exe -s -X POST https://pumpkin-friends-directory.jonas-laux.workers.dev/v1/auth/session -H "content-type: application/json" -d "{}"
  ```
  *Erwartet:* Migration `0002_letters_without_name` angewendet, **dann erst** das Deployment (der neue Code schreibt `from_name` nicht mehr, die Spalte ist bis `0002` `NOT NULL`), und `curl.exe` druckt `{"error":"gone"}`.
- [ ] **O-3. Echter Login mit einem Dev-Build, vor dem Tag.**
  ```powershell
  $env:PUMPKIN_FRIENDS_DIRECTORY="https://pumpkin-friends-directory.jonas-laux.workers.dev"; npm run tauri:remote
  ```
  (oder `pnpm tauri dev` in demselben Fenster). Mit dem echten Microsoft-Konto anmelden, Freunde einschalten, Einstellungen › Freunde › „Per Minecraft-Namen auffindbar“ an. Danach:
  ```powershell
  cd directory
  npx wrangler d1 execute pumpkin-friends-directory --remote --command "SELECT uuid FROM users"
  ```
  *Erwartet:* Statuszeile „Auffindbar als <Name>“ innerhalb von 30 s, und die Abfrage zeigt genau deine UUID (ohne Bindestriche). Das beweist die echte Kodierung des privaten Schlüssels, Mojangs Schlüssel Nr. 0 und das Layout der Mojang-Signatur. **Scheitert es:** die Logzeile des Launchers notieren (nur Codes, keine Geheimnisse) und das Release anhalten (Rückfall F1 in `BYNAME-ATTEST.md`, Abschnitt „Fallback“).
- [ ] **O-4. Zwei PCs, zwei Konten, Build 2.0.1.** A sendet B per Namen, während B's Launcher geschlossen ist; danach startet B.
  *Erwartet:* Die Anfrage zeigt „Minecraft: <aktueller Name von A>“ innerhalb von 30 s nach dem Öffnen von Freunde; nach dem Annehmen sind beide innerhalb von 30 s Freunde.
- [ ] **O-5. Laufendes Spiel.** Eine Instanz ab 1.20 starten, einem Online-Server beitreten, eine Chat-Nachricht senden. Den Launcher neu starten, während das Spiel weiterläuft (das erzwingt beim nächsten Login ein neues Zertifikat), warten bis „Auffindbar“, noch eine Nachricht senden und 2 Minuten bleiben.
  *Erwartet:* Chat funktioniert, kein Rauswurf wegen ungültiger Chat-Signatur („chat validation error“). Notiere das Ergebnis: es entscheidet, ob ein Zertifikatsabruf ein laufendes Spiel stört.
- [ ] **O-6. Cloudflare-Dashboard.** Workers › pumpkin-friends-directory › Metrics nach O-3 und O-4.
  *Erwartet:* CPU-Zeit p99 unter 10 ms, Subrequests 0.
- [ ] **O-7. Kinder- oder Mehrspieler-gesperrtes Konto** (nur, wenn du eines hast).
  *Erwartet:* „Mojang erlaubt diesem Konto keine Mehrspieler-Funktionen“ (`notAllowed`), Codes funktionieren weiter. Notiere, was Mojang auf `/player/attributes` und `/player/certificates` für dieses Konto antwortet (Statuscode, ob `multiplayerServer.enabled` auf `false` steht); bis dahin gilt eine nicht lesbare Antwort als „nicht erlaubt“ für das Auffindbarsein.
- [ ] **O-8. Der Workflow „Mojang keys“.** GitHub › Actions › „Mojang keys“ › **Run workflow**, und prüfe, dass der Workflow **aktiviert** ist (kein „This scheduled workflow is disabled“-Hinweis).
  *Erwartet:* grün. GitHub schaltet geplante Workflows eines öffentlichen Repositorys nach 60 Tagen ohne Aktivität ab; der Job `keepalive` im Workflow schaltet ihn bei jedem Lauf wieder ein. Schau deshalb ab und zu (zum Beispiel beim Release) nach, dass er aktiviert und grün ist.

### 8.3. Tag und Release (nach O-3)

- [ ] Ablauf wie in [`../RELEASING.md`](../RELEASING.md) und `BYNAME-ATTEST.md` Abschnitt 10: Version 2.0.1, annotierter Tag `v2.0.1`, die drei Build-Jobs in der Umgebung `release` freigeben, Entwurf prüfen, veröffentlichen. Der Updater bringt 2.0.1 zu den 2.0.0-Nutzern. Danach O-4 bis O-8.

### 8.4. Wenn „Mojang keys“ fehlschlägt

Ein fehlgeschlagener geplanter Lauf schickt dir eine E-Mail. Dann hat Mojang seine Schlüsselliste geändert, und jede Anmeldung scheitert mit `badCertificate`, bis der Worker die neuen Schlüssel kennt (nur die Namens-Suche ist betroffen). Ohne neues Launcher-Release:

```powershell
cd directory
node scripts/mojang-keys.mjs update
node test.mjs
```

dann Pull Request, Merge, und `npx wrangler deploy`. Dass Mojang einen neuen Schlüssel vor der ersten Nutzung veröffentlicht, ist **nicht belegt**; ein Ausfall kann also vor der E-Mail beginnen. Anzeichen in Fehlermeldungen von Nutzern: die Logzeile „The directory does not accept Mojang's player certificate“.

### 8.5. Offene Tatsachen, die erst dieser Test klärt

Nichts davon kann ein Agent klären; alles steht bis dahin als „nicht belegt“ in den Dokumenten. Trage die Ergebnisse in `VERIFICATION.md`, Abschnitt N, ein.

- [ ] **Lebensdauer des Zertifikats.** Gerechnet wird mit etwa 48 Stunden (nicht belegt). Der Launcher zeigt sie nicht an; sie steht als `expiresAt` in Mojangs Antwort, und `refreshedAfter` liegt etwa 40 Stunden nach der Ausstellung. Beobachte nach O-3 und O-4, dass die Anmeldung über mehr als zwei Tage Laufzeit hinweg funktioniert.
- [ ] **Eingeschränkte Konten** (Kinder, Mehrspieler aus, gesperrt): welche Konten bei `/player/certificates` 401 oder 403 und bei `/player/attributes` was bekommen (O-7).
- [ ] **Wirkung eines Zertifikatsabrufs auf ein laufendes Spiel** (Chat-Schlüssel; O-5).
- [ ] **Echte Kodierung des privaten Schlüssels** (PKCS#8 oder PKCS#1; beides wird akzeptiert) und Mojangs Schlüssel Nr. 0 (O-3).
- [ ] **Mojangs Bedingungen** erlauben den Abruf von `/player/certificates` durch einen Drittanbieter-Launcher (OD-N3, 8.1).
- [ ] **Keine Zeilen aus 2.0.0 in D1** (O-2, die Abfrage mit `0, 0`).

## 9. Mod im Spiel (vom Launcher eingebaut)

**Wer:** Du (Tiefenlauf mit 2. Person und zweitem Konto). **Wann:** vor jedem Release, das die Mod im Spiel enthält,
auf **Windows**; die Ergebnisse kommen in [`VERIFICATION.md`](VERIFICATION.md), Abschnitt **M3**. **Blockiert:** dieses
Release (Gate M3). Das ist die Ebene 5 aus `INGAME.md` Abschnitt 10; die Ebenen 1 bis 4 (Java, Rust, Zusammenspiel,
Rauchtest pro Knoten) läuft die CI.

**Stand: Launcher-Seite gebaut und eingespeist (Stand `feat/ingame-mod`, 2026-10-04).** Fünf Zellen haben einen
grünen Rauchtest (`INGAME-SMOKE.md`, Einträge in `mod/verified.json`): `26.3-fabric`, `1.21.1-fabric`,
`1.21.1-neoforge`, `26.2-neoforge`, `1.20.1-forge`; `1.21.8-fabric` und `1.21.11-fabric` warten auf Paket V1a.
Was noch fehlt, sind die Bildschirme (Paket U2) und der visuelle Nachweis im echten Spiel — daher ist dein
**nächster Schritt der visuelle Durchlauf (9.0)**; die vollständige Release-Prüfung (9.1 bis 9.8) folgt, sobald ein
Release-Kandidat mit Mod existiert. Die Mod installierst du nie und veröffentlichst du nirgends: Es gibt kein
Modrinth-Projekt (Schritt 4 entfällt), keinen Token und keine Freigabe-Umgebung. Du brauchst nur:

- einen Windows-PC mit dem Release-Kandidaten des Launchers (ein Build, der die Mod enthält),
- **zwei Microsoft-Konten** mit Minecraft Java (eines pro Instanz, wie in G2) für „Teilen“ und „Beitreten“,
- je eine Instanz pro Lader (Fabric, NeoForge, Forge) in einer Minecraft-Version, die in der Knotentabelle steht
  (`VERIFICATION.md`, M3.1). Mindestens eine mit **Pfad mit Umlaut im Benutzernamen**, falls du so ein Konto hast (B6).

Nur Zellen, deren Rauchtest in der CI grün war, gehören ins Release; unverifizierte Zellen sind aus und werden nicht
von Hand freigeschaltet.

- [ ] **9.0. Visueller Durchlauf im Spiel (dein nächster Schritt, sobald Paket U2 gemergt ist).** Entwicklungs-Build des
  Launchers bauen (`pnpm mod:build` nicht vergessen, sonst ist der Index leer), dann eine `26.3-fabric`-Instanz mit
  Microsoft-Konto starten (Freunde an). *Erwartet:* Der Hub öffnet sich über den Knopf „Pumpkin Friends“ im
  Pausenmenü; im Instanzordner liegt keine neue Datei in `mods/`; die Instanzseite zeigt „Freunde-Menü im Spiel:
  aktiv“. Danach die Demo-Bildschirme von U2 über ihre Start-Properties (`hubdemo`, `sharedemo`) öffnen und prüfen:
  Tabs, Listen, Bildlauf, Fokus, deutsche und englische Texte, Fenstergröße ändern ohne Duplikat-Knopf. Zum Schluss
  eine echte Freundesanfrage mit einem zweiten Konto aus dem Hub heraus beantworten (inkl. Rückfrage im Launcher).
  Was auffällt, notiere in `VERIFICATION.md`, M3 („Owner pass“), Zeile 26.3-fabric; dieser Durchlauf ersetzt den
  Kurzlauf 9.2 für diese Zelle noch nicht.
- [ ] **9.1. Tiefenlauf pro Lader** (einmal pro Release, je ein Knoten von Fabric, NeoForge, Forge): Instanz mit Konto A
  starten (Freunde an). *Erwartet:* Im Pausenmenü steht „Pumpkin Friends“, im Instanzordner liegt **keine** neue Datei
  in `mods/`, die Instanzseite zeigt „Freunde-Menü im Spiel: aktiv“. Im Hub: eine Anfrage annehmen, danach eine Welt
  für Freunde öffnen, Konto B einladen und aus Konto B beitreten (Konto B nutzt die Spiel-Funktion „Beitreten“ im
  Hub oder den Launcher). Beim ersten „Teilen“ und beim ersten Annehmen fragt der Launcher je einmal nach
  („Ablehnen“ ist vorausgewählt). Tabelle „Deep run“ in M3.1 ausfüllen.
- [ ] **9.2. Kurzlauf für jeden anderen Knoten** (3 Schritte, pro Release): Spiel startet, der Hub öffnet sich, eine
  Anfrage wird beantwortet. Zeile in M3.1 ausfüllen.
- [ ] **9.3. Nichts vor dem Einschalten.** Friends **aus**: Instanz starten. *Erwartet:* kein Button im Pausenmenü, keine
  Mod im Spiel, kein offener Port des Launchers für Friends. Dann ein Spiel mit **Offline-Konto** und eine
  Vanilla-Instanz starten: ebenfalls keine Mod, die Instanzseite sagt warum („Nur mit Microsoft-Konto“, „Braucht einen
  Loader“).
- [ ] **9.4. Fremde Mods.** Eine zweite Datei `pumpkin_friends` in `mods/` legen: *Erwartet:* Das Spiel startet, es wird
  nichts eingebaut, die Instanzseite sagt „Im Ordner mods liegt schon eine pumpkin_friends-Datei“.
- [ ] **9.5. Absicherungen.** Aktionen aus dem Spiel erst nach der Frage im Launcher (Zeitsperre von 1 s sichtbar);
  „Aktionen im Spiel: Erlauben“ fragt nicht mehr; ein Java-Wrapper-Skript führt zu „Verbindung nicht zuordenbar“, das
  Spiel startet trotzdem; eine absichtlich kaputte Mod-Jar führt zum Dialog „Ohne Freunde-Menü starten“ und der nächste
  Start läuft ohne Mod (Zeilen unter „Further checks“ in M3.2).
- [ ] **9.6. Mechanismen, die nur ein Versuch klärt** (`INGAME.md`, Anhang B): trage die Ergebnisse von B1 bis B10 in
  M3.2 ein, soweit sie auf Windows entschieden werden (besonders B6: Pfad mit Umlaut, Datei während des Starts gesperrt).
  Die Spikes S1 und S2 liefern den Rest; ein Agent darf nur eintragen, was er belegen kann.
- [ ] **9.7. Entscheidungen.** Prüfe die Liste in `INGAME.md`, Abschnitt 14 (neun Entscheidungen, alle überstimmbar), und
  sage Bescheid, wenn du eine umdrehen willst. Insbesondere Nummer 8 („Immer fragen“ als Standard für Aktionen im Spiel).
- [ ] **9.8. Datenschutztext.** Der Satz zur Mod im Opt-in-Dialog ([`PRIVACY.md`](PRIVACY.md), Abschnitt 10.4) und die
  Abschnitte 10.2 und 10.3 (andere Mods im selben Spiel, `profilekeys/`) sind von dir gelesen und freigegeben, bevor der
  Einbau ausgeliefert wird.

Danach in `VERIFICATION.md`: „M3 met“ abhaken.

## Abschluss

Wenn G1 bis G5 in [`VERIFICATION.md`](VERIFICATION.md) abgehakt sind, ist Friends freigabereif (ein Release, das die Mod im Spiel enthält, braucht zusätzlich M3). Bis dahin nennt das
README von Friends den Stand ehrlich: nicht als stabil erklärt, solange die Tests im echten Netz fehlen.
