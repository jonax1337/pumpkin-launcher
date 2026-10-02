import { useState } from "react";
import { useCommitOnUnmount } from "@/hooks/useCommitOnUnmount";
import { FormRow, FormSection, TextArea } from "@/ui";
import { useI18n } from "@/i18n";
import { NOTES_MAX_LENGTH, type Instance } from "@/lib/types";
import type { InstanceForm } from "./useInstanceForm";

const NOTES_ROWS = 6;

/** Eigene Notizen zur Instanz; gespeichert wird beim Verlassen des Felds oder der Seite. */
export function NotesSection({ instance, form, locked }: { instance: Instance; form: InstanceForm; locked: boolean }) {
  const { t } = useI18n();
  const [notes, setNotes] = useState(instance.notes);
  const saveNotes = () => {
    if (notes !== instance.notes) form.save({ notes }, t("detail.settings.notesSaved"));
  };
  useCommitOnUnmount(saveNotes);
  return (
    <FormSection title={t("detail.settings.notesSection")}>
      <FormRow label={t("detail.settings.notesLabel")} hint={t("detail.settings.notesHint")} htmlFor="inst-notes" wide>
        <TextArea
          id="inst-notes"
          rows={NOTES_ROWS}
          value={notes}
          maxLength={NOTES_MAX_LENGTH}
          placeholder={t("detail.settings.notesPlaceholder")}
          disabled={locked}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
        />
      </FormRow>
    </FormSection>
  );
}
