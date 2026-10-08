import type { Dict } from "../types.ts";

/** Wörter der Profile der Inhalte (Werkzeugleiste des Inhalte-Reiters einer Instanz). */
export const modProfiles = {
  "modProfiles.label": "Profil",
  "modProfiles.none": "Kein Profil",
  "modProfiles.modified": "geändert",
  "modProfiles.menuLabel": "Profile verwalten",
  "modProfiles.reset": "Auf „{name}“ zurücksetzen",
  "modProfiles.saveAs": "Aktuellen Stand als Profil speichern…",
  "modProfiles.saveTitle": "Als Profil speichern",
  "modProfiles.nameLabel": "Name des Profils",
  "modProfiles.saveHelp": "Merkt sich, welche Mods und Shader jetzt an sind. Ein Profil mit demselben Namen wird nach Rückfrage überschrieben.",
  "modProfiles.overwriteTitle": "Profil überschreiben?",
  "modProfiles.overwriteText": "Das Profil „{name}“ gibt es schon. Es wird durch den jetzigen Stand ersetzt.",
  "modProfiles.overwrite": "Überschreiben",
  "modProfiles.renameTitle": "Profil umbenennen",
  "modProfiles.deleteTitle": "Profil „{name}“ löschen?",
  "modProfiles.deleteText": "Die Mods und Shader selbst bleiben, wie sie sind. Es verschwindet nur das gemerkte Profil.",
  "modProfiles.saved": "Profil „{name}“ gespeichert",
  "modProfiles.renamed": "Das Profil heißt jetzt „{name}“",
  "modProfiles.deleted": "Profil „{name}“ gelöscht",
  "modProfiles.applied.one": "Profil „{name}“ angewendet: {n} Inhalt umgeschaltet",
  "modProfiles.applied.other": "Profil „{name}“ angewendet: {n} Inhalte umgeschaltet",
  "modProfiles.appliedNoChange": "Profil „{name}“ angewendet: Es musste nichts umgeschaltet werden",
} satisfies Dict;
