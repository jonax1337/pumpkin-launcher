import { useI18n } from "@/i18n";
import { Segmented } from "@/ui";
import { KIND_LABEL_KEYS } from "@/lib/catalog";
import type { Mod, ModKind } from "@/lib/types";
import type { KindFilter as KindFilterValue } from "./types";

/** Anzahl der Inhalte je Art. */
export function countByKind(mods: Mod[]) {
  const counts = { all: mods.length, mod: 0, shader: 0, resourcepack: 0 };
  for (const mod of mods) counts[mod.kind]++;
  return counts;
}

/** Filter nach Art (Alle, Mods, Shader, Ressourcenpakete) mit der Anzahl je Art. */
export function KindFilter({ value, onChange, counts }: {
  value: KindFilterValue; onChange: (kind: KindFilterValue) => void; counts: ReturnType<typeof countByKind>;
}) {
  const { t } = useI18n();
  // Leere Filter gedämpft, aber lesbar (--fg-3, ≥ 4,5:1).
  const labelOf = (kind: ModKind) => {
    const label = t(KIND_LABEL_KEYS[kind]);
    return counts[kind] ? label : <span className="st-muted">{label}</span>;
  };
  return (
    <Segmented
      size="s"
      label={t("components.sheet.kindLabel")}
      value={value}
      onChange={onChange}
      items={[
        { value: "all", label: t("common.all"), count: counts.all },
        { value: "mod", label: labelOf("mod"), count: counts.mod },
        { value: "shader", label: labelOf("shader"), count: counts.shader },
        { value: "resourcepack", label: labelOf("resourcepack"), count: counts.resourcepack },
      ]}
    />
  );
}
