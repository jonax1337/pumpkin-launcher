# Namensfindung und UX-Benchmark

Stand: 29.09.2026 · Research (Iris) · reine Recherche, kein Code geändert

Legende: **[V]** = verifiziert (Quelle verlinkt bzw. selbst per DNS/GitHub-API geprüft) · **[E]** = eigene Einschätzung, nicht belegt.

---

## A) Frühere Namensfindung

Die gewählte Marke ist **Pumpkin Launcher**. Die folgenden Alternativen sind historische Recherche; ihre Domain- und Kollisionsprüfungen gelten nicht für Pumpkin Launcher.

### Rahmen

- Mojangs Usage Guidelines zählen zu „Minecraft“ auch „any names which are confusingly similar“. Der Name darf in einem Produktnamen nicht „dominant element or the distinctive part“ sein. Tools dürfen nicht offiziell wirken. [V] <https://www.minecraft.net/en-us/usage-guidelines>
  → Keine Namen mit *Mine*, *Craft*, *Creeper* usw. Ein beschreibender Zusatz wie „ein Launcher für Minecraft“ in Tagline oder Store-Text ist zulässig.
- **Methodik der Kollisionsprüfung:**
  - Websuche nach App-, Spiel- und Marken-Treffern.
  - DNS-NS-Abfrage über 8.8.8.8: „reg“ heißt, die Domain hat Nameserver und ist damit registriert. Die Gegenprobe mit einer Unsinnsdomain ergibt NXDOMAIN, die Prüfung funktioniert also.
  - GitHub-API `users/<name>` zur Prüfung des Handles.
  - **Nicht geprüft:** Markenregister (DPMA, EUIPO, USPTO). „free?“ bei einer Domain heißt nur, dass keine NS-Einträge gefunden wurden. Das ist kein Beleg, dass die Domain registrierbar ist.
- Reine englische Wörter (Kiln, Cairn, Loam, Sprig, Hatch, Nook, Moss, Quarry, Cubby, Lumo …) sind **alle** als .com, .app und GitHub-Handle vergeben [V]. Deshalb setzt die Liste überwiegend auf Kunstwörter.

### 12 Vorschläge

| # | Name | Idee | .com | .app | .gg | .de | GitHub-Handle | Kollisionen (Websuche) | Risiko |
|---|------|------|------|------|-----|-----|---------------|------------------------|--------|
| 2 | **Mossle** | Moos: gemütlich, wächst, „grün“ | reg (keine Website erreichbar) | reg | free? | free? | `mossle` = Org mit 1 Repo (2015); `mosslelauncher` frei | nichts unter „Mossle“ gefunden, nur *Moss* (VR-Spiel von Polyarc) | **niedrig** |
| 3 | **Sprigly** | *sprig* = Zweig: frisch, leicht | free? | reg | free? | free? | **frei** (404) | *Sprigly* KI-Agenturdienst (UK), *Sprigly* Krypto-Round-up-App, *Sprig* (UX-Research-SaaS). Alles fremde Branchen | **niedrig–mittel** |
| 4 | **Tessra** | von *tessera* (Mosaikstein) | vergeben, **zum Verkauf** | reg | free? | free? | `tessra` = Org (2025, 2 Repos) | **Tessra**: iOS-Puzzlespiel (Fable Labs), gleiche Store-Kategorie | mittel |
| 5 | **Quarrly** | *quarry* = Steinbruch, Ort der Blöcke | reg | free? | free? | free? | **frei** | keine Treffer | niedrig, aber sperrige Schreibweise |
| 6 | **Brixel** | *brick* + *pixel* | reg | reg | free? | reg | `brixel` vergeben | mehrere Block-/Puzzle-Games (*Brixels*, *Brixel!*, *Brixel Escape*, Bau-Sandbox auf itch.io) | **hoch** |
| 7 | **Emberly** | Glut, Wärme | reg | reg | free? | reg | vergeben | 4+ Apps namens Emberly (Kinder-App, Skill-Tree-App, Community-App, „Emberly Executor“) | **hoch** |
| 8 | **Hearthly** | Herd, Zuhause | reg | reg | free? | reg | vergeben | 4 Apps (Putz-App, Familien-Chore-App, Care-Journal, hearthly.app); Nähe zu *Hearthstone* | **hoch** |
| 9 | **Packwerk** | Modpack + Werk (deutsch) | reg | reg | free? | reg | vergeben | **Shopify/packwerk**, bekanntes Ruby-Tool, dominiert die Suche | mittel (andere Klasse, aber keine SEO-Chance) |
| 10 | **Terrakit** | Terra + Kit | reg | free? | free? | free? | vergeben | kleine GitHub-Repos „TerraKit“ (Rust-Weltgenerierung). Klanglich nah an *Terraria* | mittel |
| 11 | **Kiln** | Brennofen: „hier wird dein Setup gebrannt“ | reg | reg | reg | – | vergeben | **Kiln**: Videospiel von Double Fine | **hoch** |
| 12 | **Cairn** | Steinmännchen, Wegmarke | reg | reg | reg | – | vergeben | **Cairn**: Spiel 2026 (The Game Bakers) inkl. „CAIRN Multiplayer Launcher“, Cairn-Linux-Launcher, Cairn-RPG-App | **sehr hoch** |

