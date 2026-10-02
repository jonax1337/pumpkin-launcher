import { toast } from "sonner";
import { loaderLine } from "@/components/common";
import { ChoiceList, ChoiceListSkeleton } from "@/components/newInstance/ChoiceList";
import { Actions, Button, Chip, Choice, Empty, ErrorBox, Field, Glyph, Hint, JobProgress, Meta, Panel, TextField } from "@/ui";
import { useContentState } from "@/store/contentState";
import { importTarget, type ForeignSelection } from "@/hooks/useImport";
import { useI18n, type TKey } from "@/i18n";
import { api } from "@/lib/api";
import { formatMemory, formatSize } from "@/lib/format";
import { progressShare, progressShortLabel } from "@/lib/progress";
import { FOREIGN_LAUNCHER_LABELS, FOREIGN_LAUNCHERS, type ForeignInstance, type NotAdopted } from "@/lib/types";

const SKELETON_ROWS = 3;
const NAME_MAX_LENGTH = 64;

/** Warum etwas aus dem anderen Launcher nicht mitkommt, in Alltagssprache. */
const NOT_ADOPTED_KEYS: Record<NotAdopted, TKey> = {
  preLaunchCommand: "components.import.notAdopted.preLaunchCommand",
  postExitCommand: "components.import.notAdopted.postExitCommand",
  wrapperCommand: "components.import.notAdopted.wrapperCommand",
  javaPath: "components.import.notAdopted.javaPath",
  jvmArgs: "components.import.notAdopted.jvmArgs",
};

/** Was die neue Instanz an Einstellungen aus der fremden übernimmt; Welten, Mods und Dateien kommen immer mit. */
function useAdoptedSettings(f: ForeignInstance): string[] {
  const { t } = useI18n();
  const { window } = f;
  return [
    f.memoryMb != null && t("components.import.adopted.memory", { memory: formatMemory(f.memoryMb) }),
    f.jvmArgs.length > 0 && t("components.import.adopted.jvmArgs"),
    f.javaPath != null && t("components.import.adopted.javaPath"),
    window.type === "size" && t("components.import.adopted.window", { width: window.width, height: window.height }),
    window.type === "fullscreen" && t("components.import.adopted.fullscreen"),
    f.group != null && t("components.import.adopted.group", { group: f.group }),
    f.notes !== "" && t("components.import.adopted.notes"),
    f.icon != null && t("components.import.adopted.icon"),
  ].filter((item) => item !== false);
}

/** Größe, Mods und Welten, die der Import kopiert. */
function useContentsLine(f: ForeignInstance): string {
  const { t } = useI18n();
  const { sizeBytes, mods, worlds } = f.contents;
  return [
    formatSize(sizeBytes),
    t(mods === 1 ? "components.import.modsOne" : "components.import.modsOther", { n: mods }),
    t(worlds === 1 ? "components.import.worldsOne" : "components.import.worldsOther", { n: worlds }),
  ].join(" · ");
}

/** Ein Abschnitt unter einer gewählten Instanz: Überschrift und Einträge hintereinander. */
function DetailLine({ label, items, tone }: { label: string; items: string[]; tone?: "warn" }) {
  return (
    <div className={tone === "warn" ? "text-warn" : "text-fg-2"}>
      <b className="mr-2">{label}</b>
      <Meta items={items} wrap />
    </div>
  );
}

/** Unter der gewählten Instanz: Name der neuen, was mitkommt und was nicht. */
function ImportDetails({ f, name, busy, onRename }: { f: ForeignInstance; name: string; busy: boolean; onRename: (name: string) => void }) {
  const { t } = useI18n();
  const adopted = useAdoptedSettings(f);
  return (
    <Panel level="sunk" pad="s" className="mb-2 flex flex-col gap-2">
      <Field label={t("components.import.nameLabel")} error={name.trim() ? undefined : t("components.import.nameEmpty")}>
        <TextField value={name} maxLength={NAME_MAX_LENGTH} disabled={busy} onChange={(e) => onRename(e.target.value)} />
      </Field>
      {adopted.length > 0 && <DetailLine label={t("components.import.adoptedLabel")} items={adopted} />}
      {f.notAdopted.length > 0 && (
        <DetailLine tone="warn" label={t("components.import.notAdoptedLabel")} items={f.notAdopted.map((reason) => t(NOT_ADOPTED_KEYS[reason]))} />
      )}
    </Panel>
  );
}

