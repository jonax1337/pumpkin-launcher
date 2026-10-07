import { toast } from "sonner";
import { t } from "@/i18n";
import type { Mod } from "@/lib/types";

/** So lange (ms) bleibt der Toast mit „Rückgängig“ stehen. */
const REMOVED_TOAST_MS = 6500;

/**
 * Toast „Sodium entfernt“ bzw. „3 Inhalte und 2 Abhängigkeiten entfernt“ mit „Rückgängig“. `requestedIds` sind die
 * gewählten Inhalte, `removed` alles, was mit ging. Reine Meldung, deshalb Modul-`t`.
 */
export function showRemovedToast({ removed, requestedIds, titleOf, onUndo }: {
  removed: Mod[]; requestedIds: string[]; titleOf: (mod: Mod) => string; onUndo: () => void;
}) {
  const requested = removed.filter((m) => requestedIds.includes(m.id));
  const dependencies = removed.length - requested.length;
  const things = requested.length === 1
    ? titleOf(requested[0])
    : t("detail.content.itemsCount.other", { n: requested.length });
  const text = dependencies
    ? t("detail.content.removedToastWithDeps", {
        things,
        deps: t(dependencies === 1 ? "detail.content.dependencies.one" : "detail.content.dependencies.other", { n: dependencies }),
      })
    : t("detail.content.removedToast", { things });
  toast(text, { duration: REMOVED_TOAST_MS, action: { label: t("ui.list.undo"), onClick: onUndo } });
}
