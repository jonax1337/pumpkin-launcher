import { Disclosure, Field, Select, Switch } from "@/ui";
import { useUpdateInstance } from "@/hooks/useInstances";
import { useI18n } from "@/i18n";
import type { Instance } from "@/lib/types";
import { BACKUP_KEEP_MAX, BACKUP_KEEP_MIN, useWorldBackup } from "@/store/worldBackup";

type Choice = "launcher" | "always" | "never";

const choiceOf = (backupWorlds: boolean | null): Choice => (backupWorlds == null ? "launcher" : backupWorlds ? "always" : "never");

/** Zur Wahl stehende Anzahlen automatischer Sicherungen je Welt, bis zur Obergrenze des Backends. */
const KEEP_OPTIONS = [BACKUP_KEEP_MIN, 2, 3, 5, 10, 20, BACKUP_KEEP_MAX];

/**
 * Welten vor dem Spielstart sichern: Wahl dieser Instanz (oder die Einstellung des Launchers) und, für alle Instanzen
 * gemeinsam, der Standard und wie viele automatische Sicherungen je Welt bleiben.
 */
export function AutoBackupSettings({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  const update = useUpdateInstance();
  const { enabled, keep, set } = useWorldBackup();
  const keepOptions = [...new Set([...KEEP_OPTIONS, keep])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: String(n) }));
  const choices: { value: Choice; label: string }[] = [
    { value: "launcher", label: t(enabled ? "detail.worlds.autoLauncherOn" : "detail.worlds.autoLauncherOff") },
    { value: "always", label: t("detail.worlds.autoAlways") },
    { value: "never", label: t("detail.worlds.autoNever") },
  ];
  return (
    <Disclosure summary={t("detail.worlds.autoTitle")}>
      <Field label={t("detail.worlds.autoField")} htmlFor="auto-backup" help={t("detail.worlds.autoHelp")}>
        <Select
          id="auto-backup"
          value={choiceOf(instance.backupWorlds)}
          options={choices}
          disabled={update.isPending}
          onChange={(choice) => update.mutate({ ...instance, backupWorlds: choice === "launcher" ? null : choice === "always" })}
        />
      </Field>
      <Field label={t("detail.worlds.autoDefaultField")} group>
        <Switch label={t("detail.worlds.autoDefaultField")} checked={enabled} onChange={(on) => set({ enabled: on })} stateText={[t("ui.switch.on"), t("ui.switch.off")]} />
      </Field>
      <Field label={t("detail.worlds.autoKeepField")} htmlFor="auto-backup-keep" help={t("detail.worlds.autoKeepHelp")}>
        <Select id="auto-backup-keep" value={String(keep)} options={keepOptions} onChange={(n) => set({ keep: Number(n) })} />
      </Field>
    </Disclosure>
  );
}
