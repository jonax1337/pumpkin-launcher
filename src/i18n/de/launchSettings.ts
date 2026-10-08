import type { Dict } from "../types.ts";

/** Start-Umgebung: Umgebungsvariablen, Wrapper und Befehle vor dem Start und nach dem Ende (Instanz und Launcher). */
export const launchSettings = {
  "launchSettings.section": "Start-Umgebung",
  "launchSettings.saved": "Start-Umgebung gespeichert",
  "launchSettings.infoAside": "Umgebungsvariablen, ein Wrapper wie GameMode oder MangoHud und Befehle vor dem Start und nach dem Ende. Jede Instanz kann eigene festlegen; was sie leer lässt, kommt von hier.",

  "launchSettings.scope.instance": "Leere Felder erben den Standard des Launchers.",
  "launchSettings.scope.launcher": "Gilt für Instanzen ohne eigene Angabe.",

  "launchSettings.presets.label": "Vorgaben",
  "launchSettings.presets.hint": "Ein Klick trägt Wrapper oder Variablen ein, ein zweiter nimmt sie wieder heraus. Das Programm muss installiert sein.",
  "launchSettings.preset.gamemode": "GameMode",
  "launchSettings.preset.mangohud": "MangoHud",
  "launchSettings.preset.nvidia": "NVIDIA-Grafikkarte",
  "launchSettings.preset.amd": "AMD-Grafikkarte",

  "launchSettings.env.label": "Umgebungsvariablen",
  "launchSettings.env.hint": "Gelten nur für das Spiel. Namen aus Buchstaben, Ziffern und _, höchstens {max} Variablen.",
  "launchSettings.env.name": "Name der Variable",
  "launchSettings.env.value": "Wert der Variable",
  "launchSettings.env.remove": "Variable {name} entfernen",
  "launchSettings.env.removeEmpty": "Leere Variable entfernen",
  "launchSettings.env.add": "Variable hinzufügen",
  "launchSettings.env.nameInvalid": "Ein Name darf nur aus Buchstaben, Ziffern und _ bestehen und nicht mit einer Ziffer beginnen.",
  "launchSettings.env.nameReserved": "Namen, die mit PUMPKIN_ beginnen, setzt der Launcher selbst.",

  "launchSettings.wrapper.label": "Wrapper-Befehl",
  "launchSettings.wrapper.hint": "Steht vor dem Java-Aufruf, etwa gamemoderun oder mangohud. Programm und Argumente; Anführungszeichen fassen Leerzeichen zusammen. Es läuft keine Shell.",

  "launchSettings.preLaunch.label": "Befehl vor dem Start",
  "launchSettings.preLaunch.hint": "Läuft im Spielordner, bevor Minecraft startet. Endet er mit einem Fehler oder braucht er länger als {seconds} Sekunden, startet das Spiel nicht.",
  "launchSettings.preLaunch.consent": "Wrapper und Befehle starten Programme mit deinen Rechten. Trage nur ein, was du kennst und dem du vertraust. Modpacks, Vorlagen und Importe setzen sie nie.",
  "launchSettings.postExit.label": "Befehl nach dem Ende",
  "launchSettings.postExit.hint": "Läuft im Hintergrund, wenn Minecraft beendet ist. Ein Fehler wird nur protokolliert.",
  "launchSettings.hooks.variables": "Die Befehle kennen PUMPKIN_INSTANCE_ID, PUMPKIN_INSTANCE_NAME, PUMPKIN_GAME_DIR, PUMPKIN_MC_VERSION und PUMPKIN_LOADER, der Befehl nach dem Ende auch PUMPKIN_EXIT_CODE.",
} satisfies Dict;
