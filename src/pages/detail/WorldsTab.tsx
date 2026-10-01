import { useState } from "react";
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
import { TYPE_LABEL_KEYS } from "@/lib/catalog";
import { formatDateTime, formatSize, relativeTime } from "@/lib/format";
import { progressShare } from "@/lib/modrinth";
import { toastError } from "@/lib/toast";
import { t, useI18n } from "@/i18n";
import type { Instance, QuickPlay, World, WorldBackup } from "@/lib/types";
import { DropHint, rejectedFileToast } from "./dropFiles";
import { GuardedButton, useBusyReason, type SectionProps } from "./guards";
import { ServersSection } from "./ServersSection";

/** Spielart einer Welt als Übersetzungsschlüssel; der Text kommt aus dem Wörterbuch. */
const GAME_MODE_KEYS: Record<NonNullable<World["gameMode"]>, string> = {
  survival: "detail.worlds.gameMode.survival",
  creative: "detail.worlds.gameMode.creative",
  adventure: "detail.worlds.gameMode.adventure",
  spectator: "detail.worlds.gameMode.spectator",
};

/** „Hardcore · 1.21.4 · 182 MB · vor 2 Stunden“ */
const worldLine = (w: World) =>
  [w.hardcore ? t("detail.worlds.hardcore") : w.gameMode && t(GAME_MODE_KEYS[w.gameMode]), w.version, formatSize(w.sizeBytes), relativeTime(w.lastPlayed)].filter(Boolean).join(" · ");

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
  const { t } = useI18n();
  const worlds = useWorlds(instance.id);
  const startsIntoWorlds = useWorldQuickPlay(instance);
  const { backup, remove } = useWorldJobs(instance);
  const { target, progress } = useContentState();
  const [removing, setRemoving] = useState<World | null>(null);
  // Sicherungen einer Welt bzw. (world = null) aller Welten, auch gelöschter.
  const [showBackups, setShowBackups] = useState<{ world: string | null } | null>(null);
  // Datenpakete einer Welt: erst die Liste, `search` = stattdessen der Katalog im Seitenpanel.
  const [packs, setPacks] = useState<{ world: World; search: boolean } | null>(null);
  const playBlocked = busy ?? (startsIntoWorlds === false ? t("detail.worlds.quickPlayUnsupported", { version: instance.minecraftVersion }) : null);

  const menuFor = (w: World): MenuEntry[] => [
    { id: "dir", text: t("components.instance.openFolder"), icon: "folder", onSelect: () => void api.openPath(w.path).catch(toastError) },
    { id: "backup", text: t("detail.worlds.backupNow"), icon: "save", disabled: !!busy, onSelect: () => backup.mutate(w) },
    { id: "backups", text: t("detail.worlds.backupsMenu"), icon: "clock", onSelect: () => setShowBackups({ world: w.id }) },
    { id: "packs", text: t("detail.worlds.datapacksMenu"), icon: "box", onSelect: () => setPacks({ world: w, search: false }) },
    "-",
    { id: "del", text: t("detail.worlds.deleteMenu"), icon: "trash", bad: true, disabled: !!busy, onSelect: () => setRemoving(w) },
  ];

  return (
    <section aria-labelledby="worlds-h">
      <SectionHeader
        id="worlds-h"
        title={t("common.worlds")}
        actions={<Button variant="ghost" size="s" icon="clock" bleed="end" onClick={() => setShowBackups({ world: null })}>{t("detail.worlds.backupsTitle")}</Button>}
      />
      <div className="mt-3">
        <QueryList
          query={worlds}
          error={t("detail.worlds.loadError")}
          empty={<Empty ill={<Glyph name="mountain" pal="teal" box={64} />} title={t("detail.worlds.emptyTitle")}>{t("detail.worlds.emptyHint")}</Empty>}
        >
          {(list) => (
            <List variant="worlds" divided aria-label={t("common.worlds")}>
              {list.map((w) => (
                <ListRow key={w.id} menu={menuFor(w)}>
                  <ProjectIcon url={w.icon} seed={w.id} />
                  {/* Wie im Spiel: der Ordner steht dabei, wenn er anders heißt (z. B. wiederhergestellte Kopien). */}
                  <RowTitle title={w.name} aside={w.name === w.id ? undefined : w.id} sub={worldLine(w)} />
                  <Cell flex align="end">
                    {target === worldTarget(instance.id, w.id) ? (
                      <JobProgress label={t("detail.worlds.backingUp")} p={progressShare(progress)} width={120} />
                    ) : (
                      <GuardedButton size="s" icon="play" blocked={playBlocked} aria-label={t("components.game.ariaPlay", { name: w.name })} onClick={() => onPlay({ type: "world", id: w.id })}>
                        {t("common.play")}
                      </GuardedButton>
                    )}
                  </Cell>
                  <Menu items={menuFor(w)} trigger={<IconButton size="s" icon="more" tip={false} label={t("detail.content.moreAbout", { name: w.name })} />} />
                </ListRow>
              ))}
            </List>
          )}
        </QueryList>
      </div>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("components.instance.deleteQuotedTitle", { name: removing?.name ?? "" })}
        text={t("detail.worlds.deleteText")}
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
  const { t } = useI18n();
  if (enabled == null) return <Chip size="s">{t("detail.worlds.packNotLoaded")}</Chip>;
  return <Chip size="s" dot tone={enabled ? "run" : "neutral"}>{enabled ? t("detail.worlds.packActive") : t("detail.worlds.packOff")}</Chip>;
}

