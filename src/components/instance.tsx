import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { save as saveFile } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { create } from "zustand";
import { Checkbox, ConfirmDialog, Dialog, DialogActions, Field, Hint, IconButton, Menu, Skel, TextField, type MenuEntry } from "@/ui";
import { usePhase } from "@/components/game";
import { useContentInstall, useContentState, withTarget } from "@/hooks/useContent";
import { askStop, useDeleteInstance, useExportEntries, useExportInstance, usePlay } from "@/hooks/useInstances";
import { useSaveTemplate } from "@/hooks/useTemplates";
import { api } from "@/lib/api";
import type { Instance } from "@/lib/types";

/** Welche Instanz gerade einen der Dialoge offen hat (einmal im Layout gerendert). */
const useInstanceActions = create<{ template: Instance | null; exporting: Instance | null; remove: Instance | null }>(() => ({
  template: null,
  exporting: null,
  remove: null,
}));

export const askSaveTemplate = (instance: Instance) => useInstanceActions.setState({ template: instance });
export const askExport = (instance: Instance) => useInstanceActions.setState({ exporting: instance });
export const askDelete = (instance: Instance) => useInstanceActions.setState({ remove: instance });

/** Spielordner der Instanz im Dateimanager öffnen; Fehler als Toast. */
export function openInstanceFolder(instance: Instance) {
  api.instanceDir(instance.id).then(api.openPath).catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));
}

/** Instanz duplizieren: Fortschritt im Aufgaben-Menü, danach ein Toast mit Sprung zur Kopie. */
function useDuplicate() {
  const install = useContentInstall();
  const navigate = useNavigate();
  return (instance: Instance) =>
    install.mutate(withTarget(`duplicate:${instance.id}`, (op) => api.duplicateInstance(instance.id, op), `${instance.name} duplizieren`), {
      onSuccess: (copy) => copy && toast.success(`„${copy.name}“ angelegt`, { action: { label: "Öffnen", onClick: () => navigate(`/instances/${copy.id}`) } }),
    });
}

/** Einträge für das Menü einer Instanz: Knopf „…“ und Rechtsklick teilen sie sich. */
export function useInstanceMenu(instance: Instance, opts: { open?: boolean } = { open: true }): MenuEntry[] {
  const phase = usePhase(instance.id);
  const play = usePlay();
  const duplicate = useDuplicate();
  const contentBusy = useContentState((s) => !!s.active);
  const navigate = useNavigate();
  const running = phase === "running";
  const busy = phase === "preparing" || phase === "starting";
  return [
    running
      ? { id: "stop", text: "Beenden…", icon: "stop", onSelect: () => askStop(instance) }
      : { id: "play", text: "Spielen", icon: "play", disabled: busy || phase === "loading", onSelect: () => void play(instance) },
    ...(opts.open ? [{ id: "open", text: "Instanz öffnen", icon: "chev" as const, onSelect: () => navigate(`/instances/${instance.id}`) }] : []),
    { id: "log", text: "Protokoll", icon: "term", onSelect: () => navigate(`/instances/${instance.id}?tab=console`) },
    { id: "dir", text: "Ordner öffnen", icon: "folder", onSelect: () => openInstanceFolder(instance) },
    "-",
    { id: "dup", text: "Duplizieren", icon: "copy", disabled: running || busy || contentBusy, onSelect: () => duplicate(instance) },
    { id: "exp", text: "Exportieren…", icon: "ul", disabled: running || busy, onSelect: () => askExport(instance) },
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

function ExportDialog({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const entries = useExportEntries(instance.id);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(entries.data?.filter((name) => EXPORT_DEFAULTS.includes(name)));
  const exp = useExportInstance();
  const toggle = (name: string, on: boolean) => setPicked(new Set(on ? [...chosen, name] : [...chosen].filter((n) => n !== name)));

  async function submit() {
    const path = await saveFile({ defaultPath: `${instance.name}.mrpack`, filters: [{ name: "Modrinth-Modpack", extensions: ["mrpack"] }] });
    if (path) exp.mutate({ instance, include: [...chosen], path }, { onSuccess: onClose });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Exportieren"
      sub={instance.name}
      width={480}
      footLeft={api.isMock ? "Nur in der App." : undefined}
      footer={<DialogActions cancel="Abbrechen" confirm={{ label: exp.isPending ? "Exportiert" : "Exportieren", width: 150, disabled: api.isMock || !entries.data || exp.isPending, onClick: submit }} />}
    >
      <Field label="Mitnehmen" group help="Inhalte von Modrinth werden verlinkt, alles andere kommt mit in die Datei. CurseForge-Dateien darfst du so nicht unbedingt öffentlich teilen.">
        {entries.error ? (
          <Hint tone="bad">{entries.error.message}</Hint>
        ) : !entries.data ? (
          <Skel h={120} />
        ) : entries.data.length ? (
          <div className="flex flex-col gap-2">
            {entries.data.map((name) => (
              <Checkbox key={name} checked={chosen.has(name)} disabled={exp.isPending} onChange={(on) => toggle(name, on)}>
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

/** Dialoge der Instanz-Aktionen; einmal im Layout. */
export function InstanceDialogs() {
  const { template, exporting, remove } = useInstanceActions();
  const del = useDeleteInstance();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const close = () => useInstanceActions.setState({ template: null, exporting: null, remove: null });
  return (
    <>
      {template && <SaveTemplateDialog key={template.id} instance={template} onClose={close} />}
      {exporting && <ExportDialog key={exporting.id} instance={exporting} onClose={close} />}
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