Quellen zu den Kollisionen [V]:
- Mossle/Moss: <https://en.wikipedia.org/wiki/Moss_(video_game)>
- Sprigly: <https://www.sprigly.co.uk/>, <https://www.sprigly.xyz/>, <https://sprig.com/>
- Tessra: <https://apps.apple.com/us/app/tessra/id6764005527>
- Brixel: <https://apps.apple.com/us/app/brixels/id6477423793>, <https://play.google.com/store/apps/details?id=com.MonarchInteractive.Brixel>, <https://neovisioninteractive.itch.io/brixel>
- Emberly: <https://apps.apple.com/us/app/emberly/id6475268238>, <https://apps.apple.com/us/app/emberly-activities-for-kids/id6749611273>
- Hearthly: <https://www.hearthlyapp.com/>, <https://usehearthly.com/>, <https://hearthly.app/>
- Packwerk: <https://github.com/Shopify/packwerk>
- Terrakit: <https://github.com/FlamingLily/TerraKit>
- Kiln: <https://en.wikipedia.org/wiki/Kiln_(video_game)>
- Cairn: <https://en.wikipedia.org/wiki/Cairn_(video_game)>, <https://cairnmultiplayer.com/>, <https://github.com/Cairn-Linux/cairn/issues/76>
- Cairnly (Ausweichform, ebenfalls belegt): <https://www.cairnly.app/>, <https://cairnly.ai/>

### Top 3

**2. Mossle**
- Das freundlichste Wort der Liste, passt zu einer ruhigen, einfachen UX.
- Die Moos-Metapher trägt auch ein Designsystem: Grüntöne, „wächst mit deinen Mods“.
- Keine Produkt-Kollision gefunden, .gg und .de ohne NS-Einträge.
- Risiko: die Aussprache schwankt leicht („Mossel“/„Mos-sle“). [E] Unkritisch, weil sie sich in beiden Sprachen gleich anhört.
- Tagline: **„Mods, die einfach wachsen.“** / EN: *„Grow your game.“*

**3. Sprigly**
- Frisch, leicht, als einziges Kunstwort mit freiem GitHub-Handle **und** freier .com (NS-seitig).
- Die bestehenden „Sprigly“-Nutzer sind UK-KI-Dienst und Krypto-App, also fremde Klassen.
- Risiko: „sprig“ kennen deutsche Nutzer kaum. Das ist neutral, erfordert aber keine Übersetzung.
- Tagline: **„Frisch installiert, sofort gespielt.“** / EN: *„Fresh packs, zero hassle.“*

Reserve: **Quarrly** (alles frei, aber Schreibweise), **Tessra** (nur, falls die iOS-Puzzle-App kein Problem ist).


---

## B) UX-Benchmark

### Überblick

