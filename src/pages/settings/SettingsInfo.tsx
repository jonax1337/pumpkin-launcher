import { useState, type ReactNode } from "react";
import { useI18n } from "@/i18n";
import { Button, Dialog, DialogActions } from "@/ui";
import { PanelActions } from "./PanelActions";

/** „Hinweise“-Knopf im Kopf der Platte; er öffnet die langen Erklärungen eines Reiters in einem Dialog. */
export function SettingsInfo({ title, label, children }: { title: string; label?: string; children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PanelActions>
        <Button size="s" icon="info" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {label ?? t("pages.settings.notes")}
        </Button>
      </PanelActions>
      <InfoDialog open={open} onOpenChange={setOpen} title={title}>{children}</InfoDialog>
    </>
  );
}

/** Dialog mit längerem Text zu einem Reiter (Hinweise, Datenschutz); Schließen unten. */
export function InfoDialog({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} footer={<DialogActions cancel={t("common.close")} />}>
      <div role="region" aria-label={title} tabIndex={0} data-autofocus className="settings-info">
        {children}
      </div>
    </Dialog>
  );
}
