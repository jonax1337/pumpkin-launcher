import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { create } from "zustand";
import { ConfirmDialog, Dialog, DialogActions, Field, IconButton, Menu, TextField, type MenuEntry } from "@/ui";
import { usePhase } from "@/components/game";
import { askStop, useDeleteInstance, useGroups, usePlay, useUpdateInstance } from "@/hooks/useInstances";
import { useSaveTemplate } from "@/hooks/useTemplates";
import { api } from "@/lib/api";
import type { Instance } from "@/lib/types";

/** Welche Instanz gerade einen der Dialoge offen hat (einmal im Layout gerendert). */
const useInstanceActions = create<{ template: Instance | null; remove: Instance | null; newGroup: Instance | null }>(() => ({
  template: null,
  remove: null,
  newGroup: null,
}));

export const askSaveTemplate = (instance: Instance) => useInstanceActions.setState({ template: instance });
export const askDelete = (instance: Instance) => useInstanceActions.setState({ remove: instance });
const askNewGroup = (instance: Instance) => useInstanceActions.setState({ newGroup: instance });

/** Spielordner der Instanz im Dateimanager öffnen; Fehler als Toast. */
export function openInstanceFolder(instance: Instance) {
  api.instanceDir(instance.id).then(api.openPath).catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));
}

/**
 * Gruppe einer Instanz wählen: vorhandene Gruppen, „Neue Gruppe…“, „Aus Gruppe entfernen“.
 * Instanz-Menü (als Untermenü) und Einstellungen teilen sich die Einträge.
 */
export function useGroupMenu(instance: Instance): MenuEntry[] {
  const groups = useGroups();
  const update = useUpdateInstance();
  const assign = (group: string | null) => update.mutate({ ...instance, group });
  return [
    ...groups.map((group) => ({ id: `group:${group}`, text: group, checked: group === instance.group, onSelect: () => assign(group) })),
    ...(groups.length ? ["-" as const] : []),
    { id: "group-new", text: "Neue Gruppe…", icon: "plus", onSelect: () => askNewGroup(instance) },
    ...(instance.group ? [{ id: "group-none", text: "Aus Gruppe entfernen", icon: "x" as const, onSelect: () => assign(null) }] : []),
  ];
}

/** Einträge für das Menü einer Instanz: Knopf „…“ und Rechtsklick teilen sie sich. */
export function useInstanceMenu(instance: Instance, opts: { open?: boolean } = { open: true }): MenuEntry[] {
  const phase = usePhase(instance.id);
  const play = usePlay();
  const navigate = useNavigate();
  const groupItems = useGroupMenu(instance);
  const running = phase === "running";
  const busy = phase === "preparing" || phase === "starting";
  return [
    running
      ? { id: "stop", text: "Beenden…", icon: "stop", onSelect: () => askStop(instance) }
      : { id: "play", text: "Spielen", icon: "play", disabled: busy || phase === "loading", onSelect: () => void play(instance) },
    ...(opts.open ? [{ id: "open", text: "Instanz öffnen", icon: "chev" as const, onSelect: () => navigate(`/instances/${instance.id}`) }] : []),
    { id: "log", text: "Protokoll", icon: "term", onSelect: () => navigate(`/instances/${instance.id}?tab=console`) },
    { id: "dir", text: "Ordner öffnen", icon: "folder", onSelect: () => openInstanceFolder(instance) },
    { id: "group", text: "Gruppe", icon: "box", disabled: running || busy, items: groupItems },
    "-",
    { id: "tpl", text: "Als Vorlage speichern", icon: "save", onSelect: () => askSaveTemplate(instance) },
    "-",
    { id: "del", text: "Löschen", icon: "trash", bad: true, disabled: running || busy, onSelect: () => askDelete(instance) },
  ];
}

/**
 * Symbolknopf „Weitere Aktionen“ mit dem Instanz-Menü. `small`: 32 statt 40 px, `large`: 56 px (neben dem großen Spielen-Knopf); `variant`: s = Platte, g = Geist;
 * `onScene`: über einer Szene (Grundplatte, harter Schatten).
 */
export function InstanceMenuButton({ instance, small, large, variant = "s", onScene, open }: { instance: Instance; small?: boolean; large?: boolean; variant?: "s" | "g"; onScene?: boolean; open?: boolean }) {
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
          label={`Weitere Aktionen für ${instance.name}`}
          tip="Weitere Aktionen"
        />
      }
    />
  );
}

function SaveTemplateDialog({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const [name, setName] = useState(instance.name);
  const save = useSaveTemplate();
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ instance, name: name.trim() || instance.name }, { onSuccess: onClose });
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Als Vorlage speichern"
      width={480}
      footer={<DialogActions cancel="Abbrechen" confirm={{ label: save.isPending ? "Speichert" : "Speichern", width: 130, form: "tpl-form", disabled: save.isPending }} />}
    >
      <form id="tpl-form" onSubmit={submit}>
        <Field label="Name der Vorlage" help={<>Gespeichert werden Version, Loader, {instance.mods.length} Inhalte und Einstellungen. Welten nicht.</>}>
          <TextField value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
        </Field>
      </form>
    </Dialog>
  );
}

function NewGroupDialog({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const [name, setName] = useState("");
  const update = useUpdateInstance();
  const group = name.trim();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (group) update.mutate({ ...instance, group }, { onSuccess: onClose });
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Neue Gruppe"
      width={480}
      footer={<DialogActions cancel="Abbrechen" confirm={{ label: update.isPending ? "Speichert" : "Speichern", width: 130, form: "group-form", disabled: !group || update.isPending }} />}
    >
      <form id="group-form" onSubmit={submit}>
        <Field label="Name der Gruppe" help={<>„{instance.name}“ kommt in diese Gruppe. Eine Gruppe ohne Instanzen verschwindet von selbst.</>}>
          <TextField value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
        </Field>
      </form>
    </Dialog>
  );
}

/** Dialoge der Instanz-Aktionen; einmal im Layout. */
export function InstanceDialogs() {
  const { template, remove, newGroup } = useInstanceActions();
  const del = useDeleteInstance();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const close = () => useInstanceActions.setState({ template: null, remove: null, newGroup: null });
  return (
    <>
      {template && <SaveTemplateDialog key={template.id} instance={template} onClose={close} />}
      {newGroup && <NewGroupDialog key={newGroup.id} instance={newGroup} onClose={close} />}
      <ConfirmDialog
        open={!!remove}
        onOpenChange={(o) => !o && close()}
        title={`„${remove?.name ?? ""}“ löschen?`}
        text="Mods, Einstellungen und Welten dieser Instanz werden gelöscht. Das lässt sich nicht rückgängig machen."
        pending={del.isPending}
        onConfirm={() =>
          remove &&
          del.mutate(remove.id, {
            onSuccess: () => {
              if (pathname.startsWith(`/instances/${remove.id}`)) navigate("/instances");
              close();
            },
          })
        }
      />
    </>
  );
}
