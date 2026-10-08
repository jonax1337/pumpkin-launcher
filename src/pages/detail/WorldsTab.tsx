import { useState } from "react";
import {
  Actions, Button, Cell, ConfirmDialog, Empty, Glyph, IconButton, JobProgress, List, ListRow, Menu, ProjectIcon, RowTitle, SectionHeader,
  type MenuEntry,
} from "@/ui";
import { AddContentSheet } from "@/components/catalog/AddContentSheet";
import { QueryList } from "@/components/QueryList";
import { useConfirmTarget } from "@/hooks/useConfirmTarget";
import { useContentState } from "@/store/contentState";
import { usePlay } from "@/hooks/usePlay";
import { useWorldJobs, useWorldQuickPlay, useWorlds, worldTarget } from "@/hooks/useWorlds";
import { api } from "@/lib/api";
import { toastError } from "@/lib/toast";
import { formatSize, relativeTime } from "@/lib/format";
import { openLocalPath } from "@/lib/links";
import { progressShare } from "@/lib/progress";
import { t, useI18n, type TKey } from "@/i18n";
import type { Instance, QuickPlay, World } from "@/lib/types";
import { BackupsDialog } from "./BackupsDialog";
import { DatapacksDialog } from "./DatapacksDialog";
import { GuardedButton, useBusyReason, useInstanceBusyReason, type SectionProps } from "./guards";
import { ServersSection } from "./ServersSection";
import { ShareSection } from "./ShareSection";

/** Spielart einer Welt als Übersetzungsschlüssel; der Text kommt aus dem Wörterbuch. */
const GAME_MODE_KEYS: Record<NonNullable<World["gameMode"]>, TKey> = {
  survival: "detail.worlds.gameMode.survival",
  creative: "detail.worlds.gameMode.creative",
  adventure: "detail.worlds.gameMode.adventure",
  spectator: "detail.worlds.gameMode.spectator",
};

/** Breite (px) der Anzeige, solange eine Sicherung läuft. */
const BACKUP_PROGRESS_WIDTH = 120;

/** „Hardcore · 1.21.4 · 182 MB · vor 2 Stunden“ */
const worldLine = (w: World) =>
  [
    w.hardcore ? t("detail.worlds.hardcore") : w.gameMode && t(GAME_MODE_KEYS[w.gameMode]),
    w.version,
    formatSize(w.sizeBytes),
    relativeTime(w.lastPlayed),
  ].filter(Boolean).join(" · ");

/** Welten und Server einer Instanz: direkt hineinspielen, Welten sichern und wiederherstellen, Serverliste pflegen, Welt für Freunde teilen. */
export function WorldsTab({ instance, onLaunched }: { instance: Instance; onLaunched: () => void }) {
  const play = usePlay();
  const busy = useInstanceBusyReason(instance.id);
  const quickPlay = (target: QuickPlay) => void play(instance, onLaunched, target);
  return (
    <div className="pt-2">
      <ShareSection instance={instance} busy={busy} />
      <WorldsSection instance={instance} busy={busy} onPlay={quickPlay} />
      <ServersSection instance={instance} busy={busy} onPlay={quickPlay} />
    </div>
  );
}

/** Eine Welt als Zeile: Name, Angaben, Spielen (oder der Fortschritt der Sicherung) und Menü. */
function WorldRow({ instance, world, menu, playBlocked, onPlay }: {
  instance: Instance; world: World; menu: MenuEntry[]; playBlocked: string | null; onPlay: () => void;
}) {
  const { t } = useI18n();
  const backingUp = useContentState((s) => s.target === worldTarget(instance.id, world.id));
  const progress = useContentState((s) => s.progress);
  return (
    <ListRow menu={menu}>
      <ProjectIcon url={world.icon} seed={world.id} />
      {/* Wie im Spiel: der Ordner steht dabei, wenn er anders heißt (z. B. wiederhergestellte Kopien). */}
      <RowTitle title={world.name} aside={world.name === world.id ? undefined : world.id} sub={worldLine(world)} />
      <Cell flex align="end">
        {backingUp ? (
          <JobProgress label={t("detail.worlds.backingUp")} p={progressShare(progress)} width={BACKUP_PROGRESS_WIDTH} />
        ) : (
          <GuardedButton
            size="s"
            icon="play"
            blocked={playBlocked}
            aria-label={t("components.game.ariaPlay", { name: world.name })}
            onClick={onPlay}
          >
            {t("common.play")}
          </GuardedButton>
        )}
      </Cell>
      <Menu
        items={menu}
        trigger={<IconButton size="s" icon="more" tip={false} label={t("detail.content.moreAbout", { name: world.name })} />}
      />
    </ListRow>
  );
}

