import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useInfiniteQuery, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  BackLink, Button, ButtonLink, Cell, Chip, Count, Dialog, DialogActions, Empty, ErrorBox, Field, Hint, Icon, IconButton, JobProgress, List, ListRow, Menu,
  MenuItem, MenuLabel, MenuNote, MenuScroll, MenuSep, Meta, Panel, ProjectIcon, RowTitle, SceneThumb, SearchField, SectionHeader, Select, Sheet, Skel, SkelRow,
  Switch, TabPanel, Tabs, TextField, Tip, Toolbar,
} from "@/ui";
import { useContentInstall, useContentState, withTarget } from "@/hooks/useContent";
import { useInstances } from "@/hooks/useInstances";
import { api } from "@/lib/api";
import {
  formatDownloads, installedKey, isPackVersionSupported, modLoadersFor, ownerKey, pickPackVersion, pickVersion, progressLabel, progressShare, projectKey, projectOf, SOURCES,
  type CatalogType, type ContentHit, type ContentProgress, type ContentProject, type ContentVersion, type SearchIndex, type Source,
} from "@/lib/modrinth";
import { openManualDownloads } from "@/components/ManualDownloads";
import { LOADER_LABELS, type Instance, type ModKind, type ModLoader } from "@/lib/types";
import { cn } from "@/lib/utils";
import { lookOf, useLook, useLookStore } from "@/store/look";

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

