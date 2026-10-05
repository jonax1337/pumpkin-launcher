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

  // Minecraft-Spielername
  "friendsSettings.nameLabel": "Minecraft-Spielername",
  "friendsSettings.nameHint": "Wird automatisch aus deinem Microsoft-Minecraft-Konto übernommen. Deine Freunde sehen diesen Namen.",
  "friendsSettings.nameUnavailable": "Kein Microsoft-Minecraft-Konto angemeldet",

  // Immer über Relay
  "friendsSettings.relayLabel": "Immer über Relay verbinden",
  "friendsSettings.relayHint": "Freunde sehen deine IP-Adressen nicht. Etwas höhere Latenz.",
  "friendsSettings.relayAside": "Der Relay-Betreiber sieht, wer mit wem verbunden ist, aber keine Inhalte.",
  "friendsSettings.relayConfirmTitle": "Verbindung neu aufbauen?",
  "friendsSettings.relayConfirmText": "Beim Umschalten baut der Launcher die Verbindung neu auf.",
  "friendsSettings.relayConfirmHosting": "Die geteilte Welt, die gerade läuft, wird dabei beendet.",
  "friendsSettings.relayConfirmJoin": "Dein Beitritt zur Welt von {name} wird dabei beendet.",
  "friendsSettings.relayConfirmJoinUnnamed": "Dein Beitritt zu einer geteilten Welt wird dabei beendet.",
  "friendsSettings.relayConfirmButton": "Umschalten",

  // Per Minecraft-Namen auffindbar
  "friendsSettings.findable.label": "Per Minecraft-Namen auffindbar",
  "friendsSettings.findable.hint": "Wer deinen Minecraft-Namen kennt, kann dir Anfragen schicken",
  "friendsSettings.findable.aside": "Das Pumpkin-Verzeichnis speichert dafür nur deine Minecraft-UUID, solange das an ist; aus = sofort gelöscht.",
  "friendsSettings.findable.active": "Auffindbar als {name}",
  "friendsSettings.findable.unreachable": "Verzeichnis nicht erreichbar; neuer Versuch läuft",
  "friendsSettings.findable.notAllowed": "Mojang erlaubt diesem Konto keine Mehrspieler-Funktionen",

  // Freunde-Menü im Spiel
  "friendsSettings.ingameMenu.label": "Freunde-Menü im Spiel",
  "friendsSettings.ingameMenu.hint": "Der Launcher fügt deinen Spielen beim Start ein Freunde-Menü hinzu, wenn Instanz und Konto dazu passen.",
  "friendsSettings.ingameActions.label": "Aktionen im Spiel",
  "friendsSettings.ingameActions.hint": "Bei „Immer fragen“ bestätigst du einmal je Spielstart im Launcher, bei „Erlauben“ darf das Spiel (und jede Mod darin) Freunde hinzufügen, Anfragen beantworten und Welten teilen, ohne zu fragen.",
  "friendsSettings.ingameActions.ask": "Immer fragen",
  "friendsSettings.ingameActions.allow": "Erlauben",

  // Fingerabdruck
  "friendsSettings.fingerprintLabel": "Mein Fingerabdruck",
  "friendsSettings.fingerprintHint": "Gehört fest zu deinem Schlüssel",
  "friendsSettings.fingerprintAside": "Dein Minecraft-Name kann sich ändern, dein Fingerabdruck gehört fest zu deinem Schlüssel. Bei Zweifeln können Freunde ihn mit deinem vergleichen. Für eine Meldung an den Relay-Betreiber kopierst du die vollständige ID.",
  "friendsSettings.copyPeerId": "Vollständige ID kopieren",
  "friendsSettings.peerIdCopied": "ID kopiert",

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
  "friendsSettings.optIn.codes": "Freunde über Codes, die ihr selbst austauscht, oder per Minecraft-Name, wenn die andere Person das erlaubt. Wer dir eine Anfrage schickt, sieht deine IP-Adresse dadurch nicht.",
  "friendsSettings.optIn.addresses": "Verschlüsselte Verbindungen zwischen den Launchern. Bei einer direkten Verbindung sehen deine Freunde deine öffentliche IP-Adresse und die Adressen deiner Netzwerke (Heimnetz, VPN). Auch wer deinen Code einlöst oder dessen Code du einlöst, kann deine Adressen sehen, solange „Immer über Relay“ aus ist. „Immer über Relay“ verhindert das.",
  "friendsSettings.optIn.relays": "Relay-Server: {relays}. Sie leiten verschlüsselte Daten weiter und sehen, wer mit wem verbunden ist, aber keine Inhalte.",
  "friendsSettings.optIn.presence": "Freunde sehen, ob du online bist oder spielst, und deinen Minecraft-Namen samt Skin. Dein Name wird automatisch aus deinem Microsoft-Minecraft-Konto übernommen.",
  "friendsSettings.optIn.noTracking": "Kein Chat, kein Tracking, keine öffentlichen Listen; die Suche per Name findet nur genaue Namen von Leuten, die das eingeschaltet haben. Jederzeit abschaltbar.",
  "friendsSettings.optIn.alwaysRelay": "Immer über Relay verbinden",
  "friendsSettings.optIn.findable": "Per Minecraft-Namen auffindbar sein",
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
  "friendsSettings.privacy.sessionserverProof": "Kontonachweis beim Annehmen einer Anfrage per Name und die Namen der Absender (Profilabfrage per UUID).",
  "friendsSettings.privacy.directoryName": "Freunde-Verzeichnis",
  "friendsSettings.privacy.directory": "Nur wenn du per Name auffindbar bist oder jemandem per Name schreibst: Minecraft-UUID, Anfragen bis {days} Tage. Den öffentlichen Schlüssel des Zertifikats und dessen Signaturen verarbeitet es nur zur Prüfung und speichert sie nicht.",
  "friendsSettings.privacy.nameLookupName": "Minecraft-Namenssuche und Kontonachweis",
  "friendsSettings.privacy.nameLookup": "Name → UUID beim Senden per Name; ein von Mojang signiertes Spielerzertifikat als Kontonachweis für das Verzeichnis, dazu die Multiplayer-Berechtigung des Kontos (Zertifikat und Attribute). Das Zugriffstoken geht nur an Mojang, nie an das Verzeichnis.",

  // Einstellungen › Java & Start
  "friendsSettings.onPlayAside": "Mit aktivierten Freunden wird der Launcher nur minimiert.",
} satisfies Dict;
