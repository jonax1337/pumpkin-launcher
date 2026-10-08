import { useState } from "react";
import { Button, ChipButton, FormRow, Hint, IconButton, TextField } from "@/ui";
import { useCommitOnUnmount } from "@/hooks/useCommitOnUnmount";
import { useLatest } from "@/hooks/useLatest";
import { useI18n, type TKey } from "@/i18n";
import {
  envNameProblem,
  isPresetOn,
  MAX_COMMAND_LENGTH,
  MAX_ENV_NAME_LENGTH,
  MAX_ENV_VALUE_LENGTH,
  MAX_ENV_VARS,
  PRE_LAUNCH_TIMEOUT_SECONDS,
  presetsFor,
  sameLaunch,
  settleLaunch,
  togglePreset,
  type EnvNameProblem,
  type LaunchPresetId,
} from "@/lib/launchSettings";
import { platform } from "@/lib/platform";
import type { EnvVar, LaunchSettings } from "@/lib/types";

const PRESET_KEYS: Record<LaunchPresetId, TKey> = {
  gamemode: "launchSettings.preset.gamemode",
  mangohud: "launchSettings.preset.mangohud",
  nvidia: "launchSettings.preset.nvidia",
  amd: "launchSettings.preset.amd",
};

const NAME_PROBLEM_KEYS: Record<EnvNameProblem, TKey> = {
  invalid: "launchSettings.env.nameInvalid",
  reserved: "launchSettings.env.nameReserved",
};

/**
 * Umgebungsvariablen, Wrapper und Befehle vor dem Start und nach dem Ende, als Zeilen eines Formulars: für eine Instanz
 * (`scope="instance"`) und für die Standards des Launchers (`scope="launcher"`). `onCommit` bekommt den neuen Stand beim
 * Verlassen eines Felds, beim Verlassen der Seite und bei jedem Klick auf eine Vorgabe oder „Entfernen“.
 */
export function LaunchFields({ scope, value, disabled = false, onCommit }: {
  scope: "instance" | "launcher";
  value: LaunchSettings;
  disabled?: boolean;
  onCommit: (next: LaunchSettings) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const [focusRow, setFocusRow] = useState<number | null>(null);
  // Ändert sich der gespeicherte Stand von außen (etwa „Zurücksetzen“), zeigt das Formular ihn; die eigene Eingabe, die
  // gleich gespeichert wird, lässt der Abgleich in Ruhe.
  const [synced, setSynced] = useState(value);
  if (!sameLaunch(value, synced)) {
    setSynced(value);
    if (!sameLaunch(value, settleLaunch(draft))) setDraft(value);
  }
  const saved = useLatest(value);
  const problems = draft.env.map((row) => envNameProblem(row.name.trim()));

  /** Ein Name, den das Backend ablehnt, wird nicht abgeschickt; der Hinweis steht schon im Formular. */
  function commit(next: LaunchSettings) {
    const settled = settleLaunch(next);
    const refusedByBackend = settled.env.some((row) => envNameProblem(row.name) !== null);
    if (!refusedByBackend && !sameLaunch(settled, saved.current)) onCommit(settled);
  }

  function replace(next: LaunchSettings) {
    setDraft(next);
    commit(next);
  }

  function changeRow(index: number, patch: Partial<EnvVar>) {
    setDraft({ ...draft, env: draft.env.map((row, at) => (at === index ? { ...row, ...patch } : row)) });
  }

  function addRow() {
    setFocusRow(draft.env.length);
    setDraft({ ...draft, env: [...draft.env, { name: "", value: "" }] });
  }

  useCommitOnUnmount(() => commit(draft));

  const presets = presetsFor(platform);
  const id = (field: string) => `${scope}-launch-${field}`;
  return (
    <>
      {presets.length > 0 && (
        <FormRow label={t("launchSettings.presets.label")} hint={t("launchSettings.presets.hint")} group="group">
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <ChipButton key={preset} pressed={isPresetOn(draft, preset)} disabled={disabled} onClick={() => replace(togglePreset(settleLaunch(draft), preset))}>
                {t(PRESET_KEYS[preset])}
              </ChipButton>
            ))}
          </div>
        </FormRow>
      )}
      <FormRow
        label={t("launchSettings.env.label")}
        hint={t("launchSettings.env.hint", { max: MAX_ENV_VARS })}
        aside={t(scope === "instance" ? "launchSettings.scope.instance" : "launchSettings.scope.launcher")}
        group="group"
      >
        {draft.env.map((row, index) => (
          <div key={index} className="mb-2 flex items-center gap-2">
            <TextField
              width="m"
              aria-label={t("launchSettings.env.name")}
              aria-invalid={problems[index] !== null || undefined}
              placeholder="NAME"
              maxLength={MAX_ENV_NAME_LENGTH}
              value={row.name}
              disabled={disabled}
              autoFocus={focusRow === index}
              onChange={(e) => changeRow(index, { name: e.target.value })}
              onBlur={() => commit(draft)}
            />
            <TextField
              aria-label={t("launchSettings.env.value")}
              placeholder="value"
              maxLength={MAX_ENV_VALUE_LENGTH}
              value={row.value}
              disabled={disabled}
              onChange={(e) => changeRow(index, { value: e.target.value })}
              onBlur={() => commit(draft)}
            />
            <IconButton
              icon="trash"
              size="s"
              label={row.name.trim() ? t("launchSettings.env.remove", { name: row.name.trim() }) : t("launchSettings.env.removeEmpty")}
              disabled={disabled}
              onClick={() => replace({ ...draft, env: draft.env.filter((_, at) => at !== index) })}
            />
          </div>
        ))}
        {[...new Set(problems)].map((problem) => problem && <Hint key={problem} tone="bad" live className="mb-2">{t(NAME_PROBLEM_KEYS[problem])}</Hint>)}
        <Button icon="plus" size="s" disabled={disabled || draft.env.length >= MAX_ENV_VARS} onClick={addRow}>
          {t("launchSettings.env.add")}
        </Button>
      </FormRow>
      <FormRow label={t("launchSettings.wrapper.label")} htmlFor={id("wrapper")} hint={t("launchSettings.wrapper.hint")}>
        <TextField
          id={id("wrapper")}
          placeholder="gamemoderun"
          maxLength={MAX_COMMAND_LENGTH}
          value={draft.wrapper}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, wrapper: e.target.value })}
          onBlur={() => commit(draft)}
        />
      </FormRow>
      <FormRow
        label={t("launchSettings.preLaunch.label")}
        htmlFor={id("pre-launch")}
        hint={t("launchSettings.preLaunch.hint", { seconds: PRE_LAUNCH_TIMEOUT_SECONDS })}
      >
        <TextField
          id={id("pre-launch")}
          maxLength={MAX_COMMAND_LENGTH}
          value={draft.preLaunch}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, preLaunch: e.target.value })}
          onBlur={() => commit(draft)}
        />
        <Hint tone="warn" className="mt-1.5">{t("launchSettings.preLaunch.consent")}</Hint>
      </FormRow>
      <FormRow label={t("launchSettings.postExit.label")} htmlFor={id("post-exit")} hint={t("launchSettings.postExit.hint")}>
        <TextField
          id={id("post-exit")}
          maxLength={MAX_COMMAND_LENGTH}
          value={draft.postExit}
          disabled={disabled}
          onChange={(e) => setDraft({ ...draft, postExit: e.target.value })}
          onBlur={() => commit(draft)}
        />
        <Hint className="mt-1.5">{t("launchSettings.hooks.variables")}</Hint>
      </FormRow>
    </>
  );
}
