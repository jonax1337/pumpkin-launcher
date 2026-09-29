import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Download, Loader2, Plus, Search, SearchX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BlockTile, EmptyState, ErrorNote } from "@/components/common";
import { useContentInstall, useContentState, withTarget } from "@/hooks/useContent";
import { useInstances } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import {
  formatDownloads, isPackVersionSupported, modLoadersFor, pickPackVersion, pickVersion, progressLabel, projectOf,
  type CatalogType, type ContentHit, type ContentProject, type ContentVersion,
} from "@/lib/modrinth";
import { LOADER_LABELS, type Instance, type ModKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export const IRIS_PROJECT_ID = "YL57xq9U";

export const KIND_LABELS: Record<ModKind, string> = { mod: "Mods", shader: "Shader", resourcepack: "Ressourcenpakete" };

/** Was in eine Instanz passt: Mods und Shader nur mit Mod-Loader, Ressourcenpakete immer. */
export const kindsFor = (instance: Instance): ModKind[] =>
  instance.loader !== "vanilla" ? ["mod", "shader", "resourcepack"] : ["resourcepack"];

/** „Fabric 1.21.4“ für Mods, sonst nur die Minecraft-Version. */
export const fitsLabel = (instance: Instance, type: CatalogType) =>
  type === "mod" ? `${LOADER_LABELS[instance.loader]} ${instance.minecraftVersion}` : `Minecraft ${instance.minecraftVersion}`;

const versionsKey = (projectId: string, mc: string | null, loader: string | null) => ["modrinth-versions", projectId, mc, loader];
// Für Quilt fragt das Backend Quilt- und Fabric-Mods an.
const loaderFor = (instance: Instance, type: CatalogType) => (type === "mod" ? instance.loader : null);

export function ContentIcon({ url, seed, size = "md" }: { url?: string | null; seed: string; size?: "sm" | "md" | "lg" }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) return <BlockTile seed={seed} size={size === "lg" ? "xl" : size} />;
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      className={cn(
        "shrink-0 rounded-lg bg-muted object-cover",
        size === "sm" && "size-9 rounded-md",
        size === "md" && "size-12",
        size === "lg" && "size-20 rounded-xl",
      )}
    />
  );
}

// ---------- Beschreibung (Markdown mit HTML von Modrinth) ----------

// Nur https-Bilder, nur http(s)-Links; Skripte und Event-Handler entfernt DOMPurify ohnehin.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "IMG") {
    if (!/^https:\/\//i.test(node.getAttribute("src") ?? "")) node.removeAttribute("src");
    node.setAttribute("loading", "lazy");
    node.setAttribute("referrerpolicy", "no-referrer");
  }
  if (node.tagName === "A" && !/^https?:\/\//i.test(node.getAttribute("href") ?? "")) node.removeAttribute("href");
});
const PURIFY = {
  FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "svg", "math", "video", "audio", "source", "picture"],
  FORBID_ATTR: ["style", "class", "id", "srcset", "target"],
};

/**
 * Reihen verlinkter Bild-Knöpfe („How to install“, „Discord“, Badges) als ruhige Textlinks aus dem Alt-Text,
 * damit fremd gestaltete Knöpfe nicht neben denen der App stehen. Einzelne verlinkte Bilder (Videos, Screenshots) bleiben.
 */
function badgeRowsAsLinks(root: DocumentFragment) {
  for (const p of root.querySelectorAll("p")) {
    const links = [...p.children];
    const badges = links.length > 1 && !p.textContent?.trim() && links.every((a) => a.tagName === "A" && a.children.length === 1 && a.firstElementChild?.tagName === "IMG");
    if (!badges) continue;
    p.className = "flex flex-wrap gap-x-4 gap-y-1";
    for (const a of links) a.replaceChildren(a.firstElementChild!.getAttribute("alt")?.trim() || new URL((a as HTMLAnchorElement).href || "https://link").hostname);
  }
}

