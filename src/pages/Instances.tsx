import { useState } from "react";
import { Link } from "react-router";
import { BookmarkPlus, Ellipsis, LibraryBig, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { BlockTile, ConfirmDialog, EmptyState, ErrorNote, PageHeader } from "@/components/common";
import { PlayControl, StatusBadge, useInstallPercent } from "@/components/game";
import { NewInstanceDialog } from "@/components/NewInstanceDialog";
import { SaveTemplateDialog } from "@/components/SaveTemplateDialog";
import { useDeleteInstance, useInstances } from "@/hooks/useInstances";
import { relativeTime } from "@/lib/format";
import { LOADER_LABELS, type Instance } from "@/lib/types";
import { cn } from "@/lib/utils";

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4";

function InstanceCard({ inst, onTemplate, onDelete }: { inst: Instance; onTemplate: () => void; onDelete: () => void }) {
  const percent = useInstallPercent(inst);
  const contents = inst.mods.length;
  return (
    <li className="group relative flex min-w-0 flex-col rounded-xl border bg-card p-4 transition-colors duration-150 hover:bg-accent/50 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring">
      <div className="flex min-w-0 items-start gap-3">
        <BlockTile seed={inst.id} />
        <div className="min-w-0 flex-1 pt-0.5">
          {/* Die ganze Karte ist klickbar; Knöpfe liegen darüber. */}
          <Link to={`/instances/${inst.id}`} title={inst.name} className="block truncate font-medium outline-none after:absolute after:inset-0 after:rounded-xl">
            {inst.name}
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={`${LOADER_LABELS[inst.loader]} ${inst.minecraftVersion}`}>
            {LOADER_LABELS[inst.loader]} {inst.minecraftVersion}
            {contents > 0 && ` · ${contents} ${contents === 1 ? "Inhalt" : "Inhalte"}`}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Mehr zu ${inst.name}`} className="relative -mt-1 shrink-0 text-muted-foreground">
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onTemplate}>
              <BookmarkPlus aria-hidden /> Als Vorlage speichern …
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 aria-hidden /> Löschen …
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-5 flex min-h-9 items-end justify-between gap-3">
        {percent != null ? (
          <div className="min-w-0 flex-1 space-y-1.5" aria-label={`Wird vorbereitet, ${percent} %`} role="group">
            <p className="text-xs text-muted-foreground tabular-nums">Wird vorbereitet … {percent} %</p>
            <Progress value={percent} />
          </div>
        ) : (
          <div className="min-w-0 space-y-0.5">
            <StatusBadge instanceId={inst.id} />
            <p className="truncate text-xs text-muted-foreground">{relativeTime(inst.lastPlayedAt)}</p>
          </div>
        )}
        {/* Spielen erscheint bei Hover und Tastaturfokus; laufend oder beim Vorbereiten bleibt der Knopf stehen. */}
        <PlayControl
          instance={inst}
          size="icon"
          className="relative opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
        />
      </div>
    </li>
  );
}

export function InstancesPage() {
  const { data: instances, isLoading, error, refetch } = useInstances();
  const del = useDeleteInstance();
  const [toDelete, setToDelete] = useState<Instance | null>(null);
  const [toTemplate, setToTemplate] = useState<Instance | null>(null);
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  const shown = instances?.filter((i) => i.name.toLowerCase().includes(needle));

  return (
    <>
      <PageHeader
        title="Bibliothek"
        description="Jede Instanz ist ein eigenes Minecraft mit eigener Version, eigenen Mods und eigenen Welten."
        actions={
          <>
            {!!instances && instances.length > 5 && (
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Suchen" aria-label="Instanzen suchen" className="w-48 pl-9" />
              </div>
            )}
            <NewInstanceDialog primary>
              {/* Im Leerzustand trägt der Leerzustand die eine Aktion; der Dialog bleibt für Strg+N und Drag & Drop da. */}
              <Button aria-keyshortcuts="Control+N" className={cn(instances?.length === 0 && "hidden")}>
                <Plus aria-hidden /> Neu
              </Button>
            </NewInstanceDialog>
          </>
        }
      />
      {error && <ErrorNote title="Die Bibliothek konnte nicht geladen werden" error={error} onRetry={() => void refetch()} />}
      {isLoading && (
        <ul className={GRID} aria-busy aria-label="Wird geladen">
          {[0, 1, 2].map((i) => (
            <li key={i} className="rounded-xl border bg-card p-4">
              <div className="flex gap-3">
                <Skeleton className="size-12 rounded-lg" />
                <div className="flex-1 space-y-2 pt-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <Skeleton className="mt-6 h-4 w-24" />
            </li>
          ))}
        </ul>
      )}
      {instances?.length === 0 && (
        <EmptyState
          icon={<LibraryBig />}
          title="Noch keine Instanzen"
          action={
            <NewInstanceDialog>
              <Button>
                <Plus aria-hidden /> Neue Instanz
              </Button>
            </NewInstanceDialog>
          }
        >
          Leg deine erste Instanz an, um loszuspielen.
        </EmptyState>
      )}
      {!!instances?.length && shown?.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">Keine Instanz heißt „{filter.trim()}“.</p>
      )}
      {!!shown?.length && (
        <ul className={GRID}>
          {shown.map((inst) => (
            <InstanceCard key={inst.id} inst={inst} onTemplate={() => setToTemplate(inst)} onDelete={() => setToDelete(inst)} />
          ))}
          {!needle && (
            <li className="min-w-0">
              <NewInstanceDialog>
                <button
                  type="button"
                  className="flex h-full min-h-36 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Plus className="size-5" aria-hidden /> Neue Instanz
                </button>
              </NewInstanceDialog>
            </li>
          )}
        </ul>
      )}
      <SaveTemplateDialog instance={toTemplate} onClose={() => setToTemplate(null)} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`„${toDelete?.name}“ löschen?`}
        description="Die Instanz samt Mods und Welten wird entfernt. Das lässt sich nicht rückgängig machen."
        pending={del.isPending}
        onConfirm={() => toDelete && del.mutate(toDelete.id, { onSuccess: () => setToDelete(null) })}
      />
    </>
  );
}
