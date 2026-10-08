import { useI18n } from "@/i18n";
import { Button, Hint, IconButton, Spacer } from "@/ui";
import type { AppliedChange } from "./types";

/** Leiste unter der Werkzeugleiste: sagt, was das Update geändert hat, und bietet „Rückgängig“; bleibt, bis man sie schließt. */
export function UndoBar({ change, locked, onUndo, onDismiss }: {
  change: AppliedChange; locked: boolean; onUndo: () => void; onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="dc-undo">
      <Hint icon="check" tone="ok" live>{change.text}</Hint>
      <Spacer />
      <Button size="s" icon="undo" disabled={locked} onClick={onUndo}>{t("ui.list.undo")}</Button>
      <IconButton size="s" icon="close" label={t("common.close")} onClick={onDismiss} />
    </div>
  );
}
