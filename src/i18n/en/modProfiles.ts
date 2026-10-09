import { modProfiles as deModProfiles } from "../de/modProfiles.ts";

/** Gleiche Schlüssel wie das deutsche Wörterbuch; tsc erzwingt die Vollständigkeit. */
export const modProfiles: typeof deModProfiles = {
  "modProfiles.label": "Profile",
  "modProfiles.none": "No profile",
  "modProfiles.modified": "modified",
  "modProfiles.menuLabel": "Manage profiles",
  "modProfiles.reset": "Reset to “{name}”",
  "modProfiles.saveAs": "Save current state as profile…",
  "modProfiles.saveTitle": "Save as profile",
  "modProfiles.nameLabel": "Profile name",
  "modProfiles.saveHelp": "Remembers which mods and shaders are on right now. A profile with the same name is overwritten after you confirm.",
  "modProfiles.overwriteTitle": "Overwrite profile?",
  "modProfiles.overwriteText": "The profile “{name}” already exists. It will be replaced by the current state.",
  "modProfiles.overwrite": "Overwrite",
  "modProfiles.renameTitle": "Rename profile",
  "modProfiles.deleteTitle": "Delete profile “{name}”?",
  "modProfiles.deleteText": "The mods and shaders themselves stay as they are. Only the remembered profile goes away.",
  "modProfiles.saved": "Profile “{name}” saved",
  "modProfiles.renamed": "The profile is now called “{name}”",
  "modProfiles.deleted": "Profile “{name}” deleted",
  "modProfiles.applied.one": "Profile “{name}” applied: {n} item switched",
  "modProfiles.applied.other": "Profile “{name}” applied: {n} items switched",
  "modProfiles.appliedNoChange": "Profile “{name}” applied: nothing needed to be switched",
};
