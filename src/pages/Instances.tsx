import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Boxes, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BlockTile, ConfirmDialog, EmptyState, ErrorNote, LoaderBadge, PageHeader } from "@/components/common";
import { useCreateInstance, useDeleteInstance, useInstances } from "@/hooks/useInstances";
import { MINECRAFT_VERSIONS } from "@/lib/mock";
import { formatMemory, relativeTime } from "@/lib/format";
import { LOADER_LABELS, LOADERS, type Instance, type ModLoader } from "@/lib/types";

function CreateInstanceDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [version, setVersion] = useState(MINECRAFT_VERSIONS[0]);
  const [loader, setLoader] = useState<ModLoader>("fabric");
  const create = useCreateInstance();
  const navigate = useNavigate();

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { name: name.trim(), minecraftVersion: version, loader, loaderVersion: null },
      {
        onSuccess: (inst) => {
          setOpen(false);
          setName("");
          navigate(`/instances/${inst.id}`);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden /> Neue Instanz
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Neue Instanz</DialogTitle>
            <DialogDescription>Version und Mod-Loader lassen sich später nicht mehr ändern.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="inst-name">Name</Label>
            <Input id="inst-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Survival mit Freunden" required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="inst-version">Minecraft-Version</Label>
              <Select value={version} onValueChange={setVersion}>
                <SelectTrigger id="inst-version" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MINECRAFT_VERSIONS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inst-loader">Mod-Loader</Label>
              <Select value={loader} onValueChange={(v) => setLoader(v as ModLoader)}>
                <SelectTrigger id="inst-loader" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOADERS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {LOADER_LABELS[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {create.error && <ErrorNote error={create.error} />}
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? "Wird angelegt…" : "Anlegen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InstancesPage() {
  const { data: instances, isLoading, error } = useInstances();
  const del = useDeleteInstance();
  const [toDelete, setToDelete] = useState<Instance | null>(null);

  return (
    <>
      <PageHeader
        title="Instanzen"
        description="Getrennte Spielstände mit eigener Version, eigenem Loader und eigenen Mods."
        actions={<CreateInstanceDialog />}
      />
      {error && <ErrorNote error={error} />}
      {isLoading && (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-card/60" />
          ))}
        </div>
      )}
      {instances?.length === 0 && (
        <EmptyState icon={<Boxes className="size-5" />} title="Noch keine Instanzen">
          Lege deine erste Instanz an, um loszuspielen.
        </EmptyState>
      )}
      <ul className="grid gap-3">
        {instances?.map((inst) => (
          <li key={inst.id} className="group relative">
            <Link
              to={`/instances/${inst.id}`}
              className="flex items-center gap-4 rounded-xl border bg-card/60 p-4 pr-16 transition-colors outline-none hover:border-primary/30 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BlockTile seed={inst.id} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{inst.name}</p>
                  <LoaderBadge loader={inst.loader} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-mono">{inst.minecraftVersion}</span> · {inst.mods.length} Mods ·{" "}
                  {formatMemory(inst.memoryMb)} RAM
                </p>
              </div>
              <span className="hidden text-sm text-muted-foreground sm:block">{relativeTime(inst.lastPlayedAt)}</span>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${inst.name} löschen`}
              className="absolute top-1/2 right-4 -translate-y-1/2 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-destructive"
              onClick={() => setToDelete(inst)}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
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
