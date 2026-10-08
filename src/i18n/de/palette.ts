import type { Dict } from "../types.ts";

/** Wörter der Befehlspalette (app/palette); `palette.kw.*` sind Suchbegriffe, durch Leerzeichen getrennt. */
export const palette = {
  "palette.title": "Befehlspalette",
  "palette.shortcut": "Befehlspalette öffnen",
  "palette.inputLabel": "Befehl, Instanz oder Seite suchen",
  "palette.placeholder": "Befehl, Instanz oder Seite suchen …",
  "palette.listLabel": "Ergebnisse",
  "palette.hint": "Pfeiltasten wählen, Enter führt aus.",
  "palette.noResults": "Keine Treffer für „{query}“",
  "palette.results.one": "{count} Ergebnis",
  "palette.results.other": "{count} Ergebnisse",

  "palette.group.recent": "Zuletzt verwendet",
  "palette.group.instances": "Instanzen",
  "palette.group.navigation": "Navigation",
  "palette.group.actions": "Aktionen",
  "palette.group.search": "Suche",

  // Instanzen
  "palette.play": "Spielen: {name}",
  "palette.playLast": "Weiterspielen: {name} – {target}",
  "palette.stop": "Beenden: {name}",
  "palette.open": "Öffnen: {name}",
  "palette.kw.play": "starten spielen launch start",
  "palette.kw.resume": "weiterspielen fortsetzen zuletzt letzte welt server schnellstart quickplay",
  "palette.kw.stop": "beenden stoppen schließen abbrechen kill",
  "palette.kw.open": "öffnen anzeigen details instanz",

  // Navigation
  "palette.settingsTab": "Einstellungen: {name}",
  "palette.kw.navigate": "gehe zu wechseln öffnen seite bereich",
  "palette.kw.settings": "einstellungen optionen konfiguration",

  // Aktionen
  "palette.newInstance": "Neue Instanz anlegen",
  "palette.kw.newInstance": "neue instanz anlegen erstellen hinzufügen",
  "palette.import": "Instanzen aus anderem Launcher importieren",
  "palette.kw.import": "importieren übernehmen anderer launcher instanzen",
  "palette.checkUpdates": "Nach Launcher-Updates suchen",
  "palette.updateBusy": "Ein Update wird gerade geladen oder installiert",
  "palette.kw.checkUpdates": "update aktualisieren neue version launcher suchen prüfen",
  "palette.openDataFolder": "Datenordner öffnen",
  "palette.kw.openDataFolder": "ordner datenordner explorer dateien launcher",
  "palette.openInstancesFolder": "Instanzordner öffnen",
  "palette.kw.openInstancesFolder": "ordner instanzordner explorer dateien instanzen",
  "palette.motionOff": "Bewegte Szenen ausschalten",
  "palette.motionOn": "Bewegte Szenen einschalten",
  "palette.kw.motion": "animation bewegung szenen buddy reduzieren",
  "palette.textSize": "Textgröße ändern",
  "palette.textSizeChange": "{from} → {to}",
  "palette.kw.textSize": "schrift schriftgröße text größe zoom",

  // Suche
  "palette.searchDiscover": "Entdecken nach „{query}“ durchsuchen",
} satisfies Dict;
