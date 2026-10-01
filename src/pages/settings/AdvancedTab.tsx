import { toast } from "sonner";
import { Actions, Button, FormRow } from "@/ui";
import { useI18n } from "@/i18n";
import { useSettings } from "@/store/settings";

/** Einstellungen › Erweitert: alles auf Anfang. */
export function AdvancedTab() {
  const { t } = useI18n();
  const reset = useSettings((s) => s.reset);
  return (
    <FormRow label={t("pages.settings.resetLabel")} hint={t("pages.settings.resetHint")}>
      <Actions>
        <Button
          icon="redo"
          onClick={() => {
            reset();
            toast.success(t("pages.settings.resetDoneToast"));
          }}
        >
          {t("pages.settings.resetButton")}
        </Button>
      </Actions>
    </FormRow>
  );
}
