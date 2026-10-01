import type { Dict } from "../types.ts";

/** Wörterbuch des ui-Bereichs (src/ui, src/app, src/pixel): deutsche Texte aus der Oberfläche. */
export const ui = {
  // ---------- Navigation und Fenstertitel ----------
  "ui.nav.home": "Start",
  "ui.nav.library": "Bibliothek",
  "ui.nav.discover": "Entdecken",
  "ui.nav.skins": "Skins",
  "ui.nav.mainAreas": "Hauptbereiche",
  "ui.pageTitle.notFound": "Seite nicht gefunden",

  // ---------- Aufgaben (Fensterleiste) ----------
  "ui.tasks.title": "Aufgaben",
  "ui.tasks.ariaRunning.one": "1 Aufgabe läuft",
  "ui.tasks.ariaRunning.other": "Aufgaben, {count} laufen",
  "ui.tasks.clearDone": "Fertige entfernen",
  "ui.tasks.emptyTitle": "Keine Aufgaben",
  "ui.tasks.emptyBody": "Downloads und Installationen erscheinen hier.",
  "ui.tasks.installing": "{name} wird installiert",
  "ui.tasks.loadingContents": "Inhalte laden",
  "ui.job.cancelAria": "{label} abbrechen",

  // ---------- Fenster ----------
  "ui.window.minimize": "Minimieren",
  "ui.window.maximize": "Maximieren",
  "ui.titlebar.homeAria": "Pumpkin Launcher, zum Start",
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

  // ---------- Listen ----------
  "ui.list.undo": "Rückgängig",

  // ---------- Seitenpanel ----------
  "ui.sheet.closeAria": "Panel schließen",

  // ---------- Speicher und Schalter ----------
  "ui.memory.label": "Arbeitsspeicher",
  "ui.switch.on": "An",
  "ui.switch.off": "Aus",
  // ---------- Szenen (Namen der Biome) ----------
  "ui.biome.forest": "Wald am Abend",
  "ui.biome.nether": "Nether",
  "ui.biome.end": "End",
  "ui.biome.snow": "Schneeberge",
  "ui.biome.cave": "Höhle",
  "ui.biome.sea": "Küste",
  "ui.biome.plains": "Ebene",
} satisfies Dict;
