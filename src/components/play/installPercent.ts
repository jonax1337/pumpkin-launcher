import { useGame } from "@/store/game";
import type { Instance, InstallProgress, InstallStep, ModLoader } from "@/lib/types";

// Reihenfolge der Schritte im Backend (`install::install`, mit Loader umrahmt von `instance_install`)
const VANILLA_STEPS: InstallStep[] = ["java", "client", "libraries", "natives", "assets"];
const stepsFor = (loader: ModLoader): InstallStep[] => (loader === "vanilla" ? VANILLA_STEPS : ["loader", ...VANILLA_STEPS, "mods"]);

/** Gesamtfortschritt 0–100: jeder Schritt zählt gleich, innerhalb des Schritts anteilig. */
function overallPercent(p: InstallProgress, steps: InstallStep[]) {
  const index = Math.max(0, steps.indexOf(p.step));
  const within = p.total > 0 ? p.done / p.total : 0;
  return Math.min(100, Math.round(((index + within) / steps.length) * 100));
}

/** Fortschritt einer Instanz in Prozent (null = keine Installation). */
export function useInstallPercent(instance: Instance) {
  const progress = useGame((s) => s.installs[instance.id]);
  return progress ? overallPercent(progress, stepsFor(instance.loader)) : null;
}