/** Datenpakete einer Welt: eigene Zips (Auswahl oder aufs Fenster ziehen), Katalog über `onSearch`, Papierkorb. */
function DatapacksDialog({ instance, world, busy, onSearch, onClose }: { instance: Instance; world: World; busy: string | null; onSearch: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const packs = useDatapacks(instance.id, world.id);
  const add = useAddDatapacks(instance.id, world.id);
  const remove = useRemoveDatapack(instance.id, world.id);
  const dragging = useFileDrop(true, take);

  function take(paths: string[]) {
    if (busy) return void toast.error(busy);
    const other = paths.find((p) => !isZip(p));
    if (other) rejectedFileToast(other, t("detail.worlds.packsAllowed"));
    const zips = paths.filter(isZip);
    if (zips.length) add.mutate(zips);
  }

  async function pick() {
    const picked = await api.pickPaths({ multiple: true, filters: [{ name: t(TYPE_LABEL_KEYS.datapack), extensions: ["zip"] }] });
    if (picked.length) take(picked);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t(TYPE_LABEL_KEYS.datapack)} sub={world.name} width={560} footer={<DialogActions cancel={t("common.close")} />}>
      <Actions className="mb-3">
        {/* Eigene Dateien gibt es nur in der App: der Browser liefert keine Pfade. */}
        {!api.isMock && (
          <GuardedButton size="s" icon="ul" blocked={busy} disabled={add.isPending} onClick={() => void pick().catch(toastError)}>
            {t("detail.content.addFile")}
          </GuardedButton>
        )}
        <GuardedButton size="s" icon="search" blocked={busy} onClick={onSearch}>{t("detail.worlds.searchModrinth")}</GuardedButton>
      </Actions>
      {dragging ? (
        <div className="drop over" aria-hidden>
          <DropHint>{t("detail.worlds.packDropHint")}</DropHint>
        </div>
      ) : (
        <QueryList
          query={packs}
          error={t("detail.worlds.packsLoadError")}
          empty={<Empty size="pane" ill="box" title={t("detail.worlds.packsEmptyTitle")}>{t("detail.worlds.packsEmptyHint")}</Empty>}
        >
          {(list) => (
            <List variant="versions" aria-label={t(TYPE_LABEL_KEYS.datapack)}>
              {list.map((pack) => (
                <ListRow key={pack.id}>
                  <RowTitle title={pack.name} sub={pack.description} />
                  <Actions gap={4}>
                    <PackState enabled={pack.enabled} />
                    <IconButton
                      size="s"
                      icon="trash"
                      label={t("detail.worlds.packTrashAria", { name: pack.name })}
                      tip={t("detail.worlds.toTrash")}
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
      <Hint className="mt-3">{t("detail.worlds.packActiveHint")}</Hint>
    </Dialog>
  );
}

/** Sicherungen einer Welt (`world`) oder aller Welten: wiederherstellen (immer als neue Welt) oder löschen. */
function BackupsDialog({ instance, world, busy, onClose }: { instance: Instance; world: string | null; busy: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const backups = useWorldBackups(instance.id, world);
  const { restore } = useWorldJobs(instance);
  const remove = useDeleteBackup(instance.id);
  const [removing, setRemoving] = useState<WorldBackup | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t("detail.worlds.backupsTitle")} sub={world ?? instance.name} width={560} footer={<DialogActions cancel={t("common.close")} />}>
      <QueryList
        query={backups}
        error={t("detail.worlds.backupsLoadError")}
        empty={<Empty size="pane" ill="clock" title={t("detail.worlds.backupsEmptyTitle")}>{t("detail.worlds.backupsEmptyHint")}</Empty>}
      >
        {(list) => (
          <List variant="versions" aria-label={t("detail.worlds.backupsTitle")}>
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
                    {t("detail.worlds.restoreAction")}
                  </GuardedButton>
                  <IconButton size="s" icon="trash" label={t("detail.worlds.backupDeleteAria", { date: formatDateTime(b.createdAt) })} tip={t("common.delete")} onClick={() => setRemoving(b)} />
                </Actions>
              </ListRow>
            ))}
          </List>
        )}
      </QueryList>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("detail.worlds.backupDeleteTitle")}
        text={removing && t("detail.worlds.backupDeleteText", { world: removing.world, date: formatDateTime(removing.createdAt) })}
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing, { onSuccess: () => setRemoving(null) })}
      />
    </Dialog>
  );
}
