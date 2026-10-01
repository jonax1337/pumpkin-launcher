import { FormRow, FormSection } from "@/ui";
import { JavaChooser, MemoryChooser, MemoryHelp } from "@/components/common";
import { useI18n } from "@/i18n";
import type { Instance } from "@/lib/types";
import { useSettings } from "@/store/settings";
import { ArgsField } from "./ArgsField";
import type { InstanceForm } from "./useInstanceForm";
import { WindowChooser } from "./WindowChooser";

/** Arbeitsspeicher, Java, Fenster und Startargumente der Instanz. */
export function GameSection({ instance, form, locked }: { instance: Instance; form: InstanceForm; locked: boolean }) {
  const { t } = useI18n();
  const globalJava = useSettings((s) => s.javaPath);
  return (
    <FormSection title={t("pages.settings.tabGame")}>
      <FormRow
        label={t("ui.memory.label")}
        hint={t("detail.settings.memoryHint")}
        group="radiogroup"
        aside={<MemoryHelp value={form.memory} />}
      >
        <MemoryChooser name="inst-mem" value={form.memory} onChange={form.changeMemory} help={false} disabled={locked} />
      </FormRow>
      <FormRow
        label={t("detail.settings.javaLabel")}
        hint={t("detail.settings.javaOnlyHint")}
        group="radiogroup"
        aside={t("detail.settings.javaAside")}
      >
        <JavaChooser
          name="inst-java"
          value={instance.javaPath ?? ""}
          onChange={(path) => form.save({ javaPath: path || null }, t("detail.settings.javaSaved"))}
          disabled={locked}
          fallback={
            <>
              {t("detail.settings.javaFallback")}{" "}
              <span className="text-fg-3">({globalJava ? t("detail.settings.javaOwnInstall") : t("detail.settings.javaAutomatic")})</span>
            </>
          }
        />
      </FormRow>
      <FormRow label={t("detail.settings.windowLabel")} hint={t("detail.settings.windowHint")} group="radiogroup">
        <WindowChooser value={instance.window} onChange={(window, done) => form.save({ window }, done)} disabled={locked} />
      </FormRow>
      <FormRow label={t("components.newInstance.advanced")}>
        <ArgsField
          label={t("detail.settings.jvmOptionsLabel")}
          hint={t("detail.settings.jvmOptionsHint")}
          hintId="inst-args-h"
          placeholder="-XX:+UseG1GC"
          rows={3}
          args={instance.jvmArgs}
          disabled={locked}
          onCommit={(text) => form.saveArgs("jvmArgs", text, t("detail.settings.jvmOptionsSaved"))}
        />
        <ArgsField
          label={t("detail.settings.gameArgsLabel")}
          hint={t("detail.settings.gameArgsHint")}
          hintId="inst-game-args-h"
          placeholder="--quickPlayMultiplayer play.example.net"
          rows={2}
          args={instance.gameArgs}
          disabled={locked}
          onCommit={(text) => form.saveArgs("gameArgs", text, t("detail.settings.gameArgsSaved"))}
        />
      </FormRow>
    </FormSection>
  );
}
