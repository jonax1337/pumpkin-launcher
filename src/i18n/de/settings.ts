import type { Dict } from "../types.ts";

/** Einstellungen: Java & Start, Speicher, Über; dazu Protokoll-Sitzungen, Absturz-Hinweise und Konto je Instanz. */
export const settings = {
  // Reiter und Abschnitte
  "settings.tabJava": "Java & Start",
  "settings.tabStorage": "Speicher",
  "settings.sectionJava": "Arbeitsspeicher & Java",
  "settings.sectionStart": "Spielstart",
  "settings.sectionInGame": "Im Spiel",
  "settings.sectionReset": "Zurücksetzen",

  // Arbeitsspeicher
  "settings.memory.minLabel": "Minimaler Arbeitsspeicher",
  "settings.memory.minAside": "Der Heap startet gleich mit dieser Größe, statt erst zu wachsen: weniger Ruckler zu Beginn. Über dem Maximum startet er nie, der Launcher begrenzt darauf.",
  "settings.memory.minHint": "So viel Speicher reserviert Minecraft gleich beim Start. Standard für Instanzen ohne eigenen Wert",
  "settings.windowHint": "Beim Start des Spiels. Standard für Instanzen ohne eigene Wahl",
  "settings.memory.minInstanceHint": "Ohne Wahl gilt die Einstellung des Launchers",
  "settings.memory.manyMods": "Mit {n} Mods brauchst du oft 8 GB oder mehr.",
  "settings.memory.fewMods": "Mit wenigen Mods bringt mehr als 8 GB selten etwas.",

  // Java
  "settings.java.detected": "Gefundene Java-Installationen",
  "settings.java.pickDetected": "Gefundene Java wählen …",

  // JVM-Argumente
  "settings.jvm.label": "JVM-Argumente",
  "settings.jvm.hint": "Standard für Instanzen ohne eigene",
  "settings.jvm.aside": "Eigene Argumente einer Instanz ersetzen diese Vorgabe ganz. Wer nicht weiß, was er braucht, lässt „Ausgewogen“ stehen.",
  "settings.jvm.balanced": "Ausgewogen",
  "settings.jvm.balancedNote": "wie der offizielle Launcher",
  "settings.jvm.lowLatency": "Niedrige Latenz",
  "settings.jvm.lowLatencyNote": "G1-Flags nach Aikar, weniger Ruckler bei viel RAM",
  "settings.jvm.custom": "Eigene",
  "settings.jvm.customNote": "dein eigener Text",
  "settings.jvm.shown": "Verwendete Argumente",

  // Verhalten des Launchers beim Spielstart
  "settings.onPlay.label": "Beim Spielstart",
  "settings.onPlay.hint": "Was mit dem Launcher passiert, sobald Minecraft läuft",
  "settings.onPlay.keep": "Offen lassen",
  "settings.onPlay.minimize": "Minimieren (nach dem Spiel kommt er zurück)",
  "settings.onPlay.close": "Schließen",
  "settings.onPlay.closeWarning": "Ohne laufenden Launcher werden Spielzeit und Absturzhinweise nicht erfasst.",

  // Discord
  "settings.discord.label": "In Discord anzeigen",
  "settings.discord.hint": "Zeigt deinen Freunden, dass du Minecraft spielst, mit Version, Loader und Startzeit. Nie Welt, Server oder Instanzname",
  "settings.discord.aside": "Braucht die Discord-App auf diesem Computer und wirkt ab dem nächsten Spielstart. Der Launcher spricht nur lokal mit ihr.",

  // Speicher
  "settings.storage.folderSection": "Datenordner",
  "settings.storage.location": "Speicherort",
  "settings.storage.locationHint": "Hier liegen Instanzen, Mods, Java und alle Spieldateien",
  "settings.storage.openFolder": "Ordner öffnen",
  "settings.storage.free": "Freier Platz",
  "settings.storage.freeOnDrive": "{size} frei auf dem Laufwerk",
  "settings.storage.usageSection": "Belegter Platz",
  "settings.storage.modCache": "Mod-Cache",
  "settings.storage.modCacheNote": "Jede Mod-Datei einmal, die Instanzen verlinken sie",
  "settings.storage.shared": "Geteilte Dateien",
  "settings.storage.sharedNote": "Libraries, Assets, Minecraft-Versionen und Java für alle Instanzen",
  "settings.storage.hardlinkNote": "Mods liegen im Cache und sind in den Instanzen verlinkt: Sie stehen in beiden Zeilen, belegen aber nur einmal Platz.",
  "settings.storage.cleanSection": "Aufräumen",
  "settings.storage.clearLabel": "Cache leeren",
  "settings.storage.clearHint": "Löscht nur Mod-Dateien, die keine Instanz mehr braucht. Instanzen, Welten und Konten bleiben unberührt.",
  "settings.storage.clearButton": "Cache leeren",
  "settings.storage.unused": "{size} ungenutzt",
  "settings.storage.nothingUnused": "Nichts Ungenutztes",
  "settings.storage.cleared": "{size} freigegeben",
  "settings.storage.nothingToClear": "Nichts zu löschen: Im Cache liegt nur, was Instanzen brauchen",
  "settings.storage.loadFailed": "Der Speicher ließ sich nicht auslesen",

  // Über
  "settings.about.license": "Lizenz",
  "settings.about.licenseHint": "Pumpkin Launcher ist freie Software unter der Apache License 2.0.",
  "settings.about.licenseRead": "Lizenz lesen",
  "settings.about.source": "Quellcode",
  "settings.about.sourceHint": "Offen auf GitHub: lesen, Fehler melden, mitmachen",
  "settings.about.sourceOpen": "Auf GitHub ansehen",

  // Protokoll: gesicherte Sitzungen
  "settings.log.session": "Sitzung",
  "settings.log.current": "Aktuelle Sitzung",
  "settings.log.archivedTitle": "Sitzung vom {date}",
  "settings.log.archivedNote": "Gesichertes Protokoll dieser Sitzung, es ändert sich nicht.",
  "settings.log.keptNote": "Die Konsole leert sich beim Schließen; die letzten {n} Sitzungen bleiben zur Auswahl.",

  // Absturz
  "settings.crash.probably": "Wahrscheinlich: {mods}.",
  "settings.crash.exit.error": "Java hat einen Fehler gemeldet, oft durch eine Mod oder eine unpassende Java-Version.",
  "settings.crash.exit.abrupt": "Das Spiel wurde unerwartet beendet, oft durch einen Fehler in einer Mod oder zu wenig Arbeitsspeicher.",
  "settings.crash.exit.access": "Ein Zugriffsfehler im Spiel, oft durch den Grafiktreiber oder eine defekte Mod.",
  "settings.crash.exit.native": "Ein Fehler in Java oder im Treiber hat das Spiel beendet, oft der Grafiktreiber oder ein Overlay.",
  "settings.crash.exit.memory": "Das System hat das Spiel beendet, meist weil der Arbeitsspeicher voll war.",
  "settings.crash.exit.killed": "Das Spiel wurde von außen beendet.",

  // Konto je Instanz
  "settings.account.label": "Konto",
  "settings.account.hint": "Damit startet diese Instanz",
  "settings.account.active": "Aktives Konto",
  "settings.account.saved": "Konto gespeichert",
  "settings.account.microsoft": "Microsoft",
  "settings.account.offline": "Spielername",
} satisfies Dict;
