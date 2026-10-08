import type { Dict } from "../types.ts";

/** Wörter des Bereichs deepLinks: Links von außen (`pumpkin://`, `modrinth://`, `curseforge://`) und Desktop-Verknüpfungen. */
export const deepLinks = {
  "deepLinks.launch.title": "{name} starten?",
  "deepLinks.launch.text": "Ein Link möchte diese Instanz starten. Starte sie nur, wenn du dem Link vertraust, auf den du geklickt hast.",
  "deepLinks.launch.world": "Das Spiel öffnet danach die Welt „{target}“.",
  "deepLinks.launch.server": "Das Spiel verbindet sich danach mit dem Server {target}.",
  "deepLinks.launch.confirm": "Starten",

  "deepLinks.instanceMissing": "Instanz nicht gefunden. Der Link gehört zu einer Instanz, die es auf diesem Rechner nicht (mehr) gibt.",
  "deepLinks.unsupportedProject": "Dieses Projekt lässt sich mit Pumpkin Launcher nicht installieren (Art: {type}).",

  "deepLinks.shortcut.menu": "Desktop-Verknüpfung anlegen",
  "deepLinks.shortcut.created": "Verknüpfung für „{name}“ angelegt",
  "deepLinks.shortcut.createdHint": "Ein Doppelklick startet die Instanz ohne Rückfrage.",

  "deepLinks.settings.sectionTitle": "Links",
  "deepLinks.settings.label": "Modrinth- und CurseForge-Links in Pumpkin öffnen",
  "deepLinks.settings.hint": "Pumpkin Launcher öffnet dann die Installieren-Links von Modrinth und CurseForge. Das ersetzt die Zuordnung anderer Programme, etwa der Modrinth-App und der CurseForge-App. Zum Rückgängigmachen schaltest du es wieder aus; ein anderes Programm bekommt die Links aber erst zurück, wenn es sie sich selbst wieder zuordnet.",
  "deepLinks.settings.enabledToast": "Modrinth- und CurseForge-Links öffnen jetzt in Pumpkin Launcher",
  "deepLinks.settings.disabledToast": "Modrinth- und CurseForge-Links gehören wieder den anderen Programmen",
} satisfies Dict;
