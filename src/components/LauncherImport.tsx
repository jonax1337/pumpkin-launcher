import { toast } from "sonner";
import { loaderLine } from "@/components/common";
import { SkelList } from "@/components/SkelList";
import { Button, Chip, Choice, Empty, ErrorBox, Field, Glyph, JobProgress } from "@/ui";
import { useContentState } from "@/store/contentState";
import { importTarget, type ForeignSelection } from "@/hooks/useImport";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { progressShare, progressShortLabel } from "@/lib/progress";
import { FOREIGN_LAUNCHER_LABELS, FOREIGN_LAUNCHERS, type ForeignInstance } from "@/lib/types";

/** Import aus anderen Launchern im Dialog „Neue Instanz“: Instanzen nach Launcher gruppiert, Fortschritt in der Zeile. */
export function ImportPane({ selection, busy }: { selection: ForeignSelection; busy: boolean }) {
  const { t } = useI18n();
  const { detected, all } = selection;
  const { active, target, progress } = useContentState();

  async function chooseFolder() {
    const [folder] = await api.pickPaths({ directory: true, title: t("components.import.folderTitle") });
    if (folder) await selection.addFolder(folder).catch((e: Error) => toast.error(t("components.import.folderScanFailed"), { description: e.message }));
  }

  const trail = (f: ForeignInstance) => {
    if (active && target === importTarget(f)) return <JobProgress label={progressShortLabel(progress)} p={progressShare(progress)} width={120} />;
    return f.imported ? <Chip>{t("components.import.alreadyImported")}</Chip> : undefined;
  };

  return (
    <>
      {detected.error ? (
        <ErrorBox title={t("components.import.searchFailed")} error={detected.error} onRetry={() => void detected.refetch()} />
      ) : detected.isPending ? (
        <div className="flex flex-col gap-1">
          <SkelList n={3} h={56} />
        </div>
      ) : !all.length ? (
        <Empty ill={<Glyph name="chest" pal="sand" box={64} />} title={t("components.import.noneFound")} size="pane">
          {t("components.import.noneFoundHint")}
        </Empty>
      ) : (
        FOREIGN_LAUNCHERS.filter((l) => all.some((f) => f.launcher === l)).map((launcher) => (
          <Field key={launcher} label={FOREIGN_LAUNCHER_LABELS[launcher]} group>
            <div className="flex flex-col gap-1">
              {all.filter((f) => f.launcher === launcher).map((f) => (
                <Choice
                  key={f.path}
                  media={<Glyph name="chest" pal="copper" />}
                  title={f.name}
                  sub={f.unsupported ?? loaderLine(f)}
                  trail={trail(f)}
                  selected={selection.isChosen(f)}
                  disabled={busy || !!f.unsupported}
                  onClick={() => selection.toggle(f)}
                />
              ))}
            </div>
          </Field>
        ))
      )}
      <Button variant="ghost" size="s" icon="folder" bleed="start" className="mt-2.5" disabled={!api.capabilities.pickPaths || busy} onClick={() => void chooseFolder()}>
        {t("components.import.chooseFolder")}
      </Button>
    </>
  );
}
