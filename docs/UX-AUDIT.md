# UX- und UI-Audit – Laux Launcher

Stand: 29.09.2026 · Basis: Commit `326dc36` · Autor: Nils (Frontend)

**Vorgehen:** Ich habe den kompletten UI-Code gelesen (`src/app`, `src/pages`, `src/components`, `src/hooks`, `src/store`, `src/lib`) und die relevanten Backend-Modelle (`src-tauri/src/models.rs`, `commands.rs`, `content_commands.rs`). Die Oberfläche lief im Vite-Dev-Server im Browser (Mock-Daten, Fenster 1100×700 = Tauri-Standard, zusätzlich 900×600 = Tauri-Minimum). Ein Screenshot stammt aus der laufenden Tauri-App (1920 px breit).
Screenshots liegen in `docs/ux-audit/` und werden unten als **[S01]**… zitiert.

**Grenze:** Der Modrinth-Katalog funktioniert im Browser-Modus nicht (`api.isMock`), siehe [S10]. Den Katalog mit echten Daten habe ich nur im Code nachvollzogen, nicht per Screenshot. In der laufenden App von Jonas habe ich bewusst nichts angeklickt.

| Nr. | Datei | Inhalt |
|---|---|---|
| S01 | `01-start-ohne-account.png` | Start, kein Konto, zuletzt gespielte Instanz nicht installiert |
| S02 | `02-instanzen.png` | Instanzliste |
| S03 | `03-instanz-uebersicht.png` | Instanz › Übersicht |
| S04 | `04-instanz-mods.png` | Instanz › Mods |
| S05 | `05-instanz-konsole.png` | Instanz › Konsole |
| S06 | `06-instanz-einstellungen.png` | Instanz › Einstellungen |
| S07 | `07-preset-anwenden-dialog.png` | Dialog „Preset anwenden“ |
| S08 | `08-instanz-forge.png` | Forge-Instanz („Forge folgt“) |
| S09 | `09-neue-instanz-dialog.png` | Dialog „Neue Instanz“ |
| S10 | `10-mods-katalog.png` | Mods-Katalog (Browser-Modus) |
| S11 | `11-modpacks.png` | Modpacks-Katalog + lokaler Import |
| S12 | `12-presets.png` | Presets |
| S13 | `13-neues-preset-dialog.png` | Dialog „Neues Preset“ |
| S14 | `14-einstellungen.png` | Einstellungen |
| S15 | `15-konto.png` | Konto |
| S16 | `16-instanz-vanilla.png` | Vanilla-Instanz |
| S17 | `17-installation-laeuft.png` | Installationsfortschritt |
| S18 | `18-spielen-ohne-account.png` | Spielen ohne Konto → Fehler-Toast |
| S19–S21 | `19/20/21-*-900px.png` | Start, Instanz und Mods bei Mindestgröße 900×600 |
| S22 | `22-tauri-app-breitbild.jpg` | Echte App bei 1920 px Breite |

---

## 1. Kurzfazit

Die Optik ist handwerklich solide (dunkles Theme, konsistente shadcn-Primitives, saubere Fokus-Ringe). Das Produkt wirkt trotzdem nicht „nice“, und das hat vor allem einen strukturellen Grund: **Die Navigation bildet die Datenstruktur ab, nicht die Aufgaben der Nutzer.** Mods, Modpacks und Presets sind eigene Hauptbereiche und stehen damit gleichrangig neben den Instanzen. Dabei ergeben alle drei nur *im Kontext einer Instanz* Sinn. Die Folge: Man wählt dieselbe Instanz mehrfach aus, springt zwischen Seiten hin und her, pflegt Versionen und Loader von Hand, und es gibt keine Rückführung zum Spielen.

Der zweite Grund ist der Mix aus Fertigem und Halbfertigem. Presets arbeiten im echten Build mit einer fest eingebauten Mock-Mod-Liste, Spieleinstellungen werden gespeichert, aber nie angewendet, die News sind Mock-Daten, Microsoft-Login und Forge/Quilt/NeoForge stehen als „folgt“ in der UI. Das untergräbt das Vertrauen und macht die Oberfläche voller, ohne dass sie mehr kann.

**Zielbild in einem Satz:** *Eine Bibliothek aus Instanzen. Jede Instanz ist der einzige Ort, an dem Inhalte hinzugefügt, verwaltet und gespielt werden. Der Katalog ist ein Werkzeug dieser Instanz und kein eigener Bereich.*

---

## 2. Nutzerreisen

Klicks zähle ich ohne Tippen und ohne Scrollen, „Select“ = 2 Klicks (öffnen + wählen). Grundlage ist der Code-Pfad, ergänzt um die Screenshots.

### 2.1 Erster Start und Login
| Schritt | Klick |
|---|---|
| App startet auf „Start“, Hero „Noch keine Instanz“ bzw. Mock [S01] | – |
| Hinweis auf fehlendes Konto nur klein unten in der Seitenleiste („Kein Konto · Account anlegen“) | – |
| Konto öffnen, Namen tippen, „Anlegen“ | 2 |

