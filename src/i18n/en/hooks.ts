import { hooks as deHooks } from "../de/hooks.ts";

/** Gleiche Schlüssel wie das deutsche Wörterbuch; tsc erzwingt die Vollständigkeit. */
export const hooks: typeof deHooks = {
  "hooks.update.availableToast": "Pumpkin Launcher {version} is here",
  "hooks.update.availableHint": "Install it whenever it suits you.",
  "hooks.update.waitForIdle": "You can restart once Minecraft has closed and no tasks are running.",
  "hooks.update.installFailed": "The update could not be installed",
  "hooks.update.loaded": "Update downloaded",
  "hooks.update.ready": "Update is ready",
  "hooks.update.readyHint": "Pumpkin Launcher will restart to install it.",


  "hooks.import.noNewInFolder": "There are no new instances in this folder.",
  "hooks.import.instanceTask": "Import {name}",


  "hooks.install.doneTask": "{name} installed",
  "hooks.install.readySub": "Ready to play",
  "hooks.install.readyToast": "{name} is ready",
  "hooks.install.cancelled": "Installation of {name} cancelled",
  "hooks.install.failed": "{name} could not be installed",

  "hooks.launch.needPlayerName": "Set a player name first.",
  "hooks.launch.needMicrosoft": "Sign in with your Microsoft account first.",
  "hooks.launch.setPlayerName": "Set player name",

  "hooks.game.exited": "Minecraft closed",
  "hooks.game.exitedPlayed": "Minecraft closed. Time played: {duration}",
  "hooks.game.exitedWithCode": "{name} exited unexpectedly (code {code})",
  "hooks.game.crashed": "{name} has crashed",
  "hooks.game.crashReportHint": "The crash report usually says which mod is at fault.",
  "hooks.game.logHint": "The log shows what happened last.",

  "hooks.screenshot.trashed": "Screenshot moved to the recycle bin",

  "hooks.skin.inLibrary": "“{name}” is now in your library",
  "hooks.skin.nowWearing": "You are now wearing “{name}”",
  "hooks.skin.wearingDefault": "You are now wearing the default skin",
  "hooks.skin.nowWearingCape": "You are now wearing the “{name}” cape",
  "hooks.skin.capeRemoved": "Cape removed",

  "hooks.support.linkCopied": "Link copied",
  "hooks.support.logShared": "Log shared",
  "hooks.support.debugCopied": "Debug info copied",
  "hooks.support.debugHint": "Paste it into your bug report.",

  "hooks.template.saved": "Template “{name}” saved",
  "hooks.template.savedHint": "You’ll find it under New › Template.",

  "hooks.datapack.added.one": "“{name}” added",
  "hooks.datapack.added.other": "{count} datapacks added",
  "hooks.datapack.trashed": "“{name}” is now in the recycle bin",

  "hooks.world.operationRunning": "An operation is already running. Wait for it to finish.",
  "hooks.world.backupTask": "Back up “{name}”",
  "hooks.world.deleteTask": "Delete “{name}”",
  "hooks.world.deletedHint": "“{name}” deleted. You’ll find its backup under “Backups”.",
  "hooks.world.restoreTask": "Restore “{name}”",
  "hooks.world.restored": "“{name}” is back",
  "hooks.world.restoredInFolder": "“{name}” is back, in the folder “{folder}”",
  "hooks.world.serverRemoved": "“{name}” removed",

  "hooks.api.modpacksNeedApp": "Modrinth modpacks require the Tauri app. No modpacks are installed in the browser.",
  "hooks.api.onlyInApp": "{what} only works in the Pumpkin Launcher app.",
  "hooks.api.addLocalFiles": "Adding your own files",
  "hooks.api.export": "Exporting",
  "hooks.api.pickFiles": "Selecting files",
  "hooks.api.openFolder": "Opening folders",
  "hooks.api.shareLogs": "Sharing logs",
  "hooks.api.addSkinFiles": "Adding skin files",
  "hooks.api.openFiles": "Opening files",
  "hooks.api.restart": "Restarting",
  "hooks.api.instanceNotFound": "Instance “{id}” not found",
  "hooks.api.duplicateName": "{name} (Copy)",
  "hooks.api.templateGone": "The template no longer exists",
  "hooks.api.versionNotInstalled": "Version {version} is not installed",
  "hooks.api.alreadyRunning": "Invalid input: instance is already running",
  "hooks.api.runningGameNotFound": "Running game “{id}” not found",
  "hooks.api.demoLogLine": "Demo log line {n}",
  "hooks.api.loadTestLine": "Load-test line {n}",
  "hooks.api.msLoginBrowser": "Sign in to Microsoft in your browser.",
  "hooks.api.msLoginDevice": "Open {url} and enter the code {code}.",
  "hooks.api.loginCancelled": "Sign-in cancelled",
  "hooks.import.instanceTaskDone": "Imported {name}",
  "hooks.world.backupTaskDone": "Backed up “{name}”",
  "hooks.world.deleteTaskDone": "Deleted “{name}”",
  "hooks.world.restoreTaskDone": "Restored “{name}”",
};
