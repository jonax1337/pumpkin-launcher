import { useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Actions, Button, Cell, ConfirmDialog, Dialog, DialogActions, Empty, ErrorBox, Field, Glyph, IconButton, JobProgress, List, ListRow, Menu,
  ProjectIcon, RowTitle, SectionHeader, Segmented, Skel, TextField, Tip, type MenuEntry,
} from "@/ui";
import { usePhase } from "@/components/game";
import { useContentState } from "@/hooks/useContent";
import { usePlay } from "@/hooks/useInstances";
import {
  useDeleteBackup, useRemoveServer, useRestoreBackup, useSaveServer, useServers, useWorldBackups, useWorldJob, useWorldJobs, useWorldQuickPlay,
  useWorlds,
} from "@/hooks/useWorlds";
import { api } from "@/lib/api";
import { formatDateTime, formatSize, relativeTime } from "@/lib/format";
import { GAME_MODE_LABELS, type Instance, type QuickPlay, type Server, type World, type WorldBackup } from "@/lib/types";

/** Warum Spieldateien gerade nicht angefasst werden und nichts startet (null = frei); das Backend lässt nur einen Vorgang zu. */
function useBusyReason(instanceId: string): string | null {
  const phase = usePhase(instanceId);
  const worldJob = useWorldJob((s) => s.job != null);
  const contentBusy = useContentState((s) => s.active != null);
  if (phase === "running") return "Minecraft läuft gerade. Beende es zuerst.";
  if (phase === "preparing" || phase === "starting") return "Minecraft startet gerade.";
  if (worldJob) return "Gerade wird eine Welt gesichert.";
  if (contentBusy) return "Gerade läuft eine Installation. Warte, bis sie fertig ist.";
  return null;
}

/** „Hardcore · 1.21.4 · 182 MB · vor 2 Stunden“ */
const worldLine = (w: World) =>
  [w.hardcore ? "Hardcore" : w.gameMode && GAME_MODE_LABELS[w.gameMode], w.version, formatSize(w.sizeBytes), relativeTime(w.lastPlayed)].filter(Boolean).join(" · ");

/** Welten und Server einer Instanz: direkt hineinspielen, Welten sichern und wiederherstellen, Serverliste pflegen. */
export function WorldsTab({ instance, onLaunched }: { instance: Instance; onLaunched: () => void }) {
  const play = usePlay();
  const busy = useBusyReason(instance.id);
  const quickPlay = (target: QuickPlay) => void play(instance, onLaunched, target);
  return (
    <div className="max-w-[var(--page-max)] pt-2">
      <WorldsSection instance={instance} busy={busy} onPlay={quickPlay} />
      <ServersSection instance={instance} busy={busy} onPlay={quickPlay} />
    </div>
  );
}

/** Knopf, der gesperrt erreichbar bleibt und den Grund (`blocked`) im Tooltip nennt. */
function GuardedButton({ blocked, onClick, ...props }: { blocked: string | null } & ComponentProps<typeof Button>) {
  return (
    <Tip label={blocked} describe>
      <Button {...props} aria-disabled={blocked ? true : undefined} onClick={(e) => !blocked && onClick?.(e)} />
    </Tip>
  );
}

/** Laden, Fehler und leere Liste; sonst `children` mit den Einträgen. */
function QueryList<T>({ query, error, empty, children }: { query: UseQueryResult<T[]>; error: string; empty: ReactNode; children: (items: T[]) => ReactNode }) {
  if (query.error) return <ErrorBox title={error} error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <Skel h={56} />;
  return query.data.length ? children(query.data) : empty;
}

type SectionProps = { instance: Instance; busy: string | null; onPlay: (target: QuickPlay) => void };

