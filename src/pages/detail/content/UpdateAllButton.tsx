import type { Ref } from "react";
import { useI18n } from "@/i18n";
import { Button, Hint } from "@/ui";
import { cn } from "@/lib/utils";
import { useContentModel } from "./ContentModel";

/**
 * „Alle aktualisieren“; ohne Updates stattdessen „Alles aktuell“. Beides liegt übereinander: die Breite bleibt,
 * ob Updates da sind oder nicht (kein toter Knopf).
 */
export function UpdateAllButton({ buttonRef }: { buttonRef: Ref<HTMLButtonElement> }) {
  const { t } = useI18n();
  const model = useContentModel();
  const count = model.updateFor.size;
  const shown = count > 0 || model.updatingAll;
  return (
    <span className="grid items-center justify-items-end *:col-start-1 *:row-start-1">
      <Button
        ref={buttonRef}
        size="s"
        icon="up"
        count={count}
        className={cn(!shown && "invisible")}
        aria-label={model.updatingAll ? t("detail.content.updating") : undefined}
        disabled={model.locked || !shown}
        onClick={() => model.askUpdates([...model.updateFor.keys()])}
      >
        {t("detail.content.updateAll")}
      </Button>
      {!shown && <Hint tone="ok">{t("detail.content.allUpToDate")}</Hint>}
    </span>
  );
}
