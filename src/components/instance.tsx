import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { save as saveFile } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { create } from "zustand";
import { t, useI18n, type TKey } from "@/i18n";
import { Checkbox, ConfirmDialog, Dialog, DialogActions, Field, Hint, IconButton, Menu, Skel, type MenuEntry } from "@/ui";
import { isBusy, usePhase } from "@/components/game";
import { NameDialog } from "@/components/NameDialog";
import { useBackgroundTask } from "@/hooks/useBackgroundTask";
import { confirmTargetProps } from "@/hooks/useConfirmTarget";
import { useContentState } from "@/hooks/useContent";
import { askStop, useDeleteInstance, useExportEntries, useGroups, usePlay, useSetGroup } from "@/hooks/useInstances";
import { useSaveTemplate } from "@/hooks/useTemplates";
import { api } from "@/lib/api";
import { KIND_LABEL_KEYS } from "@/lib/catalog";
import { revealLocalPath } from "@/lib/links";
import { instanceUrl } from "@/lib/routes";
import { toastError } from "@/lib/toast";
import type { Instance } from "@/lib/types";

/** Welche Instanz gerade einen der Dialoge offen hat (einmal im Layout gerendert). */
const useInstanceActions = create<{ template: Instance | null; exporting: Instance | null; remove: Instance | null; newGroup: Instance | null }>(() => ({
  template: null,
  exporting: null,
  remove: null,
  newGroup: null,
}));

const askSaveTemplate = (instance: Instance) => useInstanceActions.setState({ template: instance });
const askExport = (instance: Instance) => useInstanceActions.setState({ exporting: instance });
export const askDelete = (instance: Instance) => useInstanceActions.setState({ remove: instance });
const askNewGroup = (instance: Instance) => useInstanceActions.setState({ newGroup: instance });

/** Spielordner der Instanz im Dateimanager öffnen; Fehler als Toast. */
function openInstanceFolder(instance: Instance) {
  api.instanceDir(instance.id).then(api.openPath).catch(toastError);
}

/** Instanz duplizieren: Fortschritt und „Abbrechen“ im Aufgaben-Menü, danach ein Toast mit Sprung zur Kopie. */
function useDuplicate() {
  const { t } = useI18n();
  const { run } = useBackgroundTask();
  const navigate = useNavigate();
  return (instance: Instance) =>
    run({
      key: `duplicate:${instance.id}`,
      label: t("components.instance.duplicateTask", { name: instance.name }),
      doneLabel: t("components.instance.duplicateTaskDone", { name: instance.name }),
      cancellable: true,
      task: (op) => api.duplicateInstance(instance.id, op),
      onDone: (copy) => toast.success(t("components.instance.createdQuoted", { name: copy.name }), { action: { label: t("common.open"), onClick: () => navigate(instanceUrl(copy.id)) } }),
    });
}

/**
 * Export als `.mrpack` wie Duplizieren im Aufgaben-Menü; der Erfolgs-Toast führt zur Datei im Dateimanager.
 * Gehört in InstanceDialogs, nicht in den Dialog: der schließt sofort, und mit ihm fiele der Erfolgs-Toast weg.
 */
function useExport() {
  const { t } = useI18n();
  const { run } = useBackgroundTask();
  return (instance: Instance, include: string[], path: string) =>
    run({
      key: `export:${instance.id}`,
      label: t("components.instance.exportTask", { name: instance.name }),
      doneLabel: t("components.instance.exportTaskDone", { name: instance.name }),
      cancellable: true,
      // Ein Content-Lauf liefert eine Instanz (für „Öffnen“ im Verlauf); beim Export ist es die exportierte, frisch gelesen:
      // die Kopie vom Öffnen des Dialogs könnte veraltet sein und landete im Cache.
      task: (op) => api.exportInstance(instance.id, include, path, op).then(() => api.getInstance(instance.id)),
      onDone: () =>
        toast.success(t("components.instance.exportedQuoted", { name: instance.name }), {
          description: path,
          action: { label: t("components.instance.revealInFolder"), onClick: () => revealLocalPath(path) },
        }),
    });
}