| Launcher | Instanzen | Mod-Suche/-Install | Modpacks | Updates | Kompatibilität | Quellen |
|---|---|---|---|---|---|---|
| **Modrinth App** | Instanzen, Import aus anderen Launchern (u. a. GDLauncher, MultiMC); geteilte Optionen und Resourcepacks über Instanzen | Install, Update, Uninstall „with a single click“; Content-Tab als Tabelle mit Bulk-Aktionen, Filter, Sortierung | Modpack-Inhalt in eigener Karte, einzeln deaktivierbar; „Unlink“ oder „Reinstall“ zum Zurücksetzen | „Update all“-Modal: Version je Projekt wählen, Changelogs an einem Ort; läuft im Download-Manager, blockiert die UI nicht | Suche im Instanz-Kontext zeigt nur Versionen passend zu Loader und MC-Version; Abhängigkeiten „resolve multiple layers deep“; Kompatibilitätswarnung beim Pack-Versionswechsel | [1][2][3][4] |
| **Prism Launcher** | Viele Instanzen mit eigenen Einstellungen; Qt, sehr ressourcenschonend | Instanz → Tab „Version“: Loader wählen → Tab „Mods“ → „Download Mods“ → Quelle wählen (Modrinth/CurseForge) → Mods in Queue → OK | Automatische Installation und Updates; Updates vergleichen Datei-Hashes und laden nur Geändertes | Update-Dialog für Mods; Metadaten im Packwiz-Format (TOML) pro Mod | Nutzer muss selbst an Fabric API denken („mostly required“) | [5][6][7] |
| **NoRiskClient** | „Profiles“: sofortiger Wechsel zwischen MC-Versionen und Loadern, isolierte Einstellungen | Mods im Launcher suchen, aktivieren, konfigurieren, „no manual file dropping“; Modrinth und CurseForge | – (Fokus auf eigene Client-Mods und HUD) | – | – | [8][9] |
| **CurseForge App** | Profile | One-Click-Install, „verified creators“, Sicherheitsprüfungen | größter Pack-Katalog | „version control—without breaking your setup“ | – | Standalone (Electron) oder Overwolf-Variante; Werbung, Premium entfernt sie | [10][11] |
| **ATLauncher** | Instanzen pro Pack | Packs aus CurseForge, Modrinth und Technic | Pack-zentriert (142 kuratierte eigene Packs) | Instanzen „should show updates and allow reinstallation“ | Warnungen vor Malware und RCE-Exploits | [12] |
| **GDLauncher (Carbon)** | Gruppen, „Duplicate to experiment“, Import aus anderen Launchern | „Search both platforms at once“, One-Click, „Dependencies handled automatically“ | Auto-Update für Mods und Packs; Setup per Code teilen („recreates your exact setup“) | Auto-Update; parallele Downloads; automatische Java-Verwaltung | Loader Forge, Fabric, NeoForge, Quilt | [13][14] |

Carbon ist seit März 2024 released und 2026 aktiv gepflegt [14].

### Was die Modrinth App besonders einfach macht

1. **Der Kontext ist immer die Instanz.** Wer aus einer Instanz heraus sucht, bekommt nur Treffer, die zu deren Loader und MC-Version passen. Inkompatible Versionen sieht man gar nicht erst [2].
2. **Katalog und Launcher sind eins.** Die App ist „fully integrated with the website“ [1]. Es gibt keinen separaten Download-Dialog und keine Queue mit OK-Bestätigung wie bei Prism [5].
3. **Abhängigkeiten sind unsichtbar.** Sie werden mehrstufig automatisch aufgelöst [3]. Prism verlangt dagegen, dass der Nutzer selbst an Fabric API denkt [5].
4. **Pack-Inhalt und eigener Inhalt sind getrennt.** Der Nutzer kann Pack-Mods deaktivieren, das Pack per „Reinstall“ zurücksetzen oder per „Unlink“ lösen [3]. Das nimmt die Angst, „etwas kaputtzumachen“.
5. **Nichts blockiert.** Bulk-Updates laufen im Download-Manager, die Liste springt beim Installieren nicht, die Bulk-Leiste bleibt sticky [2][3].

### 10 UX-Muster zum Übernehmen

