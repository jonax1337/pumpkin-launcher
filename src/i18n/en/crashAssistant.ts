import { crashAssistant as deCrashAssistant } from "../de/crashAssistant.ts";

/** Gleiche Schlüssel wie das deutsche Wörterbuch; tsc erzwingt die Vollständigkeit. */
export const crashAssistant: typeof deCrashAssistant = {
  "crashAssistant.heading": "What happened?",
  "crashAssistant.loadFailed": "Analyzing the crash failed.",
  "crashAssistant.evidence": "Excerpt from the report",
  "crashAssistant.severity.error": "Cause found",
  "crashAssistant.severity.warning": "Probable",
  "crashAssistant.severity.info": "Note",

  "crashAssistant.outOfMemory.title": "Minecraft ran out of memory",
  "crashAssistant.outOfMemory.body": "The game’s memory was full. It had {current}; with {suggested} it has more room.",
  "crashAssistant.outOfMemoryAtLimit.body":
    "This PC cannot give the instance more than {limit}, and it already has {current}. Remove mods, lower the render distance or close other programs.",
  "crashAssistant.javaVersion.title": "Wrong Java version",
  "crashAssistant.javaVersion.body":
    "The game or a mod needs Java {javaMajor} or newer but ran with an older version. Pumpkin Launcher normally picks the right Java itself; a custom Java path overrides that.",
  "crashAssistant.javaVersionUnknown.body":
    "The game or a mod was built for a newer Java than the one it ran with. Pumpkin Launcher normally picks the right Java itself; a custom Java path overrides that.",
  "crashAssistant.missingDependency.title": "A mod needs another mod",
  "crashAssistant.missingDependency.body":
    "Missing: {dependencies}. Search for the missing mod or switch off the mod that needs it.",
  "crashAssistant.mixinFailure.title": "A mod does not fit the game",
  "crashAssistant.mixinFailure.body":
    "A mod could not hook into Minecraft. It usually does not match the Minecraft version or clashes with another mod. Update it or switch it off.",
  "crashAssistant.duplicateMods.title": "A mod is installed twice",
  "crashAssistant.duplicateMods.body": "The same mod is in two files. Switch one of them off.",
  "crashAssistant.graphicsDriver.title": "The graphics driver does not support OpenGL",
  "crashAssistant.graphicsDriver.body":
    "Minecraft could not open a window because the graphics driver does not provide OpenGL. Update your graphics card driver (Intel, AMD or NVIDIA) and restart. Minecraft often does not start at all over Remote Desktop or in a virtual machine.",
  "crashAssistant.portInUse.title": "A network port is already in use",
  "crashAssistant.portInUse.body":
    "Minecraft tried to open a port that another program already uses, often a second Minecraft or a server. Close the other program or choose another port.",
  "crashAssistant.gameFiles.title": "Game files are damaged or missing",
  "crashAssistant.gameFiles.body":
    "A file of Minecraft or its libraries cannot be read. Repair downloads it again; worlds and mods are kept.",
  "crashAssistant.suspectMods.title": "These mods may be the cause",
  "crashAssistant.suspectMods.body":
    "Probably: {mods}. This is a hint, not a verdict: switch them off one at a time and try again.",

  "crashAssistant.action.raiseMemory": "Raise to {memory}",
  "crashAssistant.action.useManagedJava": "Remove custom Java",
  "crashAssistant.action.installDependency": "Search for “{query}”",
  "crashAssistant.action.disableMod": "Switch off {name}",
  "crashAssistant.action.openUrl": "Open help page",
  "crashAssistant.action.reinstallGameFiles": "Repair game files",

  "crashAssistant.done.raiseMemory": "Memory set to {memory}",
  "crashAssistant.done.useManagedJava": "Custom Java path removed",
  "crashAssistant.done.disableMod": "{name} switched off",
  "crashAssistant.modGone": "This mod is no longer in the instance.",
};
