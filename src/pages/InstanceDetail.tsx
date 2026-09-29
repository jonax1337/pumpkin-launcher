import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Blocks, BookmarkPlus, Check, ChevronRight, Clock, ExternalLink, Loader2, MoreHorizontal, Plus, RefreshCw, Search, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { BlockTile, ConfirmDialog, EmptyState, ErrorNote, LoaderBadge, MemorySlider } from "@/components/common";
import { CrashNotice, LogConsole, PlayControl, StatusBadge } from "@/components/game";
import { SaveTemplateDialog } from "@/components/SaveTemplateDialog";
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
  useMemory,
  useUpdateInstance,
  useUpdateMods,
} from "@/hooks/useInstances";
import { relativeTime } from "@/lib/format";
import { LOADER_LABELS, SUPPORTED_LOADERS, type Instance, type Mod, type ModKind } from "@/lib/types";
import { useGame } from "@/store/game";

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
      <EmptyState
        icon={<Blocks />}
        title="Noch keine Inhalte"
        action={<Button variant="secondary" onClick={onAdd}><Plus aria-hidden /> Hinzufügen</Button>}
      >
        {kindsFor(instance).map((k) => KIND_LABELS[k]).join(", ").replace(/, ([^,]*)$/, " und $1")}, passend zu dieser Instanz.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="In Inhalten suchen" placeholder="In Inhalten suchen" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        {kinds.length > 1 && (
          <Select value={kind} onValueChange={(k) => setKind(k as ModKind | "all")}>
            <SelectTrigger aria-label="Art filtern" className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle Arten</SelectItem>
              {kinds.map((k) => <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {updateFor.size > 0 && (
            <Button variant="outline" disabled={!!active} onClick={() => runUpdates([...updateFor.keys()])}>
              {active && target === "updates" ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
              {active && target === "updates" ? progressLabel(progress) : `Alle aktualisieren (${updateFor.size})`}
            </Button>
          )}
          <Button variant="secondary" onClick={onAdd}><Plus aria-hidden /> Hinzufügen</Button>
        </div>
      </div>

      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {visible.map(({ mod, owners }) => {
          const project = projects.data?.get(projectOf(mod) ?? "");
          const available = updateFor.get(mod.id);
          const busy = !!active && (target === mod.id || (target === "updates" && !!available));
          return (
            <li key={mod.id} className={cn("flex min-w-0 items-center gap-3 py-2.5 pr-3", owners.length ? "pl-11" : "pl-4")}>
              <div className={cn("flex min-w-0 flex-1 items-center gap-3", !mod.enabled && "opacity-50")}>
                <ContentIcon url={project?.icon_url} seed={mod.id} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={title(mod)}>{title(mod)}</p>
                  {owners.length > 0 && <p className="truncate text-xs text-muted-foreground">benötigt von {owners.join(", ")}</p>}
                </div>
              </div>
              {busy ? (
                <span role="status" className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> {progressLabel(progress)}
                </span>
              ) : available && (
                <Badge asChild variant="secondary" className="h-6 max-w-40 cursor-pointer rounded-md bg-gold/10 text-gold hover:bg-gold/20">
                  <button type="button" disabled={!!active} onClick={() => runUpdates([mod.id])} title={`Auf ${available.versionNumber} aktualisieren`}>
                    <RefreshCw aria-hidden /> <span className="truncate">Update {available.versionNumber}</span>
                  </button>
                </Badge>
              )}
              <span className="hidden w-28 shrink-0 truncate text-right text-xs tabular-nums text-muted-foreground md:block" title={mod.version}>{mod.version}</span>
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
        <p className="text-xs text-muted-foreground">Ressourcenpakete schaltest du im Spiel unter Optionen › Ressourcenpakete ein.</p>
      )}
      {instance.mods.some((m) => m.kind === "shader") && !byProject.has(IRIS_PROJECT_ID) && (
        <p className="text-xs text-gold">Shader funktionieren nur mit der Mod „Iris“. Füge sie über „Hinzufügen“ hinzu.</p>
      )}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="rounded-xl border bg-card p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** Spieldateien prüfen und neu laden. „Spielen“ installiert selbst; das hier ist nur für den Fall, dass etwas kaputt ist. */
function RepairSection({ instance }: { instance: Instance }) {
  const install = useInstall();
  const status = useInstanceStatus(instance.id);
  const busy = useGame((s) => !!s.installs[instance.id] || !!s.launching[instance.id]);
  if (!SUPPORTED_LOADERS.includes(instance.loader)) return null;
  return (
    <Section title="Reparieren">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-[60ch] min-w-0 flex-1 basis-64 text-sm text-muted-foreground">
          Prüft die Spieldateien und lädt fehlende oder beschädigte neu, falls das Spiel nicht mehr startet. Welten und Mods bleiben erhalten.
        </p>
        <Button variant="outline" disabled={busy || !!status.data?.running} onClick={() => install.mutate(instance)}>
          <Wrench aria-hidden /> {busy ? "Läuft gerade …" : "Reparieren"}
        </Button>
      </div>
    </Section>
  );
}

const splitArgs = (s: string) => s.split(/\s+/).filter(Boolean);

function SettingsTab({ instance }: { instance: Instance }) {
  const defaultMemory = useMemory().value;
  const [name, setName] = useState(instance.name);
  const [customMemory, setCustomMemory] = useState(instance.memoryMb != null);
  const [memory, setMemory] = useState(instance.memoryMb ?? defaultMemory);
  const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs.join(" "));
  const update = useUpdateInstance();
  const dirty =
    (name.trim() || instance.name) !== instance.name ||
    (customMemory ? memory : null) !== instance.memoryMb ||
    splitArgs(jvmArgs).join(" ") !== instance.jvmArgs.join(" ");

  function save(e: FormEvent) {
    e.preventDefault();
    update.mutate({ ...instance, name: name.trim() || instance.name, memoryMb: customMemory ? memory : null, jvmArgs: splitArgs(jvmArgs) });
  }

  return (
    <div className="max-w-3xl space-y-8">
      <form onSubmit={save}>
        <Section title="Allgemein" description="Gilt nur für diese Instanz.">
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="inst-edit-name">Name</Label>
              <Input id="inst-edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Label htmlFor="inst-custom-mem">Eigener Arbeitsspeicher</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Aus: Standard aus den Einstellungen.</p>
                </div>
                <Switch id="inst-custom-mem" checked={customMemory} onCheckedChange={setCustomMemory} />
              </div>
              <MemorySlider value={customMemory ? memory : defaultMemory} onChange={setMemory} disabled={!customMemory} />
            </div>
            <p className="text-sm text-muted-foreground">
              {LOADER_LABELS[instance.loader]}
              {instance.loaderVersion ? ` ${instance.loaderVersion}` : ""} für Minecraft {instance.minecraftVersion}
            </p>
            <details className="group" open={jvmArgs ? true : undefined}>
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 transition-transform duration-150 group-open:rotate-90" aria-hidden /> Erweitert
              </summary>
              <div className="mt-4 space-y-2">
                <Label htmlFor="inst-jvm">Java-Startoptionen</Label>
                <Textarea id="inst-jvm" value={jvmArgs} onChange={(e) => setJvmArgs(e.target.value)} className="font-mono text-xs" placeholder="-XX:+UseG1GC" spellCheck={false} />
                <p className="text-xs text-muted-foreground">Nur ändern, wenn du weißt, was die Optionen bewirken.</p>
              </div>
            </details>
            <div className="flex items-center justify-end gap-3 border-t pt-4">
              {update.isSuccess && !dirty && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                  <Check className="size-3.5 text-primary" aria-hidden /> Gespeichert
                </span>
              )}
              <Button type="submit" variant="secondary" disabled={update.isPending || !dirty}>
                {update.isPending ? "Speichert …" : "Speichern"}
              </Button>
            </div>
          </div>
        </Section>
      </form>

      <RepairSection instance={instance} />
    </div>
  );
}

export function InstanceDetailPage() {
  const { id } = useParams();
  const { data: instance, isLoading, error, refetch } = useInstance(id);
  // Tab in der URL, damit z. B. der Absturz-Toast direkt das Protokoll öffnen kann.
  const [params, setParams] = useSearchParams();
  // Ältere Links (overview/mods) landen bei den Inhalten.
  const tab = ["content", "console", "settings"].find((t) => t === params.get("tab")) ?? "content";
  const setTab = (value: string) => setParams({ tab: value }, { replace: true });
  const [adding, setAdding] = useState(false);
  const [menuAction, setMenuAction] = useState<"template" | "delete" | null>(null);
  const del = useDeleteInstance();
  const navigate = useNavigate();
  // Gleiche Query wie im Inhalte-Tab: der Kopf zeigt das Ergebnis, sobald der Tab einmal geprüft hat.
  const updates = useModUpdates(id ?? "", false);

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-4 -ml-3 text-muted-foreground">
        <Link to="/instances">
          <ArrowLeft aria-hidden /> Bibliothek
        </Link>
      </Button>

      {isLoading && (
        <div className="mb-8 flex flex-wrap items-center gap-5" aria-busy aria-label="Wird geladen">
          <Skeleton className="size-16 rounded-xl" />
          <div className="min-w-48 flex-1 space-y-3">
            <Skeleton className="h-8 w-2/3 max-w-72" />
            <Skeleton className="h-4 w-1/2 max-w-48" />
          </div>
          <Skeleton className="h-12 w-44" />
        </div>
      )}
      {error && <ErrorNote title="Diese Instanz konnte nicht geladen werden" error={error} onRetry={() => void refetch()} />}

      {instance && (
        <>
          <header className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-5">
            <div className="flex min-w-0 flex-1 basis-80 items-center gap-4">
              <BlockTile seed={instance.id} size="lg" />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-2xl font-semibold tracking-tight xl:text-3xl" title={instance.name}>
                  {instance.name}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
                  <StatusBadge instanceId={instance.id} />
                  <LoaderBadge loader={instance.loader} />
                  <span className="tabular-nums">Minecraft {instance.minecraftVersion}</span>
                  {instance.lastPlayedAt != null && (
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="size-3.5" aria-hidden /> {relativeTime(instance.lastPlayedAt)}
                    </span>
                  )}
                  {!!updates.data?.length && (
                    <button
                      type="button"
                      className="rounded-sm text-gold underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setTab("content")}
                    >
                      {updates.data.length === 1 ? "1 Update" : `${updates.data.length} Updates`}
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <PlayControl instance={instance} align="end" onLaunched={() => setTab("console")} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`Mehr zu ${instance.name}`} className="size-12">
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setMenuAction("template")}>
                    <BookmarkPlus aria-hidden /> Als Vorlage speichern …
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => setMenuAction("delete")}>
                    <Trash2 aria-hidden /> Löschen …
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <Tabs value={tab} onValueChange={setTab} className="gap-6">
            <TabsList variant="line" className="h-10 w-full justify-start gap-5 rounded-none border-b p-0">
              <TabsTrigger value="content" className="flex-none px-0.5">
                Inhalte <span className="text-muted-foreground tabular-nums">{instance.mods.length}</span>
              </TabsTrigger>
              <TabsTrigger value="console" className="flex-none px-0.5">
                Protokoll
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex-none px-0.5">
                Einstellungen
              </TabsTrigger>
            </TabsList>
            <TabsContent value="console">
              <CrashNotice instanceId={instance.id} />
              <LogConsole instanceId={instance.id} />
            </TabsContent>
            <TabsContent value="content">
              <ContentTab instance={instance} onAdd={() => setAdding(true)} />
            </TabsContent>
            <TabsContent value="settings">
              <SettingsTab key={`${instance.name}-${instance.memoryMb}-${instance.jvmArgs.join()}`} instance={instance} />
            </TabsContent>
          </Tabs>
          <AddContentSheet instance={instance} open={adding} onOpenChange={setAdding} />
          <SaveTemplateDialog instance={menuAction === "template" ? instance : null} onClose={() => setMenuAction(null)} />
          <ConfirmDialog
            open={menuAction === "delete"}
            onOpenChange={(o) => !o && setMenuAction(null)}
            title={`„${instance.name}“ löschen?`}
            description="Die Instanz samt Mods und Welten wird entfernt. Das lässt sich nicht rückgängig machen."
            pending={del.isPending}
            onConfirm={() => del.mutate(instance.id, { onSuccess: () => navigate("/instances") })}
          />
        </>
      )}
    </div>
  );
}
