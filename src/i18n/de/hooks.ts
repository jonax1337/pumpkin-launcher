import type { Dict } from "../types.ts";

/** Wörter des Bereichs hooks (Hook-Dateien); die Browser-Fassung von lib/api.ts liegt in mock.ts. */
export const hooks = {
  "hooks.update.availableToast": "Pumpkin Launcher {version} ist da",
  "hooks.update.availableHint": "Installieren, wann es dir passt.",
  "hooks.update.waitForIdle": "Neu starten geht, sobald Minecraft beendet ist und keine Aufgaben mehr laufen.",
  "hooks.update.installFailed": "Das Update ließ sich nicht installieren",
  "hooks.update.loaded": "Update ist geladen",
  "hooks.update.ready": "Update ist bereit",
  "hooks.update.readyHint": "Pumpkin Launcher startet für die Installation neu.",

  "hooks.import.noNewInFolder": "In diesem Ordner gibt es keine neuen Instanzen.",
  "hooks.import.instanceTask": "{name} importieren",
  "hooks.import.instanceTaskDone": "{name} importiert",

  "hooks.install.doneTask": "{name} installiert",
  "hooks.install.readySub": "Bereit zum Spielen",
  "hooks.install.readyToast": "{name} ist bereit",
  "hooks.install.cancelled": "Installation von {name} abgebrochen",
  "hooks.install.failed": "{name} konnte nicht installiert werden",

  "hooks.launch.needPlayerName": "Leg zuerst einen Spielernamen fest.",
  "hooks.launch.needMicrosoft": "Melde dich zuerst mit deinem Microsoft-Konto an.",
  "hooks.launch.setPlayerName": "Spielername festlegen",

  "hooks.game.exited": "Minecraft beendet",
  "hooks.game.exitedPlayed": "Minecraft beendet. Gespielt: {duration}",
  "hooks.game.exitedWithCode": "{name} wurde unerwartet beendet (Code {code})",
  "hooks.game.crashed": "{name} ist abgestürzt",
  "hooks.game.crashReportHint": "Im Absturzbericht steht meist, welche Mod schuld ist.",
  "hooks.game.logHint": "Das Protokoll zeigt, was zuletzt passiert ist.",

  "hooks.screenshot.trashed": "Screenshot in den Papierkorb gelegt",

  "hooks.skin.inLibrary": "„{name}“ liegt jetzt in deiner Bibliothek",
  "hooks.skin.nowWearing": "Du trägst jetzt „{name}“",
  "hooks.skin.wearingDefault": "Du trägst jetzt den Standardskin",
  "hooks.skin.nowWearingCape": "Du trägst jetzt den Umhang „{name}“",
  "hooks.skin.capeRemoved": "Umhang abgelegt",

  "hooks.support.linkCopied": "Link kopiert",
  "hooks.support.logShared": "Log geteilt",
  "hooks.support.debugCopied": "Debug-Info kopiert",
  "hooks.support.debugHint": "Füge sie in deinen Fehlerbericht ein.",

  "hooks.template.saved": "Vorlage „{name}“ gespeichert",
  "hooks.template.savedHint": "Du findest sie unter Neu › Vorlage.",

  "hooks.datapack.added.one": "„{name}“ hinzugefügt",
  "hooks.datapack.added.other": "{count} Datenpakete hinzugefügt",
  "hooks.datapack.trashed": "„{name}“ liegt jetzt im Papierkorb",

  "hooks.world.operationRunning": "Es läuft schon ein Vorgang. Warte, bis er fertig ist.",
  "hooks.world.backupTask": "„{name}“ sichern",
  "hooks.world.backupTaskDone": "„{name}“ gesichert",
  "hooks.world.deleteTask": "„{name}“ löschen",
  "hooks.world.deleteTaskDone": "„{name}“ gelöscht",
  "hooks.world.deletedHint": "„{name}“ gelöscht. Die Sicherung davon findest du unter „Sicherungen“.",
  "hooks.world.restoreTask": "„{name}“ wiederherstellen",
  "hooks.world.restoreTaskDone": "„{name}“ wiederhergestellt",
  "hooks.world.restored": "„{name}“ ist wieder da",
  "hooks.world.restoredInFolder": "„{name}“ ist wieder da, im Ordner „{folder}“",
  "hooks.world.serverRemoved": "„{name}“ entfernt",
} satisfies Dict;