/**
 * Gruppe einer Instanz wählen: vorhandene Gruppen, „Neue Gruppe…“, „Aus Gruppe entfernen“.
 * Instanz-Menü (als Untermenü) und Einstellungen teilen sich die Einträge.
 */
export function useGroupMenu(instance: Instance): MenuEntry[] {
  const { t } = useI18n();
  const groups = useGroups();
  const setGroup = useSetGroup(instance.id);
  const assign = (group: string | null) => setGroup.mutate(group);
  return [
    ...groups.map((group) => ({ id: `group:${group}`, text: group, checked: group === instance.group, onSelect: () => assign(group) })),
    ...(groups.length ? ["-" as const] : []),
    { id: "group-new", text: t("components.instance.newGroupMenu"), icon: "plus", onSelect: () => askNewGroup(instance) },
    ...(instance.group ? [{ id: "group-none", text: t("components.instance.removeFromGroup"), icon: "x" as const, onSelect: () => assign(null) }] : []),
  ];
}

/** Einträge für das Menü einer Instanz: Knopf „…“ und Rechtsklick teilen sie sich. */
export function useInstanceMenu(instance: Instance, opts: { open?: boolean } = { open: true }): MenuEntry[] {
  const { t } = useI18n();
  const phase = usePhase(instance.id);
  const play = usePlay();
  const duplicate = useDuplicate();
  const contentBusy = useContentState((s) => !!s.active);
  const navigate = useNavigate();
  const groupItems = useGroupMenu(instance);
  const running = phase === "running";
  const locked = isBusy(phase);
  return [
    running
      ? { id: "stop", text: t("components.game.quitEllipsis"), icon: "stop", onSelect: () => askStop(instance) }
      : { id: "play", text: t("common.play"), icon: "play", disabled: locked || phase === "loading", onSelect: () => void play(instance) },
    ...(opts.open ? [{ id: "open", text: t("components.instance.openInstance"), icon: "chev" as const, onSelect: () => navigate(instanceUrl(instance.id)) }] : []),
    { id: "log", text: t("components.log.ariaLabel"), icon: "term", onSelect: () => navigate(instanceUrl(instance.id, "console")) },
    { id: "dir", text: t("components.instance.openFolder"), icon: "folder", onSelect: () => openInstanceFolder(instance) },
    { id: "group", text: t("components.instance.group"), icon: "box", disabled: locked, items: groupItems },
    "-",
    { id: "dup", text: t("components.instance.duplicate"), icon: "copy", disabled: locked || contentBusy, onSelect: () => duplicate(instance) },
    { id: "exp", text: t("components.instance.exportEllipsis"), icon: "ul", disabled: locked || contentBusy, onSelect: () => askExport(instance) },
    { id: "tpl", text: t("components.instance.saveAsTemplate"), icon: "save", onSelect: () => askSaveTemplate(instance) },
    "-",
    { id: "del", text: t("common.delete"), icon: "trash", bad: true, disabled: locked, onSelect: () => askDelete(instance) },
  ];
}

/**
 * Symbolknopf „Weitere Aktionen“ mit dem Instanz-Menü. `small`: 32 statt 40 px, `large`: 56 px (neben dem großen Spielen-Knopf); `variant`: s = Platte, g = Geist;
 * `onScene`: über einer Szene (Grundplatte, harter Schatten).
 */
export function InstanceMenuButton({ instance, small, large, variant = "s", onScene, open }: { instance: Instance; small?: boolean; large?: boolean; variant?: "s" | "g"; onScene?: boolean; open?: boolean }) {
  const { t } = useI18n();
  const items = useInstanceMenu(instance, { open });
  return (
    <Menu
      items={items}
      trigger={
        <IconButton
          variant={variant === "g" ? "ghost" : "secondary"}
          size={small ? "s" : large ? "l" : "m"}
          onScene={onScene}
          icon="more"
          label={t("components.instance.moreActionsFor", { name: instance.name })}
          tip={t("components.instance.moreActions")}
        />
      }
    />
  );
}

