import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { create } from "zustand";
import { useI18n } from "@/i18n";
import { ConfirmDialog, IconButton, Menu, type MenuEntry } from "@/ui";
import { isBusy, usePhase } from "@/components/play/phase";
import { DeleteInstanceText } from "@/components/DeleteInstanceText";
import { ExportDialog } from "@/components/ExportDialog";
import { NameDialog } from "@/components/NameDialog";
import { useBackgroundTask } from "@/hooks/useBackgroundTask";
import { confirmTargetProps } from "@/hooks/useConfirmTarget";
import { useContentState } from "@/store/contentState";
import { useDeleteInstance, useGroups, useRenameInstance, useSetGroup } from "@/hooks/useInstances";
import { usePlay } from "@/hooks/usePlay";
import { askStop } from "@/store/stopAsk";
import { useSaveTemplate } from "@/hooks/useTemplates";
import { api } from "@/lib/api";
import type { ExportRequest } from "@/lib/backend";
import { revealLocalPath } from "@/lib/links";
import { instanceUrl } from "@/lib/routes";
import { toastError } from "@/lib/toast";
import type { Instance } from "@/lib/types";

/** Maximale Länge des Instanznamens. */
export const NAME_MAX_LENGTH = 64;

/** Welche Instanz gerade einen der Dialoge offen hat (einmal im Layout gerendert). */
type InstanceActions = {
  template: Instance | null;
  exporting: Instance | null;
  remove: Instance | null;
  newGroup: Instance | null;
  renaming: Instance | null;
};
const NO_DIALOG: InstanceActions = { template: null, exporting: null, remove: null, newGroup: null, renaming: null };
const useInstanceActions = create<InstanceActions>(() => NO_DIALOG);

const askRename = (instance: Instance) => useInstanceActions.setState({ renaming: instance });
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
      onDone: (copy) =>
        toast.success(t("components.instance.createdQuoted", { name: copy.name }), {
          action: { label: t("common.open"), onClick: () => navigate(instanceUrl(copy.id)) },
        }),
    });
}

/**
 * Export als `.mrpack` wie Duplizieren im Aufgaben-Menü; der Erfolgs-Toast führt zur Datei im Dateimanager.
 * Gehört in InstanceDialogs, nicht in den Dialog: der schließt sofort, und mit ihm fiele der Erfolgs-Toast weg.
 */
function useExport() {
  const { t } = useI18n();
  const { run } = useBackgroundTask();
  return (instance: Instance, request: ExportRequest, path: string) =>
    run({
      key: `export:${instance.id}`,
      label: t("components.instance.exportTask", { name: instance.name }),
      doneLabel: t("components.instance.exportTaskDone", { name: instance.name }),
      cancellable: true,
      // Ein Content-Lauf liefert eine Instanz (für „Öffnen“ im Verlauf); beim Export ist es die exportierte, frisch gelesen:
      // die Kopie vom Öffnen des Dialogs könnte veraltet sein und landete im Cache.
      task: (op) => api.exportInstance(instance.id, request, path, op).then(() => api.getInstance(instance.id)),
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
    ...(instance.group
      ? [{ id: "group-none", text: t("components.instance.removeFromGroup"), icon: "x" as const, onSelect: () => assign(null) }]
      : []),
  ];
}

/**
 * Einträge für das Menü einer Instanz: Knopf „…“ und Rechtsklick teilen sie sich.
 * `showOpen = false` lässt „Instanz öffnen“ weg, wo die Instanz schon offen ist oder die Karte selbst sie öffnet.
 */
export function useInstanceMenu(instance: Instance, { showOpen = true }: { showOpen?: boolean } = {}): MenuEntry[] {
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
    ...(showOpen
      ? [
          {
            id: "open",
            text: t("components.instance.openInstance"),
            icon: "chev" as const,
            onSelect: () => navigate(instanceUrl(instance.id)),
          },
        ]
      : []),
    { id: "settings", text: t("common.settings"), icon: "gear", onSelect: () => navigate(instanceUrl(instance.id, "settings")) },
    { id: "log", text: t("components.log.ariaLabel"), icon: "term", onSelect: () => navigate(instanceUrl(instance.id, "console")) },
    { id: "dir", text: t("components.instance.openFolder"), icon: "folder", onSelect: () => openInstanceFolder(instance) },
    "-",
    { id: "rename", text: t("common.rename"), icon: "file", disabled: locked, onSelect: () => askRename(instance) },
    { id: "group", text: t("components.instance.group"), icon: "box", disabled: locked, items: groupItems },
    {
      id: "dup",
      text: t("components.instance.duplicate"),
      icon: "copy",
      disabled: locked || contentBusy,
      onSelect: () => duplicate(instance),
    },
    {
      id: "exp",
      text: t("components.instance.exportEllipsis"),
      icon: "ul",
      disabled: locked || contentBusy,
      onSelect: () => askExport(instance),
    },
    { id: "tpl", text: t("components.instance.saveAsTemplate"), icon: "save", onSelect: () => askSaveTemplate(instance) },
    "-",
    { id: "del", text: t("common.delete"), icon: "trash", bad: true, disabled: locked, onSelect: () => askDelete(instance) },
  ];
}

