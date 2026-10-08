import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { derivePhase, type Phase } from "@/components/play/phase";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { byRecent, instanceStatusQuery, useInstances } from "@/hooks/useInstances";
import { useReducedMotion } from "@/hooks/useMediaQuery";
import { t } from "@/i18n";
import { instanceUrl } from "@/lib/routes";
import type { Instance } from "@/lib/types";
import { useFriendsNav } from "@/pages/friends/useFriendsNav";
import { settingsSectionUrl } from "@/pages/settings/sections";
import { useGame } from "@/store/game";
import { useSettings } from "@/store/settings";
import { askStop } from "@/store/stopAsk";
import { useUpdateRun } from "@/store/updateRun";
import type { PaletteItem } from "./paletteModel";
import { actionItems, instanceItems, navigationItems, type InstanceActions } from "./paletteProviders";

/** Die Phase jeder Instanz, berechnet wie beim Spielen-Knopf (`usePhase`), nur für alle Instanzen auf einmal. */
function useInstancePhases(instances: Instance[]): Record<string, Phase> {
  const statuses = useQueries({ queries: instances.map((instance) => instanceStatusQuery(instance.id)) });
  const installs = useGame((s) => s.installs);
  const launching = useGame((s) => s.launching);
  const crashes = useGame((s) => s.crashes);
  return Object.fromEntries(
    instances.map((instance, at): [string, Phase] => [
      instance.id,
      derivePhase({
        preparing: instance.id in installs,
        launching: instance.id in launching,
        crashed: instance.id in crashes,
        status: statuses[at],
      }),
    ]),
  );
}

/** Warum eine Suche nach Updates gerade nicht startet; sonst undefined. */
function updateBlockedReason(searching: boolean, installing: boolean) {
  if (installing) return t("palette.updateBusy");
  return searching ? t("components.update.searching") : undefined;
}

/**
 * Alle Befehle der Palette aus den bestehenden Hooks und Speichern: Instanzen, Navigation, Aktionen. Nur in der geöffneten
 * Palette einhängen: die Statusabfragen aller Instanzen laufen nur, solange sie offen ist.
 * `play` startet wie der Spielen-Knopf (`usePlay`); es gehört einer Komponente, die das Schließen der Palette überlebt.
 */
export function usePaletteCommands(play: InstanceActions["play"]): PaletteItem[] {
  const navigate = useNavigate();
  const instances = [...(useInstances().data ?? [])].sort(byRecent);
  const phases = useInstancePhases(instances);
  const friendsHidden = useFriendsNav().hidden;
  const update = useAppUpdate();
  const installingUpdate = useUpdateRun((s) => s.phase !== "idle");
  const motion = useSettings((s) => s.motion);
  const textSize = useSettings((s) => s.textSize);
  const systemReducesMotion = useReducedMotion();

  const instanceActions: InstanceActions = {
    phaseOf: (instanceId) => phases[instanceId] ?? "loading",
    open: (instance) => navigate(instanceUrl(instance.id)),
    play,
    stop: askStop,
  };
  const checkForUpdates = () => {
    void update.refetch();
    navigate(settingsSectionUrl("ueber"));
  };

  return [
    ...instanceItems(instances, instanceActions),
    ...navigationItems(navigate, friendsHidden),
    ...actionItems({
      go: navigate,
      checkForUpdates,
      updateBlockedReason: updateBlockedReason(update.isFetching, installingUpdate),
      motion,
      systemReducesMotion,
      textSize,
    }),
  ];
}
