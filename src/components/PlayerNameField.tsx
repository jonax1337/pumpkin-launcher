import { useState } from "react";
import { useI18n } from "@/i18n";
import { isValidPlayerName } from "@/store/settings";
import { Field, TextField } from "@/ui";

/** Längster Spielername, den Minecraft annimmt. */
const MAX_PLAYER_NAME = 16;

/**
 * Fehler zum Spielernamen erst zeigen, wenn er etwas bedeutet: nach Verlassen des Felds oder ab 3 Zeichen.
 * Unerlaubte Zeichen sofort (die werden auch mit mehr Tippen nicht richtig).
 */
function showNameError(name: string, touched: boolean) {
  if (!name || isValidPlayerName(name)) return false;
  return touched || name.length >= 3 || /[^A-Za-z0-9_]/.test(name);
}

/**
 * Eingabefeld für den Spielernamen (Onboarding, Dialog „Spielername hinzufügen“). Der Fehler erscheint erst, wenn er etwas
 * bedeutet (`showNameError`) und ersetzt den Hilfetext `help` an derselben Stelle. `reserveLines`: Platz für Hilfe bzw. Fehler.
 */
export function PlayerNameField({ value, onChange, help, reserveLines }: {
  value: string; onChange: (name: string) => void; help: string; reserveLines?: 1 | 2;
}) {
  const { t } = useI18n();
  const [touched, setTouched] = useState(false);
  const invalid = showNameError(value, touched);
  return (
    <Field label={t("components.playerName.label")} reserveLines={reserveLines} help={help} error={invalid && t("components.playerName.invalid")}>
      <TextField
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        maxLength={MAX_PLAYER_NAME}
        placeholder={t("components.playerName.placeholder")}
        autoFocus
      />
    </Field>
  );
}