**Summe: 2 Klicks, aber nicht auffindbar.** Reibung:
- Es gibt kein Onboarding. Der Nutzer merkt das fehlende Konto erst beim Klick auf „Spielen“, und zwar über einen Toast ohne Link [S18] (`src/hooks/useInstances.ts:115`).
- „Konto“ erscheint in der Seitenleiste **zweimal**: als Navigationspunkt und als Account-Karte (`src/app/Layout.tsx:27,104`).
- „Offline-Account“ ist ein technischer Begriff; der Nutzer will nur „Spielername“.
- Der Microsoft-Login ist als deaktivierte Karte sichtbar („folgt“) [S15]. Das ist Rauschen.

### 2.2 Instanz anlegen und installieren
| Schritt | Klick |
|---|---|
| Instanzen | 1 |
| „Neue Instanz“ | 1 |
| Name tippen (Pflicht, kein Vorschlag) | – |
| Version (optional), Loader (Select), Loader-Version (Select), RAM-Slider | 0–6 |
| „Anlegen“ → Detailseite | 1 |
| „Installieren“, warten | 1 |
| „Spielen“ | 1 |

**Summe: 5 (Vanilla, Standardwerte) bis 11 Klicks (Fabric mit fester Loader-Version).** Reibung:
- **Anlegen und Installieren sind getrennt.** Nach „Anlegen“ steht die Instanz auf „Nicht installiert“, und der Nutzer muss den nächsten Schritt selbst finden (`src/pages/Instances.tsx:64`, `src/components/game.tsx:148`).
- Der Dialog zeigt Expertenfelder gleichrangig mit den Basics [S09]: Loader-Version, RAM, Release/Snapshot-Tabs. Nicht verfügbare Loader stehen im Select mit „folgt“.
- Der Name ist Pflicht und hat keinen Default wie „Fabric 1.21.11“.
- Die Beschreibung „Versionen kommen direkt von Mojang. Forge, NeoForge und Quilt folgen.“ ist Entwicklersicht.

### 2.3 Mods finden (Modrinth)
| Schritt | Klick |
|---|---|
| Mods | 1 |
| Suchbegriff tippen, „Suchen“ (bei leerer Suche erscheint zunächst nichts) | 1 |
| Optional MC-Version **tippen** und Loader filtern | 2 |
| „Details und Versionen“ | 1 |
| **Scrollen:** Das Detailpanel erscheint *unter* der gesamten Ergebnisliste | – |

**Summe: 3–5 Klicks + Scrollen.** Reibung (`src/components/ContentCatalog.tsx`):
- Keine Icons, obwohl `icon_url` geliefert wird (`:69–73`). Ergebnisse sind reine Textkacheln, das wirkt wie ein Formular und nicht wie ein Store.
- Das Detailpanel liegt unterhalb der Liste (`:75`), und nach dem Klick passiert oben sichtbar nichts.
- Filter sind freie Texteingaben („Minecraft, z. B. 1.21.1“) und werden nicht aus einer Instanz vorbelegt.
- Kein Paging: „erste 20 angezeigt. Suche eingrenzen für weitere Treffer.“ (`:67`)
- Keine Suche beim Tippen, kein Initialzustand („Beliebt“ o. Ä.). Die Seite ist leer, bis man sucht [S10].
- Der Projekttext wird als roher Markdown-Text angezeigt („Projektbeschreibung (Originaltext)“, `:78`).
- Die Rohwerte `client_side`/`server_side` erscheinen als „Client: required · Server: optional“.

### 2.4 Mods installieren
| Schritt | Klick |
|---|---|
| (aus 2.3) Version-Select mit Einträgen wie „Sodium 0.6.13 · 0.6.13 · fabric, quilt · MC 1.21, 1.21.1, …“ | 2 |
| Zielinstanz-Select (Nicht-Fabric-Instanzen ausgegraut) | 2 |
| „Mod + Dependencies installieren“ | 1 |
| Erfolgszeile „Inhalte für X gespeichert. Falls noch nicht installiert: dort zuerst die Spieldateien installieren.“ → Link | 1 |
| Tab „Mods“ | 1 |

**Summe: ~10–12 Klicks von „Mods“ bis zur sichtbaren Mod in der Instanz.** Das ist die zentrale Schwachstelle:
- **Rückwärtslogik:** Erst Mod, dann Version, dann Instanz. Richtig wäre: Instanz (Kontext) → Mod → passende Version automatisch.
- Die Version muss der Nutzer von Hand zur Instanz passend wählen. Dabei wäre die richtige Version eindeutig bestimmbar (Loader + MC-Version der Instanz, neueste Release-Version). `modCompatibility` (`src/lib/modrinth.ts:20`) *prüft* das erst hinterher, statt es *auszuwählen*.
- Kein Zustand „schon installiert“ im Katalog. Man kann nicht sehen, was eine Instanz bereits hat.
- Fortschritt als Rohtext „resolve: 0 / 1“ bzw. „download: 3 / 7“ (`ContentCatalog.tsx:99`, Phasennamen aus `content_commands.rs:95,103`).
- Die Gründe, warum der Button deaktiviert ist, stehen als grauer Fließtext darüber (`:44–50, :88`). Es sind 8 mögliche Texte, z. B. „Projektdetails müssen zum Inhaltstyp passen.“ Das ist Entwicklersprache.
- Aus der Instanz heraus gibt es keinen Weg in den Katalog mit Kontext. Der Leerzustand verlinkt auf `/mods` (`InstanceDetail.tsx:129`), dort muss die Instanz erneut gewählt werden.

