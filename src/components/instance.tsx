import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { save as saveFile } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { create } from "zustand";
import { Checkbox, ConfirmDialog, Dialog, DialogActions, Field, Hint, IconButton, Menu, Skel, TextField, type MenuEntry } from "@/ui";
import { usePhase } from "@/components/game";
import { useContentInstall, useContentState, withTarget } from "@/hooks/useContent";
import { askStop, useDeleteInstance, useExportEntries, useGroups, usePlay, useUpdateInstance } from "@/hooks/useInstances";
import { useSaveTemplate } from "@/hooks/useTemplates";
import { api } from "@/lib/api";
import type { Instance } from "@/lib/types";

/** Welche Instanz gerade einen der Dialoge offen hat (einmal im Layout gerendert). */
const useInstanceActions = create<{ template: Instance | null; exporting: Instance | null; remove: Instance | null; newGroup: Instance | null }>(() => ({
  template: null,
  exporting: null,
  remove: null,
  newGroup: null,
}));

export const askSaveTemplate = (instance: Instance) => useInstanceActions.setState({ template: instance });
export const askExport = (instance: Instance) => useInstanceActions.setState({ exporting: instance });
export const askDelete = (instance: Instance) => useInstanceActions.setState({ remove: instance });
const askNewGroup = (instance: Instance) => useInstanceActions.setState({ newGroup: instance });

/** Spielordner der Instanz im Dateimanager öffnen; Fehler als Toast. */
export function openInstanceFolder(instance: Instance) {
  api.instanceDir(instance.id).then(api.openPath).catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));
}

/** Instanz duplizieren: Fortschritt und „Abbrechen“ im Aufgaben-Menü, danach ein Toast mit Sprung zur Kopie. */
function useDuplicate() {
  const install = useContentInstall();
  const navigate = useNavigate();
  return (instance: Instance) =>
    install.mutate(withTarget(`duplicate:${instance.id}`, (op) => api.duplicateInstance(instance.id, op), `${instance.name} duplizieren`, { cancellable: true }), {
      onSuccess: (copy) => copy && toast.success(`„${copy.name}“ angelegt`, { action: { label: "Öffnen", onClick: () => navigate(`/instances/${copy.id}`) } }),
    });
}

/**
 * Export als `.mrpack` wie Duplizieren im Aufgaben-Menü; der Erfolgs-Toast führt zur Datei im Dateimanager.
 * Gehört in InstanceDialogs, nicht in den Dialog: der schließt sofort, und mit ihm fiele der Erfolgs-Toast weg.
 */
function useExport() {
  const install = useContentInstall();
  return (instance: Instance, include: string[], path: string) => {
    // Ein Content-Lauf liefert eine Instanz (für „Öffnen“ im Verlauf); beim Export ist es die exportierte.
    const run = (op: string) => api.exportInstance(instance.id, include, path, op).then(() => instance);
    install.mutate(withTarget(`export:${instance.id}`, run, `${instance.name} exportieren`, { cancellable: true }), {
      onSuccess: (exported) =>
        exported &&
        toast.success(`„${instance.name}“ exportiert`, {
          description: path,
          action: { label: "Im Ordner zeigen", onClick: () => api.revealPath(path).catch((e: Error) => toast.error(e.message)) },
        }),
    });
  };
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
  const duplicate = useDuplicate();
  const contentBusy = useContentState((s) => !!s.active);
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
    { id: "dup", text: "Duplizieren", icon: "copy", disabled: running || busy || contentBusy, onSelect: () => duplicate(instance) },
    { id: "exp", text: "Exportieren…", icon: "ul", disabled: running || busy || contentBusy, onSelect: () => askExport(instance) },
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

/** Dateiname für den Speichern-Dialog: Windows lehnt `:` & Co. ab, `/` läse der Dialog als Ordner. */
const packFileName = (name: string) => `${name.replace(/[<>:"/\\|?*]/g, "_").trim() || "Instanz"}.mrpack`;

/** Was ein Export ohne Zutun mitnimmt; Welten nur auf Wunsch (groß und persönlich). */
const EXPORT_DEFAULTS = ["config", "mods", "resourcepacks", "shaderpacks", "options.txt"];

/** Lesbare Namen bekannter Einträge im Spielordner. */
const ENTRY_LABELS: Record<string, string> = {
  config: "Mod-Einstellungen",
  mods: "Mods",
  resourcepacks: "Ressourcenpakete",
  shaderpacks: "Shader",
  "options.txt": "Spieleinstellungen",
  saves: "Welten",
  screenshots: "Screenshots",
  "servers.dat": "Serverliste",
};

function ExportDialog({ instance, onExport, onClose }: { instance: Instance; onExport: (include: string[], path: string) => void; onClose: () => void }) {
  const entries = useExportEntries(instance.id);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(entries.data?.filter((name) => EXPORT_DEFAULTS.includes(name)));
  const toggle = (name: string, on: boolean) => setPicked(new Set(on ? [...chosen, name] : [...chosen].filter((n) => n !== name)));

  async function submit() {
    const path = await saveFile({ defaultPath: packFileName(instance.name), filters: [{ name: "Modrinth-Modpack", extensions: ["mrpack"] }] });
    if (!path) return;
    onExport([...chosen], path);
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Exportieren"
      sub={instance.name}
      width={480}
      footLeft={api.isMock ? "Nur in der App." : undefined}
      footer={<DialogActions cancel="Abbrechen" confirm={{ label: "Exportieren", width: 150, disabled: api.isMock || !entries.data, onClick: submit }} />}
    >
      <Field label="Mitnehmen" group help="Inhalte von Modrinth werden verlinkt, alles andere kommt mit in die Datei. CurseForge-Dateien darfst du so nicht unbedingt öffentlich teilen.">
        {entries.error ? (
          <Hint tone="bad">{entries.error.message}</Hint>
        ) : !entries.data ? (
          <Skel h={120} />
        ) : entries.data.length ? (
          <div className="flex flex-col gap-2">
            {entries.data.map((name) => (
              <Checkbox key={name} checked={chosen.has(name)} onChange={(on) => toggle(name, on)}>
                {ENTRY_LABELS[name] ? `${ENTRY_LABELS[name]} (${name})` : name}
              </Checkbox>
            ))}
          </div>
        ) : (
          <Hint>Der Spielordner ist noch leer. Exportiert werden Version und Loader.</Hint>
        )}
      </Field>
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
        open={!!remove}
        onOpenChange={(o) => !o && close()}
        title={`„${remove?.name ?? ""}“ löschen?`}
        text="Mods, Einstellungen, Welten und Weltsicherungen dieser Instanz werden gelöscht. Das lässt sich nicht rückgängig machen."
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
