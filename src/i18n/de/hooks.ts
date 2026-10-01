import type { Dict } from "../types.ts";

/** Wörter des Bereichs hooks: Hook-Dateien plus Mock und Fehlermeldungen aus lib/api.ts. */
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
  "hooks.world.deleteTask": "„{name}“ löschen",
  "hooks.world.deletedHint": "„{name}“ gelöscht. Die Sicherung davon findest du unter „Sicherungen“.",
  "hooks.world.restoreTask": "„{name}“ wiederherstellen",
  "hooks.world.restored": "„{name}“ ist wieder da",
  "hooks.world.restoredInFolder": "„{name}“ ist wieder da, im Ordner „{folder}“",
  "hooks.world.serverRemoved": "„{name}“ entfernt",

  "hooks.api.modpacksNeedApp": "Modrinth-Modpacks benötigen die Tauri-App. Im Browser werden keine Modpacks installiert.",
  "hooks.api.onlyInApp": "{what} geht nur in der Pumpkin Launcher-App.",
  "hooks.api.addLocalFiles": "Eigene Dateien hinzufügen",
  "hooks.api.export": "Exportieren",
  "hooks.api.pickFiles": "Dateien auswählen",
  "hooks.api.openFolder": "Ordner öffnen",
  "hooks.api.shareLogs": "Protokolle teilen",
  "hooks.api.addSkinFiles": "Skin-Dateien hinzufügen",
  "hooks.api.openFiles": "Dateien öffnen",
  "hooks.api.restart": "Neu starten",
  "hooks.api.instanceNotFound": "Instanz „{id}“ nicht gefunden",
  "hooks.api.duplicateName": "{name} (Kopie)",
  "hooks.api.templateGone": "Die Vorlage gibt es nicht mehr",
  "hooks.api.versionNotInstalled": "Version {version} ist nicht installiert",
  "hooks.api.alreadyRunning": "Ungültige Eingabe: Instanz läuft bereits",
  "hooks.api.runningGameNotFound": "Laufendes Spiel „{id}“ nicht gefunden",
  "hooks.api.demoLogLine": "Demo-Logzeile {n}",
  "hooks.api.loadTestLine": "Lastzeile {n}",
  "hooks.api.msLoginBrowser": "Melde dich im Browser bei Microsoft an.",
  "hooks.api.msLoginDevice": "Öffne {url} und gib den Code {code} ein.",
  "hooks.api.loginCancelled": "Anmeldung abgebrochen",
  "hooks.import.instanceTaskDone": "{name} importiert",
  "hooks.world.backupTaskDone": "„{name}“ gesichert",
  "hooks.world.deleteTaskDone": "„{name}“ gelöscht",
  "hooks.world.restoreTaskDone": "„{name}“ wiederhergestellt",
} satisfies Dict;
