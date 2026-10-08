import { useState, type FormEvent } from "react";
import { useI18n } from "@/i18n";
import { FRIENDS_LIMITS, type DirectoryStatus } from "@/lib/friends-types";
import { Button, ButtonLink, Field, Hint, StatusPanel, TextField } from "@/ui";
import { isMcName, REQUEST_TTL_DAYS } from "./friendsModel";

type NameTabProps = {
  formId: string;
  input: string;
  onInput: (value: string) => void;
  onSubmit: () => void;
  /** Das Verzeichnis kennt die Person nicht oder sie ist nicht auffindbar: Hinweis mit dem Weg über den eigenen Code. */
  notFindable: boolean;
  directory: DirectoryStatus;
  findableByName: boolean;
  onShowMyCode: () => void;
};

/** Eine Anfrage per Minecraft-Namen. Die Form prüft die Oberfläche, ob es den Spieler gibt und ob er auffindbar ist, das Backend. */
export function NameTab({ formId, input, onInput, onSubmit, notFindable, directory, findableByName, onShowMyCode }: NameTabProps) {
  const { t } = useI18n();
  const [touched, setTouched] = useState(false);
  const name = input.trim();
  // Beim Tippen ist jeder Anfang „falsch“: den Fehler gibt es erst, wenn das Feld verlassen wurde.
  const wrongShape = touched && name !== "" && !isMcName(name);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form id={formId} onSubmit={submit} className="fr-form">
      <Field
        label={t("friends.name.label")}
        error={wrongShape ? t("friends.name.wrongShape", { max: FRIENDS_LIMITS.mcNameMax }) : undefined}
        reserveLines={2}
      >
        <TextField
          value={input}
          onChange={(event) => onInput(event.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={t("friends.name.placeholder")}
          maxLength={FRIENDS_LIMITS.mcNameMax}
          autoFocus
        />
      </Field>
      <Hint icon="info">
        {t("friends.name.hint", { name: isMcName(name) ? name : t("friends.name.someone"), days: REQUEST_TTL_DAYS })}
      </Hint>
      {notFindable && (
        <StatusPanel
          tone="warn"
          role="alert"
          actions={<Button size="s" icon="link" onClick={onShowMyCode}>{t("friends.name.showMyCode")}</Button>}
        >
          {t("errors.friends.nameNotFindable", { name })}
        </StatusPanel>
      )}
      {directory.state === "unreachable" && <StatusPanel tone="warn" role="status">{t("friends.name.unreachable")}</StatusPanel>}
      {!findableByName && (
        <StatusPanel icon="info" actions={<ButtonLink size="s" to="/settings?tab=freunde">{t("friends.name.openSettings")}</ButtonLink>}>
          {t("friends.name.notFindable")}
        </StatusPanel>
      )}
    </form>
  );
}
