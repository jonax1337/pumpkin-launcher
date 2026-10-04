import type { Dict } from "../types.ts";

// Einladungen, Beitritt und Mod-Bestätigung (F4). Deutsch ist Quelle der Wahrheit.
export const friendsInvite = {
  // ---------- Meldungen ----------
  "friendsInvite.toast": "{name} lädt dich ein: {title}",
  "friendsInvite.view": "Ansehen",
  "friendsInvite.revoked": "{name} hat das Teilen beendet",
  "friendsInvite.ended": "Beitritt beendet: {reason}",
  "friendsInvite.end.stopped": "Der Gastgeber hat das Teilen beendet.",
  "friendsInvite.end.kicked": "Der Gastgeber hat dich aus der Welt entfernt.",
  "friendsInvite.end.lanClosed": "Der Gastgeber hat die Welt für LAN geschlossen.",
  "friendsInvite.end.hostOffline": "Der Gastgeber ist offline gegangen.",
  "friendsInvite.end.gameExited": "Minecraft wurde beendet.",
  "friendsInvite.end.left": "Du hast den Beitritt verlassen.",
  "friendsInvite.end.disabled": "Freunde wurden ausgeschaltet.",
  "friendsInvite.end.error": "Die Verbindung zur Welt ist fehlgeschlagen.",

  // ---------- Einladungsdialog ----------
  "friendsInvite.title": "Einladung",
  "friendsInvite.invites": "lädt dich in „{title}“ ein",
  "friendsInvite.mods.one": "1 Mod",
  "friendsInvite.mods.other": "{n} Mods",
  "friendsInvite.hostOffline": "Der Gastgeber ist gerade offline.",
  "friendsInvite.planFailed": "Der Abgleich mit deinen Instanzen ist fehlgeschlagen",
  "friendsInvite.offlineAccount": "Beitreten geht nur mit einem Microsoft-Konto, diese Instanz startet aber ohne eines. Wähle in den Instanz-Einstellungen oder oben ein Microsoft-Konto.",
  "friendsInvite.lookupFailed": "Modrinth nicht erreichbar; Client-Mods werden mitgezählt",
  "friendsInvite.unsupported.title": "Erst ab Minecraft {min}",
  "friendsInvite.unsupported.body": "Diese Welt läuft mit Minecraft {version}. Beitreten geht erst ab Minecraft {min}.",

  // Passende Instanz
  "friendsInvite.instance.single": "Passende Instanz: {name}",
  "friendsInvite.instance.label": "Instanz",
  "friendsInvite.instance.pick": "Instanz wählen",

  // Instanz passt nicht
  "friendsInvite.missing.title": "Deine Instanz {name} passt nicht",
  "friendsInvite.missing.body": "Sie hat nicht dieselben Mods wie die Welt.",
  "friendsInvite.missing.listMissing": "Fehlt",
  "friendsInvite.missing.listExtra": "Zusätzlich bei dir",
  "friendsInvite.missing.hint": "Füge die fehlenden Mods hinzu oder entferne die zusätzlichen, dann erneut prüfen.",
  "friendsInvite.missing.recheck": "Erneut prüfen",

  // Keine Instanz
  "friendsInvite.none": "Du hast keine Instanz mit Minecraft {version} und {loader}.",
  "friendsInvite.createVanilla": "Vanilla-Instanz anlegen",
  "friendsInvite.creating": "Wird angelegt …",

  // Aktionen
  "friendsInvite.join": "Beitreten",
  "friendsInvite.decline": "Ablehnen",
  "friendsInvite.later": "Später",

  // ---------- Bitte der Mod ----------
  "friendsInvite.mod.title": "Anfrage aus dem Spiel",
  "friendsInvite.mod.scope.share": "Dieses Spiel möchte deine Welt mit ausgewählten Freunden teilen.",
  "friendsInvite.mod.scope.social": "Dieses Spiel möchte Freunde hinzufügen, Anfragen beantworten und Einladungen annehmen.",
  "friendsInvite.mod.game": "Spiel",
  "friendsInvite.mod.operation": "Vorgang",
  "friendsInvite.mod.allow": "Erlauben (bis Spielende)",
  "friendsInvite.mod.deny": "Ablehnen",
  "friendsInvite.mod.wait": "Erlauben wird gleich frei, damit kein Klick versehentlich zustimmt.",
} satisfies Dict;
