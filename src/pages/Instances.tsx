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
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BlockTile, ConfirmDialog, EmptyState, ErrorNote, LoaderBadge, PageHeader } from "@/components/common";
import { StatusBadge } from "@/components/game";
import { useCreateInstance, useDeleteInstance, useInstances, useLoaderVersions, useVersions } from "@/hooks/useInstances";
import { formatMemory, relativeTime } from "@/lib/format";
import { INSTALLABLE_LOADERS, LOADER_LABELS, LOADERS, type Instance, type ModLoader } from "@/lib/types";
import { useSettings } from "@/store/settings";

type Channel = "release" | "snapshot";

// Radix-Select erlaubt keinen leeren Wert; steht für loaderVersion = null.
const LATEST = "latest";

function CreateInstanceDialog() {
  const defaultMemory = useSettings((s) => s.memoryMb);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<Channel>("release");
  const [version, setVersion] = useState("");
  const [memory, setMemory] = useState(defaultMemory);
  const [loader, setLoader] = useState<ModLoader>("vanilla");
  const [loaderVersion, setLoaderVersion] = useState(LATEST);
  const versions = useVersions();
  const create = useCreateInstance();
  const navigate = useNavigate();

  const filtered = versions.data?.filter((v) => v.type === channel) ?? [];
  // Neueste Version des Kanals vorauswählen, bis der Nutzer selbst wählt
  const selected = filtered.some((v) => v.id === version) ? version : (filtered[0]?.id ?? "");
  const loaderVersions = useLoaderVersions(loader, selected);
  // Gewählte Loader-Version verfällt, wenn es sie für die neue MC-Version nicht gibt
  const selectedLoader = loaderVersions.data?.some((v) => v.version === loaderVersion) ? loaderVersion : LATEST;
  const loaderUnavailable = loader !== "vanilla" && (!!loaderVersions.error || loaderVersions.data?.length === 0);

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      {
        name: name.trim(),
        minecraftVersion: selected,
        loader,
        loaderVersion: selectedLoader === LATEST ? null : selectedLoader,
        memoryMb: memory,
      },
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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setMemory(defaultMemory);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden /> Neue Instanz
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Neue Instanz</DialogTitle>
            <DialogDescription>Versionen kommen direkt von Mojang. Forge, NeoForge und Quilt folgen.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="inst-name">Name</Label>
            <Input id="inst-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Survival mit Freunden" required autoFocus />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="inst-version">Minecraft-Version</Label>
              <Tabs value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                <TabsList className="h-7" aria-label="Versionskanal">
                  <TabsTrigger value="release" className="px-2.5 text-xs">Release</TabsTrigger>
                  <TabsTrigger value="snapshot" className="px-2.5 text-xs">Snapshot</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {versions.isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={selected} onValueChange={setVersion} disabled={!filtered.length}>
                <SelectTrigger id="inst-version" className="w-full font-mono">
                  <SelectValue placeholder={versions.error ? "Versionen nicht erreichbar" : "Keine Versionen"} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {filtered.map((v, i) => (
                    <SelectItem key={v.id} value={v.id} className="font-mono">
                      {v.id}
                      {i === 0 && <span className="ml-2 font-sans text-xs text-primary">neueste</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="inst-loader">Mod-Loader</Label>
              <Select value={loader} onValueChange={(v) => setLoader(v as ModLoader)}>
                <SelectTrigger id="inst-loader" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOADERS.map((l) => (
                    <SelectItem key={l} value={l} disabled={!INSTALLABLE_LOADERS.includes(l)}>
                      {LOADER_LABELS[l]}
                      {!INSTALLABLE_LOADERS.includes(l) && <span className="ml-2 text-xs text-muted-foreground">folgt</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="inst-loader-version">Loader-Version</Label>
              {loaderVersions.isLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select value={selectedLoader} onValueChange={setLoaderVersion} disabled={loader === "vanilla" || loaderUnavailable}>
                  <SelectTrigger id="inst-loader-version" className="w-full font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={LATEST}>Neueste stabile</SelectItem>
                    {loaderVersions.data?.map((v) => (
                      <SelectItem key={v.version} value={v.version} className="font-mono">
                        {v.version}
                        {!v.stable && <span className="ml-2 font-sans text-xs text-gold">Beta</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {loaderUnavailable && (
              <p role="alert" className="col-span-2 text-xs text-destructive">
                {loaderVersions.error
                  ? `Loader-Versionen nicht erreichbar: ${loaderVersions.error.message}`
                  : `${LOADER_LABELS[loader]} gibt es für ${selected} nicht.`}
              </p>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="inst-memory">Arbeitsspeicher</Label>
              <span className="font-mono text-sm text-primary">{formatMemory(memory)}</span>
            </div>
            <Slider id="inst-memory" aria-label="Arbeitsspeicher in MB" min={1024} max={16384} step={512} value={[memory]} onValueChange={([v]) => setMemory(v)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || !selected || loaderUnavailable || create.isPending}>
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
            <div key={i} className="flex items-center gap-4 rounded-xl border bg-card/40 p-4">
              <Skeleton className="size-12 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3.5 w-64" />
              </div>
            </div>
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
              <span className="hidden text-sm text-muted-foreground md:block">{relativeTime(inst.lastPlayedAt)}</span>
              <StatusBadge instanceId={inst.id} />
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