1. **Instanz-gebundene Suche mit Hart-Filter:** Loader und MC-Version der Instanz sind vorbelegt, inkompatible Versionen werden nicht angezeigt [2]. Globale Suche erst, nachdem ein Ziel gewählt ist.
2. **Install ohne Queue:** ein Klick installiert direkt, der Button wird zu „Installiert ✓“. Kein Sammel-Dialog mit OK [1] vs. [5].
3. **Automatische, mehrstufige Abhängigkeitsauflösung** mit dezenter Anzeige („+2 Abhängigkeiten“) statt Nutzerpflicht [3][13].
4. **„Alle aktualisieren“ als Review-Modal:** pro Mod Versionsauswahl und Changelog, dann Ausführung im Hintergrund-Download-Manager [2].
5. **Modpack-Inhalt als eigene, geschützte Sektion:** einzeln deaktivieren statt löschen, Aktionen „Auf Originalzustand zurücksetzen“ und „Vom Pack lösen“ [3].
6. **Versionswechsel mit Vorschau:** Changelog und Kompatibilitätswarnung **vor** dem Wechsel [3]. Beim MC-Versionswechsel einer Instanz die Mods gleich mitziehen. [E] Genau das war bei Modrinth lange ein offener Wunsch (Issue #912, geschlossen als Duplikat; ob inzwischen gebaut, ist ungeprüft) [15].
7. **Duplizieren zum Experimentieren und Gruppen** für Instanzen [13]. Passt direkt zu unseren Presets: Preset = Vorlage, Duplikat = Spielwiese.
8. **Geteilte Einstellungen über Instanzen** (Optionen, Resourcepacks) [1]. Das ist die Brücke zu unseren Profilen.
9. **Import aus anderen Launchern** (Modrinth, Prism/MultiMC, GDL, CurseForge) als Onboarding-Schritt [1][13]. Senkt die Wechselhürde massiv. [E]
10. **Startseite mit Quick-Launch:** „zuletzt gespielt“ plus großer Play-Button. NoRisk: „News, quick-launch, server status, all on one screen“ [8]. Dazu automatische Java-Verwaltung ohne Nutzerfrage [13].

### 5 Anti-Muster, die wir vermeiden

1. **Werbung, Overlays, Hintergrunddienste mit Adminrechten.** CurseForge/Overwolf: „mandatory installation of Overwolf, an app with admin rights that constantly runs in the background“, Beschwerden über „too many ads“ [11]. Selbst Modrinth zeigt Werbung, abschaltbar per Modrinth+ [16]. Daraus entstanden werbefreie Forks (AstralRinth, Migurinth) [16].
2. **Loader-Wahl als Vorbedingung in einem tiefen Tab.** Bei Prism muss man erst im Tab „Version“ einen Loader setzen, bevor Mods möglich sind [5]. Besser: den Loader beim Anlegen wählen oder automatisch ergänzen, wenn der erste Mod ihn braucht. [E]
3. **Nutzerpflicht für Abhängigkeiten** („make sure Fabric API is installed“) [5].
4. **Blockierende Bulk-Operationen:** früher bei Modrinth, man konnte den Content-Tab während Updates nicht verlassen [2]. Dazu springende Listen und Paginierung [3].
5. **Quellenwahl als erste Frage.** „Modrinth oder CurseForge?“ vor jeder Suche [5]. Besser: eine Suche mit vorausgewählter Quelle. GDL sucht beide Plattformen gleichzeitig [13]. Für unseren MVP heißt das schlicht Modrinth-only, ohne Umschalter. [E]

### Quellen

- [1] <https://modrinth.com/app>
- [2] <https://modrinth.com/news/changelog>
- [3] <https://modrinth.com/news/article/content-management-overhaul/> (17.03.2026)
- [4] <https://support.modrinth.com/en/articles/8827653-installing-updating-mod-loaders-and-game-versions>
- [5] <https://prismlauncher.org/wiki/getting-started/download-mods/>
- [6] <https://prismlauncher.org/>
- [7] <https://deepwiki.com/PrismLauncher/PrismLauncher/5.5-metadata-and-packwiz-system> (Sekundärquelle, aus dem Code generiert)
- [8] <https://norisk.gg/>
- [9] <https://github.com/NoRiskClient/noriskclient-launcher> (GPLv3: nur Muster übernehmen, keinen Code)
- [10] <https://www.curseforge.com/download/app>
- [11] <https://github.com/WesterosCraft/website/blob/develop/src/content/docs/curseforge-launcher-setup/index.mdoc>, <https://medium.com/overwolf/a-new-home-for-curseforge-44cbb3add844>
- [12] <https://atlauncher.com/>
- [13] <https://gdlauncher.com/>
- [14] <https://gdlauncher.com/blog/gdlauncher-carbon-out-now/>
- [15] <https://github.com/modrinth/code/issues/912>
- [16] <https://modrinth.com/news/article/design-refresh/>, <https://github.com/MiguVT/migurinth>, <https://alternativeto.net/software/astralrinth>

### Grenzen dieser Recherche

- Die Apps wurden **nicht** installiert und durchgeklickt. Alle Aussagen stützen sich auf Herstellerseiten, Changelogs, Wikis und Issues.
- Ein Hands-on-Test (je 15 Min.: Instanz anlegen, Mod suchen, Pack installieren, Update) würde vor allem die Punkte zu CurseForge und ATLauncher schärfen, deren Quellen Marketingtexte sind.