function WorldsSection({ instance, busy, onPlay }: SectionProps) {
  const worlds = useWorlds(instance.id);
  const startsIntoWorlds = useWorldQuickPlay(instance);
  const { backup, remove } = useWorldJobs(instance);
  const job = useWorldJob((s) => (s.job?.instanceId === instance.id ? s.job : null));
  const [removing, setRemoving] = useState<World | null>(null);
  // Sicherungen einer Welt bzw. (world = null) aller Welten, auch gelöschter.
  const [showBackups, setShowBackups] = useState<{ world: string | null } | null>(null);
  const playBlocked = busy ?? (startsIntoWorlds === false ? `Minecraft ${instance.minecraftVersion} kann nicht direkt in eine Welt starten, das geht erst ab 1.20.` : null);

  const menuFor = (w: World): MenuEntry[] => [
    { id: "dir", text: "Ordner öffnen", icon: "folder", onSelect: () => void api.openPath(w.path).catch((e: Error) => toast.error(e.message)) },
    { id: "backup", text: "Sichern", icon: "save", disabled: !!busy, onSelect: () => backup.mutate(w) },
    { id: "backups", text: "Sicherungen…", icon: "clock", onSelect: () => setShowBackups({ world: w.id }) },
    "-",
    { id: "del", text: "Löschen…", icon: "trash", bad: true, disabled: !!busy, onSelect: () => setRemoving(w) },
  ];

  return (
    <section aria-labelledby="worlds-h">
      <SectionHeader
        id="worlds-h"
        title="Welten"
        actions={<Button variant="ghost" size="s" icon="clock" bleed="end" onClick={() => setShowBackups({ world: null })}>Sicherungen</Button>}
      />
      <div className="mt-3">
        <QueryList
          query={worlds}
          error="Die Welten konnten nicht geladen werden"
          empty={<Empty ill={<Glyph name="mountain" pal="teal" box={64} />} title="Noch keine Welten">Leg im Spiel eine Welt an, dann startest du sie hier mit einem Klick.</Empty>}
        >
          {(list) => (
            <List variant="worlds" divided aria-label="Welten">
              {list.map((w) => (
                <ListRow key={w.id} menu={menuFor(w)}>
                  <ProjectIcon url={w.icon} seed={w.id} />
                  {/* Wie im Spiel: der Ordner steht dabei, wenn er anders heißt (z. B. wiederhergestellte Kopien). */}
                  <RowTitle title={w.name} aside={w.name === w.id ? undefined : w.id} sub={worldLine(w)} />
                  <Cell flex align="end">
                    {job?.worldId === w.id ? (
                      <JobProgress label="Wird gesichert" p={job.p} width={120} />
                    ) : (
                      <GuardedButton size="s" icon="play" blocked={playBlocked} aria-label={`Spielen: ${w.name}`} onClick={() => onPlay({ type: "world", id: w.id })}>
                        Spielen
                      </GuardedButton>
                    )}
                  </Cell>
                  <Menu items={menuFor(w)} trigger={<IconButton size="s" icon="more" tip={false} label={`Mehr zu ${w.name}`} />} />
                </ListRow>
              ))}
            </List>
          )}
        </QueryList>
      </div>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`„${removing?.name ?? ""}“ löschen?`}
        text="Vorher legt Pumpkin Launcher eine Sicherung an. Unter „Sicherungen“ holst du die Welt zurück, solange es die Instanz gibt."
        onConfirm={() => {
          if (removing) remove.mutate(removing);
          setRemoving(null);
        }}
      />
      {showBackups && <BackupsDialog instance={instance} world={showBackups.world} busy={busy} onClose={() => setShowBackups(null)} />}
    </section>
  );
}

/** Sicherungen einer Welt (`world`) oder aller Welten: wiederherstellen (immer als neue Welt) oder löschen. */
function BackupsDialog({ instance, world, busy, onClose }: { instance: Instance; world: string | null; busy: string | null; onClose: () => void }) {
  const backups = useWorldBackups(instance.id, world);
  const restore = useRestoreBackup(instance.id);
  const remove = useDeleteBackup(instance.id);
  const [removing, setRemoving] = useState<WorldBackup | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Sicherungen" sub={world ?? instance.name} width={560} footer={<DialogActions cancel="Schließen" />}>
      <QueryList
        query={backups}
        error="Die Sicherungen konnten nicht geladen werden"
        empty={<Empty size="pane" ill="clock" title="Noch keine Sicherungen">Sichere eine Welt über ihr Menü. Beim Löschen legt Pumpkin Launcher selbst eine an.</Empty>}
      >
        {(list) => (
          <List variant="versions" aria-label="Sicherungen">
            {list.map((b) => (
              <ListRow key={b.id}>
                {/* Für eine Welt zählt der Zeitpunkt; in der Liste aller Welten zuerst, welche es ist. */}
                {world == null ? (
                  <RowTitle title={b.world} sub={`${formatDateTime(b.createdAt)} · ${formatSize(b.sizeBytes)}`} />
                ) : (
                  <RowTitle title={formatDateTime(b.createdAt)} sub={formatSize(b.sizeBytes)} />
                )}
                <Actions gap={4}>
                  <GuardedButton size="s" icon="redo" blocked={busy} disabled={restore.isPending} onClick={() => restore.mutate(b)}>
                    Wiederherstellen
                  </GuardedButton>
                  <IconButton size="s" icon="trash" label={`Sicherung vom ${formatDateTime(b.createdAt)} löschen`} tip="Löschen" onClick={() => setRemoving(b)} />
                </Actions>
              </ListRow>
            ))}
          </List>
        )}
      </QueryList>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Sicherung löschen?"
        text={removing && `Die Sicherung von „${removing.world}“ vom ${formatDateTime(removing.createdAt)} ist danach weg.`}
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing, { onSuccess: () => setRemoving(null) })}
      />
    </Dialog>
  );
}

const NEW_SERVER: Server = { name: "", address: "", icon: null, acceptTextures: null };

