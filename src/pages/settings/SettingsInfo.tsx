import { useState, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import { Button, Dialog, DialogActions } from "@/ui";

export function SettingsInfo({ title, label, children }: { title: string; label?: string; children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="s" icon="info" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {label ?? t("pages.settings.notes")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={title} width={720} footer={<DialogActions cancel={t("common.close")} />}>
        <div role="region" aria-label={title} tabIndex={0} data-autofocus className="[container-type:inline-size]">
          {children}
        </div>
      </Dialog>
    </>
  );
}
