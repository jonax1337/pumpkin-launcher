import { useState } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { Instance, ModLoader } from "@/lib/types";
import { useCreateInstance, useVersions } from "./useInstances";
import { usePlay } from "./usePlay";

/** Sodium in Modrinth: Das Onboarding legt „Fabric mit Mods“ um diesen Mod herum an. */
const SODIUM_PROJECT_ID = "AANobbMI";

/**
 * Die Instanzen, mit denen das Onboarding startet: Vanilla mit der neuesten Version oder Fabric mit Sodium.
 * Beide legen die Instanz an und starten sie gleich; `busy` gilt, bis das Anlegen fertig ist.
 */
export function useStarterInstance() {
  const versions = useVersions();
  const create = useCreateInstance();
  const play = usePlay();
  const [busy, setBusy] = useState(false);
  const releases = versions.data?.filter((v) => v.type === "release").map((v) => v.id) ?? [];

  async function createAndPlay(build: () => Promise<Instance>) {
    setBusy(true);
    try {
      void play(await build());
    } catch (err) {
      toast.error(t("components.onboarding.goFailed"), { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  const newInstance = (name: string, minecraftVersion: string, loader: ModLoader) =>
    create.mutateAsync({ name, minecraftVersion, loader, loaderVersion: null, memoryMb: null });

  const vanilla = () => createAndPlay(() => newInstance(`Minecraft ${releases[0]}`, releases[0], "vanilla"));

  /** Neueste Minecraft-Version, für die es Sodium schon gibt; Release-Versionen von Sodium bevorzugt. */
  async function fabricWithSodium() {
    const sodium = await api.modrinthVersions(SODIUM_PROJECT_ID, null, "fabric");
    const ranked = [...sodium.filter((v) => v.version_type === "release"), ...sodium];
    const minecraftVersion = releases.find((r) => ranked.some((v) => v.game_versions.includes(r)));
    const version = ranked.find((v) => minecraftVersion && v.game_versions.includes(minecraftVersion));
    if (!minecraftVersion || !version) throw new Error(t("components.onboarding.noSodium"));
    const instance = await newInstance(`Fabric ${minecraftVersion}`, minecraftVersion, "fabric");
    return api.modrinthInstallMod(instance.id, version.id, crypto.randomUUID());
  }

  return { busy, ready: releases.length > 0, vanilla, mods: () => createAndPlay(fabricWithSodium) };
}