function ServersSection({ instance, busy, onPlay }: SectionProps) {
  const servers = useServers(instance.id);
  const remove = useRemoveServer(instance.id);
  // Server im Dialog; `index` null = neu.
  const [editing, setEditing] = useState<{ index: number | null; server: Server } | null>(null);
  const [removing, setRemoving] = useState<{ index: number; server: Server } | null>(null);
  const addButton = (
    <GuardedButton size="s" icon="plus" blocked={busy} onClick={() => setEditing({ index: null, server: NEW_SERVER })}>
      Hinzufügen
    </GuardedButton>
  );

  const menuFor = (server: Server, index: number): MenuEntry[] => [
    { id: "edit", text: "Bearbeiten…", icon: "file", disabled: !!busy, onSelect: () => setEditing({ index, server }) },
    "-",
    { id: "rm", text: "Entfernen…", icon: "trash", bad: true, disabled: !!busy, onSelect: () => setRemoving({ index, server }) },
  ];

  return (
    <section className="mt-8" aria-labelledby="servers-h">
      <SectionHeader id="servers-h" title="Server" actions={addButton} />
      <div className="mt-3">
        <QueryList
          query={servers}
          error="Die Serverliste konnte nicht geladen werden"
          empty={
            <Empty ill={<Glyph name="compass" pal="copper" box={64} />} title="Noch keine Server" actions={addButton}>
              Füge einen Server hinzu, dann landest du mit einem Klick direkt dort.
            </Empty>
          }
        >
          {(list) => (
            <List variant="worlds" divided aria-label="Server">
              {list.map((server, index) => (
                // Die Serverliste darf denselben Server mehrmals enthalten; die Stelle ist der Schlüssel.
                <ListRow key={index} menu={menuFor(server, index)}>
                  <ProjectIcon url={server.icon} seed={server.address} />
                  <RowTitle title={server.name || server.address} sub={server.address} />
                  <Cell flex align="end">
                    <GuardedButton size="s" icon="play" blocked={busy} aria-label={`Spielen: ${server.name}`} onClick={() => onPlay({ type: "server", address: server.address })}>
                      Spielen
                    </GuardedButton>
                  </Cell>
                  <Menu items={menuFor(server, index)} trigger={<IconButton size="s" icon="more" tip={false} label={`Mehr zu ${server.name}`} />} />
                </ListRow>
              ))}
            </List>
          )}
        </QueryList>
      </div>
      {editing && <ServerDialog key={editing.index ?? "new"} instance={instance} {...editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`„${removing?.server.name ?? ""}“ entfernen?`}
        text="Der Server verschwindet aus der Serverliste im Spiel."
        confirmLabel="Entfernen"
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing, { onSuccess: () => setRemoving(null) })}
      />
    </section>
  );
}

type Packs = "prompt" | "accept" | "reject";

/** Ressourcenpakete des Servers, wie im Spiel unter „Server bearbeiten“. */
const PACKS: { value: Packs; label: string; accept: boolean | null }[] = [
  { value: "prompt", label: "Nachfragen", accept: null },
  { value: "accept", label: "Annehmen", accept: true },
  { value: "reject", label: "Ablehnen", accept: false },
];

function ServerDialog({ instance, index, server, onClose }: { instance: Instance; index: number | null; server: Server; onClose: () => void }) {
  const [name, setName] = useState(server.name);
  const [address, setAddress] = useState(server.address);
  const [packs, setPacks] = useState(PACKS.find((p) => p.accept === server.acceptTextures)?.value ?? "prompt");
  const save = useSaveServer(instance.id);
  const ready = name.trim() !== "" && address.trim() !== "";

  function submit(e: FormEvent) {
    e.preventDefault();
    const acceptTextures = PACKS.find((p) => p.value === packs)?.accept ?? null;
    if (ready) save.mutate({ index, server: { ...server, name, address, acceptTextures } }, { onSuccess: onClose });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={index == null ? "Server hinzufügen" : "Server bearbeiten"}
      width={480}
      footer={<DialogActions cancel="Abbrechen" confirm={{ label: save.isPending ? "Speichert" : "Speichern", width: 130, form: "server-form", disabled: !ready || save.isPending }} />}
    >
      <form id="server-form" onSubmit={submit}>
        <Field label="Name">
          <TextField value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus />
        </Field>
        <Field label="Adresse" help="Zum Beispiel play.example.net oder play.example.net:25565">
          <TextField value={address} onChange={(e) => setAddress(e.target.value)} maxLength={255} spellCheck={false} />
        </Field>
        <Field label="Ressourcenpakete des Servers" group>
          <Segmented size="s" label="Ressourcenpakete des Servers" value={packs} onChange={setPacks} items={PACKS} />
        </Field>
      </form>
    </Dialog>
  );
}
