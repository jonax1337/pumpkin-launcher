import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { ChevronRight, Compass, FileArchive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TemplatesTab } from "@/components/TemplatesTab";
import { MemorySlider } from "@/components/common";
import { ContentResults, PackInstallButton } from "@/components/ContentBrowser";
import { useContentInstall, useContentState } from "@/hooks/useContent";
import { useCreateInstance, useLoaderVersions, useMemory, useVersions } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import { packReason } from "@/lib/modrinth";
import { formatMemory } from "@/lib/format";
import { ALL_LOADERS, LOADER_LABELS, SUPPORTED_LOADERS, type ModLoader } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "empty" | "modpack" | "file" | "template";

// Radix-Select erlaubt keinen leeren Wert; steht für loaderVersion = null.
const LATEST = "latest";

const packName = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.mrpack$/i, "");

function EmptyTab({ onDone }: { onDone: (id: string) => void }) {
  const defaultMemory = useMemory().value;
  const [name, setName] = useState("");
  const [snapshots, setSnapshots] = useState(false);
  const [version, setVersion] = useState("");
  const [loader, setLoader] = useState<ModLoader>("vanilla");
  const [loaderVersion, setLoaderVersion] = useState(LATEST);
  const [memory, setMemory] = useState<number | null>(null);
  const versions = useVersions();
  const create = useCreateInstance();

  const filtered = versions.data?.filter((v) => v.type === "release" || snapshots) ?? [];
  // Neueste Version vorauswählen, bis der Nutzer selbst wählt
  const selected = filtered.some((v) => v.id === version) ? version : (filtered[0]?.id ?? "");
  const loaderVersions = useLoaderVersions(loader, selected);
  // Gewählte Loader-Version verfällt, wenn es sie für die neue Minecraft-Version nicht gibt
  const selectedLoader = loaderVersions.data?.some((v) => v.version === loaderVersion) ? loaderVersion : LATEST;
  const loaderUnavailable = loader !== "vanilla" && (!!loaderVersions.error || loaderVersions.data?.length === 0);
  const defaultName = `${loader === "vanilla" ? "Minecraft" : LOADER_LABELS[loader]} ${selected}`;

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      {
        name: name.trim() || defaultName,
        minecraftVersion: selected,
        loader,
        loaderVersion: selectedLoader === LATEST ? null : selectedLoader,
        memoryMb: memory,
      },
      { onSuccess: (inst) => onDone(inst.id) },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="inst-version">Minecraft-Version</Label>
        {versions.isLoading ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <Select value={selected} onValueChange={setVersion} disabled={!filtered.length}>
            <SelectTrigger id="inst-version" className="w-full">
              <SelectValue placeholder={versions.error ? "Versionen gerade nicht erreichbar" : "Keine Versionen"} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {filtered.map((v, i) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.id}
                  {i === 0 && <span className="ml-2 text-xs text-primary">neueste</span>}
                  {v.type !== "release" && <span className="ml-2 text-xs text-gold">Vorschau</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="space-y-2">
        <Label id="inst-loader">Mod-Loader</Label>
        <div role="radiogroup" aria-labelledby="inst-loader" className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
          {ALL_LOADERS.map((l) => {
            const soon = !SUPPORTED_LOADERS.includes(l);
            return (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={loader === l}
                disabled={soon}
                onClick={() => setLoader(l)}
                className={cn(
                  "flex min-h-14 flex-col justify-center rounded-lg border px-3 py-2 text-left text-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                  loader === l ? "border-primary bg-accent" : "hover:bg-accent/50",
                )}
              >
                <span className="font-medium">{LOADER_LABELS[l]}</span>
                <span className="text-xs text-muted-foreground">{soon ? "bald verfügbar" : l === "vanilla" ? "ohne Mods" : "mit Mods"}</span>
              </button>
            );
          })}
        </div>
        {loaderUnavailable && (
          <p role="alert" className="text-xs text-destructive">
            {loaderVersions.error ? `${LOADER_LABELS[loader]} ist gerade nicht erreichbar.` : `Für Minecraft ${selected} gibt es noch kein ${LOADER_LABELS[loader]}.`}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="inst-name">
          Name <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input id="inst-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName} />
      </div>

      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden /> Erweitert
        </summary>
        <div className="mt-4 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="inst-snapshots">Vorschau-Versionen (Snapshots) anzeigen</Label>
            <Switch id="inst-snapshots" checked={snapshots} onCheckedChange={setSnapshots} />
          </div>
          {loader !== "vanilla" && (
            <div className="space-y-2">
              <Label htmlFor="inst-loader-version">{LOADER_LABELS[loader]}-Version</Label>
              <Select value={selectedLoader} onValueChange={setLoaderVersion} disabled={loaderUnavailable || loaderVersions.isLoading}>
                <SelectTrigger id="inst-loader-version" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={LATEST}>Neueste stabile (empfohlen)</SelectItem>
                  {loaderVersions.data?.map((v) => (
                    <SelectItem key={v.version} value={v.version}>
                      {v.version}
                      {!v.stable && <span className="ml-2 text-xs text-gold">Beta</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor="inst-memory-custom">Eigener Arbeitsspeicher</Label>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">Aus: Standard ({formatMemory(defaultMemory)}).</p>
              </div>
              <Switch id="inst-memory-custom" checked={memory != null} onCheckedChange={(on) => setMemory(on ? defaultMemory : null)} />
            </div>
            {memory != null && <MemorySlider id="inst-memory" value={memory} onChange={setMemory} />}
          </div>
        </div>
      </details>

      <DialogFooter>
        <Button type="submit" disabled={!selected || loaderUnavailable || create.isPending}>
          {create.isPending ? "Wird erstellt…" : "Erstellen"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function FileTab({ path, setPath, onDone }: { path: string; setPath: (p: string) => void; onDone: (id: string) => void }) {
  const [name, setName] = useState("");
  const install = useContentInstall();
  const progress = useContentState((s) => s.progress);

  async function choose() {
    const picked = await openFile({ multiple: false, directory: false, filters: [{ name: "Modpack", extensions: ["mrpack"] }] });
    if (picked) setPath(picked);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    install.mutate((op) => api.modrinthImportPack(path, name.trim() || packName(path), op), { onSuccess: (inst) => inst && onDone(inst.id) });
  }

  if (api.isMock) return <p className="text-sm text-muted-foreground">Dateien lassen sich nur in der Voxlet-App öffnen.</p>;

  return (
    <form onSubmit={submit} className="space-y-5">
      <button
        type="button"
        onClick={choose}
        className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center outline-none transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FileArchive className="size-6 text-muted-foreground" aria-hidden />
        {path ? (
          <span className="max-w-full truncate font-medium">{packName(path)}.mrpack</span>
        ) : (
          <span className="font-medium">Datei auswählen oder hierher ziehen</span>
        )}
        <span className="text-xs text-muted-foreground">Modpack-Datei (.mrpack), z. B. von Modrinth heruntergeladen</span>
      </button>
      {path && (
        <div className="space-y-2">
          <Label htmlFor="file-name">
            Name <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="file-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={packName(path)} />
        </div>
      )}
      <DialogFooter>
        <Button type="submit" disabled={!path || install.isPending}>
          {install.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {install.isPending ? (progress?.total ? `Lädt ${progress.done} von ${progress.total}…` : "Wird geprüft…") : "Importieren"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Kompakte Modpack-Suche; Details bleiben in „Entdecken“. */
function ModpackTab({ onDone, onDiscover }: { onDone: (id: string) => void; onDiscover: (projectId?: string) => void }) {
  return (
    <div>
      <ContentResults
        type="modpack"
        onOpen={(id) => onDiscover(id)}
        action={(hit) => <PackInstallButton projectId={hit.project_id} title={hit.title} reason={packReason(hit.categories)} onDone={onDone} />}
      />
      <Button variant="link" className="mt-2 px-0" onClick={() => onDiscover()}>
        <Compass aria-hidden /> Mehr in Entdecken
      </Button>
    </div>
  );
}

/** „Neu“: leere Instanz, Modpack oder Datei. Die `primary`-Instanz nimmt aufs Fenster gezogene .mrpack und Strg+N an. */
export function NewInstanceDialog({ children, primary }: { children: ReactNode; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("empty");
  const [path, setPath] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (api.isMock || !primary) return;
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      const file = payload.type === "drop" ? payload.paths.find((p) => /\.mrpack$/i.test(p)) : undefined;
      if (!file) return;
      setPath(file);
      setTab("file");
      setOpen(true);
    });
    return () => void unlisten.then((f) => f());
  }, [primary]);

  // Strg+N führt zu /instances?neu=1 (siehe Layout).
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!primary || !params.has("neu")) return;
    setTab("empty");
    setOpen(true);
    setParams({}, { replace: true });
  }, [primary, params, setParams]);

  function done(id: string) {
    setOpen(false);
    setPath("");
    navigate(`/instances/${id}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="w-[min(40rem,calc(100vw-2rem))] content-start">
        <DialogHeader>
          <DialogTitle>Neue Instanz</DialogTitle>
          <DialogDescription>Ein eigenes Minecraft mit eigener Version, eigenen Mods und eigenen Welten.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(t) => setTab(t as Tab)} className="min-w-0">
          <TabsList className="grid h-9 w-full grid-cols-4">
            <TabsTrigger value="empty">Leer</TabsTrigger>
            <TabsTrigger value="modpack">Modpack</TabsTrigger>
            <TabsTrigger value="file">Datei</TabsTrigger>
            <TabsTrigger value="template">Vorlage</TabsTrigger>
          </TabsList>
          <TabsContent value="empty" className="mt-5">
            <EmptyTab onDone={done} />
          </TabsContent>
          <TabsContent value="modpack" className="mt-5">
            <ModpackTab onDone={done} onDiscover={(id) => { setOpen(false); navigate(id ? `/discover?projekt=${id}` : "/discover"); }} />
          </TabsContent>
          <TabsContent value="file" className="mt-5">
            <FileTab path={path} setPath={setPath} onDone={done} />
          </TabsContent>
          <TabsContent value="template" className="mt-5">
            <TemplatesTab onDone={done} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
