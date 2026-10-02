import { useMemo } from "react";
import { useI18n } from "@/i18n";
import { Chip, Tip } from "@/ui";
import { useInstances } from "@/hooks/useInstances";
import { projectOf } from "@/lib/mods";
import type { Instance } from "@/lib/types";

/** Instanzen je Projekt-ID: als Inhalt drin oder als Modpack angelegt. */
export function useInstalledIn() {
  const instances = useInstances();
  return useMemo(() => {
    const map = new Map<string, Instance[]>();
    const add = (id: string, i: Instance) => map.set(id, [...(map.get(id) ?? []), i]);
    for (const i of instances.data ?? []) {
      const ids = new Set(i.mods.map(projectOf).filter((id): id is string => !!id));
      if (i.modpack?.type === "modrinth") ids.add(i.modpack.projectId);
      if (i.modpack?.type === "provider") ids.add(`${i.modpack.source}:${i.modpack.projectId}`);
      ids.forEach((id) => add(id, i));
    }
    return map;
  }, [instances.data]);
}

// Chip-Text bleibt kurz (die Zeile schneidet sonst mitten im Wort ab); der volle Name steht im Tooltip.
const ROW_CHIP_MAX = 28;
const HEAD_CHIP_MAX = 36;

const shortName = (name: string, max: number) => (name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name);

/** „In Survival 1.21“ oder „In 2 Instanzen“; die Namen stehen im Tooltip (für Vorleser als Beschreibung, wenn sie im Chip fehlen). */
function useInstalledLabel(instances: Instance[] | undefined, maxLength: number) {
  const { t } = useI18n();
  if (!instances?.length) return null;
  const one = instances.length === 1;
  const text = shortName(one ? t("components.installedIn.one", { name: instances[0].name }) : t("components.installedIn.other", { n: instances.length }), maxLength);
  return { text, tip: t("components.installedIn.tip", { names: instances.map((i) => i.name).join(", ") }), describe: !one || text.endsWith("…") };
}

/** In der Katalogzeile klein mit Punkt (Metazeile 22 px). */
export function InstalledChipRow({ instances }: { instances?: Instance[] }) {
  const label = useInstalledLabel(instances, ROW_CHIP_MAX);
  return label && <Tip label={label.tip} describe={label.describe}><Chip size="s" dot>{label.text}</Chip></Tip>;
}

/** Im Projektkopf mit Haken. */
export function InstalledChipHead({ instances }: { instances?: Instance[] }) {
  const label = useInstalledLabel(instances, HEAD_CHIP_MAX);
  return label && <Tip label={label.tip} describe={label.describe}><Chip icon="check">{label.text}</Chip></Tip>;
}
