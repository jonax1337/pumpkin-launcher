import type { Instance, Mod, ModProfile } from "./types";

/** Wie im Backend (`services::mod_profiles`): längster Profilname in Zeichen und höchste Zahl Profile je Instanz. */
export const MAX_PROFILE_NAME_LENGTH = 40;
export const MAX_PROFILES = 20;

/** Ressourcenpakete schaltet das Spiel selbst (siehe `useContentActions`); sie gehören in kein Profil. */
const isProfiled = (mod: Mod) => mod.kind !== "resourcepack";

/** Der Name ohne Randleerraum; null, wenn er leer oder zu lang ist. */
export function cleanProfileName(raw: string): string | null {
  const name = raw.trim();
  return name.length > 0 && [...name].length <= MAX_PROFILE_NAME_LENGTH ? name : null;
}

/** Das Profil mit diesem Namen (ohne Rücksicht auf Groß- und Kleinschreibung): Speichern überschreibt es. */
export const profileNamed = (profiles: ModProfile[], name: string) =>
  profiles.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());

export const activeProfileOf = (instance: Pick<Instance, "modProfiles" | "activeModProfile">) =>
  instance.modProfiles.find((p) => p.id === instance.activeModProfile);

/** Schnappschuss der schaltbaren Inhalte: was an ist und was überhaupt da war. */
export function captureProfile(id: string, name: string, mods: Mod[]): ModProfile {
  const switchable = mods.filter(isProfiled);
  return { id, name, enabledIds: switchable.filter((m) => m.enabled).map((m) => m.id), knownIds: switchable.map((m) => m.id) };
}

/**
 * Die Inhalte nach dem Anwenden des Profils: was es als an kennt, ist an, was es kannte und als aus speicherte, ist aus.
 * Spätere Inhalte und das Festhalten bleiben, wie sie sind; geänderte Einträge sind neue Objekte, die übrigen dieselben.
 */
export function applyProfile(mods: Mod[], profile: ModProfile): Mod[] {
  const enabled = new Set(profile.enabledIds);
  const known = new Set(profile.knownIds);
  return mods.map((mod) => {
    if (!isProfiled(mod)) return mod;
    const on = enabled.has(mod.id) || (!known.has(mod.id) && mod.enabled);
    return on === mod.enabled ? mod : { ...mod, enabled: on };
  });
}

/** Wie viele Inhalte das Anwenden des Profils umschalten würde. */
export const changeCount = (mods: Mod[], profile: ModProfile) => applyProfile(mods, profile).filter((mod, i) => mod !== mods[i]).length;

/** Das aktive Profil gilt als geändert, sobald Anwenden etwas umschalten würde. */
export function isModified(instance: Pick<Instance, "mods" | "modProfiles" | "activeModProfile">): boolean {
  const active = activeProfileOf(instance);
  return !!active && changeCount(instance.mods, active) > 0;
}