### 2.5 Mods aktivieren, deaktivieren, aktualisieren, entfernen
| Aktion | Klicks | Bemerkung |
|---|---|---|
| Aktivieren/Deaktivieren | 3 (Instanzen → Instanz → Tab Mods) + 1 | ok, aber jeder Toggle speichert sofort die ganze Instanz, und alle Schalter sind währenddessen gesperrt (`InstanceDetail.tsx:149`) |
| Entfernen | +1 | **ohne Bestätigung und ohne Rückgängig** (`:158–167`) |
| Aktualisieren | – | **nicht möglich**, weder einzeln noch „alle aktualisieren“ |
| Mod-Details, Abhängigkeiten sehen | – | nicht vorhanden; Dependencies erscheinen als normale Mods ohne Kennzeichnung |

Weitere Reibung [S04]: keine Icons, keine Suche oder Filter in der Liste, Dateiname (`sodium-0.6.13.jar`) als Untertitel, das Badge „Modrinth“ wiederholt sich in jeder Zeile, und es gibt keine Warnung zu inkompatiblen oder fehlenden Abhängigkeiten.

### 2.6 Modpacks und Presets
**Modpack aus Modrinth:** Modpacks (1) → Suchen (1) → Details (1) → Version-Select (2) → „Neue Instanz aus Pack erstellen“ (1) → Link (1) → Installieren (1) → Spielen (1) = **9 Klicks**. Danach gilt „Falls noch nicht installiert: dort zuerst die Spieldateien installieren“: Der zweite Installationsschritt ist also wieder manuell.

**Lokales .mrpack:** absoluten Pfad **von Hand eintippen**, weil es keinen Dateidialog und kein Drag & Drop gibt (`ContentCatalog.tsx:93`) [S11].

**Presets:** Presets (1) → Neues Preset (1) → 7 Felder → Anlegen (1); dann anwenden: Instanzen (1) → Instanz (1) → Preset anwenden (1) → wählen (1) = **7 Klicks**. Kritisch:
- Die Mod-Auswahl im Preset ist **die hart kodierte `MOCK_MODS`-Liste**, auch in der echten App (`src/pages/Presets.tsx:23,69,124`) [S13]. Diese „Mods“ haben erfundene Modrinth-IDs (`projectId: "sodium"`, `versionId: "0.6.13"`, `src/lib/mock.ts:19`).
- `gameSettings` wird gespeichert, aber **nirgends angewendet**: Das Backend schreibt keine `options.txt` (grep nach `options.txt`/`game_settings` findet nur `models.rs`).
- „Erbt von“ und `excludeMods` sind Vererbungskonzepte, die ein Spieler nicht braucht.
- Anwenden ist eine Einbahnstraße: Mods werden hinzugefügt, JVM-Args **ersetzt**, ein Rückgängig gibt es nicht (`models.rs:112`). `presetId` ist danach nur noch ein Etikett ohne Wirkung.
- Presets kann man nicht bearbeiten (nur anlegen und löschen), obwohl `useUpdatePreset` existiert.

### 2.7 Spiel starten
- **Best Case (installiert, Konto da): 1 Klick** auf Start [S01]. Das ist gut.
- **Realistisch beim ersten Mal:** Spielen → Fehler-Toast Konto [S18] → Konto (1) → anlegen (1) → zurück (1) → Spielen (1). Bei neuer Instanz zusätzlich „Installieren“ **und** „Spielen“.
- Der Hero auf „Start“ zeigt „Zuletzt gespielt“ auch für eine nie gespielte oder nicht installierte Instanz [S01].
- Bei Start im Detail wird auf den Konsolen-Tab gewechselt (gut). Auf „Start“ fehlt eine Rückmeldung, dass das Spiel läuft, außer dem Badge.

### 2.8 Fehlerfall
| Fehler | Rückmeldung heute | Problem |
|---|---|---|
| Kein Konto | Toast „Lege zuerst unter Konto einen Offline-Account an“ | keine Aktion oder Link im Toast |
| Spiel crasht | Toast „Spiel mit Code X beendet – Details in der Konsole“ (`useInstances.ts:150`) | kein Button zur Konsole; die Konsole gibt es nur im Detail-Tab |
| Installation schlägt fehl | globaler Toast mit Backend-Rohtext; der Fortschrittsbalken verschwindet | kein „Erneut versuchen“ an der Stelle, kein Log |
| Query-Fehler (z. B. Instanzen laden) | **doppelt:** globaler Toast (`main.tsx:24`) **und** Inline-`ErrorNote` | doppelte Meldung |
| Katalog-Fehler | ungestylter Text + „Erneut versuchen“ | stilistisch aus der Reihe |
| Mod-Installation schlägt fehl | Text „Ursache beheben und die gewünschte Installation erneut auslösen.“ | ohne konkreten nächsten Schritt |
| Konsole | nur die letzten 2000 Zeilen, kein Kopieren, kein „Logordner öffnen“ | für Support unbrauchbar |

