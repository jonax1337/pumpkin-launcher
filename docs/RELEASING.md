# Release veröffentlichen

Ein Release entsteht aus einem Git-Tag `v<version>`. Der Workflow `.github/workflows/release.yml` baut daraus auf `windows-latest` den NSIS-Installer, signiert ihn für den Updater und legt einen **Entwurf** auf GitHub an. Erst wenn du den Entwurf veröffentlichst, bekommen Tester das Update.

## Einmalig: Signaturschlüssel und Secrets

Der Updater installiert nur Dateien, deren Signatur zum öffentlichen Schlüssel in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) passt. Der private Schlüssel liegt **nie** im Repo.

1. Schlüssel erzeugen (bereits geschehen; nur bei Verlust oder Neuanfang):
   ```bash
   pnpm tauri signer generate -w "$USERPROFILE/.tauri/pumpkin-launcher.key"
   ```
   Die `.pub`-Datei daneben ist der öffentliche Schlüssel für `tauri.conf.json`.
2. Im Repo unter **Settings → Secrets and variables → Actions** anlegen:
   - `TAURI_SIGNING_PRIVATE_KEY` – Inhalt der Datei `pumpkin-launcher.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` – das Passwort des Schlüssels. Ohne Passwort das Secret einfach nicht anlegen (GitHub erlaubt keine leeren Secrets).
3. Schlüssel zusätzlich sicher aufbewahren (Passwortmanager). **Geht er verloren, erreichen bestehende Installationen keine Updates mehr**: ein neuer Schlüssel passt nicht zu deren eingebautem öffentlichem Schlüssel, Tester müssten den Installer von Hand neu laden.

## Ablauf

1. **Version anheben** – an drei Stellen dieselbe Version, z. B. `0.2.0`:
   - `package.json` → `version`
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `[package] version`

   Danach `cargo check --manifest-path src-tauri/Cargo.toml`, damit `Cargo.lock` mitzieht, und alles committen.
2. **Annotierten Tag mit Versionshinweisen** anlegen und pushen. Die Tag-Nachricht (Markdown) wird Release-Text und erscheint im Launcher unter *Einstellungen › Über*:
   ```bash
   git tag -a v0.2.0 -F notes.md     # oder: -m "Kurzer Titel" -m "- Änderung 1"
   git push origin v0.2.0
   ```
3. **Workflow abwarten.** Er bricht mit klarer Meldung ab, wenn der Tag nicht zur Version in allen drei Dateien passt. Danach liegt ein Entwurf vor mit:
   - dem NSIS-Installer `…_<version>_x64-setup.exe` und seiner Updater-Signatur `.sig`
   - `latest.json` (Version, Versionshinweise, Download-Adresse und Signatur für den Updater)
4. **Entwurf prüfen und veröffentlichen.** Installer einmal ausprobieren, dann *Publish release*. Den Release-Text kannst du auf GitHub noch ändern; die Versionshinweise im Launcher stammen aber aus `latest.json` und bleiben beim Stand des Tags.

Ein fehlgeschlagener Lauf lässt sich über *Re-run jobs* wiederholen; die Dateien landen im selben Entwurf. Muss der Code noch geändert werden: Entwurf und Tag löschen, korrigieren, neu taggen.

## So funktioniert der Updater

- Der Launcher fragt `https://github.com/jonax1337/pumpkin-launcher/releases/latest/download/latest.json` ab. „latest“ ist immer das neueste **veröffentlichte** Release; Entwürfe und Pre-Releases sieht der Updater nicht.
- Im Release-Build sucht der Launcher kurz nach dem Start still nach einer neuen Version und meldet sie per Hinweis. Von Hand: *Einstellungen › Über › Nach Updates suchen*.
- Installiert wird nur nach Klick auf *Installieren und neu starten*: Download mit Fortschritt, Prüfung der Signatur, dann startet der NSIS-Installer im passiven Modus und den Launcher danach neu. Läuft gerade Minecraft oder ein Download, wartet der Launcher, bis beides fertig ist, sagt das an und startet erst nach einem weiteren Klick auf *Jetzt neu starten* neu, damit ein Absturzbericht nicht im Neustart untergeht.
- Ein zweiter Start des Launchers holt das laufende Fenster nach vorn (Single-Instance), statt einen zweiten Prozess auf dieselben Daten loszulassen.

## Lokal bauen

Weil `bundle.createUpdaterArtifacts` aktiv ist, braucht `pnpm tauri build` den privaten Schlüssel:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw "$env:USERPROFILE\.tauri\pumpkin-launcher.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
pnpm tauri build
```

Ohne Schlüssel (z. B. für Mitwirkende) die Updater-Dateien abschalten:

```bash
pnpm tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

## Windows SmartScreen

Der Installer ist nicht code-signiert. Beim ersten Download zeigt Windows deshalb „Der Computer wurde durch Windows geschützt“; Tester klicken auf **Weitere Informationen → Trotzdem ausführen**. Updates über den Launcher laufen ohne Browser-Download und zeigen diese Abfrage in der Regel nicht.

Die Warnung verschwindet erst mit einer Code-Signatur. Zwei Wege, die zu einem Open-Source-Projekt passen (beide noch nicht eingerichtet):

- **[SignPath Foundation](https://signpath.org/)** – kostenlos für Open-Source-Projekte mit OSI-Lizenz (Apache-2.0 passt). Bewerbung beim Projekt; signiert wird über deren GitHub-Integration aus diesem Workflow heraus, das Zertifikat lautet auf die SignPath Foundation. Die Updater-Signatur (`.sig`) muss danach über die code-signierte Datei neu erzeugt werden (`pnpm tauri signer sign`), und `latest.json` muss die neue Signatur enthalten.
- **[Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/)** – Microsofts Signierdienst im monatlichen Abo, mit Identitätsprüfung (für Einzelpersonen nicht in allen Ländern verfügbar, vorher prüfen). Lässt sich über `bundle.windows.signCommand` direkt in `tauri build` einhängen; dann signiert Tauri vor der Updater-Signatur und `latest.json` stimmt ohne Zusatzschritt.

Beide Varianten bauen Reputation bei SmartScreen erst mit der Zeit auf; die Warnung kann bei den ersten signierten Releases noch kurz erscheinen.
