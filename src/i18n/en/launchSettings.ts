import { launchSettings as deLaunchSettings } from "../de/launchSettings.ts";

/** Gleiche Schlüssel wie das deutsche Wörterbuch; tsc erzwingt die Vollständigkeit. */
export const launchSettings: typeof deLaunchSettings = {
  "launchSettings.section": "Launch environment",
  "launchSettings.saved": "Launch environment saved",
  "launchSettings.infoAside": "Environment variables, a wrapper such as GameMode or MangoHud, and commands before launch and after exit. Each instance can set its own; whatever it leaves empty comes from here.",

  "launchSettings.scope.instance": "Empty fields inherit the launcher default.",
  "launchSettings.scope.launcher": "Applies to instances with no value of their own.",

  "launchSettings.presets.label": "Presets",
  "launchSettings.presets.hint": "One click adds the wrapper or variables, a second click removes them again. The program must be installed.",
  "launchSettings.preset.gamemode": "GameMode",
  "launchSettings.preset.mangohud": "MangoHud",
  "launchSettings.preset.nvidia": "NVIDIA graphics card",
  "launchSettings.preset.amd": "AMD graphics card",

  "launchSettings.env.label": "Environment variables",
  "launchSettings.env.hint": "Apply to the game only. Names of letters, digits and _, at most {max} variables.",
  "launchSettings.env.name": "Variable name",
  "launchSettings.env.value": "Variable value",
  "launchSettings.env.remove": "Remove variable {name}",
  "launchSettings.env.removeEmpty": "Remove empty variable",
  "launchSettings.env.add": "Add variable",
  "launchSettings.env.nameInvalid": "A name may only contain letters, digits and _, and must not start with a digit.",
  "launchSettings.env.nameReserved": "The launcher sets names starting with PUMPKIN_ itself.",

  "launchSettings.wrapper.label": "Wrapper command",
  "launchSettings.wrapper.hint": "Goes in front of the Java call, such as gamemoderun or mangohud. A program and its arguments; quotes group spaces. No shell is involved.",

  "launchSettings.preLaunch.label": "Command before launch",
  "launchSettings.preLaunch.hint": "Runs in the game folder before Minecraft starts. If it fails or takes longer than {seconds} seconds, the game does not launch.",
  "launchSettings.preLaunch.consent": "Wrappers and commands run programs with your rights. Only enter what you know and trust. Modpacks, templates and imports never set them.",
  "launchSettings.postExit.label": "Command after exit",
  "launchSettings.postExit.hint": "Runs in the background once Minecraft has closed. A failure is only logged.",
  "launchSettings.hooks.variables": "The commands see PUMPKIN_INSTANCE_ID, PUMPKIN_INSTANCE_NAME, PUMPKIN_GAME_DIR, PUMPKIN_MC_VERSION and PUMPKIN_LOADER; the command after exit also sees PUMPKIN_EXIT_CODE.",
};
