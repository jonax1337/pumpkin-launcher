import { useState } from "react";
import { Link } from "react-router";
import { Ellipsis, LibraryBig, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BlockTile, ConfirmDialog, EmptyState, ErrorNote, PageHeader } from "@/components/common";
import { PlayControl } from "@/components/game";
import { NewInstanceDialog } from "@/components/NewInstanceDialog";
import { useDeleteInstance, useInstances } from "@/hooks/useInstances";
import { LOADER_LABELS, type Instance } from "@/lib/types";

export function InstancesPage() {
  const { data: instances, isLoading, error } = useInstances();
  const del = useDeleteInstance();
  const [toDelete, setToDelete] = useState<Instance | null>(null);
  const [filter, setFilter] = useState("");
  const shown = instances?.filter((i) => i.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <>
      <PageHeader
        title="Bibliothek"
        description="Jede Instanz ist ein eigenes Minecraft mit eigener Version, eigenen Mods und eigenen Welten."
        actions={
          <>
            {!!instances?.length && instances.length > 5 && (
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Suchen" aria-label="Instanzen suchen" className="w-48 pl-9" />
              </div>
            )}
            <NewInstanceDialog acceptDrops>
              <Button>
                <Plus aria-hidden /> Neu
              </Button>
            </NewInstanceDialog>
          </>
        }
      />
      {error && <ErrorNote error={error} />}
      {isLoading && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      )}
      {instances?.length === 0 && (
        <EmptyState icon={<LibraryBig className="size-5" />} title="Noch keine Instanzen">
          Leg deine erste Instanz an, um loszuspielen.
        </EmptyState>
      )}
      {!!shown?.length && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
          {shown.map((inst) => (
            <li key={inst.id} className="relative flex flex-col gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-primary/30">
              <div className="flex items-start gap-3">
                <BlockTile seed={inst.id} />
                <div className="min-w-0 flex-1">
                  {/* Die ganze Karte ist klickbar; Knöpfe liegen darüber. */}
                  <Link
                    to={`/instances/${inst.id}`}
                    className="block truncate font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring"
                  >
                    {inst.name}
                  </Link>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {LOADER_LABELS[inst.loader]} {inst.minecraftVersion}
                    {inst.mods.length > 0 && ` · ${inst.mods.length} Inhalte`}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Mehr zu ${inst.name}`} className="relative -mt-1 -mr-1 text-muted-foreground">
                      <Ellipsis aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" onSelect={() => setToDelete(inst)}>
                      <Trash2 aria-hidden /> Löschen
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="relative mt-auto flex justify-end">
                <PlayControl instance={inst} />
              </div>
            </li>
          ))}
          <li>
            <NewInstanceDialog>
              <button
                type="button"
                className="flex h-full min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="size-5" aria-hidden /> Neu
              </button>
            </NewInstanceDialog>
          </li>
        </ul>
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`„${toDelete?.name}" löschen?`}
        description="Die Instanz samt Mods und Welten wird entfernt. Das lässt sich nicht rückgängig machen."
        pending={del.isPending}
        onConfirm={() => toDelete && del.mutate(toDelete.id, { onSuccess: () => setToDelete(null) })}
      />
    </>
  );
}
