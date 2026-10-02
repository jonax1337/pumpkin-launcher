import { useState } from "react";
import { useI18n, type TKey } from "@/i18n";
import { Checkbox, Dialog, DialogActions, Field, Hint, Skel, TextArea, TextField } from "@/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { useExportEntries, useExportSummary } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import type { ExportRequest } from "@/lib/backend";
import { KIND_LABEL_KEYS } from "@/lib/catalog";
import { packFileName } from "@/lib/mods";
import { toastError } from "@/lib/toast";
import type { Instance } from "@/lib/types";

const DEFAULT_VERSION = "1.0.0";
const MAX_NAME_LENGTH = 200;
const MAX_VERSION_LENGTH = 64;
const MAX_SUMMARY_LENGTH = 500;

/** Was ein Export ohne Zutun mitnimmt; Welten nur auf Wunsch (groß). */
const EXPORT_DEFAULTS = ["config", "mods", "resourcepacks", "shaderpacks", "options.txt", "servers.dat"];

/** Export ohne Dialog: die Standard-Einträge aus `entries`, Name der Instanz, erste Version, keine Beschreibung. */
export const defaultExportRequest = (instance: Instance, entries: string[]): ExportRequest => ({
  include: entries.filter((entry) => EXPORT_DEFAULTS.includes(entry)),
  name: instance.name,
  versionId: DEFAULT_VERSION,
  summary: null,
});

/** Lesbare Namen bekannter Einträge im Spielordner. */
const ENTRY_LABELS: Record<string, TKey> = {
  config: "components.export.entry.config",
  mods: KIND_LABEL_KEYS.mod,
  resourcepacks: KIND_LABEL_KEYS.resourcepack,
  shaderpacks: KIND_LABEL_KEYS.shader,
  "options.txt": "components.export.entry.options",
  saves: "common.worlds",
  screenshots: "components.export.entry.screenshots",
  "servers.dat": "components.export.entry.servers",
};

/** Export als `.mrpack`: Angaben für das Pack, Auswahl aus dem Spielordner und was daraus in der Datei wird. */
export function ExportDialog({ instance, onExport, onClose }: {
  instance: Instance; onExport: (request: ExportRequest, path: string) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const entries = useExportEntries(instance.id);
  const [name, setName] = useState(instance.name);
  const [version, setVersion] = useState(DEFAULT_VERSION);
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(entries.data?.filter((entry) => EXPORT_DEFAULTS.includes(entry)));
  const include = [...chosen].sort();
  const toggle = (entry: string, on: boolean) => setPicked(new Set(on ? [...chosen, entry] : include.filter((n) => n !== entry)));

  async function submit() {
    const packName = name.trim();
    const path = await api.pickSavePath({
      defaultPath: packFileName(packName, t("common.instance")),
      filters: [{ name: t("components.export.fileFilter"), extensions: ["mrpack"] }],
    });
    if (!path) return;
    onExport({ include, name: packName, versionId: version.trim(), summary: description.trim() || null }, path);
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("components.instance.export")}
      sub={instance.name}
      width={520}
      footLeft={api.capabilities.exportInstance ? undefined : t("components.export.appOnly")}
      footer={
        <DialogActions
          cancel={t("common.cancel")}
          confirm={{
            label: t("components.instance.export"),
            width: 150,
            disabled: !api.capabilities.exportInstance || !entries.data || !name.trim() || !version.trim(),
            onClick: () => void submit().catch(toastError),
          }}
        />
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <Field label={t("components.export.packName")} className="min-w-0 flex-1">
            <TextField value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_NAME_LENGTH} />
          </Field>
          <Field label={t("components.export.packVersion")} className="w-36 flex-none">
            <TextField value={version} onChange={(e) => setVersion(e.target.value)} maxLength={MAX_VERSION_LENGTH} />
          </Field>
        </div>
        <Field label={t("components.export.packDescription")} optional>
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={MAX_SUMMARY_LENGTH} rows={2} />
        </Field>
        <Field label={t("components.export.include")} group help={t("components.export.includeHelp")}>
          <ExportEntries entries={entries} chosen={chosen} onToggle={toggle} />
        </Field>
        {chosen.has("config") && <Hint tone="warn">{t("components.export.configWarning")}</Hint>}
        <ExportSummaryNote instanceId={instance.id} include={include} enabled={!!entries.data} />
      </div>
    </Dialog>
  );
}

/** Die wählbaren Einträge des Spielordners; solange sie laden oder wenn das fehlschlägt, ein Platzhalter. */
function ExportEntries({ entries, chosen, onToggle }: {
  entries: ReturnType<typeof useExportEntries>; chosen: Set<string>; onToggle: (name: string, on: boolean) => void;
}) {
  const { t } = useI18n();
  if (entries.error) return <Hint tone="bad">{entries.error.message}</Hint>;
  if (!entries.data) return <Skel h={120} />;
  if (!entries.data.length) return <Hint>{t("components.export.folderEmpty")}</Hint>;
  return (
    <div className="flex flex-col gap-2">
      {entries.data.map((name) => (
        <Checkbox key={name} checked={chosen.has(name)} onChange={(on) => onToggle(name, on)}>
          {ENTRY_LABELS[name] ? `${t(ENTRY_LABELS[name])} (${name})` : name}
        </Checkbox>
      ))}
    </div>
  );
}

/** Wie viele Inhalte verlinkt, eingebettet oder (ausgeschaltet) übersprungen werden; Letzteres fällt als Warnung auf. */
function ExportSummaryNote({ instanceId, include, enabled }: { instanceId: string; include: string[]; enabled: boolean }) {
  const { t } = useI18n();
  const summary = useExportSummary(instanceId, useDebounced(include), enabled);
  if (!enabled || summary.error) return null;
  if (!summary.data) return <Hint live>{t("components.export.summaryLoading")}</Hint>;
  const { linked, embedded, skippedDisabled } = summary.data;
  return (
    <div className="flex flex-col gap-2">
      {linked + embedded > 0 && <Hint live>{t("components.export.summary", { linked, embedded })}</Hint>}
      {skippedDisabled > 0 && (
        <Hint tone="warn" live>
          {t(skippedDisabled === 1 ? "components.export.skippedDisabled.one" : "components.export.skippedDisabled.other", { n: skippedDisabled })}
        </Hint>
      )}
    </div>
  );
}