---

## 3. Mods im Detail: Datenmodell vs. UI

### 3.1 Ist-Zustand

```
Instance ─┬─ minecraftVersion, loader, loaderVersion
          ├─ mods: Mod[]              (Kopien, inkl. enabled)
          ├─ presetId  ──────────────▶ Preset   (nur Etikett, keine Live-Bindung)
          ├─ modpack: ModpackOrigin    (nur Herkunft, keine Update-Funktion)
          ├─ memoryMb, jvmArgs
Preset ───┬─ mods: Mod[]  (UI: aus MOCK_MODS!)
          ├─ inheritsFrom, excludeMods  (Vererbung)
          ├─ gameSettings              (wird nie angewendet)
          ├─ jvmArgs, memoryMb
          └─ KEIN minecraftVersion / loader  ← Mods ohne Versionskontext
Katalog (Mods/Modpacks)  ─ eigener State, kennt keine Instanz, bis man sie im Select wählt
```

### 3.2 Was unlogisch oder redundant ist
1. **Presets haben keinen Versions- und Loader-Kontext.** Eine Mod-Datei ist an MC-Version und Loader gebunden. Ein Preset „Sodium 0.6.13“ auf eine 1.20.1-Instanz anzuwenden, ist technisch falsch. Das Datenmodell lässt das zu, die UI warnt nicht.
2. **Preset und Modpack sind dasselbe Konzept** („Bündel aus Mods + Einstellungen“), einmal lokal, einmal von Modrinth. Die UI behandelt sie als zwei Hauptbereiche mit völlig unterschiedlichen Abläufen.
3. **Preset-Vererbung** (`inheritsFrom`, `excludeMods`) ist Power-User-Komplexität ohne erkennbaren Nutzen für Spieler. Eine Kopie leistet dasselbe.
4. **Mods-Seite und Instanz-Mods-Tab** sind zwei Orte für dieselbe Sache und nicht verbunden.
5. **Loader-Version** ist ein Implementierungsdetail. 99 % der Nutzer wollen „neueste stabile“.
6. **RAM und JVM-Args** existieren an drei Stellen: global (Einstellungen), pro Instanz und pro Preset. Welcher Wert gilt, zeigt die UI nur halb („Standard“ im Stat [S16]).
7. **`modpack`-Herkunft** wird gespeichert, aber nicht genutzt (kein „Pack aktualisieren“, keine Pack-Info in der UI).
8. **Installation ist ein getrennter Zustand**, den der Nutzer verwalten muss („Nicht installiert“ → „Installieren“), obwohl der Launcher das beim Spielen selbst erledigen könnte.

### 3.3 Zielmodell

```
Instanz  (= der Ort, an dem alles passiert)
 ├─ Spielversion  { minecraft, loader }         ← einmal gewählt, danach „Version ändern…“ als Assistent
 ├─ Inhalte[]     { projectId, versionId, enabled, installedAs: "direkt" | "abhängigkeit" | "pack" }
 │    Mods, Ressourcenpakete, Shader, gleiche Liste mit Typfilter
 ├─ Herkunft?     { modpack projectId/versionId }  → „Pack-Update verfügbar“
 ├─ Leistung      { ram | "automatisch" }, JVM nur unter „Erweitert“
 └─ Spieleinstellungen (options.txt), nur wenn tatsächlich angewendet

Vorlage  (ersetzt Preset, optional)
 = gespeicherte Instanz ohne Welten: „Als Vorlage speichern“ / „Aus Vorlage erstellen“
 = identisch zu einem lokalen Modpack (.mrpack-Export), keine Vererbung
```

**Regeln:**
- **„Inhalt hinzufügen“ gibt es nur im Kontext einer Instanz.** Der Katalog öffnet sich mit vorbelegtem Filter (MC-Version + Loader der Instanz) und blendet Inkompatibles aus. Die Version wählt der Launcher automatisch (neueste kompatible Release-Version). Ein Klick auf „+“ installiert.
- **Abhängigkeiten sind automatisch und sichtbar gruppiert.** Sie werden mitinstalliert, als „benötigt von X“ markiert und beim Entfernen des letzten Nutzers mit entfernt.
- **Modpack = neue Instanz.** „Neu“ bietet drei Wege: *Leer* · *Aus Modpack* · *Aus Vorlage/Datei*. Alles endet in einer Instanz.
- **Installieren ist implizit.** „Spielen“ installiert Fehlendes und startet dann, mit einem Fortschritt im Button.
- **Updates:** Pro Instanz „Updates prüfen“ zeigt einen Badge an der Mod und bietet „Alle aktualisieren“.

---

## 4. UI-Qualität