type MenuButtonProps = {
  instance: Instance;
  /** 32 (`s`), 40 (`m`) oder 56 px (`l`, neben dem großen Spielen-Knopf). */
  size?: "s" | "m" | "l";
  variant?: "secondary" | "ghost";
  /** Über einer Szene (Grundplatte, harter Schatten). */
  onScene?: boolean;
  showOpen?: boolean;
};

/** Symbolknopf „Weitere Aktionen“ mit dem Instanz-Menü. */
export function InstanceMenuButton({ instance, size = "m", variant = "secondary", onScene, showOpen }: MenuButtonProps) {
  const { t } = useI18n();
  const items = useInstanceMenu(instance, { showOpen });
  return (
    <Menu
      items={items}
      trigger={
        <IconButton
          variant={variant}
          size={size}
          onScene={onScene}
          icon="more"
          label={t("components.instance.moreActionsFor", { name: instance.name })}
          tip={t("components.instance.moreActions")}
        />
      }
    />
  );
}

function RenameDialog({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const { t } = useI18n();
  const rename = useRenameInstance(instance.id);
  function renamed() {
    toast.success(t("detail.settings.nameSaved"));
    onClose();
  }
  const submit = (name: string) => (name === instance.name ? onClose() : rename.mutate(name, { onSuccess: renamed }));
  return (
    <NameDialog
      title={t("components.instance.renameTitle")}
      label={t("components.instance.nameField")}
      initial={instance.name}
      maxLength={NAME_MAX_LENGTH}
      pending={rename.isPending}
      onSubmit={submit}
      onClose={onClose}
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
  const { template, exporting, remove, newGroup, renaming } = useInstanceActions();
  const del = useDeleteInstance();
  const exportPack = useExport();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const close = () => useInstanceActions.setState(NO_DIALOG);
  return (
    <>
      {template && <SaveTemplateDialog key={template.id} instance={template} onClose={close} />}
      {exporting && (
        <ExportDialog
          key={exporting.id}
          instance={exporting}
          onExport={(request, path) => exportPack(exporting, request, path)}
          onClose={close}
        />
      )}
      {newGroup && <NewGroupDialog key={newGroup.id} instance={newGroup} onClose={close} />}
      {renaming && <RenameDialog key={renaming.id} instance={renaming} onClose={close} />}
      <ConfirmDialog
        {...confirmTargetProps(remove, close, {
          title: (instance) => t("components.instance.deleteQuotedTitle", { name: instance.name }),
          text: (instance) => <DeleteInstanceText instance={instance} />,
          pending: del.isPending,
          onConfirm: (instance, closeDialog) =>
            del.mutate(instance.id, {
              onSuccess: () => {
                if (pathname.startsWith(instanceUrl(instance.id))) navigate("/instances");
                closeDialog();
              },
            }),
        })}
      />
    </>
  );
}
