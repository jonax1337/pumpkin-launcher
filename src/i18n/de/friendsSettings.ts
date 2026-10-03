import type { Dict } from "../types.ts";

// Einstellungen, Opt-in und Datenschutzhinweis der Freunde (F3). Deutsch ist Quelle der Wahrheit.
export const friendsSettings = {
  // Reiter und Abschnitte
  "friendsSettings.tab": "Freunde",
  "friendsSettings.sectionGeneral": "Allgemein",
  "friendsSettings.sectionBlocked": "Blockierte",
  "friendsSettings.sectionDanger": "Gefahrenbereich",

  // Nicht verfügbar
  "friendsSettings.noSecretStore": "Auf diesem System gibt es keinen Schlüsselbund (Secret Service); Freunde sind hier nicht verfügbar.",
  "friendsSettings.identityLostTitle": "Identität verloren",
  "friendsSettings.identityLostText": "Deine Freunde-Identität fehlt im Schlüsselbund, etwa nach einer Neuinstallation oder einem Wechsel des Benutzerkontos. Setze sie zurück, um neu zu beginnen. Deine bisherigen Freunde werden dabei gelöscht.",
  "friendsSettings.loadFailed": "Die Freunde-Einstellungen ließen sich nicht laden",

  // Ein- und ausschalten
  "friendsSettings.enableLabel": "Freunde",
  "friendsSettings.enableHint": "Freundescodes, Online-Status und gemeinsam spielen",
  "friendsSettings.enableAside": "Standardmäßig aus. Beim Einschalten zeigt ein Dialog, was Freunde und Relay-Server sehen. Ausschalten behält deine Freunde.",

  // Anzeigename
  "friendsSettings.nameLabel": "Anzeigename",
  "friendsSettings.nameHint": "So sehen dich deine Freunde: {min} bis {max} Zeichen",
  "friendsSettings.nameAside": "Du gibst den Namen selbst an. Freunde sehen ihn zusammen mit deinem Fingerabdruck.",

  // Immer über Relay
  "friendsSettings.relayLabel": "Immer über Relay verbinden",
  "friendsSettings.relayHint": "Freunde sehen deine IP-Adressen nicht. Etwas höhere Latenz.",
  "friendsSettings.relayAside": "Der Relay-Betreiber sieht, wer mit wem verbunden ist, aber keine Inhalte.",
  "friendsSettings.relayConfirmTitle": "Verbindung neu aufbauen?",
  "friendsSettings.relayConfirmText": "Beim Umschalten baut der Launcher die Verbindung neu auf. Die geteilte Welt, die gerade läuft, wird dabei beendet.",
  "friendsSettings.relayConfirmButton": "Umschalten",

  // Fingerabdruck
  "friendsSettings.fingerprintLabel": "Mein Fingerabdruck",
  "friendsSettings.fingerprintHint": "Gehört fest zu deinem Schlüssel",
  "friendsSettings.fingerprintAside": "Namen gibst du selbst an, den Fingerabdruck nicht. Bei Zweifeln können Freunde ihn mit deinem vergleichen.",

  // Netzwerk
  "friendsSettings.networkLabel": "Netzwerk",
  "friendsSettings.networkOnline": "Verbunden über {relayHost}",
  "friendsSettings.networkStarting": "Verbindung wird aufgebaut …",
  "friendsSettings.networkOff": "Nicht verbunden",
  "friendsSettings.networkDegraded": "Getrennt: {reason}",
  "friendsSettings.degraded.relayUnreachable": "Der Relay-Server ist nicht erreichbar",
  "friendsSettings.degraded.bindFailed": "Der Netzwerkanschluss ließ sich nicht öffnen",

  // Blockierte
  "friendsSettings.blockedHint": "Blockierte erreichen dich nicht: keine Anfragen, kein Online-Status.",
  "friendsSettings.blockedNone": "Niemand blockiert.",
  "friendsSettings.blockedSince": "Blockiert am {date}",
  "friendsSettings.unblock": "Entsperren",

  // Identität erneuern und zurücksetzen
  "friendsSettings.rotateLabel": "Identität erneuern",
  "friendsSettings.rotateHint": "Neuer Schlüssel, deine Freunde bleiben",
  "friendsSettings.rotateButton": "Erneuern",
  "friendsSettings.rotateTitle": "Identität erneuern?",
  "friendsSettings.rotateText": "Deine Freunde bekommen die neue Identität automatisch, sobald sie online sind (bis zu 14 Tage). Deine offenen Freundescodes werden widerrufen, und Anfragen, die noch auf Bestätigung warten, werden gelöscht. Läuft gerade eine geteilte Welt oder ein Beitritt, wird er beendet.",
  "friendsSettings.rotated": "Identität erneuert",
  "friendsSettings.resetLabel": "Identität zurücksetzen und alle Freunde löschen",
  "friendsSettings.resetHint": "Löscht Freunde, Anfragen, Codes und Blockierte und legt eine neue Identität an",
  "friendsSettings.resetButton": "Zurücksetzen",
  "friendsSettings.resetTitle": "Identität zurücksetzen?",
  "friendsSettings.resetText": "Alle Freunde, Anfragen, Codes und Blockierten werden gelöscht, und du bekommst eine neue Identität. Deine bisherigen Freunde erfahren das, sobald sie online sind. Das lässt sich nicht rückgängig machen.",
  "friendsSettings.resetDone": "Identität zurückgesetzt",

  // Opt-in
  "friendsSettings.optIn.title": "Freunde aktivieren",
  "friendsSettings.optIn.codes": "Freunde nur über Codes, die ihr selbst austauscht. Wer deinen Code hat, kann dir eine Anfrage schicken; deine IP-Adresse sieht er dadurch nicht.",
  "friendsSettings.optIn.addresses": "Verschlüsselte Verbindungen zwischen den Launchern. Bei einer direkten Verbindung sehen deine Freunde deine öffentliche IP-Adresse und die Adressen deiner Netzwerke (Heimnetz, VPN). Auch wer deinen Code einlöst oder dessen Code du einlöst, kann deine Adressen sehen, solange „Immer über Relay“ aus ist. „Immer über Relay“ verhindert das.",
  "friendsSettings.optIn.relays": "Relay-Server: {relays}. Sie leiten verschlüsselte Daten weiter und sehen, wer mit wem verbunden ist, aber keine Inhalte.",
  "friendsSettings.optIn.presence": "Freunde sehen, ob du online bist oder spielst, und deinen Minecraft-Namen samt Skin (von dir selbst angegeben).",
  "friendsSettings.optIn.noTracking": "Kein Chat, kein Tracking, keine öffentlichen Listen. Jederzeit abschaltbar.",
  "friendsSettings.optIn.nameLabel": "Anzeigename",
  "friendsSettings.optIn.alwaysRelay": "Immer über Relay verbinden",
  "friendsSettings.optIn.thirdParty": "Ich bin einverstanden, dass {operator} ({hosts}) als Relay genutzt wird",
  "friendsSettings.optIn.understood": "Verstanden",
  "friendsSettings.optIn.firewall": "Windows fragt eventuell nach einer Firewall-Freigabe (UDP). Erlaubst du sie in privaten Netzwerken, klappen direkte Verbindungen besser.",
  "friendsSettings.optIn.confirm": "Freunde aktivieren",
  "friendsSettings.optIn.pending": "Wird aktiviert",

  // Betreiber der Relay-Server
  "friendsSettings.operator.pumpkin": "Pumpkin Launcher",
  "friendsSettings.operator.n0": "n0",

  // Datenschutzhinweis (Über)
  "friendsSettings.privacy.relayName": "Freunde-Relay: {operator}",
  "friendsSettings.privacy.relay": "Freunde: verschlüsselte Weiterleitung, keine Inhalte. Nur, wenn du Freunde einschaltest.",
  "friendsSettings.privacy.sessionserverName": "Mojang (Freunde)",
  "friendsSettings.privacy.sessionserver": "Skins deiner Freunde: Der Launcher holt sie mit der Spieler-UUID vom Sessionserver und speichert sie lokal. Die Oberfläche selbst fragt Mojang nie. Nur, wenn du Freunde einschaltest.",

  // Einstellungen › Java & Start
  "friendsSettings.onPlayAside": "Mit aktivierten Freunden wird der Launcher nur minimiert.",
} satisfies Dict;
