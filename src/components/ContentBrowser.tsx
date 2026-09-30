import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  BackLink, Btn, BtnLink, Chip, Dialog, DialogClose, Empty, ErrorBox, Menu, MenuItem, MenuLabel, MenuSep, Progress, ProjectIcon, SearchField, Seg, Sheet, Switch,
  TextField, Tip,
} from "@/components/px";
import { useContentInstall, useContentState, withTarget } from "@/hooks/useContent";
import { useInstances } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import {
  formatDownloads, isPackVersionSupported, modLoadersFor, pickPackVersion, pickVersion, progressLabel, projectOf,
  type CatalogType, type ContentHit, type ContentProgress, type ContentProject, type ContentVersion, type SearchIndex,
} from "@/lib/modrinth";
import { LOADER_LABELS, type Instance, type ModKind, type ModLoader } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon } from "@/pixel/icons";
import { PixelScene } from "@/pixel/PixelScene";
import { lookOf, useLook, useLookStore } from "@/store/look";
import "@/styles/catalog.css";

export const IRIS_PROJECT_ID = "YL57xq9U";

export const KIND_LABELS: Record<ModKind, string> = { mod: "Mods", shader: "Shader", resourcepack: "Ressourcenpakete" };
const TYPE_LABELS: Record<CatalogType, string> = { modpack: "Modpacks", ...KIND_LABELS };
const TYPE_ONE: Record<CatalogType, string> = { modpack: "Modpack", mod: "Mod", shader: "Shader", resourcepack: "Ressourcenpaket" };

/** Was in eine Instanz passt: Mods und Shader nur mit Mod-Loader, Ressourcenpakete immer. */
export const kindsFor = (instance: Instance): ModKind[] =>
  instance.loader !== "vanilla" ? ["mod", "shader", "resourcepack"] : ["resourcepack"];

/** „Fabric 1.21.4“ für Mods, sonst nur die Minecraft-Version. */
export const fitsLabel = (instance: Instance, type: CatalogType) =>
  type === "mod" ? `${LOADER_LABELS[instance.loader]} ${instance.minecraftVersion}` : `Minecraft ${instance.minecraftVersion}`;

const versionsKey = (projectId: string, mc: string | null, loader: string | null) => ["modrinth-versions", projectId, mc, loader];
// Für Quilt fragt das Backend Quilt- und Fabric-Mods an.
const loaderFor = (instance: Instance, type: CatalogType) => (type === "mod" ? instance.loader : null);

const allVersionsQuery = (projectId: string) => ({
  queryKey: versionsKey(projectId, null, null),
  queryFn: () => api.modrinthVersions(projectId, null, null),
  staleTime: 10 * 60_000,
  retry: false,
});

// Modrinth-Kategorien in Alltagssprache; Loader-Namen sind keine Kategorie für die Anzeige.
const CATEGORY: Record<string, string> = {
  adventure: "Abenteuer", optimization: "Leistung", technology: "Technik", magic: "Magie", decoration: "Deko", utility: "Werkzeug",
  "game-mechanics": "Spielmechanik", library: "Programmbibliothek", worldgen: "Weltgenerierung", mobs: "Kreaturen", storage: "Lager",
  equipment: "Ausrüstung", food: "Essen", transportation: "Transport", social: "Mehrspieler", economy: "Wirtschaft", management: "Verwaltung",
  minigame: "Minispiel", "kitchen-sink": "Alles drin", lightweight: "Leicht", multiplayer: "Mehrspieler", quests: "Quests",
  challenging: "Fordernd", combat: "Kampf", realistic: "Realistisch", "semi-realistic": "Halbrealistisch", cartoon: "Comic",
  fantasy: "Fantasy", "vanilla-like": "Wie das Original", simplistic: "Schlicht", themed: "Thema", tweaks: "Anpassungen",
  audio: "Klang", blocks: "Blöcke", entities: "Wesen", gui: "Oberfläche", items: "Gegenstände", models: "Modelle", fonts: "Schriften",
  atmosphere: "Atmosphäre", bloom: "Leuchten", shadows: "Schatten", reflections: "Spiegelungen", foliage: "Pflanzen",
  "colored-lighting": "Farbiges Licht", "path-tracing": "Path Tracing", pbr: "PBR", "high-performance": "Leistung", "low-performance": "Schwache Rechner",
  "potato": "Sehr schwache Rechner", screenshot: "Bildschirmfotos", cursed: "Verflucht",
};
const LOADER_CATS = new Set(["fabric", "forge", "quilt", "neoforge", "iris", "optifine", "canvas", "vanilla", "minecraft", "datapack", "liteloader", "modloader", "rift", "bukkit", "paper", "spigot", "purpur", "folia", "velocity", "waterfall", "bungeecord", "sponge"]);
const categoryNames = (cats: string[], max = 2) =>
  cats.filter((c) => !LOADER_CATS.has(c) && !/^\d+x/.test(c)).slice(0, max).map((c) => CATEGORY[c] ?? c.charAt(0).toUpperCase() + c.slice(1).replace(/-/g, " "));