export function Description({ body }: { body: string }) {
  const html = useMemo(() => {
    const doc = DOMPurify.sanitize(marked.parse(body, { async: false }), { ...PURIFY, RETURN_DOM_FRAGMENT: true });
    badgeRowsAsLinks(doc);
    const box = document.createElement("div");
    box.append(doc);
    return box.innerHTML;
  }, [body]);
  // Links nie im Launcher-Fenster öffnen, sondern im Standardbrowser.
  function onLink(e: MouseEvent) {
    const link = (e.target as Element).closest("a");
    if (!link) return;
    e.preventDefault();
    if (/^https?:/.test(link.href)) void api.openExternal(link.href);
  }
  return (
    <div
      onClick={onLink}
      onAuxClick={onLink}
      className="text-sm leading-relaxed break-words text-muted-foreground [&_a]:text-primary [&_a]:underline-offset-4 [&_a:hover]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:font-medium [&_h3]:text-foreground [&_hr]:my-4 [&_img]:inline-block [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-md [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_strong]:text-foreground [&_table]:block [&_table]:overflow-x-auto [&_td]:px-2 [&_th]:px-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ---------- Hinzufügen ----------

/**
 * Wählt die passende Version automatisch (oder nimmt `versionId`) und installiert mit Abhängigkeiten.
 * "missing" = keine Version für diese Instanz. Mit `openAction` bekommt der Toast „Öffnen“ (Instanz, Tab Inhalte).
 */
function useAddContent() {
  const qc = useQueryClient();
  const install = useContentInstall();
  const navigate = useNavigate();
  return async (instance: Instance, projectId: string, title: string, type: CatalogType, opts: { versionId?: string; openAction?: boolean } = {}) => {
    let id = opts.versionId;
    if (!id) {
      const mc = instance.minecraftVersion, loader = loaderFor(instance, type);
      try {
        const versions = await qc.fetchQuery({
          queryKey: versionsKey(projectId, mc, loader),
          queryFn: () => api.modrinthVersions(projectId, mc, loader),
          staleTime: 10 * 60_000,
        });
        id = pickVersion(versions)?.id;
      } catch (err) {
        toast.error(`${title} konnte nicht geladen werden`, { description: err instanceof Error ? err.message : String(err) });
        return "error";
      }
      if (!id) return "missing";
    }
    const before = instance.mods.length;
    install.mutate(withTarget(projectId, (op) => api.modrinthInstallMod(instance.id, id, op)), {
      onSuccess: (result) => {
        if (!result) return;
        const extra = result.mods.length - before - 1;
        const deps = extra > 0 ? ` (+ ${extra} benötigte ${extra === 1 ? "Mod" : "Mods"})` : "";
        if (!opts.openAction) return void toast.success(`${title} hinzugefügt${deps}`);
        toast.success(`${title} ist jetzt in ${result.name}${deps}`, {
          action: { label: "Öffnen", onClick: () => navigate(`/instances/${result.id}?tab=content`) },
        });
      },
    });
    return "ok";
  };
}

function AddButton({ instance, projectId, title, type, versionId, large }: {
  instance: Instance; projectId: string; title: string; type: CatalogType; versionId?: string; large?: boolean;
}) {
  const addContent = useAddContent();
  const { active, target, progress } = useContentState();
  const [state, setState] = useState<"idle" | "checking" | "missing">("idle");
  const installed = instance.mods.some((m) => projectOf(m) === projectId);

  async function add() {
    setState("checking");
    setState((await addContent(instance, projectId, title, type, { versionId })) === "missing" ? "missing" : "idle");
  }

  const note = "flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground";
  if (installed) return <span className={note}><Check className="size-3.5 text-primary" aria-hidden /> Installiert</span>;
  if (state === "checking" || (active && target === projectId))
    return <span role="status" className={note}><Loader2 className="size-3.5 animate-spin" aria-hidden /> {state === "checking" ? "Wird geprüft…" : progressLabel(progress)}</span>;
  if (state === "missing") return <span className={note}>Keine Version für {instance.minecraftVersion}</span>;
  return large ? (
    <Button disabled={!!active} onClick={add}><Plus aria-hidden /> Hinzufügen</Button>
  ) : (
    <Button variant="secondary" size="icon-sm" disabled={!!active} aria-label={`${title} hinzufügen`} title="Hinzufügen" onClick={add}>
      <Plus aria-hidden />
    </Button>
  );
}

const busyNote = (label: string, onCancel?: () => void) => (
  <span className="flex shrink-0 items-center gap-1">
    <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
      <Loader2 className="size-3.5 animate-spin" aria-hidden /> {label}
    </span>
    {onCancel && (
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onCancel}>
        <X aria-hidden /> Abbrechen
      </Button>
    )}
  </span>
);

/** Laufende Modpack-Installation abbrechen; das Ergebnis meldet der zentrale Fehler-Toast neutral. */
function cancelActive() {
  const op = useContentState.getState().active;
  if (op) void api.packInstallCancel(op).catch((e: Error) => toast.error(e.message));
}

/** Ohne Instanz-Kontext: Menü mit allen Instanzen; unpassende ausgegraut mit Grund, sonst „Neue Instanz anlegen…“. */
export function AddToInstanceMenu({ projectId, title, type, large }: { projectId: string; title: string; type: ModKind; large?: boolean }) {
  const instances = useInstances();
  const addContent = useAddContent();
  const navigate = useNavigate();
  const { active, target, progress } = useContentState();
  const [open, setOpen] = useState(false);
  // Alle Versionen einmal laden, um Instanzen ohne passende Minecraft-Version vorab auszugrauen.
  const all = useQuery({
    queryKey: versionsKey(projectId, null, null),
    queryFn: () => api.modrinthVersions(projectId, null, null),
    enabled: open,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const reasonFor = (i: Instance): string | null => {
    if (!kindsFor(i).includes(type)) return "Geht nur in Instanzen mit Mod-Loader";
    if (i.mods.some((m) => projectOf(m) === projectId)) return "Schon drin";
    const fits = all.data?.some((v) => v.game_versions.includes(i.minecraftVersion) && (type !== "mod" || v.loaders.some((l) => modLoadersFor(i.loader).includes(l))));
    return all.data && !fits ? `Keine Version für ${i.minecraftVersion}` : null;
  };
  const rows = (instances.data ?? []).map((i) => ({ i, reason: reasonFor(i) }));
  const usable = rows.some((r) => !r.reason);

  if (active && target === projectId) return busyNote(progressLabel(progress));
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant={large ? "default" : "outline"} size={large ? "default" : "sm"} disabled={!!active} aria-label={large ? undefined : `${title} zu Instanz hinzufügen`}>
          <Plus aria-hidden /> {large ? "Zu Instanz hinzufügen" : "Hinzufügen"} <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-64">
        <DropdownMenuLabel>Hinzufügen zu …</DropdownMenuLabel>
        {rows.map(({ i, reason }) => (
          <DropdownMenuItem
            key={i.id}
            disabled={!!reason}
            onSelect={() =>
              void addContent(i, projectId, title, type, { openAction: true }).then(
                (r) => r === "missing" && toast.error(`${title} gibt es nicht für Minecraft ${i.minecraftVersion}`),
              )
            }
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{i.name}</span>
              <span className="block text-xs text-muted-foreground">{reason ?? fitsLabel(i, type)}</span>
            </span>
          </DropdownMenuItem>
        ))}
        {all.isPending && rows.length > 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Prüft passende Versionen…</p>}
        {!usable && !all.isPending && (
          <>
            {rows.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => navigate("/instances?neu=1")}>
              <Plus aria-hidden /> {type === "resourcepack" ? "Neue Instanz anlegen…" : "Neue Fabric-Instanz anlegen…"}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Modpack als neue Instanz; ohne `versionId` die neueste stabile Fabric/Vanilla-Version. */
function useInstallPack(projectId: string, title: string, onDone?: (instanceId: string) => void) {
  const qc = useQueryClient();
  const install = useContentInstall();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const { active, target, progress } = useContentState();

  async function run(versionId?: string) {
    let id = versionId;
    if (!id) {
      setChecking(true);
      try {
        const picked = pickPackVersion(await qc.fetchQuery({
          queryKey: versionsKey(projectId, null, null),
          queryFn: () => api.modrinthVersions(projectId, null, null),
          staleTime: 10 * 60_000,
        }));
        if (picked.reason) toast.error(`${title} lässt sich nicht installieren`, { description: picked.reason });
        id = picked.version?.id;
      } catch (err) {
        toast.error(`${title} konnte nicht geladen werden`, { description: err instanceof Error ? err.message : String(err) });
      } finally {
        setChecking(false);
      }
      if (!id) return;
    }
    install.mutate(withTarget(projectId, (op) => api.modrinthInstallPack(id, title, op)), {
      onSuccess: (inst) => {
        if (!inst) return;
        toast.success(`${title} ist bereit – „Spielen“ lädt beim ersten Start den Rest`);
        if (onDone) onDone(inst.id);
        else navigate(`/instances/${inst.id}`);
      },
    });
  }
  const busy = checking ? "Wird geprüft…" : active && target === projectId ? progressLabel(progress) : null;
  return { run, busy, blocked: !!active || checking, cancel: !checking && busy ? cancelActive : undefined };
}

/** Zeilenaktion für Modpacks. */
export function PackInstallButton({ projectId, title, onDone }: { projectId: string; title: string; onDone?: (instanceId: string) => void }) {
  const pack = useInstallPack(projectId, title, onDone);
  if (pack.busy) return busyNote(pack.busy, pack.cancel);
  return (
    <Button variant="secondary" size="sm" className="shrink-0" disabled={pack.blocked} aria-label={`${title} als Instanz installieren`} onClick={() => void pack.run()}>
      <Download aria-hidden /> Installieren
    </Button>
  );
}

/** Aktionen in den Pack-Details: „Als Instanz installieren“ plus „Andere Version…“. */
export function PackActions({ projectId, title, onDone }: { projectId: string; title: string; onDone?: (instanceId: string) => void }) {
  const pack = useInstallPack(projectId, title, onDone);
  const versions = useQuery({
    queryKey: versionsKey(projectId, null, null),
    queryFn: () => api.modrinthVersions(projectId, null, null),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const { version, reason } = versions.data ? pickPackVersion(versions.data) : { version: null, reason: null };
  const fitting = versions.data?.filter(isPackVersionSupported) ?? [];

  if (pack.busy) return busyNote(pack.busy, pack.cancel);
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap gap-2">
        <Button disabled={!version || pack.blocked} onClick={() => void pack.run(version?.id)}>
          <Download aria-hidden /> Als Instanz installieren
        </Button>
        {fitting.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={pack.blocked}>Andere Version… <ChevronDown aria-hidden /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80">
              {fitting.map((v) => (
                <DropdownMenuItem key={v.id} onSelect={() => void pack.run(v.id)}>
                  <span className="flex-1">{v.version_number}</span>
                  <span className="text-xs text-muted-foreground">Minecraft {v.game_versions.at(-1)}</span>
                  {VERSION_TYPE[v.version_type] && <span className="text-xs text-gold">{VERSION_TYPE[v.version_type]}</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {reason && <span className="text-xs text-muted-foreground">{reason}</span>}
    </div>
  );
}

// ---------- Suche und Ergebnisse ----------

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const SEARCH_PLACEHOLDER: Record<CatalogType, string> = {
  mod: "Mods suchen…", shader: "Shader suchen…", resourcepack: "Ressourcenpakete suchen…", modpack: "Modpacks suchen…",
};

/**
 * Suche mit „Beliebt“ als Startzustand. Mit `instance` passend gefiltert und mit „+“ je Zeile,
 * sonst mit `action` je Zeile. `barClassName` gibt der klebenden Suchleiste den Hintergrund der Umgebung.
 */
export function ContentResults({ type, instance, action, onOpen, barClassName = "bg-popover", grid, autoFocus = true }: {
  type: CatalogType; instance?: Instance; action?: (hit: ContentHit) => ReactNode; onOpen: (projectId: string) => void; barClassName?: string;
  /** Kacheln im Raster statt einer Liste (Entdecken in breiten Fenstern). */
  grid?: boolean; autoFocus?: boolean;
}) {
  const [input, setInput] = useState("");
  const query = useDebounced(input.trim(), 300);
  const mc = instance?.minecraftVersion ?? null;
  const loader = instance ? loaderFor(instance, type) : null;
  const results = useInfiniteQuery({
    queryKey: ["modrinth-search", type, query, mc, loader],
    queryFn: ({ pageParam }) => api.modrinthSearch(query, type, mc, loader, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.hits.length < last.total_hits ? last.offset + last.limit : undefined),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const hits = results.data?.pages.flatMap((p) => p.hits) ?? [];

  return (
    <div>
      <div className={cn("sticky top-0 z-10 pt-1 pb-3", barClassName)}>
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label={SEARCH_PLACEHOLDER[type]}
            placeholder={SEARCH_PLACEHOLDER[type]}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus={autoFocus}
            className="pl-9"
          />
        </div>
      </div>
      <p className="mb-2 text-xs font-medium text-muted-foreground" aria-live="polite">
        {!query ? "Beliebt" : results.data ? `${results.data.pages[0].total_hits.toLocaleString("de")} Treffer` : "Sucht…"}
      </p>

      {results.error && <ErrorNote title="Modrinth ist gerade nicht erreichbar" error={results.error} onRetry={() => void results.refetch()} />}
      {results.isPending && (
        <ul className={cn(grid ? GRID : "divide-y overflow-hidden rounded-xl border bg-card")} aria-busy aria-label="Wird geladen">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className={cn("flex items-center gap-3 px-3 py-3", grid && "rounded-xl border bg-card")}>
              <Skeleton className="size-12 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </li>
          ))}
        </ul>
      )}
      {results.data && hits.length === 0 && (
        <EmptyState icon={<SearchX />} title={`Nichts gefunden für „${query}“`}>
          Versuch es mit einem anderen Suchwort.
        </EmptyState>
      )}

      {hits.length > 0 && (
        <ul className={cn(grid ? GRID : "divide-y overflow-hidden rounded-xl border bg-card")}>
          {hits.map((hit) => (
            <li key={hit.project_id} className={cn("flex min-w-0 items-center gap-3 px-3 py-3", grid && "rounded-xl border bg-card")}>
              <button
                type="button"
                onClick={() => onOpen(hit.project_id)}
                className="group flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ContentIcon url={hit.icon_url} seed={hit.project_id} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium underline-offset-4 group-hover:underline" title={hit.title}>{hit.title}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{hit.description}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                    <Download className="size-3" aria-hidden /> {formatDownloads(hit.downloads)}
                    <span className="sr-only">Downloads</span>
                  </span>
                </span>
              </button>
              {instance ? (
                <AddButton instance={instance} projectId={hit.project_id} title={hit.title} type={type} />
              ) : action ? (
                action(hit)
              ) : (
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              )}
            </li>
          ))}
        </ul>
      )}
      {results.hasNextPage && (
        <Button variant="outline" className="mt-3 w-full" disabled={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>
          {results.isFetchingNextPage ? "Lädt…" : "Mehr laden"}
        </Button>
      )}
    </div>
  );
}

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(24rem,1fr))] gap-3";

// ---------- Details ----------

const VERSION_TYPE: Record<ContentVersion["version_type"], string | null> = { release: null, beta: "Beta", alpha: "Testversion" };

export function ContentDetail({ projectId, type, instance, action, onBack }: {
  projectId: string; type: CatalogType; instance?: Instance; action?: (project: ContentProject) => ReactNode; onBack: () => void;
}) {
  const project = useQuery({
    queryKey: ["modrinth-project", projectId],
    queryFn: () => api.modrinthProject(projectId),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const mc = instance?.minecraftVersion ?? null;
  const loader = instance ? loaderFor(instance, type) : null;
  const versions = useQuery({
    queryKey: versionsKey(projectId, mc, loader),
    queryFn: () => api.modrinthVersions(projectId, mc, loader),
    enabled: !!instance,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const title = project.data?.title ?? "";
  const choose = !!instance && !instance.mods.some((m) => projectOf(m) === projectId);

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={onBack}>
        <ArrowLeft aria-hidden /> Zurück
      </Button>
      {project.isPending && (
        <div className="flex items-center gap-4">
          <Skeleton className="size-20 rounded-xl" />
          <div className="flex-1 space-y-2"><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-full" /></div>
        </div>
      )}
      {project.error && <ErrorNote error={project.error} />}
      {project.data && (
        <>
          <header className="flex flex-col items-start gap-4">
            <div className="flex w-full min-w-0 items-center gap-4">
              <ContentIcon url={project.data.icon_url} seed={projectId} size="lg" />
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
                <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{project.data.description}</p>
              </div>
            </div>
            {instance ? <AddButton instance={instance} projectId={projectId} title={title} type={type} large /> : action?.(project.data)}
          </header>

          {instance && choose && versions.data && versions.data.length > 0 && (
            <details className="group rounded-xl border bg-card">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium select-none">
                <ChevronRight className="mr-1 inline size-4 transition-transform group-open:rotate-90" aria-hidden />
                Andere Version wählen…
              </summary>
              <ul className="max-h-72 divide-y overflow-y-auto border-t">
                {versions.data.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{v.version_number}</span>
                    {VERSION_TYPE[v.version_type] && <span className="text-xs text-gold">{VERSION_TYPE[v.version_type]}</span>}
                    <AddButton instance={instance} projectId={projectId} title={title} type={type} versionId={v.id} />
                  </li>
                ))}
              </ul>
            </details>
          )}
          {instance && versions.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">Keine Version für {fitsLabel(instance, type)}.</p>
          )}

          <div className="max-w-[75ch] border-t pt-5">
            <Description body={project.data.body} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Seitenpanel in der Instanz ----------

export function AddContentSheet({ instance, open, onOpenChange }: { instance: Instance; open: boolean; onOpenChange: (open: boolean) => void }) {
  const kinds = kindsFor(instance);
  const [type, setType] = useState<ModKind>(kinds[0]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const hasIris = instance.mods.some((m) => projectOf(m) === IRIS_PROJECT_ID);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Inhalte für {instance.name}</SheetTitle>
          <SheetDescription className="flex items-center gap-1.5">
            <Check className="size-3.5 text-primary" aria-hidden /> Passend zu {fitsLabel(instance, type)}
          </SheetDescription>
          {kinds.length > 1 && !projectId && (
            <Tabs value={type} onValueChange={(t) => setType(t as ModKind)} className="mt-2">
              <TabsList>
                {kinds.map((k) => <TabsTrigger key={k} value={k}>{KIND_LABELS[k]}</TabsTrigger>)}
              </TabsList>
            </Tabs>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 [scrollbar-gutter:stable]">
          {projectId && (
            <div className="pt-3">
              <ContentDetail projectId={projectId} type={type} instance={instance} onBack={() => setProjectId(null)} />
            </div>
          )}
          {/* Bleibt beim Öffnen von Details erhalten, damit Suche und geladene Seiten nicht verloren gehen. */}
          <div className={cn("pt-4", projectId && "hidden")}>
            {type === "shader" && !hasIris && (
              <p className="mb-3 rounded-lg border border-gold/25 bg-gold/10 px-3 py-2 text-xs text-gold">
                Shader brauchen die Mod „Iris“. Füge sie unter „Mods“ hinzu.
              </p>
            )}
            <ContentResults key={type} type={type} instance={instance} onOpen={setProjectId} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
