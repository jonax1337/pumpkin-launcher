import { useState } from "react";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  Actions, Button, Cell, Chip, ConfirmDialog, Dialog, DialogActions, Empty, Glyph, Hint, IconButton, JobProgress, List, ListRow, Menu, ProjectIcon,
  RowTitle, SectionHeader, type MenuEntry,
} from "@/ui";
import { AddContentSheet } from "@/components/ContentBrowser";
import { QueryList } from "@/components/QueryList";
import { useContentState } from "@/hooks/useContent";
import { useFileDrop } from "@/hooks/useFileDrop";
import { usePlay } from "@/hooks/useInstances";
import {
  useAddDatapacks, useDatapacks, useDeleteBackup, useRemoveDatapack, useWorldBackups, useWorldJobs, useWorldQuickPlay, useWorlds, worldTarget,
} from "@/hooks/useWorlds";
import { api } from "@/lib/api";
import { formatDateTime, formatSize, relativeTime } from "@/lib/format";
import { progressShare } from "@/lib/modrinth";
import { toastError } from "@/lib/toast";
import { GAME_MODE_LABELS, type Instance, type QuickPlay, type World, type WorldBackup } from "@/lib/types";
import { DropHint, rejectedFileToast } from "./dropFiles";
import { GuardedButton, useBusyReason, type SectionProps } from "./guards";
import { ServersSection } from "./ServersSection";

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

function WorldsSection({ instance, busy, onPlay }: SectionProps) {
  const worlds = useWorlds(instance.id);
  const startsIntoWorlds = useWorldQuickPlay(instance);
  const { backup, remove } = useWorldJobs(instance);
  const { target, progress } = useContentState();
  const [removing, setRemoving] = useState<World | null>(null);
  // Sicherungen einer Welt bzw. (world = null) aller Welten, auch gelöschter.
  const [showBackups, setShowBackups] = useState<{ world: string | null } | null>(null);
  // Datenpakete einer Welt: erst die Liste, `search` = stattdessen der Katalog im Seitenpanel.
  const [packs, setPacks] = useState<{ world: World; search: boolean } | null>(null);
  const playBlocked = busy ?? (startsIntoWorlds === false ? `Minecraft ${instance.minecraftVersion} kann nicht direkt in eine Welt starten, das geht erst ab 1.20.` : null);

  const menuFor = (w: World): MenuEntry[] => [
    { id: "dir", text: "Ordner öffnen", icon: "folder", onSelect: () => void api.openPath(w.path).catch(toastError) },
    { id: "backup", text: "Sichern", icon: "save", disabled: !!busy, onSelect: () => backup.mutate(w) },
    { id: "backups", text: "Sicherungen…", icon: "clock", onSelect: () => setShowBackups({ world: w.id }) },
    { id: "packs", text: "Datenpakete…", icon: "box", onSelect: () => setPacks({ world: w, search: false }) },
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
                    {target === worldTarget(instance.id, w.id) ? (
                      <JobProgress label="Wird gesichert" p={progressShare(progress)} width={120} />
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
      {packs && !packs.search && (
        <DatapacksDialog instance={instance} world={packs.world} busy={busy} onSearch={() => setPacks({ ...packs, search: true })} onClose={() => setPacks(null)} />
      )}
      {packs && (
        <AddContentSheet instance={instance} world={packs.world} open={packs.search} onOpenChange={(open) => setPacks({ ...packs, search: open })} />
      )}
    </section>
  );
}

const isZip = (path: string) => /\.zip$/i.test(path);

/** Was `level.dat` über ein Datenpaket sagt; schalten kann es nur das Spiel. */
function PackState({ enabled }: { enabled: boolean | null }) {
  if (enabled == null) return <Chip size="s">Noch nicht geladen</Chip>;
  return <Chip size="s" dot tone={enabled ? "run" : "neutral"}>{enabled ? "Aktiv" : "Abgeschaltet"}</Chip>;
}

/** Datenpakete einer Welt: eigene Zips (Auswahl oder aufs Fenster ziehen), Katalog über `onSearch`, Papierkorb. */
function DatapacksDialog({ instance, world, busy, onSearch, onClose }: { instance: Instance; world: World; busy: string | null; onSearch: () => void; onClose: () => void }) {
  const packs = useDatapacks(instance.id, world.id);
  const add = useAddDatapacks(instance.id, world.id);
  const remove = useRemoveDatapack(instance.id, world.id);
  const dragging = useFileDrop(true, take);

  function take(paths: string[]) {
    if (busy) return void toast.error(busy);
    const other = paths.find((p) => !isZip(p));
    if (other) rejectedFileToast(other, "Datenpakete sind .zip-Dateien.");
    const zips = paths.filter(isZip);
    if (zips.length) add.mutate(zips);
  }

  async function pick() {
    const picked = await openFile({ multiple: true, directory: false, filters: [{ name: "Datenpakete", extensions: ["zip"] }] });
    if (picked) take(picked);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Datenpakete" sub={world.name} width={560} footer={<DialogActions cancel="Schließen" />}>
      <Actions className="mb-3">
        {/* Eigene Dateien gibt es nur in der App: der Browser liefert keine Pfade. */}
        {!api.isMock && (
          <GuardedButton size="s" icon="ul" blocked={busy} disabled={add.isPending} onClick={() => void pick().catch(toastError)}>
            Datei hinzufügen…
          </GuardedButton>
        )}
        <GuardedButton size="s" icon="search" blocked={busy} onClick={onSearch}>Auf Modrinth suchen</GuardedButton>
      </Actions>
      {dragging ? (
        <div className="drop over" aria-hidden>
          <DropHint>Datenpakete (.zip)</DropHint>
        </div>
      ) : (
        <QueryList
          query={packs}
          error="Die Datenpakete konnten nicht geladen werden"
          empty={<Empty size="pane" ill="box" title="Noch keine Datenpakete">Füge .zip-Dateien hinzu oder such auf Modrinth.</Empty>}
        >
          {(list) => (
            <List variant="versions" aria-label="Datenpakete">
              {list.map((pack) => (
                <ListRow key={pack.id}>
                  <RowTitle title={pack.name} sub={pack.description} />
                  <Actions gap={4}>
                    <PackState enabled={pack.enabled} />
                    <IconButton
                      size="s"
                      icon="trash"
                      label={`${pack.name} in den Papierkorb legen`}
                      tip="In den Papierkorb"
                      disabled={!!busy || remove.isPending}
                      onClick={() => remove.mutate(pack)}
                    />
                  </Actions>
                </ListRow>
              ))}
            </List>
          )}
        </QueryList>
      )}
      <Hint className="mt-3">Ob ein Paket aktiv ist, steuert das Spiel (Befehl /datapack). Neue Pakete nimmt es beim nächsten Öffnen der Welt dazu.</Hint>
    </Dialog>
  );
}

/** Sicherungen einer Welt (`world`) oder aller Welten: wiederherstellen (immer als neue Welt) oder löschen. */
function BackupsDialog({ instance, world, busy, onClose }: { instance: Instance; world: string | null; busy: string | null; onClose: () => void }) {
  const backups = useWorldBackups(instance.id, world);
  const { restore } = useWorldJobs(instance);
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