| Bereich | Befund |
|---|---|
| **Layout** | Feste Seitenleiste mit 240 px, Inhalt `max-w-6xl` zentriert (`Layout.tsx:92,137`). Bei 1920 px bleiben rechts und links große Leerflächen, die Seite wirkt leer [S22]. Bei 900 px (Tauri-Minimum) wird der Instanzname auf „Survival 1.…“ gekürzt und das Status-Badge bricht zweizeilig um [S20]. Die Seitenleiste lässt sich nicht einklappen. |
| **Hierarchie** | Auf der Instanzseite konkurrieren zwei gleich große Buttons („Preset anwenden“ neben der Primäraktion) [S03]. Die Übersicht wiederholt den Header (MC-Version zweimal) und zeigt Stat-Kacheln ohne Handlungswert. |
| **Abstände** | Seiten-Padding `px-10 py-10` ist bei 900 px zu viel. Karten nutzen `p-4`, `p-5`, `p-2.5` und `p-3` durcheinander. |
| **Typografie** | Drei Familien (Geist, Geist Mono, Bricolage Grotesque). Mono wird für jede Versionsnummer genutzt und wirkt technisch. Viele Mikrotexte `text-[11px]` und `text-xs` in Muted-Farbe. |
| **Farbe** | Smaragd + Gold sind konsistent. Allerdings gibt es viel Deko (Grid-Hintergrund, zwei Glows, Hero-Gradient, Blur), und die Karten-Transparenzen `bg-card/40`, `/60`, `/70` variieren zufällig. Loader-Badges haben Hardcoded-Tints außerhalb der Tokens (`common.tsx:35`). |
| **shadcn-Konsistenz** | Die Seiten nutzen Card/Dialog/Tabs sauber. **`ContentCatalog.tsx` bricht das Muster:** keine Cards, keine Skeletons, ungestylte `<p role="status">`, extrem dichte Einzeiler (104 Zeilen, schwer wartbar). Listen-Buttons sind handgebaute `<button>`s mit kopierten Klassen (`Account.tsx:84`, `InstanceDetail.tsx:55`, `Presets.tsx:127`) statt einer gemeinsamen Komponente. `AlertDialog` fehlt für Bestätigungen; `ConfirmDialog` baut das mit `Dialog` nach. |
| **Dark Mode** | Nur Dark. `.dark` ist in `index.html` fest gesetzt, das Light-Theme ist ungetestet („nicht aktiv“, `index.css:56`), Farben wie `bg-white/5`, `ring-white/10` und `text-emerald-300` sind für Dark hartkodiert. Für einen Launcher ist das okay, dann aber das Light-Theme löschen statt es halb zu pflegen. |
| **Tastatur / A11y** | Positiv: Fokus-Ringe, `aria-label` an Icon-Buttons, `role="log"`, `aria-live` bei Fortschritt. Negativ: Lösch-Buttons sind `opacity-0` und erscheinen erst bei Hover/Fokus, also schlecht auffindbar. Es gibt keine Tastenkürzel (z. B. Ctrl+K Suche, Enter = Spielen). `StatusBadge` hat `role="status"` auf jeder Listenzeile, dadurch kündigen Screenreader bei jeder Statusänderung mehrfach an. Das Mods-Katalog-Select mit langen Texten ist per Tastatur mühsam. |
| **Leer-, Lade- und Fehlerzustände** | Instanzen/Presets: gut (Skeleton + EmptyState). Katalog: Leerzustand fehlt (leere Seite), Laden ist nur Text, Fehler sind ungestylt. Start: News sind **Mock-Daten** (`Home.tsx:11`) und im Produkt irreführend. |
| **Sprache** | Mix aus Nutzer- und Entwicklersprache: „JVM-Args“, „Loader-Version“, „Dependencies“, „Pack-Loader“, „Spieldateien installieren“, „Offline-Account“, „Tauri-App“. |

---

## 5. Befund-Katalog (priorisiert)

Schwere: **K** = kritisch (falsches Verhalten oder Vertrauensbruch), **H** = hoch (Kernaufgabe deutlich erschwert), **M** = mittel, **N** = niedrig.