function WorldsSection({ instance, busy, onPlay }: SectionProps) {
  const { t } = useI18n();
  const worlds = useWorlds(instance.id);
  const startsIntoWorlds = useWorldQuickPlay(instance);
  const { backup, remove, importWorld } = useWorldJobs(instance);
  // Sichern, Löschen, Importieren und Wiederherstellen sind Inhalts-Vorgänge: von ihnen läuft nur einer zur Zeit.
  const jobBusy = useBusyReason(instance.id);
  const removal = useConfirmTarget<World>();
  // Sicherungen einer Welt bzw. (world = null) aller Welten, auch gelöschter.
  const [showBackups, setShowBackups] = useState<{ world: string | null } | null>(null);
  // Datenpakete einer Welt: erst die Liste, `search` = stattdessen der Katalog im Seitenpanel.
  const [packs, setPacks] = useState<{ world: World; search: boolean } | null>(null);
  const quickPlayUnsupported =
    startsIntoWorlds === false ? t("detail.worlds.quickPlayUnsupported", { version: instance.minecraftVersion }) : null;
  const playBlocked = busy ?? quickPlayUnsupported;

  async function pickWorld() {
    const [path] = await api.pickPaths({
      title: t("detail.worlds.importPickTitle"),
      filters: [{ name: t("detail.worlds.importFilter"), extensions: ["zip"] }],
    });
    if (path) importWorld.mutate(path);
  }

  const menuFor = (w: World): MenuEntry[] => [
    { id: "dir", text: t("components.instance.openFolder"), icon: "folder", onSelect: () => openLocalPath(w.path) },
    { id: "backup", text: t("detail.worlds.backupNow"), icon: "save", disabled: !!jobBusy, onSelect: () => backup.mutate(w) },
    { id: "backups", text: t("detail.worlds.backupsMenu"), icon: "clock", onSelect: () => setShowBackups({ world: w.id }) },
    { id: "packs", text: t("detail.worlds.datapacksMenu"), icon: "box", onSelect: () => setPacks({ world: w, search: false }) },
    "-",
    { id: "del", text: t("detail.worlds.deleteMenu"), icon: "trash", bad: true, disabled: !!jobBusy, onSelect: () => removal.ask(w) },
  ];

  return (
    <section aria-labelledby="worlds-h">
      <SectionHeader
        id="worlds-h"
        title={t("common.worlds")}
        actions={
          <Actions gap={4}>
            <GuardedButton variant="ghost" size="s" icon="ul" blocked={jobBusy} onClick={() => void pickWorld().catch(toastError)}>
              {t("detail.worlds.importAction")}
            </GuardedButton>
            <Button variant="ghost" size="s" icon="clock" bleed="end" onClick={() => setShowBackups({ world: null })}>
              {t("detail.worlds.backupsTitle")}
            </Button>
          </Actions>
        }
      />
      <div className="mt-3">
        <QueryList
          query={worlds}
          error={t("detail.worlds.loadError")}
          empty={
            <Empty ill={<Glyph name="mountain" pal="teal" box={64} />} title={t("detail.worlds.emptyTitle")}>
              {t("detail.worlds.emptyHint")}
            </Empty>
          }
        >
          {(list) => (
            <List variant="worlds" divided aria-label={t("common.worlds")}>
              {list.map((world) => (
                <WorldRow
                  key={world.id}
                  instance={instance}
                  world={world}
                  menu={menuFor(world)}
                  playBlocked={playBlocked}
                  onPlay={() => onPlay({ type: "world", id: world.id })}
                />
              ))}
            </List>
          )}
        </QueryList>
      </div>
      <ConfirmDialog
        {...removal.dialogProps({
          title: (world) => t("components.instance.deleteQuotedTitle", { name: world.name }),
          text: () => t("detail.worlds.deleteText"),
          onConfirm: (world, close) => {
            remove.mutate(world);
            close();
          },
        })}
      />
      {showBackups && <BackupsDialog instance={instance} world={showBackups.world} busy={jobBusy} onClose={() => setShowBackups(null)} />}
      {packs && !packs.search && (
        <DatapacksDialog
          instance={instance}
          world={packs.world}
          busy={busy}
          onSearch={() => setPacks({ ...packs, search: true })}
          onClose={() => setPacks(null)}
        />
      )}
      {packs && (
        <AddContentSheet
          instance={instance}
          world={packs.world}
          open={packs.search}
          onOpenChange={(open) => setPacks({ ...packs, search: open })}
        />
      )}
    </section>
  );
}
