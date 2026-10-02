import type { Dict } from "../types.ts";

/** Settings: Java & launch, storage, about; plus log sessions, crash hints and the account per instance. */
export const settings = {
  // Tabs and sections
  "settings.tabJava": "Java & launch",
  "settings.tabStorage": "Storage",
  "settings.sectionJava": "Memory & Java",
  "settings.sectionStart": "Game start",
  "settings.sectionInGame": "In the game",
  "settings.sectionReset": "Reset",

  // Memory
  "settings.memory.minLabel": "Minimum memory",
  "settings.memory.minAside": "The heap starts at this size instead of growing into it: fewer stutters at the start. It never starts above the maximum; the launcher caps it there.",
  "settings.memory.minHint": "How much memory Minecraft reserves right at startup. Default for instances without their own value",
  "settings.windowHint": "When the game starts. Default for instances without their own choice",
  "settings.memory.minInstanceHint": "Without a choice, the launcher’s setting applies",
  "settings.memory.manyMods": "With {n} mods you often need 8 GB or more.",
  "settings.memory.fewMods": "With few mods, more than 8 GB rarely helps.",

  // Java
  "settings.java.detected": "Java installations found",
  "settings.java.pickDetected": "Pick a Java found …",

  // JVM arguments
  "settings.jvm.label": "JVM arguments",
  "settings.jvm.hint": "Default for instances without their own",
  "settings.jvm.aside": "An instance’s own arguments replace this preset completely. If you’re not sure what you need, leave “Balanced” selected.",
  "settings.jvm.balanced": "Balanced",
  "settings.jvm.balancedNote": "like the official launcher",
  "settings.jvm.lowLatency": "Low latency",
  "settings.jvm.lowLatencyNote": "G1 flags by Aikar, fewer stutters with lots of RAM",
  "settings.jvm.custom": "Custom",
  "settings.jvm.customNote": "your own text",
  "settings.jvm.shown": "Arguments in use",

  // Launcher behavior at game start
  "settings.onPlay.label": "When the game starts",
  "settings.onPlay.hint": "What happens to the launcher once Minecraft is running",
  "settings.onPlay.keep": "Keep open",
  "settings.onPlay.minimize": "Minimize (it comes back after the game)",
  "settings.onPlay.close": "Close",
  "settings.onPlay.closeWarning": "Without the launcher running, playtime and crash hints aren’t recorded.",

  // Discord
  "settings.discord.label": "Show in Discord",
  "settings.discord.hint": "Shows your friends that you are playing Minecraft, with version, loader and start time. Never the world, server or instance name",
  "settings.discord.aside": "Needs the Discord app on this computer and takes effect from the next game start. The launcher talks to it locally only.",

  // Storage
  "settings.storage.folderSection": "Data folder",
  "settings.storage.location": "Location",
  "settings.storage.locationHint": "Instances, mods, Java and all game files live here",
  "settings.storage.openFolder": "Open folder",
  "settings.storage.free": "Free space",
  "settings.storage.freeOnDrive": "{size} free on the drive",
  "settings.storage.usageSection": "Used space",
  "settings.storage.modCache": "Mod cache",
  "settings.storage.modCacheNote": "Each mod file once, instances link to it",
  "settings.storage.shared": "Shared files",
  "settings.storage.sharedNote": "Libraries, assets, Minecraft versions and Java for all instances",
  "settings.storage.hardlinkNote": "Mods sit in the cache and are linked into the instances: they show up in both rows but take up space only once.",
  "settings.storage.cleanSection": "Clean up",
  "settings.storage.clearLabel": "Clear cache",
  "settings.storage.clearHint": "Only deletes mod files no instance needs any more. Instances, worlds and accounts stay untouched.",
  "settings.storage.clearButton": "Clear cache",
  "settings.storage.unused": "{size} unused",
  "settings.storage.nothingUnused": "Nothing unused",
  "settings.storage.cleared": "{size} freed",
  "settings.storage.nothingToClear": "Nothing to delete: the cache only holds what instances need",
  "settings.storage.loadFailed": "Couldn’t read the storage",

  // About
  "settings.about.license": "License",
  "settings.about.licenseHint": "Pumpkin Launcher is free software under the Apache License 2.0.",
  "settings.about.licenseRead": "Read license",
  "settings.about.source": "Source code",
  "settings.about.sourceHint": "Open on GitHub: read it, report bugs, join in",
  "settings.about.sourceOpen": "View on GitHub",

  // Log: saved sessions
  "settings.log.session": "Session",
  "settings.log.current": "Current session",
  "settings.log.archivedTitle": "Session from {date}",
  "settings.log.archivedNote": "Saved log of this session, it doesn’t change.",
  "settings.log.keptNote": "The console clears on exit; the last {n} sessions stay available to pick.",

  // Crash
  "settings.crash.probably": "Probably: {mods}.",
  "settings.crash.exit.error": "Java reported an error, often caused by a mod or a wrong Java version.",
  "settings.crash.exit.abrupt": "The game ended unexpectedly, often because of a faulty mod or too little memory.",
  "settings.crash.exit.access": "An access error in the game, often caused by the graphics driver or a broken mod.",
  "settings.crash.exit.native": "An error in Java or a driver ended the game, often the graphics driver or an overlay.",
  "settings.crash.exit.memory": "The system ended the game, usually because memory ran out.",
  "settings.crash.exit.killed": "The game was ended from outside.",

  // Account per instance
  "settings.account.label": "Account",
  "settings.account.hint": "This instance starts with it",
  "settings.account.active": "Active account",
  "settings.account.saved": "Account saved",
  "settings.account.microsoft": "Microsoft",
  "settings.account.offline": "Player name",
} satisfies Dict;