| # | Schwere | Befund | Ort | Screenshot |
|---|---|---|---|---|
| 1 | **K** | Preset-Mods kommen aus der hart kodierten `MOCK_MODS`-Liste, auch im echten Build. Die Mods haben erfundene Quellen und werden beim Anwenden in echte Instanzen kopiert. | `src/pages/Presets.tsx:23,69,124`; `src/lib/mock.ts:29` | S13 |
| 2 | **K** | Preset-`gameSettings` werden gespeichert und angezeigt („3 Einstellungen“), aber nie angewendet. | `Presets.tsx:169`; `src-tauri/src/models.rs:142` | S12 |
| 3 | **K** | Mod entfernen ohne Bestätigung und ohne Rückgängig. | `src/pages/InstanceDetail.tsx:158` | S04 |
| 4 | **H** | Mod-Installation läuft rückwärts (Mod → Version → Instanz), ~10–12 Klicks, Version und Instanz-Kompatibilität muss der Nutzer von Hand abgleichen. | `src/components/ContentCatalog.tsx:82–89`; `src/lib/modrinth.ts:20` | S10 |
| 5 | **H** | Kein Weg „Mod hinzufügen“ aus der Instanz; der Leerzustand verlinkt kontextlos auf `/mods`. | `InstanceDetail.tsx:125–134` | S04 |
| 6 | **H** | Mods können nicht aktualisiert werden; Abhängigkeiten sind nicht als solche erkennbar. | `InstanceDetail.tsx:122` | S04 |
| 7 | **H** | Informationsarchitektur: Mods, Modpacks und Presets als Hauptbereiche neben Instanzen. Drei Einstiege in dasselbe Problem. | `src/app/Layout.tsx:18–24` | S01 |
| 8 | **H** | Kein Onboarding. Das fehlende Konto fällt erst beim Spielen auf, der Toast hat keine Aktion. | `src/hooks/useInstances.ts:115`; `Layout.tsx:104` | S18 |
| 9 | **H** | Anlegen → Installieren → Spielen sind drei manuelle Schritte; nach Modpack-Import kommt ein weiterer manueller „Spieldateien installieren“-Schritt. | `src/components/game.tsx:148`; `ContentCatalog.tsx:101` | S16, S17 |
| 10 | **H** | Katalog ohne Icons, ohne Paging, ohne Initialinhalt; Detailpanel liegt unter der Liste (Klick ohne sichtbare Wirkung). | `ContentCatalog.tsx:65–90` | S10 |
| 11 | **H** | Crash/Exit-Toast ohne Link zur Konsole; die Konsole ist nur im Detail-Tab erreichbar, ohne Kopieren oder „Logs öffnen“. | `useInstances.ts:150`; `game.tsx:179` | S05 |
| 12 | **M** | `.mrpack`-Import verlangt einen getippten absoluten Pfad statt Dateidialog oder Drag & Drop. | `ContentCatalog.tsx:91–97` | S11 |
| 13 | **M** | Fehler erscheinen doppelt (globaler Toast + Inline-`ErrorNote`). | `src/main.tsx:24`; `Instances.tsx:200` u. a. | – |
| 14 | **M** | Preset anwenden ist eine Einbahnstraße (JVM-Args ersetzt, kein Undo, `presetId` wirkungslos); Presets sind nicht bearbeitbar; Vererbung ist Overkill. | `models.rs:112`; `Presets.tsx:105` | S07, S13 |
| 15 | **M** | Dialog „Neue Instanz“ zeigt Expertenfelder (Loader-Version, RAM, Kanal) gleichrangig; Name ist Pflicht ohne Default. | `Instances.tsx:87–181` | S09 |
| 16 | **M** | Rohwerte in der UI: „resolve: 0 / 1“, „Client: required“, Markdown-Rohtext, Modrinth-`project_type`. | `ContentCatalog.tsx:71,78,99` | – |
| 17 | **M** | Mock-News auf der Startseite im echten Build. | `src/pages/Home.tsx:11,120` | S01 |
| 18 | **M** | Mindestgröße 900×600: Titel gekürzt, Badge umgebrochen, `px-10` zu breit. Bei großen Fenstern wirkt die Seite durch `max-w-6xl` leer. | `Layout.tsx:137`; `InstanceDetail.tsx:296` | S20, S22 |
| 19 | **M** | Toggle einer Mod speichert die ganze Instanz und sperrt alle Schalter (kein optimistisches Update). | `InstanceDetail.tsx:147–156` | S04 |
| 20 | **M** | Hero „Zuletzt gespielt“ zeigt auch nie gespielte oder nicht installierte Instanzen. | `Home.tsx:32`; `useInstances.ts:62` | S01 |
| 21 | **M** | „Folgt“-Features sichtbar (Microsoft-Login, Forge/Quilt/NeoForge im Select, „Forge folgt“-Button). | `Account.tsx:126`; `Instances.tsx:133`; `game.tsx:140` | S08, S15 |
| 22 | **M** | `ContentCatalog.tsx` weicht vom Komponenten-Stil ab (keine Card/Skeleton, dichte Einzeiler) und ist schwer wartbar. | `ContentCatalog.tsx` | S10, S11 |
| 23 | **N** | „Konto“ doppelt in der Seitenleiste. | `Layout.tsx:27,104` | S01 |
| 24 | **N** | Lösch-Buttons unsichtbar bis Hover. | `Instances.tsx:244`; `Account.tsx:109` | S02 |
| 25 | **N** | Mehrfaches `role="status"` in Listen; keine Tastenkürzel. | `game.tsx:62` | – |
| 26 | **N** | Übersicht-Tab wiederholt Headerdaten; Stat-Kacheln ohne Aktion. | `InstanceDetail.tsx:90` | S03 |
| 27 | **N** | Drei Schriftfamilien, viel Mono, viele 11-px-Texte; Deko-Glows und Grid. | `index.css:4–6`; `Layout.tsx:123` | S01 |
| 28 | **N** | Halbgepflegtes Light-Theme und hartkodierte Dark-Farben. | `index.css:56`; `common.tsx:35` | – |
| 29 | **N** | Entwicklersprache: „JVM-Args“, „Dependencies“, „Offline-Account“, „Spieldateien“. | diverse | – |

---

## 6. Redesign-Konzept

