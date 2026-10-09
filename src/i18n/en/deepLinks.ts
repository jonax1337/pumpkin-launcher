import { deepLinks as deDeepLinks } from "../de/deepLinks.ts";

/** Gleiche Schlüssel wie das deutsche Wörterbuch; tsc erzwingt die Vollständigkeit. */
export const deepLinks: typeof deDeepLinks = {
  "deepLinks.launch.title": "Start {name}?",
  "deepLinks.launch.text": "A link wants to start this instance. Only start it if you trust the link you clicked.",
  "deepLinks.launch.world": "The game will then open the world “{target}”.",
  "deepLinks.launch.server": "The game will then connect to the server {target}.",
  "deepLinks.launch.confirm": "Start",

  "deepLinks.instanceMissing": "Instance not found. The link belongs to an instance that does not exist on this computer (any more).",
  "deepLinks.unsupportedProject": "Pumpkin Launcher cannot install this project (type: {type}).",

  "deepLinks.shortcut.menu": "Create desktop shortcut",
  "deepLinks.shortcut.created": "Shortcut for “{name}” created",
  "deepLinks.shortcut.createdHint": "A double click starts the instance without asking.",

  "deepLinks.settings.sectionTitle": "Links",
  "deepLinks.settings.label": "Open Modrinth and CurseForge links in Pumpkin",
  "deepLinks.settings.hint": "Pumpkin Launcher then opens the install links of Modrinth and CurseForge. This replaces the setting of other programs, such as the Modrinth app and the CurseForge app. To undo it, switch it off again; another program only gets the links back once it registers them again itself.",
  "deepLinks.settings.enabledToast": "Modrinth and CurseForge links now open in Pumpkin Launcher",
  "deepLinks.settings.disabledToast": "Modrinth and CurseForge links belong to the other programs again",
};