/** Warum eine Instanz sich nicht importieren lässt, und was stattdessen geht. */
function UnsupportedNote({ reason }: { reason: string }) {
  const { t } = useI18n();
  return (
    <Panel level="sunk" pad="s" className="mb-2 flex flex-col gap-1">
      <Hint tone="warn">{reason}</Hint>
      <Hint icon={false}>{t("components.import.unsupportedAlternative")}</Hint>
    </Panel>
  );
}

function ImportRow({ f, selection, busy }: { f: ForeignInstance; selection: ForeignSelection; busy: boolean }) {
  const { t } = useI18n();
  const { active, target, progress } = useContentState();
  const contents = useContentsLine(f);
  const chosen = selection.isChosen(f);
  const trail =
    active && target === importTarget(f) ? (
      <JobProgress label={progressShortLabel(progress)} p={progressShare(progress)} width={120} />
    ) : f.imported ? (
      <Chip>{t("components.import.alreadyImported")}</Chip>
    ) : f.unsupported ? (
      <Chip tone="warn">{t("components.import.unsupported")}</Chip>
    ) : undefined;
  return (
    <>
      <Choice
        media={<Glyph name="chest" pal="copper" />}
        title={f.name}
        sub={`${loaderLine(f)} · ${contents}`}
        trail={trail}
        selected={chosen}
        disabled={busy || !!f.unsupported}
        onClick={() => selection.toggle(f)}
      />
      {f.unsupported && <UnsupportedNote reason={f.unsupported} />}
      {chosen && <ImportDetails f={f} name={selection.nameOf(f)} busy={busy} onRename={(name) => selection.rename(f, name)} />}
    </>
  );
}

/** Auswahl in Zahlen und der Weg, alle zu wählen oder keine: gewählt ist erst, was der Nutzer wählt. */
function SelectionBar({ selection, busy }: { selection: ForeignSelection; busy: boolean }) {
  const { t } = useI18n();
  const { selectable, chosen } = selection;
  if (!selectable.length) return null;
  const all = chosen.length === selectable.length;
  return (
    <Actions gap={12} wrap className="mb-3">
      <span className="text-fg-2">{chosen.length ? t("components.import.selectedCount", { n: chosen.length, total: selectable.length }) : t("components.import.pickHint")}</span>
      <Button variant="ghost" size="s" disabled={busy} onClick={all ? selection.clear : selection.chooseAll}>
        {all ? t("components.import.clearSelection") : t("components.import.chooseAll")}
      </Button>
    </Actions>
  );
}

/** Import aus anderen Launchern im Dialog „Neue Instanz“: Instanzen nach Launcher gruppiert, Fortschritt in der Zeile. */
export function ImportPane({ selection, busy }: { selection: ForeignSelection; busy: boolean }) {
  const { t } = useI18n();
  const { detected, all } = selection;

  async function chooseFolder() {
    const [folder] = await api.pickPaths({ directory: true, title: t("components.import.folderTitle") });
    if (folder) await selection.addFolder(folder).catch((e: Error) => toast.error(t("components.import.folderScanFailed"), { description: e.message }));
  }

  return (
    <>
      {detected.error ? (
        <ErrorBox title={t("components.import.searchFailed")} error={detected.error} onRetry={() => void detected.refetch()} />
      ) : detected.isPending ? (
        <ChoiceListSkeleton n={SKELETON_ROWS} />
      ) : !all.length ? (
        <Empty ill={<Glyph name="chest" pal="sand" box={64} />} title={t("components.import.noneFound")} size="pane">
          {t("components.import.noneFoundHint")}
        </Empty>
      ) : (
        <>
          <SelectionBar selection={selection} busy={busy} />
          {FOREIGN_LAUNCHERS.filter((l) => all.some((f) => f.launcher === l)).map((launcher) => (
            <Field key={launcher} label={FOREIGN_LAUNCHER_LABELS[launcher]} group>
              <ChoiceList>
                {all.filter((f) => f.launcher === launcher).map((f) => (
                  <ImportRow key={f.path} f={f} selection={selection} busy={busy} />
                ))}
              </ChoiceList>
            </Field>
          ))}
        </>
      )}
      <Button variant="ghost" size="s" icon="folder" bleed="start" className="mt-2.5" disabled={!api.capabilities.pickPaths || busy} onClick={() => void chooseFolder()}>
        {t("components.import.chooseFolder")}
      </Button>
    </>
  );
}