### 6.1 Kernprinzipien
1. **Instanz zuerst.** Alles, was eine Instanz verändert, passiert in der Instanz. Es gibt keine globalen Seiten, die eine Zielinstanz abfragen.
2. **Ein Hauptknopf.** „Spielen“ erledigt Installieren, Reparieren und Starten. Fortschritt erscheint im Knopf.
3. **Der Launcher entscheidet, der Nutzer darf überschreiben.** Version, Loader-Version, Abhängigkeiten und RAM sind automatisch; „Erweitert“ ist eingeklappt.
4. **Nur zeigen, was funktioniert.** Keine „folgt“-Einträge, keine Mock-Daten im Build.
5. **Jede Rückmeldung hat eine Aktion.** Fehler-Toasts mit „Konsole öffnen“, „Erneut versuchen“ oder „Konto anlegen“.
6. **Alltagssprache.** „Spielername“ statt „Offline-Account“, „Benötigt von Sodium“ statt „Dependency“, „Arbeitsspeicher: Automatisch“.

### 6.2 Informationsarchitektur (4 Hauptbereiche)

```
┌──────────────┐
│ ▶ Spielen    │  Home: zuletzt gespielt + Schnellstart, sonst Onboarding
│ ▦ Bibliothek │  Alle Instanzen (Grid), "+ Neu" (Leer | Modpack | Datei/Vorlage)
│ ⌕ Entdecken  │  Modpacks + beliebte Mods zum Stöbern → endet immer in "Zu Instanz hinzufügen" / "Als Instanz installieren"
│ ⚙ Einstell.  │  Spielername/Konto, Java/RAM-Standard, Erscheinungsbild, Ordner
└──────────────┘
    [Profil-Chip unten: "Jonas ▾"  → Name wechseln]
```

Weg fallen als Hauptbereiche: **Mods**, **Modpacks** und **Presets** (aufgegangen in Entdecken, Bibliothek und Instanz) sowie **Konto** (in Einstellungen plus Profil-Chip).

### 6.3 Wireframes

**Home / Spielen** (erster Start ohne Instanz = Onboarding in 2 Schritten)
```
┌─────────────────────────────────────────────────────────────┐
│  Willkommen!                                                │
│  ① Wie heißt du im Spiel?  [ Jonas________ ]  ✓             │
│  ② Womit willst du starten?                                 │
│   ┌──────────┐ ┌──────────────┐ ┌───────────────────┐       │
│   │ Vanilla  │ │ Performance  │ │ Modpack wählen…   │       │
│   │ 1.21.11  │ │ Fabric+Sodium│ │ (Entdecken)       │       │
│   └──────────┘ └──────────────┘ └───────────────────┘       │
│                               [ ▶ Los geht's ]              │
└─────────────────────────────────────────────────────────────┘
```
Mit Instanzen:
```
┌─────────────────────────────────────────────────────────────┐
│ [Bild]  Survival 1.21          Fabric · 1.21.4 · 23 Mods     │
│                                   [ ▶  SPIELEN        ▾ ]    │  ▾ = andere Instanz
│                                   ▓▓▓▓▓▓░░ Assets 64 %       │  (nur beim Vorbereiten)
├─────────────────────────────────────────────────────────────┤
│ Zuletzt:  [Create-Fabrik ▶]  [Vanilla Snapshot ▶]  [+ Neu]   │
└─────────────────────────────────────────────────────────────┘
```

**Bibliothek**
```
Bibliothek                               [⌕ Filter]  [+ Neu ▾]
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│ [Bild] │ │ [Bild] │ │ [Bild] │ │   +    │   Hover: ▶ Spielen · ⋯ (Umbenennen,
│Survival│ │ Create │ │Vanilla │ │  Neu   │          Ordner öffnen, Duplizieren,
│Fabric  │ │ Fabric │ │1.21.5  │ │        │          Als Vorlage speichern, Löschen)
│● Läuft │ │        │ │        │ │        │
└────────┘ └────────┘ └────────┘ └────────┘
```
„+ Neu“ öffnet einen Dialog mit Tabs **Leer** (Name optional, Version, Loader: Vanilla/Fabric; „Erweitert ▸“ für Loader-Version und RAM) · **Modpack** (Suche) · **Datei** (Drag & Drop `.mrpack` oder Vorlage).

**Instanz** (ein Ort für alles, Tabs: Inhalte · Welten · Protokoll · Einstellungen)
```
← Bibliothek
[Bild] Survival 1.21                                [ ▶ SPIELEN ]
       Fabric · 1.21.4 · 23 Mods · ⚠ 3 Updates     [ ⋯ ]
─────────────────────────────────────────────────────────────
 Inhalte (23)   Welten   Protokoll   Einstellungen
─────────────────────────────────────────────────────────────
 [⌕ In Inhalten suchen]  [Mods ▾]      [⟳ Alle aktualisieren] [+ Hinzufügen]
 ┌─────────────────────────────────────────────────────────┐
 │ [ic] Sodium        0.6.13   ⟳ 0.6.14        [●━] ⋯      │
 │ [ic] Iris Shaders  1.8.12                    [●━] ⋯      │
 │   └ benötigt: Fabric API (automatisch)                   │
 │ [ic] Lithium       0.15.1                    [━○] ⋯      │  deaktiviert
 └─────────────────────────────────────────────────────────┘
  Entfernt: AppleSkin  [Rückgängig]                            (Toast, 6 s)
```

