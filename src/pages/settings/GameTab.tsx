import { FormRow } from "@/ui";
import { JavaChooser, MemoryChooser, MemoryHelp } from "@/components/common";
import { useI18n } from "@/i18n";
import { useSettings } from "@/store/settings";

/** Java: automatisch (mitgelieferte Runtime) oder eigene Java-Installation. */
function JavaRow() {
  const { t } = useI18n();
  const javaPath = useSettings((s) => s.javaPath);
  const set = useSettings((s) => s.set);
  return (
    <FormRow label="Java" hint={t("pages.settings.javaHint")} group="radiogroup" aside={t("pages.settings.javaAside")}>
      <JavaChooser
        name="gjava"
        value={javaPath}
        onChange={(path) => set({ javaPath: path })}
        fallback={<>{t("components.memory.auto")} <span className="text-fg-3">{t("pages.settings.javaAutomaticNote")}</span></>}
      />
    </FormRow>
  );
}

/** Einstellungen › Spiel: Arbeitsspeicher und Java für alle Instanzen ohne eigene Angabe. */
export function GameTab() {
  const { t } = useI18n();
  const memoryMb = useSettings((s) => s.memoryMb);
  const set = useSettings((s) => s.set);
  return (
    <>
      <FormRow
        label={t("ui.memory.label")}
        hint={t("pages.settings.memoryHint")}
        group="radiogroup"
        aside={<MemoryHelp value={memoryMb} />}
      >
        <MemoryChooser name="gram" value={memoryMb} onChange={(mb) => set({ memoryMb: mb })} help={false} />
      </FormRow>
      <JavaRow />
    </>
  );
}
