// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { Backend } from "./backend";
import { applyProfile, captureProfile, cleanProfileName, MAX_PROFILE_NAME_LENGTH, MAX_PROFILES, profileNamed } from "./modProfiles";
import { clone, findInstance, newId, wait, type MockContext } from "./mock-util";
import type { Instance, ModProfile } from "./types";

const validName = (raw: string) => {
  const name = cleanProfileName(raw);
  if (!name) throw new Error(t("errors.profiles.nameInvalid", { max: MAX_PROFILE_NAME_LENGTH }));
  return name;
};

const profileOf = (instance: Instance, profileId: string): ModProfile => {
  const profile = instance.modProfiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(t("errors.profiles.notFound"));
  return profile;
};

/** Profile der Inhalte wie `services::mod_profiles`: alles nur im Speicher. */
export function createProfileMock({ db }: MockContext) {
  return {
    async modProfileSave(instanceId, rawName) {
      await wait();
      const inst = findInstance(db, instanceId);
      const name = validName(rawName);
      const existing = profileNamed(inst.modProfiles, name);
      if (!existing && inst.modProfiles.length >= MAX_PROFILES) throw new Error(t("errors.profiles.tooMany", { max: MAX_PROFILES }));
      const profile = captureProfile(existing?.id ?? newId("profile"), name, inst.mods);
      inst.modProfiles = existing ? inst.modProfiles.map((p) => (p === existing ? profile : p)) : [...inst.modProfiles, profile];
      inst.activeModProfile = profile.id;
      return clone(inst);
    },
    async modProfileApply(instanceId, profileId) {
      await wait();
      const inst = findInstance(db, instanceId);
      if (db.running.has(instanceId)) throw new Error(t("errors.instance.stillRunning"));
      const profile = profileOf(inst, profileId);
      inst.mods = applyProfile(inst.mods, profile);
      inst.activeModProfile = profile.id;
      return clone(inst);
    },
    async modProfileRename(instanceId, profileId, rawName) {
      await wait();
      const inst = findInstance(db, instanceId);
      const name = validName(rawName);
      profileOf(inst, profileId);
      const clash = profileNamed(inst.modProfiles, name);
      if (clash && clash.id !== profileId) throw new Error(t("errors.profiles.nameTaken", { name }));
      inst.modProfiles = inst.modProfiles.map((p) => (p.id === profileId ? { ...p, name } : p));
      return clone(inst);
    },
    async modProfileDelete(instanceId, profileId) {
      await wait();
      const inst = findInstance(db, instanceId);
      profileOf(inst, profileId);
      inst.modProfiles = inst.modProfiles.filter((p) => p.id !== profileId);
      if (inst.activeModProfile === profileId) inst.activeModProfile = null;
      return clone(inst);
    },
  } satisfies Partial<Backend>;
}