**„+ Hinzufügen“** = Katalog als Seitenpanel (Sheet) **im Kontext der Instanz**
```
┌───────────────────────────── Inhalte für Survival 1.21 ──┐
│ [⌕ Suche…]   Mods | Shader | Ressourcenpakete             │
│ Passend zu Fabric 1.21.4 ✓   (Filter fest, abschaltbar)   │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ [ic] Sodium       Performance · 80 Mio.   ✓ Installiert│ │
│ │ [ic] Xaero's Map  Karte · 40 Mio.          [ + ]      │ │
│ │ [ic] JEI          Rezepte · 200 Mio.       [ + ]      │ │
│ └──────────────────────────────────────────────────────┘ │
│   … mehr laden                                             │
│ Klick auf Zeile → Details (Beschreibung gerendert,         │
│ Screenshots, Versionsliste unter „Andere Version…“)       │
└────────────────────────────────────────────────────────────┘
```
„+“ = neueste kompatible Version + Abhängigkeiten, Fortschritt in der Zeile, Ergebnis sofort in der Liste.

**Entdecken** (globales Stöbern)
```
Entdecken                       [⌕ Modpacks und Mods suchen]
Beliebte Modpacks  ─────────────────────────────  mehr ›
[Karte][Karte][Karte][Karte]     → [Als neue Instanz installieren]
Beliebte Mods  ─────────────────────────────────  mehr ›
[Karte][Karte][Karte][Karte]     → [Zu Instanz hinzufügen ▾] (nur kompatible Instanzen)
```

### 6.4 Presets: Empfehlung
**Streichen und durch „Vorlagen“ ersetzen:** Eine Vorlage ist ein Schnappschuss einer Instanz (Version + Loader + Inhalte + Einstellungen), technisch ein lokales `.mrpack`. Aktionen: „Als Vorlage speichern“ (Instanz-Menü) und „Neu › Aus Vorlage“. Keine Vererbung, kein „Anwenden auf bestehende Instanz“. Das beseitigt Befunde 1, 2 und 14 und das Versionsproblem aus 3.2.1. Die Kosten sind Backend-Arbeit (Export/Import existiert für `.mrpack` bereits teilweise) und damit eine Entscheidung für Mara bzw. Jonas.

### 6.5 Umsetzungsreihenfolge (kleine, einzeln lieferbare Schritte)

| Schritt | Inhalt | Behebt | Aufwand |
|---|---|---|---|
| 1 | **Aufräumen:** Mock-News und Microsoft-Karte entfernen, „folgt“-Loader ausblenden, `MOCK_MODS` aus Presets entfernen (Preset-Seite vorerst ausblenden), Doppel-Toast abstellen | 1, 2, 13, 17, 21 | S |
| 2 | Mod entfernen mit Undo-Toast; Toggle optimistisch | 3, 19 | S |
| 3 | Fehler-Toasts mit Aktion (Konto anlegen, Konsole öffnen, Erneut versuchen) | 8, 11 | S |
| 4 | „Spielen“ installiert bei Bedarf automatisch; Fortschritt im Button; Modpack-Import ohne Extra-Schritt | 9 | M (braucht ggf. Backend-Freigabe) |
| 5 | **Katalog als Instanz-Panel:** „+ Hinzufügen“ in der Instanz, Filter aus der Instanz, automatische Versionswahl, Icons, Status „installiert“, Paging | 4, 5, 10, 16, 22 | L |
| 6 | Abhängigkeiten in der Mod-Liste kennzeichnen; Updates prüfen und „Alle aktualisieren“ | 6 | M–L (Backend: Update-Check) |
| 7 | Navigation auf 4 Bereiche umbauen (Spielen, Bibliothek, Entdecken, Einstellungen); Konto in Einstellungen + Profil-Chip | 7, 23 | M |
| 8 | Onboarding beim ersten Start (Spielername + Startvorlage) | 8 | M |
| 9 | Dialog „Neu“ mit Tabs Leer/Modpack/Datei; Expertenfelder unter „Erweitert“; Dateidialog/Drag & Drop für `.mrpack` | 12, 15 | M |
| 10 | Presets durch Vorlagen ersetzen (siehe 6.4) | 14 | L (Backend) |
| 11 | Feinschliff: responsives Padding, Seitenleiste einklappbar ab < 1000 px, Typo auf 2 Familien reduzieren, Deko reduzieren, Kartenstile vereinheitlichen, Sprache überarbeiten, Tastenkürzel | 18, 24–29 | M |

Schritt 1–3 sind reine Frontend-Arbeit, liefern schnell sichtbaren Nutzen und blockieren nichts. Schritt 5 ist der größte UX-Gewinn.

---

## 7. Offene Fragen (Entscheidung Mara / Jonas)
1. Presets streichen und durch Vorlagen (= lokales `.mrpack`) ersetzen, oder Presets behalten und um MC-Version/Loader erweitern?
2. Darf „Spielen“ automatisch installieren? Das ist ein Backend-Verhalten, der Command existiert bereits getrennt.
3. Sollen Shader und Ressourcenpakete in dieselbe Inhaltsliste (Zielmodell), oder bleibt es vorerst bei Mods?
4. Ist ein Update-Check für Mods im Backend geplant? Ohne ihn bleibt Schritt 6 unvollständig.
