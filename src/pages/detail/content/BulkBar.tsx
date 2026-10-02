import { useI18n } from "@/i18n";
import { Button, Count, Spacer } from "@/ui";
import { useContentModel } from "./ContentModel";

/** Leiste über der Liste, solange etwas gewählt ist: Schalten, Aktualisieren, Entfernen für die Auswahl. */
export function BulkBar() {
  const { t } = useI18n();
  const model = useContentModel();
  const { pickedLive } = model;
  const switchable = pickedLive.filter(model.isSwitchable);
  const updatable = pickedLive.filter((id) => model.updateFor.has(id));
  return (
    <>
      <span><Count value={pickedLive.length} minDigits={2} /> {t("detail.content.selectedCount", { n: pickedLive.length })}</span>
      <Button
        size="s"
        disabled={!switchable.length}
        onClick={() => model.setEnabled(switchable, false)}
      >
        {t("detail.content.switchOff")}
      </Button>
      <Button
        size="s"
        disabled={!switchable.length}
        onClick={() => model.setEnabled(switchable, true)}
      >
        {t("detail.content.switchOn")}
      </Button>
      <Button
        size="s"
        icon="up"
        disabled={model.locked || !updatable.length}
        onClick={() => model.askUpdates(updatable)}
      >
        {t("detail.content.updateAction")}
      </Button>
      <Button size="s" icon="trash" onClick={() => model.remove(pickedLive)}>{t("common.remove")}</Button>
      <Spacer />
      <Button variant="ghost" size="s" onClick={model.clearPicked}>{t("detail.content.clearSelection")}</Button>
    </>
  );
}