function SaveTemplateDialog({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const { t } = useI18n();
  const save = useSaveTemplate();
  return (
    <NameDialog
      title={t("components.instance.saveAsTemplate")}
      label={t("components.instance.templateName")}
      help={t("components.instance.templateHelp", { count: instance.mods.length })}
      initial={instance.name}
      maxLength={100}
      pending={save.isPending}
      allowBlank
      onSubmit={(name) => save.mutate({ instance, name: name || instance.name }, { onSuccess: onClose })}
      onClose={onClose}
    />
  );
}

/** Dateiname für den Speichern-Dialog: Windows lehnt `:` & Co. ab, `/` läse der Dialog als Ordner. */
const packFileName = (name: string) => `${name.replace(/[<>:"/\\|?*]/g, "_").trim() || t("common.instance")}.mrpack`;

/** Was ein Export ohne Zutun mitnimmt; Welten nur auf Wunsch (groß und persönlich). */
const EXPORT_DEFAULTS = ["config", "mods", "resourcepacks", "shaderpacks", "options.txt"];

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

function ExportDialog({ instance, onExport, onClose }: { instance: Instance; onExport: (include: string[], path: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const entries = useExportEntries(instance.id);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(entries.data?.filter((name) => EXPORT_DEFAULTS.includes(name)));
  const toggle = (name: string, on: boolean) => setPicked(new Set(on ? [...chosen, name] : [...chosen].filter((n) => n !== name)));

  async function submit() {
    const path = await saveFile({ defaultPath: packFileName(instance.name), filters: [{ name: t("components.export.fileFilter"), extensions: ["mrpack"] }] });
    if (!path) return;
    onExport([...chosen], path);
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("components.instance.export")}
      sub={instance.name}
      width={480}
      footLeft={api.isMock ? t("components.export.appOnly") : undefined}
      footer={<DialogActions cancel={t("common.cancel")} confirm={{ label: t("components.instance.export"), width: 150, disabled: api.isMock || !entries.data, onClick: submit }} />}
    >
      <Field label={t("components.export.include")} group help={t("components.export.includeHelp")}>
        {entries.error ? (
          <Hint tone="bad">{entries.error.message}</Hint>
        ) : !entries.data ? (
          <Skel h={120} />
        ) : entries.data.length ? (
          <div className="flex flex-col gap-2">
            {entries.data.map((name) => (
              <Checkbox key={name} checked={chosen.has(name)} onChange={(on) => toggle(name, on)}>
                {ENTRY_LABELS[name] ? `${t(ENTRY_LABELS[name])} (${name})` : name}
              </Checkbox>
            ))}
          </div>
        ) : (
          <Hint>{t("components.export.folderEmpty")}</Hint>
        )}
      </Field>
    </Dialog>
  );
}

function NewGroupDialog({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const { t } = useI18n();
  const setGroup = useSetGroup(instance.id);
  return (
    <NameDialog
      title={t("components.instance.newGroupTitle")}
      label={t("components.instance.groupName")}
      help={t("components.instance.groupHelp", { name: instance.name })}
      initial=""
      maxLength={40}
      pending={setGroup.isPending}
      onSubmit={(group) => setGroup.mutate(group, { onSuccess: onClose })}
      onClose={onClose}
    />
  );
}

/** Dialoge der Instanz-Aktionen; einmal im Layout. */
export function InstanceDialogs() {
  const { t } = useI18n();
  const { template, exporting, remove, newGroup } = useInstanceActions();
  const del = useDeleteInstance();
  const exportPack = useExport();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const close = () => useInstanceActions.setState({ template: null, exporting: null, remove: null, newGroup: null });
  return (
    <>
      {template && <SaveTemplateDialog key={template.id} instance={template} onClose={close} />}
      {exporting && <ExportDialog key={exporting.id} instance={exporting} onExport={(include, path) => exportPack(exporting, include, path)} onClose={close} />}
      {newGroup && <NewGroupDialog key={newGroup.id} instance={newGroup} onClose={close} />}
      <ConfirmDialog
        {...confirmTargetProps(remove, close, {
          title: (instance) => t("components.instance.deleteQuotedTitle", { name: instance.name }),
          text: () => t("components.instance.deleteText"),
          pending: del.isPending,
          onConfirm: (instance, closeDialog) =>
            del.mutate(instance.id, {
              onSuccess: () => {
                if (pathname.startsWith(`/instances/${instance.id}`)) navigate("/instances");
                closeDialog();
              },
            }),
        })}
      />
    </>
  );
}