const allVersionsQuery = (projectId: string, source: Source = "modrinth") => ({
  queryKey: source === "modrinth" ? versionsKey(projectId, null, null) : ["catalog-versions", source, projectId],
  queryFn: () => (source === "modrinth" ? api.modrinthVersions(projectId, null, null) : api.providerVersions(source, projectId)),
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

/** Breite des laufenden Vorgangs: Projektkopf 230, Zeile 120, Seitenpanel 112. */
const jobWidth = (large?: boolean, compact?: boolean) => (large ? 230 : compact ? 112 : 120);

const shortLabel = (p: ContentProgress | null) => (!p || p.phase === "resolve" || p.phase === "validate" ? "Wird geprüft" : p.phase === "download" ? "Lädt" : p.phase === "extract" ? "Wird entpackt" : "Fertig");

/** Instanzen je Projekt-ID: als Inhalt drin oder als Modpack angelegt. */
function useInstalledIn() {
  const instances = useInstances();
  return useMemo(() => {
    const map = new Map<string, Instance[]>();
    const add = (id: string, i: Instance) => map.set(id, [...(map.get(id) ?? []), i]);
    for (const i of instances.data ?? []) {
      const ids = new Set(i.mods.map(projectOf).filter((id): id is string => !!id));
      if (i.modpack?.type === "modrinth") ids.add(i.modpack.projectId);
      if (i.modpack?.type === "provider") ids.add(`${i.modpack.source}:${i.modpack.projectId}`);
      ids.forEach((id) => add(id, i));
    }
    return map;
  }, [instances.data]);
}

// Chip-Text bleibt kurz (die Zeile schneidet sonst mitten im Wort ab); der volle Name steht im Tooltip.
const shortName = (name: string, max: number) => (name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name);

/**
 * „In Survival 1.21“ oder „In 2 Instanzen“; die Namen stehen im Tooltip (für Vorleser als Beschreibung, wenn sie im Chip fehlen).
 * In der Katalogzeile klein mit Punkt (Metazeile 22 px), im Projektkopf mit Haken.
 */
function InChip({ instances, small }: { instances?: Instance[]; small?: boolean }) {
  if (!instances?.length) return null;
  const one = instances.length === 1;
  const text = shortName(one ? `In ${instances[0].name}` : `In ${instances.length} Instanzen`, small ? 28 : 36);
  return (
    <Tip label={`Schon in ${instances.map((i) => i.name).join(", ")}`} describe={!one || text.endsWith("…")}>
      {small ? <Chip size="s" dot>{text}</Chip> : <Chip icon="check">{text}</Chip>}
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
  return async (instance: Instance, projectId: string, title: string, type: CatalogType, opts: { versionId?: string; openAction?: boolean; source?: Source } = {}) => {
    const source = opts.source ?? "modrinth";
    let id = opts.versionId;
    let picked: ContentVersion | undefined;
    const mc = instance.minecraftVersion, loader = loaderFor(instance, type);
    try {
      if (!id) {
        const versions = await qc.fetchQuery({
          queryKey: source === "modrinth" ? versionsKey(projectId, mc, loader) : ["catalog-versions", source, projectId, mc, loader],
          queryFn: () => (source === "modrinth" ? api.modrinthVersions(projectId, mc, loader) : api.providerVersions(source, projectId, mc, loader)),
          staleTime: 10 * 60_000,
        });
        picked = pickVersion(versions) ?? undefined;
        id = picked?.id;
      } else if (source !== "modrinth") {
        picked = (await qc.fetchQuery(allVersionsQuery(projectId, source))).find((v) => v.id === id);
      }
    } catch (err) {
      toast.error(`${title} konnte nicht geladen werden`, { description: err instanceof Error ? err.message : String(err) });
      return "error";
    }
    if (!id) return "missing";
    // CurseForge: Die Autoren erlauben den Download nur über die Webseite. Nicht umgehen, sondern beim Laden von Hand helfen.
    if (source !== "modrinth" && picked && !picked.files[0]?.url) {
      const page = await qc.fetchQuery({ queryKey: ["catalog-project", source, projectId], queryFn: () => api.providerProject(source, projectId), staleTime: 10 * 60_000 })
        .then((p) => p.web_url).catch(() => null);
      openManualDownloads({
        instanceId: instance.id,
        instanceName: instance.name,
        items: [{ projectId: Number(projectId), fileId: Number(id), name: title, fileName: picked.files[0]?.filename ?? title, url: page ?? `https://www.curseforge.com/minecraft/search?search=${encodeURIComponent(title)}` }],
      });
      return "blocked";
    }
    const before = instance.mods.length;
    const perform = (op: string) => (source === "modrinth" ? api.modrinthInstallMod(instance.id, id, op) : api.providerInstallMod(source, instance.id, projectId, id, op));
    install.mutate(withTarget(projectId, perform, `${title} installieren`), {
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
function AddButton({ instance, projectId, title, type, versionId, large, compact, source = "modrinth" }: {
  instance: Instance; projectId: string; title: string; type: CatalogType; versionId?: string; large?: boolean; compact?: boolean; source?: Source;
}) {
  const addContent = useAddContent();
  const { active, target, progress } = useContentState();
  const [state, setState] = useState<"idle" | "checking" | "missing">("idle");
  const installed = instance.mods.some((m) => ownerKey(m) === projectKey(source, projectId));

  async function add() {
    setState("checking");
    const r = await addContent(instance, projectId, title, type, { versionId, source });
    setState(r === "missing" ? "missing" : "idle");
    if (r === "missing" && compact) toast.error(`${title} gibt es nicht für ${fitsLabel(instance, type)}`);
  }

  if (installed) return <Chip icon="check">Installiert</Chip>;
  if (state === "checking") return <JobProgress label="Wird geprüft" p={null} width={jobWidth(large, compact)} />;
  if (active && target === projectId) return <JobProgress label={shortLabel(progress)} p={progressShare(progress)} width={jobWidth(large, compact)} />;
  if (state === "missing" && !compact) return <Hint>Keine Version für {instance.minecraftVersion}</Hint>;
  return large ? (
    <Button variant="primary" size="l" icon="plus" disabled={!!active} onClick={add}>Hinzufügen</Button>
  ) : versionId ? (
    <IconButton size="s" icon="dl" label={`${title} in dieser Version hinzufügen`} tip="Diese Version hinzufügen" disabled={!!active} onClick={add} />
  ) : (
    <Button size="s" icon="plus" disabled={!!active} aria-label={`${title} hinzufügen`} onClick={add}>Hinzufügen</Button>
  );
}

/** Laufende Modpack-Installation abbrechen; das Ergebnis meldet der zentrale Fehler-Toast neutral. */
function cancelActive() {
  const op = useContentState.getState().active;
  if (op) void api.packInstallCancel(op).catch((e: Error) => toast.error(e.message));
}

/** Ohne Instanz-Kontext: Menü mit allen Instanzen; unpassende ausgegraut mit Grund, sonst „Neue Instanz anlegen…“. */
export function AddToInstanceMenu({ projectId, title, type, large, source = "modrinth" }: { projectId: string; title: string; type: ModKind; large?: boolean; source?: Source }) {
  const instances = useInstances();
  const looks = useLookStore((s) => s.looks);
  const addContent = useAddContent();
  const navigate = useNavigate();
  const { active, target, progress } = useContentState();
  const [open, setOpen] = useState(false);
  // Alle Versionen einmal laden, um Instanzen ohne passende Minecraft-Version vorab auszugrauen.
  const all = useQuery({ ...allVersionsQuery(projectId, source), enabled: open });
  const reasonFor = (i: Instance): string | null => {
    if (!kindsFor(i).includes(type)) return "Geht nur in Instanzen mit Mod-Loader";
    if (i.mods.some((m) => ownerKey(m) === projectKey(source, projectId))) return "Schon drin";
    const fits = all.data?.some((v) => v.game_versions.includes(i.minecraftVersion) && (type !== "mod" || v.loaders.some((l) => modLoadersFor(i.loader).includes(l))));
    return all.data && !fits ? `Keine Version für ${i.minecraftVersion}` : null;
  };
  const rows = (instances.data ?? []).map((i) => ({ i, reason: reasonFor(i) }));
  const usable = rows.some((r) => !r.reason);

  if (active && target === projectId) return <JobProgress label={shortLabel(progress)} p={progressShare(progress)} width={jobWidth(large)} />;
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      width={300}
      trigger={
        <Button
          variant={large ? "primary" : "secondary"}
          size={large ? "l" : "s"}
          icon="plus"
          iconEnd="chevd"
          disabled={!!active}
          aria-label={large ? undefined : `${title} zu Instanz hinzufügen`}
        >
          {large ? "Zu Instanz hinzufügen" : "Hinzufügen"}
        </Button>
      }
    >
      <MenuLabel>Hinzufügen zu …</MenuLabel>
      <MenuScroll>
        {rows.map(({ i, reason }) => {
          const look = lookOf(looks, i.id);
          return (
            <MenuItem
              key={i.id}
              disabled={!!reason}
              lead={<SceneThumb bio={look.bio} seed={look.seed} size={28} />}
              sub={reason ?? fitsLabel(i, type)}
              onSelect={() =>
                void addContent(i, projectId, title, type, { openAction: true, source }).then(
                  (r) => r === "missing" && toast.error(`${title} gibt es nicht für Minecraft ${i.minecraftVersion}`),
                )
              }
            >
              {i.name}
            </MenuItem>
          );
        })}
        {rows.length === 0 && !instances.isPending && <MenuNote>Noch keine Instanz.</MenuNote>}
      </MenuScroll>
      {all.isPending && rows.length > 0 && <MenuNote>Prüft passende Versionen …</MenuNote>}
      {!usable && !all.isPending && (
        <>
          <MenuSep />
          <MenuItem onSelect={() => navigate("/instances?neu=1")}>
            <Icon name="plus" size="s" />
            <span className="vx-trunc">{type === "resourcepack" ? "Neue Instanz anlegen …" : "Neue Fabric-Instanz anlegen …"}</span>
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

/** Modpack als neue Instanz; ohne `versionId` die neueste stabile Version mit unterstütztem Loader. */
export function useInstallPack(projectId: string, title: string, onDone?: (instanceId: string) => void, source: Source = "modrinth") {
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
        const picked = pickPackVersion(await qc.fetchQuery(allVersionsQuery(projectId, source)));
        if (picked.reason) toast.error(`${title} lässt sich nicht installieren`, { description: picked.reason });
        id = picked.version?.id;
      } catch (err) {
        toast.error(`${title} konnte nicht geladen werden`, { description: err instanceof Error ? err.message : String(err) });
      } finally {
        setChecking(false);
      }
      if (!id) return;
    }
    const perform = (op: string) => (source === "modrinth" ? api.modrinthInstallPack(id, name, op) : api.providerInstallPack(source, projectId, id, name, op));
    install.mutate(withTarget(projectId, perform, `Modpack „${name}“ installieren`), {
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
  // Platzhalter rechtsbündig in der Wertspalte (Zeile bleibt 19 px hoch)
  const val = (text: ReactNode) => (v ? text : versions.isPending ? <Skel w={90} h={12} className="ml-auto mt-1" /> : "–");
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
      <Field label="Name der Instanz">
        <TextField value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
      </Field>
      <dl className="kv">
        <dt>Modpack-Version</dt>
        <dd className="vx-trunc">{val(v?.version_number)}</dd>
        <dt>Minecraft</dt>
        <dd>{val(v?.game_versions.at(-1))}</dd>
        <dt>Loader</dt>
        <dd>{val(v && loaderNames(v))}</dd>
      </dl>
      {versions.error ? (
        <ErrorBox className="mt-3" title="Versionen konnten nicht geladen werden" error={versions.error} onRetry={() => void versions.refetch()} />
      ) : picked && !v ? (
        <Hint tone="bad" live>{picked.reason}</Hint>
      ) : (
        <Hint>Pumpkin Launcher lädt jetzt die Mods des Packs. Minecraft selbst kommt beim ersten Start dazu.</Hint>
      )}
    </form>
  );
}

/**
 * Bestätigung vor „Als neue Instanz anlegen“: zeigt Version, Minecraft und Loader, die Pumpkin Launcher wählt,
 * und lässt den Namen ändern. `ask()` öffnet sie (optional für eine bestimmte Version), `dialog` gehört ins Markup.
 */
function usePackConfirm(projectId: string, title: string, onDone?: (instanceId: string) => void, source: Source = "modrinth") {
  const pack = useInstallPack(projectId, title, onDone, source);
  const [ask, setAsk] = useState<{ versionId?: string } | null>(null);
  const versions = useQuery({ ...allVersionsQuery(projectId, source), enabled: !!ask });
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
      footer={<DialogActions cancel="Abbrechen" confirm={{ label: "Instanz anlegen", width: 170, form: "pack-confirm", disabled: !picked?.version || pack.blocked }} />}
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
export function PackInstallButton({ projectId, title, onDone, source = "modrinth" }: { projectId: string; title: string; onDone?: (instanceId: string) => void; source?: Source }) {
  const { pack, ask, dialog } = usePackConfirm(projectId, title, onDone, source);
  return (
    <>
      {pack.busy ? (
        <JobProgress label={pack.busy} p={pack.p} width={120} onCancel={pack.cancel} cancelLabel={`Installation von ${title} abbrechen`} />
      ) : (
        <Button size="s" icon="plus" disabled={pack.blocked} aria-label={`${title} als Instanz anlegen`} onClick={() => ask()}>
          Anlegen
        </Button>
      )}
      {dialog}
    </>
  );
}

// Ein Begriff für alles Unfertige, wie im Dialog „Neue Instanz“.
const VERSION_TYPE: Record<ContentVersion["version_type"], string | null> = { release: null, beta: "Vorabversion", alpha: "Vorabversion" };

/** Aktionen in den Pack-Details: „Als neue Instanz anlegen“ plus „Andere Version“, beide mit Bestätigung. */
export function PackActions({ projectId, title, onDone, source = "modrinth" }: { projectId: string; title: string; onDone?: (instanceId: string) => void; source?: Source }) {
  const { pack, ask, dialog } = usePackConfirm(projectId, title, onDone, source);
  const versions = useQuery(allVersionsQuery(projectId, source));
  const { version, reason } = versions.data ? pickPackVersion(versions.data) : { version: null, reason: null };
  const fitting = versions.data?.filter(isPackVersionSupported) ?? [];

  if (pack.busy) return <JobProgress label={pack.busy} p={pack.p} width={230} onCancel={pack.cancel} cancelLabel={`Installation von ${title} abbrechen`} />;
  return (
    <>
      <Button variant="primary" size="l" icon="plus" disabled={!version || pack.blocked} onClick={() => ask(version?.id)}>
        {reason ?? "Als neue Instanz anlegen"}
      </Button>
      {fitting.length > 1 && (
        <Menu
          trigger={<Button iconEnd="chevd" disabled={pack.blocked}>Andere Version</Button>}
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
    <Empty
      ill="plug"
      title="Keine Verbindung"
      size={compact ? "pane" : "page"}
      actions={
        <>
          <Button icon="redo" onClick={onRetry}>Erneut versuchen</Button>
          {!compact && <ButtonLink variant="ghost" to="/instances">Zur Bibliothek</ButtonLink>}
        </>
      }
    >
      Der Katalog braucht Internet. Deine installierten Instanzen kannst du trotzdem spielen.
    </Empty>
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
export function ContentResults({ type, instance, action, onOpen, autoFocus = true, query: outerQuery, mc: outerMc, loader: outerLoader, fit = true, compact, onReset, sort, feature, source = "modrinth" }: {
  type: CatalogType; instance?: Instance; action?: (hit: ContentHit) => ReactNode; onOpen: (projectId: string, hit?: ContentHit) => void;
  /** Katalog-Quelle; ohne Angabe Modrinth. Anbieter ohne Schlüssel liefern nur Modpacks (CurseForge: Nachschlagen per Link). */
  source?: Source;
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
  const info = SOURCES[source];
  const results = useInfiniteQuery({
    queryKey: source === "modrinth" ? ["modrinth-search", type, query, mc, loader, index] : ["catalog-search", source, type, query, mc, loader, index],
    queryFn: ({ pageParam }) =>
      source === "modrinth" ? api.modrinthSearch(query, type, mc, loader, pageParam, index) : api.providerSearch(source, query, type, mc, loader, pageParam, index),
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
  const variant = compact ? "catalog-compact" : "catalog";

  return (
    <div>
      {!controlled && (
        <Toolbar search="l" className="mb-3.5">
          <SearchField value={input} onChange={setInput} placeholder={SEARCH_PLACEHOLDER[type]} autoFocus={autoFocus} />
        </Toolbar>
      )}
      {/* Ohne Suchbegriff die Sortierung als Abschnittsüberschrift (wie auf Start), mit Suchbegriff die Trefferzahl; gleiche Höhe */}
      {!results.error && (
        <div aria-live="polite" className="mb-2.5">
          <SectionHeader
            as={compact ? "h3" : "h2"}
            size={compact ? "card" : "section"}
            title={!query ? SORT_HEADINGS[index] : results.data ? <><Count value={total.toLocaleString("de")} /> Treffer</> : "Sucht …"}
          />
        </div>
      )}

      {results.error ? (
        navigator.onLine === false ? (
          <Offline compact={compact} onRetry={() => void results.refetch()} />
        ) : (
          <ErrorBox title={`${info.label} ist gerade nicht erreichbar`} error={results.error} onRetry={() => void results.refetch()} />
        )
      ) : results.isPending ? (
        <List variant={variant} aria-busy aria-label="Wird geladen">
          {Array.from({ length: 6 }, (_, i) => <SkelRow key={i} feature={featured && i === 0} />)}
        </List>
      ) : hits.length === 0 ? (
        <Empty
          ill="search"
          title="Nichts gefunden"
          size={compact ? "pane" : "section"}
          actions={hasFilter && onReset ? <Button onClick={onReset}>Filter zurücksetzen</Button> : undefined}
        >
          {instance && fit ? `Für ${fitsLabel(instance, type)} gibt es hier nichts Passendes. Schalte den Filter aus, um alles zu sehen.` : `Keine ${TYPE_LABELS[type]} passen zu deiner Suche und den Filtern.`}
        </Empty>
      ) : (
        <>
          <List variant={variant} aria-label={TYPE_LABELS[type]}>
            {hits.map((hit, k) => {
              const busy = !instance && !!active && target === hit.project_id && type !== "modpack";
              const feat = featured && k === 0;
              return (
                <ListRow key={hit.project_id} feature={feat} index={k % 20} hit={{ onClick: () => onOpen(hit.project_id, hit), label: `${hit.title} ansehen` }}>
                  <ProjectIcon url={hit.icon_url} seed={hit.project_id} box={feat ? 104 : compact ? 40 : 72} />
                  <RowTitle
                    size={feat ? "feature" : "l"}
                    title={hit.title}
                    aside={compact ? undefined : `von ${hit.author}`}
                    sub={hit.description}
                    meta={
                      <>
                        <span><Count value={formatDownloads(hit.downloads)} /> Downloads</span>
                        {categoryNames(hit.categories, compact ? 0 : 2).map((c) => <Chip key={c} size="s" data-hide="900">{c}</Chip>)}
                        {!instance && <InChip small instances={installedIn.get(installedKey(source, hit.project_id))} />}
                      </>
                    }
                  />
                  <Cell flex align="end">
                    {busy ? (
                      <JobProgress label={shortLabel(progress)} p={progressShare(progress)} width={jobWidth(false, compact)} />
                    ) : instance ? (
                      <AddButton instance={instance} projectId={hit.project_id} title={hit.title} type={type} compact={compact} source={source} />
                    ) : action ? (
                      action(hit)
                    ) : (
                      <Icon name="chev" size="s" tone="muted" />
                    )}
                  </Cell>
                </ListRow>
              );
            })}
          </List>
          <div className="morebar">
            {results.hasNextPage ? (
              <Button disabled={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>
                {results.isFetchingNextPage ? "Lädt …" : "Mehr laden"}
              </Button>
            ) : (
              <Hint className="self-center">{hits.length === 1 ? "1 Ergebnis" : `Alle ${hits.length} Ergebnisse geladen`}</Hint>
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
      <span className="block text-fg-3">{all.length} Versionen</span>
    </>
  );
}

/**
 * Projektseite: Kopf mit Bild und Aktion, links Beschreibung, rechts „Passt zu“ und Versionen.
 * Mit `instance` (Seitenpanel) wird für diese Instanz hinzugefügt; `hit` liefert Autor, Downloads und Kategorien aus der Suche.
 * Im Seitenpanel einspaltig (ui/overlay.css, .vx-sheet .proj-*).
 */
export function ContentDetail({ projectId, type, instance, action, onBack, backLabel = "Zurück", hit, source = "modrinth" }: {
  projectId: string; type: CatalogType; instance?: Instance; action?: (project: ContentProject) => ReactNode; onBack: () => void;
  backLabel?: string; hit?: ContentHit | null; source?: Source;
}) {
  const info = SOURCES[source];
  const project = useQuery({
    queryKey: source === "modrinth" ? ["modrinth-project", projectId] : ["catalog-project", source, projectId],
    queryFn: () => (source === "modrinth" ? api.modrinthProject(projectId) : api.providerProject(source, projectId)),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const mc = instance?.minecraftVersion ?? null;
  const loader = instance ? loaderFor(instance, type) : null;
  const fitting = useQuery({
    queryKey: source === "modrinth" ? versionsKey(projectId, mc, loader) : ["catalog-versions", source, projectId, mc, loader],
    queryFn: () => (source === "modrinth" ? api.modrinthVersions(projectId, mc, loader) : api.providerVersions(source, projectId, mc, loader)),
    enabled: !!instance,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const all = useQuery(allVersionsQuery(projectId, source));
  const instances = useInstances();
  const title = project.data?.title ?? hit?.title ?? "";
  const { pack, ask: askPack, dialog: packDialog } = usePackConfirm(projectId, title, undefined, source);
  const installedIn = useInstalledIn();
  const shown = (instance ? fitting.data : type === "modpack" && info.install ? all.data?.filter(isPackVersionSupported) : all.data)?.slice(0, 5);
  const fitCount =
    source === "modrinth" && type !== "modpack" && all.data && instances.data
      ? instances.data.filter((i) => kindsFor(i).includes(type as ModKind) && all.data!.some((v) => v.game_versions.includes(i.minecraftVersion) && (type !== "mod" || v.loaders.some((l) => modLoadersFor(i.loader).includes(l))))).length
      : null;
  const loaders = all.data ? [...new Set(all.data.flatMap((v) => v.loaders))].filter((l) => l !== "minecraft") : [];

  return (
    <section className="proj">
      <BackLink onClick={onBack}>{backLabel}</BackLink>
      {project.isPending && (
        <div className="proj-h" aria-busy aria-label="Wird geladen">
          <Skel w={64} h={64} />
          <div className="flex flex-col gap-2.5">
            <Skel h={36} w="50%" />
            <Skel h={14} w="30%" />
          </div>
        </div>
      )}
      {project.error && <ErrorBox className="mt-3" title="Das Projekt konnte nicht geladen werden" error={project.error} onRetry={() => void project.refetch()} />}
      {project.data && (
        <>
          <div className="proj-h">
            <ProjectIcon url={project.data.icon_url} seed={projectId} box={64} />
            <div className="min-w-0">
              <h1 title={title}>{title}</h1>
              <div className="by">
                {hit && <Meta items={[`von ${hit.author}`, <><Count value={formatDownloads(hit.downloads)} /> Downloads</>]} />}
                <Chip size="s">{TYPE_ONE[type]}</Chip>
                {hit && categoryNames(hit.categories, 2).map((c) => <Chip key={c} size="s">{c}</Chip>)}
                {!instance && <InChip instances={installedIn.get(installedKey(source, projectId))} />}
              </div>
            </div>
            <div className="projact">
              {instance ? <AddButton instance={instance} projectId={projectId} title={title} type={type} large source={source} /> : action?.(project.data)}
            </div>
          </div>
          <div className="proj-b">
            <div>
              {project.data.description && <p className="lead">{project.data.description}</p>}
              <Description body={project.data.body} />
            </div>
            <aside className="side">
              <Panel notch={2} pad="m">
                <SectionHeader as="h3" size="card" title="Passt zu" />
                <dl className="kv">
                  <dt>Minecraft</dt>
                  <dd>{all.data ? <McSummary versions={all.data} /> : "…"}</dd>
                  {type !== "resourcepack" && (
                    <>
                      <dt>Loader</dt>
                      <dd>{type === "shader" ? "Iris (Fabric, Quilt, NeoForge)" : loaders.length ? loaders.map((l) => LOADER_LABELS[l as ModLoader] ?? l).join(", ") : all.data ? "Nicht angegeben" : "…"}</dd>
                    </>
                  )}
                  {source === "modrinth" && (
                    <>
                      <dt>Benötigt auf</dt>
                      <dd>{sideText(project.data)}</dd>
                    </>
                  )}
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
              </Panel>
              <Panel notch={2} pad="m">
                <SectionHeader as="h3" size="card" title={instance ? `Versionen für ${fitsLabel(instance, type)}` : "Versionen"} />
                {!shown && <Skel h={44} />}
                {shown?.length === 0 && <Hint>{instance ? `Keine Version für ${fitsLabel(instance, type)}.` : "Keine Version verfügbar."}</Hint>}
                {!!shown?.length && (
                  <List variant="versions" aria-label="Versionen">
                    {shown.map((v) => (
                      <ListRow key={v.id}>
                        <RowTitle
                          title={v.version_number}
                          sub={`${v.loaders.filter((l) => l !== "minecraft").map((l) => LOADER_LABELS[l as ModLoader] ?? l).join(", ") || "Alle Loader"} · ${v.game_versions.at(-1)}${VERSION_TYPE[v.version_type] ? ` · ${VERSION_TYPE[v.version_type]}` : ""}`}
                        />
                        {instance ? (
                          <AddButton instance={instance} projectId={projectId} title={title} type={type} versionId={v.id} source={source} />
                        ) : type === "modpack" && info.install ? (
                          <IconButton size="s" icon="plus" label={`${v.version_number} als Instanz anlegen`} tip="Diese Version als Instanz anlegen" disabled={pack.blocked} onClick={() => askPack(v.id)} />
                        ) : null}
                      </ListRow>
                    ))}
                  </List>
                )}
              </Panel>
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
  // Modrinth oder CurseForge; der Shader-Hinweis zu Iris gilt für beide.
  const [source, setSource] = useState<Source>("modrinth");
  const { acc } = useLook(instance.id);
  const hasIris = instance.mods.some((m) => projectOf(m) === IRIS_PROJECT_ID || (m.source.type === "curseforge" && /iris/i.test(m.name)));
  const kind = kinds.includes(type) ? type : kinds[0];
  const tabbed = kinds.length > 1;

  // Beim Öffnen mit gewünschter Art (z. B. „Iris hinzufügen“) direkt dorthin.
  useEffect(() => {
    if (open && initialKind && kinds.includes(initialKind)) {
      setType(initialKind);
      setProjectId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKind]);

  const results = (
    <>
      {kind === "shader" && !hasIris && <Hint tone="warn" className="mb-2">Shader brauchen die Mod „Iris“. Füge sie unter „Mods“ hinzu.</Hint>}
      <ContentResults
        key={`${source}-${kind}`}
        source={source}
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
    </>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      acc={acc}
      title={`Inhalte für ${instance.name}`}
      sub={`Pumpkin Launcher wählt automatisch die Version für ${fitsLabel(instance, "mod")}.`}
      tools={
        projectId ? undefined : (
          <>
            {tabbed && (
              <Tabs variant="segment" size="s" idBase="sheet-art" label="Art" value={kind} onChange={setType} items={kinds.map((k) => ({ value: k, label: KIND_LABELS[k] }))} />
            )}
            <Select
              size="s"
              label="Quelle"
              value={source}
              onChange={(v) => setSource(v as Source)}
              options={[{ value: "modrinth", label: "Modrinth" }, { value: "curseforge", label: "CurseForge" }]}
            />
            <SearchField size="s" value={query} onChange={setQuery} placeholder="Im Katalog suchen" autoFocus />
            <Switch checked={fit} onChange={setFit} label={`Nur passend zu ${fitsLabel(instance, kind)}`} visibleLabel />
          </>
        )
      }
    >
      {projectId && (
        <ContentDetail projectId={projectId} type={kind} instance={instance} hit={hit} source={source} backLabel={KIND_LABELS[kind]} onBack={() => setProjectId(null)} />
      )}
      {/* Bleibt beim Öffnen von Details erhalten, damit Suche und geladene Seiten nicht verloren gehen. */}
      {tabbed ? (
        <TabPanel idBase="sheet-art" value={kind} hidden={!!projectId}>{results}</TabPanel>
      ) : (
        <div hidden={!!projectId}>{results}</div>
      )}
    </Sheet>
  );
}
