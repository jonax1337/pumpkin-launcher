import { palette as dePalette } from "../de/palette.ts";

/** Gleiche Schlüssel wie das deutsche Wörterbuch; tsc erzwingt die Vollständigkeit. */
export const palette: typeof dePalette = {
  "palette.title": "Command palette",
  "palette.shortcut": "Open command palette",
  "palette.inputLabel": "Search commands, instances and pages",
  "palette.placeholder": "Search commands, instances or pages…",
  "palette.listLabel": "Results",
  "palette.hint": "Arrow keys select, Enter runs.",
  "palette.key.enter": "Enter",
  "palette.noResults": "No results for “{query}”",
  "palette.results.one": "{count} result",
  "palette.results.other": "{count} results",

  "palette.group.recent": "Recent",
  "palette.group.instances": "Instances",
  "palette.group.navigation": "Navigation",
  "palette.group.actions": "Actions",
  "palette.group.search": "Search",

  // Instances
  "palette.play": "Play {name}",
  "palette.playLast": "Play last: {name} – {target}",
  "palette.stop": "Stop {name}",
  "palette.open": "Open {name}",
  "palette.kw.play": "launch start run game",
  "palette.kw.resume": "resume continue last world server quick play quickplay",
  "palette.kw.stop": "quit exit close kill",
  "palette.kw.open": "show details instance",

  // Navigation
  "palette.settingsTab": "Settings: {name}",
  "palette.kw.navigate": "go to switch open page area",
  "palette.kw.settings": "settings preferences options configuration",

  // Actions
  "palette.newInstance": "Create new instance",
  "palette.kw.newInstance": "new instance create add",
  "palette.import": "Import instances from another launcher",
  "palette.kw.import": "import migrate other launcher instances",
  "palette.checkUpdates": "Check for launcher updates",
  "palette.updateBusy": "An update is being downloaded or installed",
  "palette.kw.checkUpdates": "update upgrade new version launcher check",
  "palette.openDataFolder": "Open data folder",
  "palette.kw.openDataFolder": "folder data directory explorer files launcher",
  "palette.openInstancesFolder": "Open instances folder",
  "palette.kw.openInstancesFolder": "folder instances directory explorer files",
  "palette.motionOff": "Turn off animated scenes",
  "palette.motionOn": "Turn on animated scenes",
  "palette.kw.motion": "animation motion scenes buddy reduce",
  "palette.textSize": "Change text size",
  "palette.textSizeChange": "{from} → {to}",
  "palette.kw.textSize": "font size text zoom scale",

  // Search
  "palette.searchDiscover": "Search Discover for “{query}”",
};
