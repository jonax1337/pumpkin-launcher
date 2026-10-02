import { useI18n } from "@/i18n";
import { ImportPane } from "@/components/LauncherImport";
import { cancelContent } from "@/hooks/useContent";
import { useForeignSelection } from "@/hooks/useImport";
import type { TabContext, TabModel } from "./tab";

/** Reiter „Anderer Launcher“: Instanzen aus anderen Launchern übernehmen. */
export function useImportTab(ctx: TabContext): TabModel {
  const { t } = useI18n();
  const foreign = useForeignSelection(ctx.tab === "import");
  const { importer } = ctx;
  const { chosen } = foreign;

  return {
    valid: chosen.length > 0 && chosen.every((c) => c.name) && !ctx.active,
    label: ctx.runningLabel ?? (chosen.length > 1 ? t("components.newInstance.importMany", { n: chosen.length }) : t("components.newInstance.importLabel")),
    hint: t("components.newInstance.importNote"),
    queues: true,
    busy: false,
    cancel: importer.running ? { aria: t("components.newInstance.cancelImport"), onClick: cancelContent } : undefined,
    submit: () => void importer.run(chosen).then((created) => created.length && ctx.onImported()),
    renderPane: (busy) => <ImportPane selection={foreign} busy={busy} />,
  };
}
