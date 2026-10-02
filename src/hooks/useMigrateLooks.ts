import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Instance } from "@/lib/types";
import { useLookStore } from "@/store/look";
import { instanceKeys } from "./queryKeys";
import { useInstances } from "./useInstances";

/** Instanzen, deren Altbestand gerade übertragen wird: eine neue Instanzliste mittendrin startet es nicht doppelt. */
const migrating = new Set<string>();

/** Überträgt Szene und Icon, die ältere Versionen nur im localStorage hielten, ins Instanzmodell; schon Gesetztes bleibt. */
async function migrate(instance: Instance) {
  const { looks, icons, forgetLegacy } = useLookStore.getState();
  const look = looks[instance.id];
  const icon = icons[instance.id];
  if (look && !instance.scene) await api.setInstanceScene(instance.id, { biome: look.bio, seed: look.seed });
  if (icon && !instance.icon) await api.setInstanceIcon(instance.id, icon);
  forgetLegacy(instance.id);
}

/**
 * Übernimmt einmal je Instanz, was Versionen vor dem Instanzmodell lokal gemerkt haben (Szene und Icon), damit es mit
 * Export, Duplizieren und Sicherung der Instanzen mitkommt. Scheitert das, bleibt der Altbestand für den nächsten Start.
 * Werte zu Instanzen, die es nicht mehr gibt, fallen weg.
 */
export function useMigrateLooks() {
  const qc = useQueryClient();
  const instances = useInstances().data;
  useEffect(() => {
    if (!instances) return;
    const { looks, icons, forgetLegacy } = useLookStore.getState();
    const known = new Set(instances.map((i) => i.id));
    [...Object.keys(looks), ...Object.keys(icons)].filter((id) => !known.has(id)).forEach(forgetLegacy);
    for (const instance of instances.filter((i) => (looks[i.id] || icons[i.id]) && !migrating.has(i.id))) {
      migrating.add(instance.id);
      migrate(instance)
        .then(() => qc.invalidateQueries({ queryKey: instanceKeys.all }))
        .catch(console.error)
        .finally(() => migrating.delete(instance.id));
    }
  }, [instances, qc]);
}
