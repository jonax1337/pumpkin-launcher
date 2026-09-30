import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { create } from "zustand";
import { Btn, ConfirmDialog, Dialog, DialogClose, Menu, TextField, type MenuEntry } from "@/components/px";
import { usePhase } from "@/components/game";
import { askStop, useDeleteInstance, usePlay } from "@/hooks/useInstances";
import { useSaveTemplate } from "@/hooks/useTemplates";
import { api } from "@/lib/api";
import type { Instance } from "@/lib/types";

/** Welche Instanz gerade einen der beiden Dialoge offen hat (einmal im Layout gerendert). */
const useInstanceActions = create<{ template: Instance | null; remove: Instance | null }>(() => ({ template: null, remove: null }));

export const askSaveTemplate = (instance: Instance) => useInstanceActions.setState({ template: instance });
export const askDelete = (instance: Instance) => useInstanceActions.setState({ remove: instance });

/** Spielordner der Instanz im Dateimanager öffnen; Fehler als Toast. */
export function openInstanceFolder(instance: Instance) {
  api.instanceDir(instance.id).then(api.openPath).catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));
}

/** Einträge für das Menü einer Instanz: Knopf „…“ und Rechtsklick teilen sie sich. */
export function useInstanceMenu(instance: Instance, opts: { open?: boolean } = { open: true }): MenuEntry[] {
  const phase = usePhase(instance.id);
  const play = usePlay();
  const navigate = useNavigate();
  const running = phase === "running";
  const busy = phase === "preparing" || phase === "starting";
  return [
    running
      ? { id: "stop", text: "Beenden…", icon: "stop", onSelect: () => askStop(instance) }
      : { id: "play", text: "Spielen", icon: "play", disabled: busy || phase === "loading", onSelect: () => void play(instance) },
    ...(opts.open ? [{ id: "open", text: "Öffnen", icon: "chev" as const, onSelect: () => navigate(`/instances/${instance.id}`) }] : []),
    { id: "log", text: "Protokoll", icon: "term", onSelect: () => navigate(`/instances/${instance.id}?tab=console`) },
    { id: "dir", text: "Ordner öffnen", icon: "folder", onSelect: () => openInstanceFolder(instance) },
    "-",
    { id: "tpl", text: "Als Vorlage speichern", icon: "save", onSelect: () => askSaveTemplate(instance) },
    "-",
    { id: "del", text: "Löschen", icon: "trash", bad: true, disabled: running || busy, onSelect: () => askDelete(instance) },
  ];
}

/** Knopf „Weitere Aktionen“ mit dem Instanz-Menü. */
export function InstanceMenuButton({ instance, small, variant = "s", open }: { instance: Instance; small?: boolean; variant?: "s" | "g"; open?: boolean }) {
  const items = useInstanceMenu(instance, { open });
  return (
    <Menu
      items={items}
      trigger={<Btn variant={variant} size={small ? "s" : "m"} iconOnly icon="more" aria-label={`Weitere Aktionen für ${instance.name}`} />}
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
      footer={
        <>
          <DialogClose asChild><Btn>Abbrechen</Btn></DialogClose>
          <Btn variant="p" full style={{ width: 130 }} type="submit" form="tpl-form" disabled={save.isPending}>{save.isPending ? "Speichert" : "Speichern"}</Btn>
        </>
      }
    >
      <form id="tpl-form" onSubmit={submit} className="nf">
        <label htmlFor="tpl-name">Name der Vorlage</label>
        <TextField id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
        <span className="help">Gespeichert werden Version, Loader, {instance.mods.length} Inhalte und Einstellungen. Welten nicht.</span>
      </form>
    </Dialog>
  );
}

/** Dialoge der Instanz-Aktionen; einmal im Layout. */
export function InstanceDialogs() {
  const { template, remove } = useInstanceActions();
  const del = useDeleteInstance();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const close = () => useInstanceActions.setState({ template: null, remove: null });
  return (
    <>
      {template && <SaveTemplateDialog key={template.id} instance={template} onClose={close} />}
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
