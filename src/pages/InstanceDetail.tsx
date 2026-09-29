import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Blocks, Check, ExternalLink, Loader2, MoreHorizontal, Plus, RefreshCw, Search, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { BlockTile, ConfirmDialog, EmptyState, ErrorNote, LoaderBadge } from "@/components/common";
import { LogConsole, PlayControl, StatusBadge } from "@/components/game";
import { AddContentSheet, ContentIcon, IRIS_PROJECT_ID, KIND_LABELS, kindsFor } from "@/components/ContentBrowser";
import { useContentInstall, useContentState, useModUpdates, useProjects, withTarget } from "@/hooks/useContent";
import { api } from "@/lib/api";
import { progressLabel, projectOf, removeWithDependencies, undoRemove } from "@/lib/modrinth";
import { cn } from "@/lib/utils";
import {
  instanceKeys,
  useDeleteInstance,
  useInstall,
  useInstance,
  useInstanceStatus,
  useUpdateInstance,
  useUpdateMods,
} from "@/hooks/useInstances";
import { formatDate, formatMemory, relativeTime } from "@/lib/format";
import { INSTALLABLE_LOADERS, type Instance, type Mod, type ModKind } from "@/lib/types";
import { useGame } from "@/store/game";
import { useSettings } from "@/store/settings";

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border bg-card/60 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={mono ? "mt-1 font-mono text-lg" : "mt-1 text-lg font-medium"}>{value}</p>
    </div>
  );
}

