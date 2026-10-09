import type { Dict } from "../types.ts";

/** Wörterbuch des ui-Bereichs (src/ui, src/app, src/pixel): deutsche Texte aus der Oberfläche. */
export const ui = {
  // ---------- Navigation und Fenstertitel ----------
  "ui.nav.home": "Start",
  "ui.nav.library": "Bibliothek",
  "ui.nav.discover": "Entdecken",
  "ui.nav.skins": "Skins",
  "ui.nav.friends": "Freunde",
  "ui.nav.announcements": "Neuigkeiten",
  "ui.nav.announcementsBadgeAria": "{name}, {count} ungelesen",
  "ui.nav.friendsBadgeAria": "{name}, {count} offen",
  "ui.nav.mainAreas": "Hauptbereiche",
  "ui.pageTitle.notFound": "Seite nicht gefunden",

  // ---------- Aufgaben (Fensterleiste) ----------
  "ui.tasks.title": "Aufgaben",
  "ui.tasks.ariaRunning.one": "1 Aufgabe läuft",
  "ui.tasks.ariaRunning.other": "Aufgaben, {count} laufen",
  "ui.tasks.clearDone": "Fertige entfernen",
  "ui.tasks.activeCount": "{count} aktiv",
  "ui.tasks.emptyTitle": "Keine Aufgaben",
  "ui.tasks.emptyBody": "Downloads und Installationen erscheinen hier.",
  "ui.tasks.installing": "{name} wird installiert",
  "ui.tasks.loadingContents": "Inhalte laden",
  "ui.tasks.queuedSub": "Wartet auf den laufenden Vorgang",
  "ui.tasks.unqueueAria": "{label} aus der Warteschlange entfernen",
  "ui.job.cancelAria": "{label} abbrechen",

  // ---------- Fenster ----------
  "ui.window.minimize": "Minimieren",
  "ui.window.maximize": "Maximieren",
  "ui.titlebar.updateAvailable": "Update verfügbar",
  "ui.offline.label": "Offline",
  "ui.offline.detail": ": keine Internetverbindung, Katalog und Downloads sind nicht verfügbar",

  // ---------- Rückmeldungen ----------
  "ui.progress.label": "Fortschritt",
  "ui.toast.containerAria": "Benachrichtigungen",
  "ui.dialog.pending": "Einen Moment",

  // ---------- Felder ----------
  "ui.field.optional": "(optional)",
  "ui.search.clearAria": "Suche leeren",
  "ui.select.placeholder": "Keine Auswahl",

  "ui.context.cut": "Ausschneiden",
  "ui.context.copy": "Kopieren",
  "ui.context.paste": "Einfügen",
  "ui.context.selectAll": "Alles auswählen",
  "ui.context.refresh": "Aktualisieren",
  "ui.context.editFailed": "Text konnte nicht bearbeitet werden",

  // ---------- Listen ----------
  "ui.list.undo": "Rückgängig",

  // ---------- Seitenpanel ----------
  "ui.sheet.closeAria": "Panel schließen",

  // ---------- Speicher und Schalter ----------
  "ui.memory.label": "Arbeitsspeicher",
  "ui.switch.on": "An",
  "ui.switch.off": "Aus",
  // ---------- Tastaturkürzel ----------
  "ui.skipToContent": "Zum Inhalt springen",
  "ui.shortcut.ctrl": "Strg",
  "ui.shortcut.title": "Tastaturkürzel",
  "ui.shortcut.groupGeneral": "Allgemein",
  "ui.shortcut.groupAreas": "Bereiche",
  "ui.shortcut.goTo": "Wechseln zu {name}",
  "ui.shortcut.settings": "Einstellungen öffnen",
  "ui.shortcut.newInstance": "Neue Instanz",
  "ui.shortcut.play": "Spielen (Start und Instanz)",
  "ui.shortcut.search": "Suche der Seite",
  "ui.shortcut.help": "Diese Übersicht",
  "ui.shortcut.tabHint": "Mit Tab springst du durch alle Bedienelemente, mit den Pfeiltasten durch Listen und Reiter, Esc schließt Fenster und Menüs.",
  "ui.shortcut.windowHint": "Das Fenster ordnest du mit Win+Pfeiltasten an; Minimieren, Maximieren und Schließen oben rechts erreichst du mit Tab.",
  // ---------- Szenen (Namen der Biome) ----------
  "ui.biome.forest": "Wald am Abend",
  "ui.biome.nether": "Nether",
  "ui.biome.end": "End",
  "ui.biome.snow": "Schneeberge",
  "ui.biome.cave": "Höhle",
  "ui.biome.sea": "Küste",
  "ui.biome.plains": "Ebene",
} satisfies Dict;
