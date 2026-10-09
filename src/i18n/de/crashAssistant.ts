import type { Dict } from "../types.ts";

/** Wörter des Absturzassistenten (components/crash); die Titel und Texte folgen den Kennungen der Befunde aus dem Backend. */
export const crashAssistant = {
  "crashAssistant.heading": "Was ist passiert?",
  "crashAssistant.loadFailed": "Die Analyse des Absturzes ist fehlgeschlagen.",
  "crashAssistant.evidence": "Auszug aus dem Bericht",
  "crashAssistant.more": "Weitere Befunde ({n})",
  "crashAssistant.severity.error": "Ursache gefunden",
  "crashAssistant.severity.warning": "Wahrscheinlich",
  "crashAssistant.severity.info": "Hinweis",

  "crashAssistant.outOfMemory.title": "Minecraft hatte zu wenig Arbeitsspeicher",
  "crashAssistant.outOfMemory.body": "Der Speicher des Spiels war voll. Zugeteilt waren {current}; mit {suggested} hat es mehr Luft.",
  "crashAssistant.outOfMemoryAtLimit.body":
    "Mehr als {limit} kann dieser PC der Instanz nicht geben, sie hat schon {current}. Entferne Mods, senke die Sichtweite oder schließe andere Programme.",
  "crashAssistant.javaVersion.title": "Falsche Java-Version",
  "crashAssistant.javaVersion.body":
    "Das Spiel oder eine Mod braucht Java {javaMajor} oder neuer, lief aber mit einer älteren Version. Normalerweise wählt Pumpkin Launcher das passende Java selbst; ein eigener Java-Pfad überstimmt das.",
  "crashAssistant.javaVersionUnknown.body":
    "Das Spiel oder eine Mod wurde für ein neueres Java gebaut als das, mit dem es lief. Normalerweise wählt Pumpkin Launcher das passende Java selbst; ein eigener Java-Pfad überstimmt das.",
  "crashAssistant.missingDependency.title": "Eine Mod braucht eine andere Mod",
  "crashAssistant.missingDependency.body":
    "Es fehlt: {dependencies}. Suche die fehlende Mod oder schalte die Mod aus, die sie braucht.",
  "crashAssistant.mixinFailure.title": "Eine Mod passt nicht zum Spiel",
  "crashAssistant.mixinFailure.body":
    "Eine Mod konnte sich nicht in Minecraft einhängen. Meist passt sie nicht zur Minecraft-Version oder beißt sich mit einer anderen Mod. Aktualisiere sie oder schalte sie aus.",
  "crashAssistant.duplicateMods.title": "Eine Mod ist doppelt vorhanden",
  "crashAssistant.duplicateMods.body": "Dieselbe Mod liegt in zwei Dateien. Schalte eine davon aus.",
  "crashAssistant.graphicsDriver.title": "Der Grafiktreiber unterstützt OpenGL nicht",
  "crashAssistant.graphicsDriver.body":
    "Minecraft konnte kein Fenster öffnen, weil der Grafiktreiber OpenGL nicht bereitstellt. Aktualisiere den Treiber deiner Grafikkarte (Intel, AMD oder NVIDIA) und starte neu. Per Remote-Desktop oder in einer virtuellen Maschine startet Minecraft oft gar nicht.",
  "crashAssistant.portInUse.title": "Ein Netzwerk-Port ist schon belegt",
  "crashAssistant.portInUse.body":
    "Minecraft wollte einen Port öffnen, den schon ein anderes Programm nutzt, oft ein zweites Minecraft oder ein Server. Schließe das andere Programm oder wähle einen anderen Port.",
  "crashAssistant.gameFiles.title": "Spieldateien sind beschädigt oder fehlen",
  "crashAssistant.gameFiles.body":
    "Eine Datei von Minecraft oder seinen Bibliotheken lässt sich nicht lesen. Reparieren lädt sie neu; Welten und Mods bleiben.",
  "crashAssistant.suspectMods.title": "Diese Mods kommen als Ursache in Frage",
  "crashAssistant.suspectMods.body":
    "Wahrscheinlich: {mods}. Das ist ein Hinweis, kein Urteil: Schalte sie nacheinander aus und probiere es erneut.",

  "crashAssistant.action.raiseMemory": "Auf {memory} erhöhen",
  "crashAssistant.action.useManagedJava": "Eigenes Java entfernen",
  "crashAssistant.action.installDependency": "„{query}“ suchen",
  "crashAssistant.action.disableMod": "{name} ausschalten",
  "crashAssistant.action.openUrl": "Hilfeseite öffnen",
  "crashAssistant.action.reinstallGameFiles": "Spieldateien reparieren",

  "crashAssistant.done.raiseMemory": "Arbeitsspeicher auf {memory} gesetzt",
  "crashAssistant.done.useManagedJava": "Eigener Java-Pfad entfernt",
  "crashAssistant.done.disableMod": "{name} ausgeschaltet",
  "crashAssistant.modGone": "Diese Mod ist nicht mehr in der Instanz.",
} satisfies Dict;
