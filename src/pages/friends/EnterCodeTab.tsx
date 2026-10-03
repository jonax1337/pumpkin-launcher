import { useState, type FormEvent } from "react";
import { useI18n } from "@/i18n";
import { isFriendCodeShape } from "@/lib/friendCode";
import { Field, Hint, TextField } from "@/ui";

/** Das Feld für den Code eines Freundes. Die Form prüft die Oberfläche, Version und Prüfsumme das Backend. */
export function EnterCodeTab({ formId, input, onInput, onSubmit }: { formId: string; input: string; onInput: (value: string) => void; onSubmit: () => void }) {
  const { t } = useI18n();
  const [touched, setTouched] = useState(false);
  // Beim Tippen ist jeder Anfang „falsch“: den Fehler gibt es erst, wenn das Feld verlassen wurde.
  const wrongShape = touched && input.trim() !== "" && !isFriendCodeShape(input);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form id={formId} onSubmit={submit}>
      <Field
        label={t("friends.enter.label")}
        help={t("friends.enter.help")}
        error={wrongShape ? t("friends.enter.wrongShape") : undefined}
        reserveLines={2}
      >
        <TextField
          value={input}
          onChange={(event) => onInput(event.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={t("friends.enter.placeholder")}
          autoFocus
        />
      </Field>
      <Hint className="mt-3" icon="info">{t("friends.enter.consent")}</Hint>
    </form>
  );
}
