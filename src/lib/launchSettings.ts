// Start-Umgebung: leere Werte, die Grenzen des Backends und die Vorgaben je Betriebssystem.
import { splitArgs } from "./jvm.ts";
import type { EnvVar, LaunchSettings } from "./types";

export const EMPTY_LAUNCH: LaunchSettings = { env: [], wrapper: "", preLaunch: "", postExit: "" };

/** Wie im Backend (`services/launch_settings.rs`, `launch_command.rs`). */
export const MAX_ENV_VARS = 64;
export const MAX_ENV_NAME_LENGTH = 128;
export const MAX_ENV_VALUE_LENGTH = 4096;
export const MAX_COMMAND_LENGTH = 4096;
/** Wie lange der Befehl vor dem Start höchstens läuft (Backend: `PRE_LAUNCH_TIMEOUT`). */
export const PRE_LAUNCH_TIMEOUT_SECONDS = 60;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Namen mit diesem Anfang setzt der Launcher selbst (Backend: `RESERVED_PREFIX`). */
const RESERVED_PREFIX = "PUMPKIN_";

/** Was an einem Namen nicht stimmt; ein leerer Name meldet nichts, solange man noch tippt. */
export type EnvNameProblem = "invalid" | "reserved";

export function envNameProblem(name: string): EnvNameProblem | null {
  if (name === "") return null;
  if (!ENV_NAME.test(name) || name.length > MAX_ENV_NAME_LENGTH) return "invalid";
  return name.toUpperCase().startsWith(RESERVED_PREFIX) ? "reserved" : null;
}

/** Was gespeichert wird: Namen und Befehle ohne Randleerraum, Zeilen ohne Namen (noch nicht fertig) bleiben draußen. */
export const settleLaunch = (draft: LaunchSettings): LaunchSettings => ({
  env: draft.env.filter((row) => row.name.trim() !== "").map((row) => ({ name: row.name.trim(), value: row.value })),
  wrapper: draft.wrapper.trim(),
  preLaunch: draft.preLaunch.trim(),
  postExit: draft.postExit.trim(),
});

export const sameLaunch = (a: LaunchSettings, b: LaunchSettings) =>
  a.wrapper === b.wrapper &&
  a.preLaunch === b.preLaunch &&
  a.postExit === b.postExit &&
  a.env.length === b.env.length &&
  a.env.every((row, index) => row.name === b.env[index]?.name && row.value === b.env[index]?.value);

// ---------- Vorgaben ----------

export type LaunchPresetId = "gamemode" | "mangohud" | "nvidia" | "amd";

export type Os = "windows" | "macos" | "linux";

/** Eine Vorgabe setzt ein Wrapper-Programm oder Umgebungsvariablen (oder beides) und gilt nur auf bestimmten Systemen. */
interface LaunchPreset {
  systems: Os[];
  wrapper?: string;
  env?: EnvVar[];
}

const LAUNCH_PRESETS: Record<LaunchPresetId, LaunchPreset> = {
  gamemode: { systems: ["linux"], wrapper: "gamemoderun" },
  mangohud: { systems: ["linux"], wrapper: "mangohud" },
  nvidia: {
    systems: ["linux"],
    env: [
      { name: "__NV_PRIME_RENDER_OFFLOAD", value: "1" },
      { name: "__GLX_VENDOR_LIBRARY_NAME", value: "nvidia" },
      { name: "__VK_LAYER_NV_optimus", value: "NVIDIA_only" },
    ],
  },
  amd: { systems: ["linux"], env: [{ name: "DRI_PRIME", value: "1" }] },
};

/** Die Vorgaben, die auf diesem Betriebssystem etwas bedeuten. */
export const presetsFor = (os: Os) => (Object.keys(LAUNCH_PRESETS) as LaunchPresetId[]).filter((id) => LAUNCH_PRESETS[id].systems.includes(os));

/** Ob die Vorgabe in den Einstellungen steckt: ihr Wrapper steht in der Befehlszeile, alle ihre Variablen mit ihren Werten in der Liste. */
export function isPresetOn(settings: LaunchSettings, id: LaunchPresetId): boolean {
  const { wrapper, env = [] } = LAUNCH_PRESETS[id];
  const wrapperOn = wrapper === undefined || splitArgs(settings.wrapper).includes(wrapper);
  return wrapperOn && env.every((wanted) => settings.env.some((row) => row.name === wanted.name && row.value === wanted.value));
}

/** Schaltet die Vorgabe ein, wenn sie fehlt, sonst aus; was nicht zu ihr gehört, bleibt. */
export function togglePreset(settings: LaunchSettings, id: LaunchPresetId): LaunchSettings {
  const { wrapper, env } = LAUNCH_PRESETS[id];
  const on = isPresetOn(settings, id);
  return {
    ...settings,
    wrapper: wrapper === undefined ? settings.wrapper : toggledWrapper(settings.wrapper, wrapper, on),
    env: env === undefined ? settings.env : toggledEnv(settings.env, env, on),
  };
}

function toggledWrapper(wrapper: string, program: string, on: boolean): string {
  const words = splitArgs(wrapper);
  return (on ? words.filter((word) => word !== program) : [...words, program]).join(" ");
}

/** Eine Variable des Nutzers mit demselben Namen weicht dem Wert der Vorgabe. */
function toggledEnv(env: EnvVar[], preset: EnvVar[], on: boolean): EnvVar[] {
  const others = env.filter((row) => !preset.some((wanted) => wanted.name === row.name));
  return on ? others : [...others, ...preset];
}
