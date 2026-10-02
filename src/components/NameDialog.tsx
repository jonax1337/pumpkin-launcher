import { useId, useState, type FormEvent } from "react";
import { useI18n } from "@/i18n";
import { Dialog, DialogActions, Field, TextField } from "@/ui";

/**
 * Dialog mit einem Namensfeld (Umbenennen, neue Gruppe, Vorlage speichern). Ruft `onSubmit` mit dem getrimmten Namen auf;
 * `onClose` kommt nach Abbrechen und Schließen. Leer ist nur mit `allowBlank` erlaubt (dann entscheidet der Aufrufer, was gilt).
 * Der Name startet bei jedem Einhängen mit `initial`, der Aufrufer vergibt dafür einen `key`.
 * `confirm` ersetzt „Speichern“ und „Speichert“, wenn der Dialog etwas anderes tut als zu speichern.
 */
export function NameDialog({ title, label, help, initial, maxLength, pending, allowBlank, confirm, onSubmit, onClose }: {
  title: string; label: string; help?: string; initial: string; maxLength: number; pending: boolean; allowBlank?: boolean;
  confirm?: { label: string; pending: string };
  onSubmit: (name: string) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const formId = useId();
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  const ready = (allowBlank || trimmed !== "") && !pending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (ready) onSubmit(trimmed);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      width={480}
      footer={<DialogActions cancel={t("common.cancel")} confirm={{ label: pending ? (confirm?.pending ?? t("components.common.saving")) : (confirm?.label ?? t("common.save")), width: 130, form: formId, disabled: !ready }} />}
    >
      <form id={formId} onSubmit={submit}>
        <Field label={label} help={help}>
          <TextField value={name} onChange={(e) => setName(e.target.value)} maxLength={maxLength} autoFocus />
        </Field>
      </form>
    </Dialog>
  );
}