/** Anteil 0–1 für Fortschrittsbalken; null = unbestimmt. */
const progressShare = (p: ContentProgress | null) => (p?.phase === "download" && p.total ? Math.min(1, p.done / p.total) : null);

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
    p.className = "badges";
    for (const a of links) a.replaceChildren(a.firstElementChild!.getAttribute("alt")?.trim() || new URL((a as HTMLAnchorElement).href || "https://link").hostname);
  }
}

/** Projektbeschreibung im Pixelkino-Stil (`.desc`). Links öffnen im Standardbrowser. */
export function Description({ body, className }: { body: string; className?: string }) {
  const html = useMemo(() => {
    const doc = DOMPurify.sanitize(marked.parse(body, { async: false }), { ...PURIFY, RETURN_DOM_FRAGMENT: true });
    badgeRowsAsLinks(doc);
    const box = document.createElement("div");
    box.append(doc);
    return box.innerHTML;
  }, [body]);
  function onLink(e: MouseEvent) {
    const link = (e.target as Element).closest("a");
    if (!link) return;
    e.preventDefault();
    if (/^https?:/.test(link.href)) void api.openExternal(link.href);
  }
  return <div onClick={onLink} onAuxClick={onLink} className={cn("desc md", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

// ---------- Kleine Zustände in Zeilen ----------

/** Laufender Vorgang in einer Zeile: Beschriftung und Segmentbalken. */
function JobCell({ label, p, onCancel, wide }: { label: string; p: number | null; onCancel?: () => void; wide?: boolean }) {
  return (
    <>
      <div className="jobp" style={wide ? { width: 230 } : undefined} role="status">
        <span className="ell">
          {label}
          {p != null && <> <span className="num" style={{ fontSize: 16 }}>{Math.floor(p * 100)} %</span></>}
        </span>
        <Progress thin={!wide} p={p} label={label} />
      </div>
      {onCancel && (
        <Tip label="Abbrechen">
          <Btn variant="g" size="s" iconOnly aria-label="Abbrechen" onClick={onCancel}><Icon name="x5" small /></Btn>
        </Tip>
      )}
    </>
  );
}

const shortLabel = (p: ContentProgress | null) => (!p || p.phase === "resolve" || p.phase === "validate" ? "Wird geprüft" : p.phase === "download" ? "Lädt" : p.phase === "extract" ? "Wird entpackt" : "Fertig");

function InstalledChip({ title }: { title?: string }) {
  const chip = (
    <Chip small>
      <Icon name="check5" small />
      Installiert
    </Chip>
  );
  return title ? <Tip label={title}>{chip}</Tip> : chip;
}

/** Instanzen je Projekt-ID: als Inhalt drin oder als Modpack angelegt. */
function useInstalledIn() {
  const instances = useInstances();
  return useMemo(() => {
    const map = new Map<string, Instance[]>();
    const add = (id: string, i: Instance) => map.set(id, [...(map.get(id) ?? []), i]);
    for (const i of instances.data ?? []) {
      const ids = new Set(i.mods.map(projectOf).filter((id): id is string => !!id));
      if (i.modpack?.type === "modrinth") ids.add(i.modpack.projectId);
      ids.forEach((id) => add(id, i));
    }
    return map;
  }, [instances.data]);
}

/** „In Survival 1.21“ oder „In 2 Instanzen“; die Namen stehen im Tooltip und für Vorleser im Chip selbst. */
function InChip({ instances }: { instances?: Instance[] }) {
  if (!instances?.length) return null;
  const one = instances.length === 1;
  const names = instances.map((i) => i.name).join(", ");
  return (
    <Tip label={`Schon in ${names}`}>
      <Chip small className="inchip">
        <Icon name="check5" small />
        <span className="ell">{one ? `In ${instances[0].name}` : `In ${instances.length} Instanzen`}</span>
        {!one && <span className="sr">: {names}</span>}
      </Chip>
    </Tip>
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
    install.mutate(withTarget(projectId, (op) => api.modrinthInstallMod(instance.id, id, op), `${title} installieren`), {
      onSuccess: (result) => {
        if (!result) return;
        const extra = result.mods.length - before - 1;
        const deps = extra > 0 ? `, dazu ${extra} ${extra === 1 ? "benötigte Mod" : "benötigte Mods"}` : "";
        if (!opts.openAction) return void toast.success(`${title} hinzugefügt${deps}`);
        toast.success(`${title} ist jetzt in ${result.name}${deps}`, {
          action: { label: "Ansehen", onClick: () => navigate(`/instances/${result.id}?tab=content`) },
        });
      },
    });
    return "ok";
  };
}

/** Hinzufügen im Kontext einer Instanz: Knopf, „Installiert“, Fortschritt oder „Keine Version“. */
function AddButton({ instance, projectId, title, type, versionId, large, compact }: {
  instance: Instance; projectId: string; title: string; type: CatalogType; versionId?: string; large?: boolean; compact?: boolean;
}) {
  const addContent = useAddContent();
  const { active, target, progress } = useContentState();
  const [state, setState] = useState<"idle" | "checking" | "missing">("idle");
  const installed = instance.mods.some((m) => projectOf(m) === projectId);

  async function add() {
    setState("checking");
    const r = await addContent(instance, projectId, title, type, { versionId });
    setState(r === "missing" ? "missing" : "idle");
    if (r === "missing" && compact) toast.error(`${title} gibt es nicht für ${fitsLabel(instance, type)}`);
  }

  if (installed) return <InstalledChip />;
  if (state === "checking") return <JobCell label="Wird geprüft" p={null} wide={large} />;
  if (active && target === projectId) return <JobCell label={shortLabel(progress)} p={progressShare(progress)} wide={large} />;
  if (state === "missing" && !compact) return <span className="faint" style={{ fontSize: 12.5 }}>Keine Version für {instance.minecraftVersion}</span>;
  return large ? (
    <Btn variant="p" size="l" icon="plus" disabled={!!active} onClick={add}>Hinzufügen</Btn>
  ) : versionId ? (
    <Tip label="Diese Version hinzufügen">
      <Btn variant="g" size="s" iconOnly icon="dl" disabled={!!active} aria-label={`${title} in dieser Version hinzufügen`} onClick={add} />
    </Tip>
  ) : (
    <Btn size="s" icon="plus" disabled={!!active} aria-label={`${title} hinzufügen`} onClick={add}>Hinzufügen</Btn>
  );
}

/** Laufende Modpack-Installation abbrechen; das Ergebnis meldet der zentrale Fehler-Toast neutral. */
function cancelActive() {
  const op = useContentState.getState().active;
  if (op) void api.packInstallCancel(op).catch((e: Error) => toast.error(e.message));
}

/** Ohne Instanz-Kontext: Menü mit allen Instanzen; unpassende ausgegraut mit Grund, sonst „Neue Instanz anlegen…“. */
export function AddToInstanceMenu({ projectId, title, type, large }: { projectId: string; title: string; type: ModKind; large?: boolean }) {
  const instances = useInstances();
  const looks = useLookStore((s) => s.looks);
  const addContent = useAddContent();
  const navigate = useNavigate();
  const { active, target, progress } = useContentState();
  const [open, setOpen] = useState(false);
  // Alle Versionen einmal laden, um Instanzen ohne passende Minecraft-Version vorab auszugrauen.
  const all = useQuery({ ...allVersionsQuery(projectId), enabled: open });
  const reasonFor = (i: Instance): string | null => {
    if (!kindsFor(i).includes(type)) return "Geht nur in Instanzen mit Mod-Loader";
    if (i.mods.some((m) => projectOf(m) === projectId)) return "Schon drin";
    const fits = all.data?.some((v) => v.game_versions.includes(i.minecraftVersion) && (type !== "mod" || v.loaders.some((l) => modLoadersFor(i.loader).includes(l))));
    return all.data && !fits ? `Keine Version für ${i.minecraftVersion}` : null;
  };
  const rows = (instances.data ?? []).map((i) => ({ i, reason: reasonFor(i) }));
  const usable = rows.some((r) => !r.reason);

  if (active && target === projectId) return <JobCell label={shortLabel(progress)} p={progressShare(progress)} wide={large} />;
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      className="addto"
      trigger={
        <Btn variant={large ? "p" : "s"} size={large ? "l" : "s"} icon="plus" disabled={!!active} aria-label={large ? undefined : `${title} zu Instanz hinzufügen`}>
          {large ? "Zu Instanz hinzufügen" : "Hinzufügen"}
          <Icon name="chevd" small />
        </Btn>
      }
    >
      <MenuLabel className="mlabel">Hinzufügen zu …</MenuLabel>
      <div className="scrollbox">
        {rows.map(({ i, reason }) => {
          const look = lookOf(looks, i.id);
          return (
            <MenuItem
              key={i.id}
              className="mitem tall"
              disabled={!!reason}
              onSelect={() =>
                void addContent(i, projectId, title, type, { openAction: true }).then(
                  (r) => r === "missing" && toast.error(`${title} gibt es nicht für Minecraft ${i.minecraftVersion}`),
                )
              }
            >
              <span className="thumb"><PixelScene bio={look.bio} seed={look.seed} /></span>
              <span className="sub2 ell">
                <b className="ell">{i.name}</b>
                <span className="ell">{reason ?? fitsLabel(i, type)}</span>
              </span>
            </MenuItem>
          );
        })}
        {rows.length === 0 && !instances.isPending && <p className="faint" style={{ padding: "6px 10px", fontSize: 12.5 }}>Noch keine Instanz.</p>}
      </div>
      {all.isPending && rows.length > 0 && <p className="faint" style={{ padding: "4px 10px 6px", fontSize: 12 }}>Prüft passende Versionen …</p>}
      {!usable && !all.isPending && (
        <>
          <MenuSep className="msep" />
          <MenuItem className="mitem" onSelect={() => navigate("/instances?neu=1")}>
            <Icon name="plus" />
            <span className="ell">{type === "resourcepack" ? "Neue Instanz anlegen …" : "Neue Fabric-Instanz anlegen …"}</span>
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

/** Modpack als neue Instanz; ohne `versionId` die neueste stabile Version mit unterstütztem Loader. */
export function useInstallPack(projectId: string, title: string, onDone?: (instanceId: string) => void) {
  const qc = useQueryClient();
  const install = useContentInstall();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const { active, target, progress } = useContentState();

  async function run(versionId?: string, name = title) {
    let id = versionId;
    if (!id) {
      setChecking(true);
      try {
        const picked = pickPackVersion(await qc.fetchQuery(allVersionsQuery(projectId)));
        if (picked.reason) toast.error(`${title} lässt sich nicht installieren`, { description: picked.reason });
        id = picked.version?.id;
      } catch (err) {
        toast.error(`${title} konnte nicht geladen werden`, { description: err instanceof Error ? err.message : String(err) });
      } finally {
        setChecking(false);
      }
      if (!id) return;
    }
    install.mutate(withTarget(projectId, (op) => api.modrinthInstallPack(id, name, op), `Modpack „${name}“ installieren`), {
      onSuccess: (inst) => {
        if (!inst) return;
        toast.success(`${inst.name} ist bereit. „Spielen“ lädt beim ersten Start den Rest.`, {
          action: onDone ? undefined : { label: "Öffnen", onClick: () => navigate(`/instances/${inst.id}`) },
        });
        if (onDone) onDone(inst.id);
        else navigate(`/instances/${inst.id}`);
      },
    });
  }
  const busy = checking ? "Wird geprüft" : active && target === projectId ? progressLabel(progress).replace(/…$/, "") : null;
  return { run, busy, p: checking ? null : progressShare(progress), blocked: !!active || checking, cancel: !checking && busy ? cancelActive : undefined };
}

const loaderNames = (v: ContentVersion) =>
  v.loaders.filter((l) => l !== "minecraft").map((l) => LOADER_LABELS[l as ModLoader] ?? l).join(", ") || "Vanilla";

/** Inhalt der Bestätigung; wird beim Schließen verworfen, der Name beginnt also immer beim Pack-Titel. */
function PackConfirmBody({ title, versions, picked, onConfirm }: {
  title: string; versions: UseQueryResult<ContentVersion[]>; picked: { version: ContentVersion | null; reason: string | null } | null;
  onConfirm: (versionId: string, name: string) => void;
}) {
  const [name, setName] = useState(title);
  const v = picked?.version ?? null;
  const val = (text: ReactNode) => (v ? text : versions.isPending ? <i className="sk" style={{ display: "inline-block", width: 90, height: 12 }} /> : "–");
  const submit = () => v && onConfirm(v.id, name.trim() || title);
  return (
    <form
      id="pack-confirm"
      className="pcf"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="nf">
        <label htmlFor="pc-name">Name der Instanz</label>
        <TextField id="pc-name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
      </div>
      <dl className="kv">
        <dt>Modpack-Version</dt>
        <dd className="ell">{val(v?.version_number)}</dd>
        <dt>Minecraft</dt>
        <dd>{val(v?.game_versions.at(-1))}</dd>
        <dt>Loader</dt>
        <dd>{val(v && loaderNames(v))}</dd>
      </dl>
      {versions.error ? (
        <ErrorBox className="mt-3" title="Versionen konnten nicht geladen werden" error={versions.error} onRetry={() => void versions.refetch()} />
      ) : picked && !v ? (
        <p className="err-msg" role="alert">{picked.reason}</p>
      ) : (
        <p className="help">Voxlet lädt jetzt die Mods des Packs. Minecraft selbst kommt beim ersten Start dazu.</p>
      )}
    </form>
  );
}

/**
 * Bestätigung vor „Als neue Instanz anlegen“: zeigt Version, Minecraft und Loader, die Voxlet wählt,
 * und lässt den Namen ändern. `ask()` öffnet sie (optional für eine bestimmte Version), `dialog` gehört ins Markup.
 */
function usePackConfirm(projectId: string, title: string, onDone?: (instanceId: string) => void) {
  const pack = useInstallPack(projectId, title, onDone);
  const [ask, setAsk] = useState<{ versionId?: string } | null>(null);
  const versions = useQuery({ ...allVersionsQuery(projectId), enabled: !!ask });
  const picked = versions.data
    ? ask?.versionId
      ? { version: versions.data.find((v) => v.id === ask.versionId) ?? null, reason: "Diese Version gibt es nicht mehr" }
      : pickPackVersion(versions.data)
    : null;
  const dialog = (
    <Dialog
      open={!!ask}
      onOpenChange={(o) => !o && setAsk(null)}
      title="Neue Instanz aus Modpack"
      sub={title}
      width={480}
      height={380}
      footer={
        <>
          <DialogClose asChild><Btn>Abbrechen</Btn></DialogClose>
          <Btn variant="p" full type="submit" form="pack-confirm" style={{ width: 170 }} disabled={!picked?.version || pack.blocked}>Instanz anlegen</Btn>
        </>
      }
    >
      <PackConfirmBody
        title={title}
        versions={versions}
        picked={picked}
        onConfirm={(id, name) => {
          setAsk(null);
          void pack.run(id, name);
        }}
      />
    </Dialog>
  );
  return { pack, ask: (versionId?: string) => setAsk({ versionId }), dialog };
}

/** Zeilenaktion für Modpacks: erst bestätigen, dann anlegen. */
export function PackInstallButton({ projectId, title, onDone }: { projectId: string; title: string; onDone?: (instanceId: string) => void }) {
  const { pack, ask, dialog } = usePackConfirm(projectId, title, onDone);
  return (
    <>
      {pack.busy ? (
        <JobCell label={pack.busy} p={pack.p} onCancel={pack.cancel} />
      ) : (
        <Btn size="s" icon="plus" disabled={pack.blocked} aria-label={`${title} als Instanz anlegen`} onClick={() => ask()}>
          Anlegen
        </Btn>
      )}
      {dialog}
    </>
  );
}

// Ein Begriff für alles Unfertige, wie im Dialog „Neue Instanz“.
const VERSION_TYPE: Record<ContentVersion["version_type"], string | null> = { release: null, beta: "Vorabversion", alpha: "Vorabversion" };

/** Aktionen in den Pack-Details: „Als neue Instanz anlegen“ plus „Andere Version…“, beide mit Bestätigung. */
export function PackActions({ projectId, title, onDone }: { projectId: string; title: string; onDone?: (instanceId: string) => void }) {
  const { pack, ask, dialog } = usePackConfirm(projectId, title, onDone);
  const versions = useQuery(allVersionsQuery(projectId));
  const { version, reason } = versions.data ? pickPackVersion(versions.data) : { version: null, reason: null };
  const fitting = versions.data?.filter(isPackVersionSupported) ?? [];

  if (pack.busy) return <JobCell label={pack.busy} p={pack.p} onCancel={pack.cancel} wide />;
  return (
    <>
      <Btn variant="p" size="l" icon="plus" disabled={!version || pack.blocked} onClick={() => ask(version?.id)}>
        {reason ?? "Als neue Instanz anlegen"}
      </Btn>
      {fitting.length > 1 && (
        <Menu
          trigger={<Btn iconOnly icon="more" disabled={pack.blocked} aria-label="Andere Version wählen" />}
          items={[
            { label: "Andere Version" },
            ...fitting.slice(0, 30).map((v) => ({
              id: v.id,
              text: v.version_number,
              sub: `${loaderNames(v)} ${v.game_versions.at(-1) ?? ""}${VERSION_TYPE[v.version_type] ? ` · ${VERSION_TYPE[v.version_type]}` : ""}`,
              icon: "plus" as const,
              onSelect: () => ask(v.id),
            })),
          ]}
        />
      )}
      {dialog}
    </>
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
  mod: "In Mods suchen", shader: "In Shadern suchen", resourcepack: "In Ressourcenpaketen suchen", modpack: "In Modpacks suchen",
};

/** Keine Verbindung: Katalog braucht Internet. */
function Offline({ onRetry, compact }: { onRetry: () => void; compact?: boolean }) {
  return (
    <div className="offl" style={compact ? { padding: "40px 8px" } : undefined}>
      <Icon name="plug" />
      <h2>Keine Verbindung</h2>
      <p>Der Katalog braucht Internet. Deine installierten Instanzen kannst du trotzdem spielen.</p>
      <div className="row">
        <Btn icon="redo" onClick={onRetry}>Erneut versuchen</Btn>
        {!compact && <BtnLink variant="g" to="/instances">Zur Bibliothek</BtnLink>}
      </div>
    </div>
  );
}

/** Überschrift ohne Suchbegriff je Sortierung. */
export const SORT_HEADINGS: Record<SearchIndex, string> = {
  relevance: "Nach Relevanz", downloads: "Beliebt", follows: "Meistgefolgt", newest: "Neu", updated: "Zuletzt aktualisiert",
};

/**
 * Suche mit „Beliebt“ als Startzustand. Mit `instance` passend gefiltert und mit „Hinzufügen“ je Zeile,
 * sonst mit `action` je Zeile. Ohne `query` bringt sie ihr eigenes Suchfeld mit; mit `query` sucht sie,
 * was außen steht (Entdecken, Seitenpanel). `compact` = schmale Zeilen im Seitenpanel.
 * `sort` fehlt = Downloads ohne Suchbegriff, sonst Relevanz. `feature` hebt ohne Suchbegriff den meistgeladenen bzw. meistgefolgten Treffer als Karte hervor.
 */
export function ContentResults({ type, instance, action, onOpen, autoFocus = true, query: outerQuery, mc: outerMc, loader: outerLoader, fit = true, compact, onReset, sort, feature }: {
  type: CatalogType; instance?: Instance; action?: (hit: ContentHit) => ReactNode; onOpen: (projectId: string, hit?: ContentHit) => void;
  /** Früher: Hintergrund der klebenden Suchleiste; ohne Wirkung. */
  barClassName?: string;
  /** Früher: Kacheln im Raster; Pixelkino zeigt immer Zeilen. */
  grid?: boolean;
  autoFocus?: boolean; query?: string; mc?: string | null; loader?: string | null;
  /** Mit `instance`: nur Passendes zeigen (Version und Loader der Instanz). */
  fit?: boolean; compact?: boolean; onReset?: () => void; sort?: SearchIndex | null; feature?: boolean;
}) {
  const [input, setInput] = useState("");
  const controlled = outerQuery != null;
  const query = useDebounced((controlled ? outerQuery : input).trim(), 300);
  const mc = instance ? (fit ? instance.minecraftVersion : null) : (outerMc ?? null);
  const loader = instance ? (fit ? loaderFor(instance, type) : null) : (outerLoader ?? null);
  const index: SearchIndex = sort ?? (query ? "relevance" : "downloads");
  const results = useInfiniteQuery({
    queryKey: ["modrinth-search", type, query, mc, loader, index],
    queryFn: ({ pageParam }) => api.modrinthSearch(query, type, mc, loader, pageParam, index),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.hits.length < last.total_hits ? last.offset + last.limit : undefined),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const hits = results.data?.pages.flatMap((p) => p.hits) ?? [];
  const total = results.data?.pages[0]?.total_hits ?? 0;
  const { active, target, progress } = useContentState();
  const hasFilter = !!(query || outerMc || outerLoader);
  const installedIn = useInstalledIn();
  // Nur eine echte Spitze hervorheben (Downloads, Follower), nicht den zufällig neuesten Upload.
  const featured = !!feature && !compact && !query && (index === "downloads" || index === "follows");

  return (
    <div>
      {!controlled && (
        <div className="disc-tools" style={{ marginTop: 0 }}>
          <SearchField value={input} onChange={setInput} placeholder={SEARCH_PLACEHOLDER[type]} autoFocus={autoFocus} />
        </div>
      )}
      {/* Ohne Suchbegriff eine Abschnittsüberschrift (wie auf Start), mit Suchbegriff die Trefferzahl; gleiche Höhe */}
      {!results.error && (
        <div className="ctxline" aria-live="polite">
          {!query ? (
            compact ? <h3 className="ctxh">{SORT_HEADINGS[index]}</h3> : <h2 className="ctxh">{SORT_HEADINGS[index]}</h2>
          ) : results.data ? <p><span className="num">{total.toLocaleString("de")}</span> Treffer</p> : <p>Sucht …</p>}
        </div>
      )}

      {results.error ? (
        navigator.onLine === false ? (
          <Offline compact={compact} onRetry={() => void results.refetch()} />
        ) : (
          <ErrorBox title="Modrinth ist gerade nicht erreichbar" error={results.error} onRetry={() => void results.refetch()} />
        )
      ) : results.isPending ? (
        <div className="rlist" aria-busy aria-label="Wird geladen">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={cn("skrow", featured && i === 0 && "feat")} style={compact ? { gridTemplateColumns: "48px minmax(0,1fr) 128px", height: 76 } : undefined}>
              <i className="sk a" style={compact ? { width: 40, height: 40 } : undefined} />
              <div className="b">
                <i className="sk" style={{ width: "38%" }} />
                <i className="sk" style={{ width: "72%" }} />
                <i className="sk" style={{ width: "24%" }} />
              </div>
              <i className="sk" style={{ height: 32, width: compact ? 100 : 120, justifySelf: "end" }} />
            </div>
          ))}
        </div>
      ) : hits.length === 0 ? (
        <Empty
          ill={<Icon name="search" />}
          title="Nichts gefunden"
          minHeight={compact ? 200 : undefined}
          actions={hasFilter && onReset ? <Btn onClick={onReset}>Filter zurücksetzen</Btn> : undefined}
        >
          {instance && fit ? `Für ${fitsLabel(instance, type)} gibt es hier nichts Passendes. Schalte den Filter aus, um alles zu sehen.` : `Keine ${TYPE_LABELS[type]} passen zu deiner Suche und den Filtern.`}
        </Empty>
      ) : (
        <>
          <div className="rlist">
            {hits.map((hit, k) => {
              const busy = !instance && !!active && target === hit.project_id && type !== "modpack";
              const cats = categoryNames(hit.categories, compact ? 0 : 2);
              const feat = featured && k === 0;
              return (
                <div
                  key={hit.project_id}
                  className={cn("rrow rise", compact && "compact", feat && "feat")}
                  style={{ "--i": k % 20 } as CSSProperties}
                  onClick={(e) => !(e.target as Element).closest(".ra") && onOpen(hit.project_id, hit)}
                >
                  <button type="button" className="hit fx" aria-label={`${hit.title} ansehen`} onClick={(e) => (e.stopPropagation(), onOpen(hit.project_id, hit))} />
                  <ProjectIcon url={hit.icon_url} seed={hit.project_id} big={!compact} />
                  <div className="rt">
                    <div className="t1">
                      <b title={hit.title}>{hit.title}</b>
                      {!compact && <span>von {hit.author}</span>}
                    </div>
                    <p title={hit.description}>{hit.description}</p>
                    <div className="t3">
                      <span><span className="num">{formatDownloads(hit.downloads)}</span> Downloads</span>
                      {cats.map((c) => <Chip key={c} small className="hide-m">{c}</Chip>)}
                      {!instance && <InChip instances={installedIn.get(hit.project_id)} />}
                    </div>
                  </div>
                  <div className="ra">
                    {busy ? (
                      <JobCell label={shortLabel(progress)} p={progressShare(progress)} />
                    ) : instance ? (
                      <AddButton instance={instance} projectId={hit.project_id} title={hit.title} type={type} compact={compact} />
                    ) : action ? (
                      action(hit)
                    ) : (
                      <Icon name="chevr" small />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="morebar">
            {results.hasNextPage ? (
              <Btn disabled={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>
                {results.isFetchingNextPage ? "Lädt …" : "Mehr laden"}
              </Btn>
            ) : (
              <span className="faint" style={{ alignSelf: "center" }}>Alle {hits.length} Ergebnisse geladen</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Details ----------

/** Wo das Projekt installiert sein muss: Client = dein Spiel, Server = der Server, auf dem du spielst. */
const sideText = ({ client_side: c, server_side: s }: ContentProject) => {
  if (c === "unsupported") return "Nur Server";
  if (s === "unsupported") return "Nur Client";
  if (c === "required" && s === "required") return "Client und Server";
  if (c === "required") return "Client, Server optional";
  if (s === "required") return "Server, Client optional";
  return "Client oder Server";
};

const cmpMc = (a: string, b: string) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** Minecraft-Versionen einer Liste: bis drei einzeln, sonst Spanne und Anzahl („1.21.4 – 1.20.1“, „33 Versionen“). */
function McSummary({ versions }: { versions: ContentVersion[] }) {
  const all = [...new Set(versions.flatMap((v) => v.game_versions).filter((g) => /^\d+\.\d+(\.\d+)?$/.test(g)))].sort(cmpMc).reverse();
  if (!all.length) return <>Unbekannt</>;
  if (all.length <= 3) return <>{all.join(", ")}</>;
  // Zwei feste Zeilen statt freiem Umbruch in der rechtsbündigen Spalte
  return (
    <>
      <span className="block">{all[0]} – {all.at(-1)}</span>
      <span className="block faint">{all.length} Versionen</span>
    </>
  );
}

/**
 * Projektseite: Kopf mit Bild und Aktion, links Beschreibung, rechts „Passt zu“ und Versionen.
 * Mit `instance` (Seitenpanel) wird für diese Instanz hinzugefügt; `hit` liefert Autor, Downloads und Kategorien aus der Suche.
 */
export function ContentDetail({ projectId, type, instance, action, onBack, backLabel = "Zurück", hit }: {
  projectId: string; type: CatalogType; instance?: Instance; action?: (project: ContentProject) => ReactNode; onBack: () => void;
  backLabel?: string; hit?: ContentHit | null;
}) {
  const project = useQuery({
    queryKey: ["modrinth-project", projectId],
    queryFn: () => api.modrinthProject(projectId),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const mc = instance?.minecraftVersion ?? null;
  const loader = instance ? loaderFor(instance, type) : null;
  const fitting = useQuery({
    queryKey: versionsKey(projectId, mc, loader),
    queryFn: () => api.modrinthVersions(projectId, mc, loader),
    enabled: !!instance,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const all = useQuery(allVersionsQuery(projectId));
  const instances = useInstances();
  const title = project.data?.title ?? hit?.title ?? "";
  const { pack, ask: askPack, dialog: packDialog } = usePackConfirm(projectId, title);
  const installedIn = useInstalledIn();
  const shown = (instance ? fitting.data : type === "modpack" ? all.data?.filter(isPackVersionSupported) : all.data)?.slice(0, 5);
  const fitCount =
    type !== "modpack" && all.data && instances.data
      ? instances.data.filter((i) => kindsFor(i).includes(type as ModKind) && all.data!.some((v) => v.game_versions.includes(i.minecraftVersion) && (type !== "mod" || v.loaders.some((l) => modLoadersFor(i.loader).includes(l))))).length
      : null;
  const loaders = all.data ? [...new Set(all.data.flatMap((v) => v.loaders))].filter((l) => l !== "minecraft") : [];

  return (
    <section className="proj">
      <BackLink onClick={onBack}>{backLabel}</BackLink>
      {project.isPending && (
        <div className="proj-h" aria-busy aria-label="Wird geladen">
          <i className="sk" style={{ width: 64, height: 64 }} />
          <div className="flex flex-col gap-2.5">
            <i className="sk" style={{ height: 36, width: "50%" }} />
            <i className="sk" style={{ height: 14, width: "30%" }} />
          </div>
        </div>
      )}
      {project.error && <ErrorBox className="mt-3" title="Das Projekt konnte nicht geladen werden" error={project.error} onRetry={() => void project.refetch()} />}
      {project.data && (
        <>
          <div className="proj-h">
            <ProjectIcon url={project.data.icon_url} seed={projectId} big />
            <div style={{ minWidth: 0 }}>
              <h1 title={title}>{title}</h1>
              <div className="by">
                {hit && <span>von {hit.author}</span>}
                {hit && <span><span className="num">{formatDownloads(hit.downloads)}</span> Downloads</span>}
                <Chip small>{TYPE_ONE[type]}</Chip>
                {hit && categoryNames(hit.categories, 2).map((c) => <Chip key={c} small>{c}</Chip>)}
                {!instance && <InChip instances={installedIn.get(projectId)} />}
              </div>
            </div>
            <div className="projact">
              {instance ? <AddButton instance={instance} projectId={projectId} title={title} type={type} large /> : action?.(project.data)}
            </div>
          </div>
          <div className="proj-b">
            <div>
              {project.data.description && <p className="lead">{project.data.description}</p>}
              <Description body={project.data.body} />
            </div>
            <aside className="side">
              <div className="sbox">
                <h3>Passt zu</h3>
                <dl className="kv">
                  <dt>Minecraft</dt>
                  <dd>{all.data ? <McSummary versions={all.data} /> : "…"}</dd>
                  {type !== "resourcepack" && (
                    <>
                      <dt>Loader</dt>
                      <dd>{type === "shader" ? "Iris (Fabric, Quilt, NeoForge)" : loaders.length ? loaders.map((l) => LOADER_LABELS[l as ModLoader] ?? l).join(", ") : "…"}</dd>
                    </>
                  )}
                  <dt>Benötigt auf</dt>
                  <dd>{sideText(project.data)}</dd>
                  {instance ? (
                    <>
                      <dt>Diese Instanz</dt>
                      <dd>{fitting.data ? (fitting.data.length ? "Passt" : "Keine Version") : "…"}</dd>
                    </>
                  ) : fitCount != null && instances.data ? (
                    <>
                      <dt>Deine Instanzen</dt>
                      <dd>{fitCount} von {instances.data.length}</dd>
                    </>
                  ) : null}
                </dl>
              </div>
              <div className="sbox">
                <h3>{instance ? `Versionen für ${fitsLabel(instance, type)}` : "Versionen"}</h3>
                {!shown && <i className="sk block" style={{ height: 44 }} />}
                {shown?.length === 0 && <p className="faint" style={{ fontSize: 13 }}>{instance ? `Keine Version für ${fitsLabel(instance, type)}.` : "Keine Version verfügbar."}</p>}
                {shown?.map((v) => (
                  <div key={v.id} className="vrow">
                    <div style={{ minWidth: 0 }}>
                      <b className="ell block">{v.version_number}</b>
                      <span className="ell">
                        {v.loaders.filter((l) => l !== "minecraft").map((l) => LOADER_LABELS[l as ModLoader] ?? l).join(", ") || "Alle Loader"} · {v.game_versions.at(-1)}
                        {VERSION_TYPE[v.version_type] && ` · ${VERSION_TYPE[v.version_type]}`}
                      </span>
                    </div>
                    {instance ? (
                      <AddButton instance={instance} projectId={projectId} title={title} type={type} versionId={v.id} />
                    ) : type === "modpack" ? (
                      <Tip label="Diese Version als Instanz anlegen">
                        <Btn variant="g" size="s" iconOnly icon="plus" disabled={pack.blocked} aria-label={`${v.version_number} als Instanz anlegen`} onClick={() => askPack(v.id)} />
                      </Tip>
                    ) : null}
                  </div>
                ))}
              </div>
            </aside>
          </div>
          {packDialog}
        </>
      )}
    </section>
  );
}

// ---------- Seitenpanel in der Instanz ----------

export function AddContentSheet({ instance, open, onOpenChange, initialKind }: { instance: Instance; open: boolean; onOpenChange: (open: boolean) => void; initialKind?: ModKind }) {
  const kinds = kindsFor(instance);
  const [type, setType] = useState<ModKind>(initialKind && kinds.includes(initialKind) ? initialKind : kinds[0]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [hit, setHit] = useState<ContentHit | null>(null);
  const [query, setQuery] = useState("");
  const [fit, setFit] = useState(true);
  const { acc } = useLook(instance.id);
  const hasIris = instance.mods.some((m) => projectOf(m) === IRIS_PROJECT_ID);
  const kind = kinds.includes(type) ? type : kinds[0];

  // Beim Öffnen mit gewünschter Art (z. B. „Iris hinzufügen“) direkt dorthin.
  useEffect(() => {
    if (open && initialKind && kinds.includes(initialKind)) {
      setType(initialKind);
      setProjectId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKind]);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      acc={acc}
      title={`Inhalte für ${instance.name}`}
      sub={`Voxlet wählt automatisch die Version für ${fitsLabel(instance, "mod")}.`}
      tools={
        projectId ? undefined : (
          <>
            {kinds.length > 1 && (
              <Seg small tabs label="Art" value={kind} onChange={(t) => setType(t)} options={kinds.map((k) => ({ value: k, label: KIND_LABELS[k] }))} />
            )}
            <SearchField small value={query} onChange={setQuery} placeholder="Im Katalog suchen" autoFocus />
            <div className="row" style={{ gap: 10, fontSize: 13, color: "var(--fg-2)" }}>
              <Switch id="sheet-fit" checked={fit} onChange={setFit} label="Nur passende Inhalte zeigen" />
              <label htmlFor="sheet-fit" className="cursor-pointer">Nur passend zu {fitsLabel(instance, kind)}</label>
            </div>
          </>
        )
      }
    >
      {projectId && (
        <ContentDetail projectId={projectId} type={kind} instance={instance} hit={hit} backLabel={KIND_LABELS[kind]} onBack={() => setProjectId(null)} />
      )}
      {/* Bleibt beim Öffnen von Details erhalten, damit Suche und geladene Seiten nicht verloren gehen. */}
      <div hidden={!!projectId}>
        {kind === "shader" && !hasIris && (
          <p className="hintline warn"><Icon name="warn" small />Shader brauchen die Mod „Iris“. Füge sie unter „Mods“ hinzu.</p>
        )}
        <ContentResults
          key={kind}
          type={kind}
          instance={instance}
          query={query}
          fit={fit}
          compact
          onReset={() => setQuery("")}
          onOpen={(id, h) => {
            setHit(h ?? null);
            setProjectId(id);
          }}
        />
      </div>
    </Sheet>
  );
}