function OverviewTab({ instance }: { instance: Instance }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Minecraft" value={instance.minecraftVersion} mono />
        <Stat label="Loader-Version" value={instance.loaderVersion ?? "–"} mono />
        <Stat label="Mods" value={`${instance.mods.filter((m) => m.enabled).length} / ${instance.mods.length} aktiv`} />
        <Stat label="Arbeitsspeicher" value={formatMemory(instance.memoryMb)} />
      </div>
      <Card className="bg-card/60">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[160px_1fr] gap-y-3 text-sm">
            <dt className="text-muted-foreground">Erstellt</dt>
            <dd>{formatDate(instance.createdAt)}</dd>
            <dt className="text-muted-foreground">Zuletzt gespielt</dt>
            <dd>{relativeTime(instance.lastPlayedAt)}</dd>
            <dt className="text-muted-foreground">JVM-Argumente</dt>
            <dd className="font-mono text-xs break-all">{instance.jvmArgs.join(" ") || "–"}</dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

type Row = { mod: Mod; owners: string[] };

function ContentTab({ instance, onAdd }: { instance: Instance; onAdd: () => void }) {
  const qc = useQueryClient();
  const update = useUpdateMods(instance.id);
  const install = useContentInstall();
  const { active, target, progress } = useContentState();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<ModKind | "all">("all");
  const projects = useProjects(instance.mods.flatMap((m) => projectOf(m) ?? []));
  const updates = useModUpdates(instance.id, instance.mods.length > 0);
  // Nur Updates, deren Stand noch stimmt: direkt nach dem Aktualisieren läuft der Check erst neu.
  const updateFor = new Map(
    (updates.data ?? []).filter((u) => instance.mods.some((m) => m.id === u.modId && m.version === u.currentVersion)).map((u) => [u.modId, u]),
  );
  const byProject = new Map(instance.mods.flatMap((m) => { const p = projectOf(m); return p ? [[p, m] as const] : []; }));
  const title = (m: Mod) => projects.data?.get(projectOf(m) ?? "")?.title ?? m.name;
  const kinds = [...new Set(instance.mods.map((m) => m.kind))];

  // Direkt Hinzugefügtes zuerst, jede Abhängigkeit eingerückt unter ihrem ersten vorhandenen Nutzer.
  const ownersOf = (m: Mod) => m.requiredBy.flatMap((p) => byProject.get(p) ?? []);
  const rows: Row[] = [];
  const placed = new Set<Mod>();
  const add = (mod: Mod) => { rows.push({ mod, owners: ownersOf(mod).map(title) }); placed.add(mod); };
  for (const m of instance.mods.filter((m) => ownersOf(m).length === 0)) {
    add(m);
    instance.mods.filter((d) => ownersOf(d)[0] === m).forEach(add);
  }
  instance.mods.filter((m) => !placed.has(m)).forEach(add);
  const needle = search.trim().toLowerCase();
  const visible = rows.filter(({ mod }) => (kind === "all" || mod.kind === kind) && (!needle || title(mod).toLowerCase().includes(needle)));

  function remove(mod: Mod) {
    const before = instance.mods;
    const { mods, removed } = removeWithDependencies(before, mod.id);
    update.mutate({ ...instance, mods });
    const extra = removed.length - 1;
    toast(`${title(mod)}${extra ? ` und ${extra} ${extra === 1 ? "Abhängigkeit" : "Abhängigkeiten"}` : ""} entfernt`, {
      duration: 6000,
      action: {
        label: "Rückgängig",
        onClick: () => {
          // Aktuellen Stand nehmen: in den 6 s können weitere Änderungen passiert sein.
          const current = qc.getQueryData<Instance>(instanceKeys.detail(instance.id));
          if (!current || current.mods.some((m) => m.id === mod.id)) return;
          update.mutate({ ...current, mods: undoRemove(current.mods, before, removed) });
        },
      },
    });
  }

  function runUpdates(modIds: string[]) {
    const name = modIds.length === 1 ? title(instance.mods.find((m) => m.id === modIds[0])!) : "";
    install.mutate(withTarget(modIds.length === 1 ? modIds[0] : "updates", (op) => api.modrinthUpdateMods(instance.id, modIds, op)), {
      onSuccess: (result) => { if (result) toast.success(name ? `${name} aktualisiert` : `${modIds.length} Inhalte aktualisiert`); },
    });
  }

  if (instance.mods.length === 0) {
    return (
      <EmptyState icon={<Blocks className="size-5" />} title="Noch keine Inhalte">
        <p>{kindsFor(instance).map((k) => KIND_LABELS[k]).join(", ").replace(/, ([^,]*)$/, " und $1")}, passend zu dieser Instanz.</p>
        <Button className="mt-4" onClick={onAdd}><Plus aria-hidden /> Hinzufügen</Button>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="In Inhalten suchen" placeholder="In Inhalten suchen" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        {kinds.length > 1 && (
          <Select value={kind} onValueChange={(k) => setKind(k as ModKind | "all")}>
            <SelectTrigger aria-label="Art filtern" className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle</SelectItem>
              {kinds.map((k) => <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {updateFor.size > 0 && (
          <Button variant="outline" disabled={!!active} onClick={() => runUpdates([...updateFor.keys()])}>
            {active && target === "updates" ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            {active && target === "updates" ? progressLabel(progress) : `Alle aktualisieren (${updateFor.size})`}
          </Button>
        )}
        <Button onClick={onAdd}><Plus aria-hidden /> Hinzufügen</Button>
      </div>

      <ul className="divide-y overflow-hidden rounded-xl border bg-card/60">
        {visible.map(({ mod, owners }) => {
          const project = projects.data?.get(projectOf(mod) ?? "");
          const available = updateFor.get(mod.id);
          const busy = !!active && (target === mod.id || (target === "updates" && !!available));
          return (
            <li key={mod.id} className={cn("flex items-center gap-3 py-2.5 pr-3", owners.length ? "pl-10" : "pl-3")}>
              <div className={cn("flex min-w-0 flex-1 items-center gap-3", !mod.enabled && "opacity-50")}>
                <ContentIcon url={project?.icon_url} seed={mod.id} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{title(mod)}</p>
                  {owners.length > 0 && <p className="truncate text-xs text-muted-foreground">benötigt von {owners.join(", ")}</p>}
                </div>
              </div>
              {busy ? (
                <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> {progressLabel(progress)}
                </span>
              ) : available && (
                <Badge asChild variant="secondary" className="cursor-pointer text-primary">
                  <button type="button" disabled={!!active} onClick={() => runUpdates([mod.id])} title="Jetzt aktualisieren">
                    Update: {available.versionNumber}
                  </button>
                </Badge>
              )}
              <span className="hidden w-24 truncate text-right font-mono text-xs text-muted-foreground sm:block" title={mod.version}>{mod.version}</span>
              <Switch
                checked={mod.enabled}
                aria-label={`${title(mod)} ${mod.enabled ? "ausschalten" : "einschalten"}`}
                onCheckedChange={(enabled) =>
                  update.mutate({ ...instance, mods: instance.mods.map((m) => (m.id === mod.id ? { ...m, enabled } : m)) })
                }
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Mehr zu ${title(mod)}`}><MoreHorizontal aria-hidden /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {available && (
                    <DropdownMenuItem disabled={!!active} onSelect={() => runUpdates([mod.id])}>
                      <RefreshCw aria-hidden /> Auf {available.versionNumber} aktualisieren
                    </DropdownMenuItem>
                  )}
                  {projectOf(mod) && (
                    <DropdownMenuItem onSelect={() => void api.openExternal(`https://modrinth.com/project/${projectOf(mod)}`)}>
                      <ExternalLink aria-hidden /> Auf Modrinth ansehen
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem variant="destructive" onSelect={() => remove(mod)}>
                    <Trash2 aria-hidden /> Entfernen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
        {visible.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nichts gefunden.</li>}
      </ul>

      {instance.mods.some((m) => m.kind === "resourcepack") && (
        <p className="text-xs text-muted-foreground">Ressourcenpakete aktivierst du im Spiel unter Optionen › Ressourcenpakete.</p>
      )}
      {instance.mods.some((m) => m.kind === "shader") && !byProject.has(IRIS_PROJECT_ID) && (
        <p className="text-xs text-gold">Shader funktionieren nur mit der Mod „Iris“. Füge sie über „Hinzufügen“ hinzu.</p>
      )}
    </div>
  );
}

/** Spieldateien prüfen und neu laden. „Spielen“ installiert selbst; das hier ist nur für den Fall, dass etwas kaputt ist. */
function RepairCard({ instance }: { instance: Instance }) {
  const install = useInstall();
  const status = useInstanceStatus(instance.id);
  const busy = useGame((s) => !!s.installs[instance.id] || !!s.launching[instance.id]);
  if (!INSTALLABLE_LOADERS.includes(instance.loader)) return null;
  return (
    <Card className="bg-card/60">
      <CardHeader>
        <CardTitle>Reparieren</CardTitle>
        <CardDescription>
          Prüft die Spieldateien und lädt fehlende oder beschädigte neu, falls das Spiel nicht mehr startet. Welten und Mods bleiben erhalten.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" disabled={busy || !!status.data?.running} onClick={() => install.mutate(instance)}>
          <Wrench aria-hidden /> {busy ? "Läuft gerade…" : "Reparieren"}
        </Button>
      </CardContent>
    </Card>
  );
}

function SettingsTab({ instance }: { instance: Instance }) {
  const defaultMemory = useSettings((s) => s.memoryMb);
  const [name, setName] = useState(instance.name);
  const [customMemory, setCustomMemory] = useState(instance.memoryMb != null);
  const [memory, setMemory] = useState(instance.memoryMb ?? defaultMemory);
  const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs.join(" "));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useUpdateInstance();
  const del = useDeleteInstance();
  const navigate = useNavigate();

  function save() {
    update.mutate({
      ...instance,
      name: name.trim() || instance.name,
      memoryMb: customMemory ? memory : null,
      jvmArgs: jvmArgs.split(/\s+/).filter(Boolean),
    });
  }

  return (
    <div className="space-y-6">
      <Card className="bg-card/60">
        <CardHeader>
          <CardTitle>Allgemein</CardTitle>
          <CardDescription>Einstellungen gelten nur für diese Instanz.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="inst-edit-name">Name</Label>
            <Input id="inst-edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="inst-custom-mem">Eigener Arbeitsspeicher</Label>
              <Switch id="inst-custom-mem" checked={customMemory} onCheckedChange={setCustomMemory} />
            </div>
            <div className="flex items-center gap-4">
              <Slider
                aria-label="Arbeitsspeicher in MB"
                min={1024}
                max={16384}
                step={512}
                value={[customMemory ? memory : defaultMemory]}
                onValueChange={([v]) => setMemory(v)}
                disabled={!customMemory}
              />
              <span className="w-20 text-right font-mono text-sm">
                {formatMemory(customMemory ? memory : defaultMemory)}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="inst-jvm">JVM-Argumente</Label>
            <Textarea
              id="inst-jvm"
              value={jvmArgs}
              onChange={(e) => setJvmArgs(e.target.value)}
              className="font-mono text-xs"
              placeholder="-XX:+UseG1GC"
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={save} disabled={update.isPending}>
              {update.isSuccess && !update.isPending ? <Check aria-hidden /> : null}
              {update.isPending ? "Speichert…" : "Speichern"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <RepairCard instance={instance} />

      <Card className="border-destructive/30 bg-destructive/5 ring-destructive/20">
        <CardHeader>
          <CardTitle>Instanz löschen</CardTitle>
          <CardDescription>Entfernt die Instanz inklusive Mods und Welten.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden /> Löschen
          </Button>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`„${instance.name}" löschen?`}
        description="Das lässt sich nicht rückgängig machen."
        pending={del.isPending}
        onConfirm={() => del.mutate(instance.id, { onSuccess: () => navigate("/instances") })}
      />
    </div>
  );
}

export function InstanceDetailPage() {
  const { id } = useParams();
  const { data: instance, isLoading, error } = useInstance(id);
  // Tab in der URL, damit z. B. der Absturz-Toast direkt die Konsole öffnen kann.
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const setTab = (value: string) => setParams({ tab: value }, { replace: true });
  const [adding, setAdding] = useState(false);
  // Gleiche Query wie im Inhalte-Tab: der Kopf zeigt das Ergebnis, sobald der Tab einmal geprüft hat.
  const updates = useModUpdates(id ?? "", false);

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-6 -ml-2 text-muted-foreground">
        <Link to="/instances">
          <ArrowLeft aria-hidden /> Instanzen
        </Link>
      </Button>

      {isLoading && (
        <div className="mb-8 flex items-center gap-5">
          <Skeleton className="size-20 rounded-xl" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-5 w-40" />
          </div>
          <Skeleton className="h-9 w-32" />
        </div>
      )}
      {error && <ErrorNote error={error} />}

      {instance && (
        <>
          <header className="mb-8 flex flex-wrap items-center gap-5">
            <BlockTile seed={instance.id} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-3xl font-semibold">{instance.name}</h1>
              <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
                <StatusBadge instanceId={instance.id} />
                <LoaderBadge loader={instance.loader} />
                <span className="font-mono">{instance.minecraftVersion}</span>
                {!!updates.data?.length && (
                  <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => setTab("content")}>
                    {updates.data.length === 1 ? "1 Update" : `${updates.data.length} Updates`}
                  </button>
                )}
              </div>
            </div>
            <PlayControl instance={instance} onLaunched={() => setTab("console")} />
          </header>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="overview">Übersicht</TabsTrigger>
              <TabsTrigger value="content">Inhalte ({instance.mods.length})</TabsTrigger>
              <TabsTrigger value="console">Konsole</TabsTrigger>
              <TabsTrigger value="settings">Einstellungen</TabsTrigger>
            </TabsList>
            <TabsContent value="console">
              <LogConsole instanceId={instance.id} />
            </TabsContent>
            <TabsContent value="overview">
              <OverviewTab instance={instance} />
            </TabsContent>
            <TabsContent value="content">
              <ContentTab instance={instance} onAdd={() => setAdding(true)} />
            </TabsContent>
            <TabsContent value="settings">
              <SettingsTab key={`${instance.presetId}-${instance.memoryMb}-${instance.jvmArgs.join()}`} instance={instance} />
            </TabsContent>
          </Tabs>
          <AddContentSheet instance={instance} open={adding} onOpenChange={setAdding} />
        </>
      )}
    </div>
  );
}
