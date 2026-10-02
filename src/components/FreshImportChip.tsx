import { useEffect, useRef } from "react";
import { Chip } from "@/ui";
import { useI18n } from "@/i18n";
import { useFreshImports } from "@/store/freshImports";

/** Ist die Instanz gerade importiert worden? */
export const useIsFreshImport = (instanceId: string) => useFreshImports((s) => s.ids.includes(instanceId));

/** „Neu importiert“; die erste der Importierten rückt ins Bild, damit sie in einer langen Bibliothek nicht untergeht. */
export function FreshImportChip({ instanceId }: { instanceId: string }) {
  const { t } = useI18n();
  const first = useFreshImports((s) => s.ids[0] === instanceId);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (first) ref.current?.scrollIntoView({ block: "nearest" });
  }, [first]);
  return (
    <Chip ref={ref} tone="acc" icon="plus">
      {t("pages.instances.justImported")}
    </Chip>
  );
}
