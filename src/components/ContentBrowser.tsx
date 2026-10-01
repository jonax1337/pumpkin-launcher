import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useInfiniteQuery, useQueries, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { t, useI18n } from "@/i18n";
import {
  BackLink, Button, ButtonLink, Cell, Chip, Count, Dialog, DialogActions, Empty, ErrorBox, Field, Hint, Icon, IconButton, JobProgress, List, ListRow, Menu,
  MenuItem, MenuLabel, MenuNote, MenuScroll, MenuSep, Meta, Panel, ProjectIcon, RowTitle, SceneThumb, SearchField, SectionHeader, Select, Sheet, Skel, SkelRow,
  Switch, TabPanel, Tabs, TextField, Tip, type MenuEntry,
} from "@/ui";
import { cancelContent, useContentInstall, useContentState, withTarget } from "@/hooks/useContent";
import { useDebounced } from "@/hooks/useDebounced";
import { useInstances } from "@/hooks/useInstances";
import { worldsQuery } from "@/hooks/useWorlds";
import { catalogKeys, worldKeys } from "@/hooks/queryKeys";
import { api } from "@/lib/api";
import { TYPE_LABEL_KEYS, TYPE_ONE_KEYS } from "@/lib/catalog";
import { errorMessage } from "@/lib/errors";
import { formatCount } from "@/lib/format";
import {
  formatDownloads, installedKey, isPackVersionSupported, modLoadersFor, ownerKey, pickPackVersion, pickVersion, progressLabel, progressShare, progressShortLabel, projectKey, projectOf, SOURCES,
  type CatalogType, type ContentHit, type ContentProject, type ContentVersion, type SearchIndex, type Source,
} from "@/lib/modrinth";
import { loaderLine } from "@/components/common";
import { Description } from "@/components/Description";
import { openManualDownloads } from "@/components/ManualDownloads";
import { instanceUrl, newInstanceUrl, type InstanceTab } from "@/lib/routes";
import { LOADER_LABELS, type Instance, type ModKind, type ModLoader, type World } from "@/lib/types";
import { lookOf, useLook, useLookStore } from "@/store/look";

export const IRIS_PROJECT_ID = "YL57xq9U";

/** Record mit i18n-Schlüsseln, dessen Lesen übersetzt: Komponenten brauchen dazu nichts zu ändern. */
function lazyLabels(keys: Record<string, string>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [prop, key] of Object.entries(keys)) Object.defineProperty(labels, prop, { enumerable: true, get: () => t(key) });
  return labels;
}

// Exportierte Records lesen lazily übersetzt, damit ein Sprachwechsel ohne Neuladen greift.
export const TYPE_LABELS: Record<CatalogType, string> = lazyLabels(TYPE_LABEL_KEYS);

/** Was in eine Instanz passt: Mods und Shader nur mit Mod-Loader, Ressourcenpakete immer. */
const kindsFor = (instance: Instance): ModKind[] =>
  instance.loader !== "vanilla" ? ["mod", "shader", "resourcepack"] : ["resourcepack"];

/** „Fabric 1.21.4“ für Mods, sonst nur die Minecraft-Version. */
const fitsLabel = (instance: Instance, type: CatalogType) =>
  type === "mod" ? loaderLine(instance) : `Minecraft ${instance.minecraftVersion}`;

// Für Quilt fragt das Backend Quilt- und Fabric-Mods an; Datenpakete führt Modrinth unter dem Loader „datapack“.
const loaderFor = (instance: Instance, type: CatalogType) => (type === "mod" ? instance.loader : type === "datapack" ? "datapack" : null);

/** Passt die Version zur Instanz: Minecraft-Version, bei Mods und Datenpaketen auch der Loader. */
const versionFits = (v: ContentVersion, instance: Instance, type: CatalogType) => {
  const loader = loaderFor(instance, type);
  return v.game_versions.includes(instance.minecraftVersion) && (loader == null || v.loaders.some((l) => modLoadersFor(loader).includes(l)));
};

const allVersionsQuery = (projectId: string, source: Source = "modrinth") => ({
  queryKey: catalogKeys.versions(source, projectId, null, null),
  queryFn: () => (source === "modrinth" ? api.modrinthVersions(projectId, null, null) : api.providerVersions(source, projectId)),
  staleTime: 10 * 60_000,
  retry: false,
});

// Modrinth-Kategorien in Alltagssprache; Loader-Namen sind keine Kategorie für die Anzeige.
const CATEGORY: Record<string, string> = {
  adventure: "detail.worlds.gameMode.adventure", optimization: "components.category.optimization", technology: "components.category.technology",
  magic: "components.category.magic", decoration: "components.category.decoration", utility: "components.category.utility",
  "game-mechanics": "components.category.gameMechanics", library: "components.category.library", worldgen: "components.category.worldgen",
  mobs: "components.category.mobs", storage: "components.category.storage", equipment: "components.category.equipment",
  food: "components.category.food", transportation: "components.category.transportation", social: "components.category.social",
  economy: "components.category.economy", management: "components.category.management", minigame: "components.category.minigame",
  "kitchen-sink": "components.category.kitchenSink", lightweight: "components.category.lightweight", multiplayer: "components.category.multiplayer",
  quests: "components.category.quests", challenging: "components.category.challenging", combat: "components.category.combat",
  realistic: "components.category.realistic", "semi-realistic": "components.category.semiRealistic", cartoon: "components.category.cartoon",
  fantasy: "components.category.fantasy", "vanilla-like": "components.category.vanillaLike", simplistic: "components.category.simplistic",
  themed: "components.category.themed", tweaks: "components.category.tweaks", audio: "components.category.audio",
  blocks: "components.category.blocks", entities: "components.category.entities", gui: "components.category.gui",
  items: "components.category.items", models: "components.category.models", fonts: "components.category.fonts",
  atmosphere: "components.category.atmosphere", bloom: "components.category.bloom", shadows: "components.category.shadows",
  reflections: "components.category.reflections", foliage: "components.category.foliage", "colored-lighting": "components.category.coloredLighting",
  "path-tracing": "components.category.pathTracing", pbr: "components.category.pbr", "high-performance": "components.category.highPerformance",
  "low-performance": "components.category.lowPerformance", "potato": "components.category.potato", screenshot: "components.category.screenshot",
  cursed: "components.category.cursed",
};
const LOADER_CATS = new Set(["fabric", "forge", "quilt", "neoforge", "iris", "optifine", "canvas", "vanilla", "minecraft", "datapack", "liteloader", "modloader", "rift", "bukkit", "paper", "spigot", "purpur", "folia", "velocity", "waterfall", "bungeecord", "sponge"]);
const categoryNames = (cats: string[], max = 2) =>
  cats.filter((c) => !LOADER_CATS.has(c) && !/^\d+x/.test(c)).slice(0, max).map((c) => (CATEGORY[c] ? t(CATEGORY[c]) : c.charAt(0).toUpperCase() + c.slice(1).replace(/-/g, " ")));

// ---------- Kleine Zustände in Zeilen ----------

/** Breite des laufenden Vorgangs: Projektkopf 230, Zeile 120, Seitenpanel 112. */
const jobWidth = (large?: boolean, compact?: boolean) => (large ? 230 : compact ? 112 : 120);


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
  const { t } = useI18n();
  if (!instances?.length) return null;
  const one = instances.length === 1;
  const text = shortName(one ? t("components.installedIn.one", { name: instances[0].name }) : t("components.installedIn.other", { n: instances.length }), small ? 28 : 36);
  return (
    <Tip label={t("components.installedIn.tip", { namen: instances.map((i) => i.name).join(", ") })} describe={!one || text.endsWith("…")}>
      {small ? <Chip size="s" dot>{text}</Chip> : <Chip icon="check">{text}</Chip>}
    </Tip>
  );
}

// ---------- Hinzufügen ----------

/**
 * Datenpaket in die Welt. Der Lauf gibt die Instanz unverändert zurück (keine Abhängigkeiten), damit Fortschritt und
 * Aufgaben-Menü wie bei Mods laufen. Die Liste der Welt wird hier aufgefrischt, nicht erst im Erfolgs-Callback, der
 * bei einer inzwischen verlassenen Seite nicht mehr läuft.
 */
const installDatapack = async (qc: QueryClient, instance: Instance, world: World, versionId: string, op: string) => {
  await api.datapackInstall(instance.id, world.id, versionId, op);
  void qc.invalidateQueries({ queryKey: worldKeys.datapacks(instance.id, world.id) });
  return instance;
};

/** Wohin ein Inhalt kam: in die Welt (Tab Welten) oder in die Instanz (Tab Inhalte). */
const destination = (instance: Instance, world?: World): { label: string; tab: InstanceTab } =>
  world ? { label: t("components.content.destinationWorld", { welt: world.name, instanz: instance.name }), tab: "worlds" } : { label: instance.name, tab: "content" };

/**
 * Wählt die passende Version automatisch (oder nimmt `versionId`) und installiert mit Abhängigkeiten, Datenpakete in
 * die Welt `world`. "missing" = keine Version für diese Instanz. Mit `openAction` bekommt der Toast „Ansehen“ (Instanz, Tab Inhalte bzw. Welten).
 */
function useAddContent() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const install = useContentInstall();
  const navigate = useNavigate();
  return async (
    instance: Instance, projectId: string, title: string, type: CatalogType, opts: { versionId?: string; openAction?: boolean; source?: Source; world?: World } = {},
  ) => {
    const source = opts.source ?? "modrinth";
    let id = opts.versionId;
    let picked: ContentVersion | undefined;
    const mc = instance.minecraftVersion, loader = loaderFor(instance, type);
    try {
      if (!id) {
        const versions = await qc.fetchQuery({
          queryKey: catalogKeys.versions(source, projectId, mc, loader),
          queryFn: () => (source === "modrinth" ? api.modrinthVersions(projectId, mc, loader) : api.providerVersions(source, projectId, mc, loader)),
          staleTime: 10 * 60_000,
        });
        picked = pickVersion(versions) ?? undefined;
        id = picked?.id;
      } else if (source !== "modrinth") {
        picked = (await qc.fetchQuery(allVersionsQuery(projectId, source))).find((v) => v.id === id);
      }
    } catch (err) {
      toast.error(t("components.content.loadFailed", { name: title }), { description: errorMessage(err) });
      return "error";
    }
    if (!id) return "missing";
    // CurseForge: Die Autoren erlauben den Download nur über die Webseite. Nicht umgehen, sondern beim Laden von Hand helfen.
    if (source !== "modrinth" && picked && !picked.files[0]?.url) {
      const page = await qc.fetchQuery({ queryKey: catalogKeys.project(source, projectId), queryFn: () => api.providerProject(source, projectId), staleTime: 10 * 60_000 })
        .then((p) => p.web_url).catch(() => null);
      openManualDownloads({
        instanceId: instance.id,
        instanceName: instance.name,
        items: [{ projectId: Number(projectId), fileId: Number(id), name: title, fileName: picked.files[0]?.filename ?? title, url: page ?? `https://www.curseforge.com/minecraft/search?search=${encodeURIComponent(title)}` }],
      });
      return "blocked";
    }
    const before = instance.mods.length;
    const { world } = opts;
    const perform = (op: string) =>
      world ? installDatapack(qc, instance, world, id, op) : source === "modrinth" ? api.modrinthInstallMod(instance.id, id, op) : api.providerInstallMod(source, instance.id, projectId, id, op);
    install.mutate(withTarget(projectId, perform, t("components.content.installTask", { name: title }), { doneLabel: t("components.content.installTaskDone", { name: title }) }), {
      onSuccess: (result) => {
        if (!result) return;
        const extra = result.mods.length - before - 1;
        const deps = extra > 0 ? t(extra === 1 ? "components.content.deps.one" : "components.content.deps.other", { n: extra }) : "";
        if (!opts.openAction) return void toast.success(t("components.content.added", { name: title }) + deps);
        const { label, tab } = destination(result, world);
        toast.success(t("components.content.nowIn", { name: title, ziel: label }) + deps, { action: { label: t("components.content.viewAction"), onClick: () => navigate(instanceUrl(result.id, tab)) } });
      },
    });
    return "ok";
  };
}

/** Hinzufügen im Kontext einer Instanz (Datenpakete: einer Welt darin): Knopf, „Installiert“, Fortschritt oder „Keine Version“. */
function AddButton({ instance, world, projectId, title, type, versionId, large, compact, source = "modrinth" }: {
  instance: Instance; world?: World; projectId: string; title: string; type: CatalogType; versionId?: string; large?: boolean; compact?: boolean; source?: Source;
}) {
  const { t } = useI18n();
  const addContent = useAddContent();
  const { active, target, progress } = useContentState();
  const [state, setState] = useState<"idle" | "checking" | "missing">("idle");
  const installed = instance.mods.some((m) => ownerKey(m) === projectKey(source, projectId));

  async function add() {
    setState("checking");
    const r = await addContent(instance, projectId, title, type, { versionId, source, world });
    setState(r === "missing" ? "missing" : "idle");
    if (r === "missing" && compact) toast.error(t("components.content.notAvailableFor", { name: title, passt: fitsLabel(instance, type) }));
  }

  if (installed) return <Chip icon="check">{t("components.content.installed")}</Chip>;
  if (state === "checking") return <JobProgress label={t("components.common.checking")} p={null} width={jobWidth(large, compact)} />;
  if (active && target === projectId) return <JobProgress label={progressShortLabel(progress)} p={progressShare(progress)} width={jobWidth(large, compact)} />;
  if (state === "missing" && !compact) return <Hint>{t("components.content.noVersionFor", { version: instance.minecraftVersion })}</Hint>;
  return large ? (
    <Button variant="primary" size="l" icon="plus" disabled={!!active} onClick={add}>{t("common.add")}</Button>
  ) : versionId ? (
    <IconButton size="s" icon="dl" label={t("components.content.addThisVersion", { name: title })} tip={t("components.content.addVersion")} disabled={!!active} onClick={add} />
  ) : (
    <Button size="s" icon="plus" disabled={!!active} aria-label={t("components.content.addAria", { name: title })} onClick={add}>{t("common.add")}</Button>
  );
}

/** Ohne Instanz-Kontext: Menü mit allen Instanzen; unpassende ausgegraut mit Grund, sonst „Neue Instanz anlegen…“. */
export function AddToInstanceMenu({ projectId, title, type, large, source = "modrinth" }: { projectId: string; title: string; type: ModKind; large?: boolean; source?: Source }) {
  const { t } = useI18n();
  const instances = useInstances();
  const looks = useLookStore((s) => s.looks);
  const addContent = useAddContent();
  const navigate = useNavigate();
  const { active, target, progress } = useContentState();
  const [open, setOpen] = useState(false);
  // Alle Versionen einmal laden, um Instanzen ohne passende Minecraft-Version vorab auszugrauen.
  const all = useQuery({ ...allVersionsQuery(projectId, source), enabled: open });
  const reasonFor = (i: Instance): string | null => {
    if (!kindsFor(i).includes(type)) return t("components.content.needsLoader");
    if (i.mods.some((m) => ownerKey(m) === projectKey(source, projectId))) return t("components.content.alreadyIn");
    return all.data && !all.data.some((v) => versionFits(v, i, type)) ? t("components.content.noVersionFor", { version: i.minecraftVersion }) : null;
  };
  const rows = (instances.data ?? []).map((i) => ({ i, reason: reasonFor(i) }));
  const usable = rows.some((r) => !r.reason);

  if (active && target === projectId) return <JobProgress label={progressShortLabel(progress)} p={progressShare(progress)} width={jobWidth(large)} />;
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      width={300}
      trigger={addMenuTrigger(title, "instance", !!active, large)}
    >
      <MenuLabel>{t("components.content.addToMenu")}</MenuLabel>
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
                  (r) => r === "missing" && toast.error(t("components.content.notForMc", { name: title, version: i.minecraftVersion })),
                )
              }
            >
              {i.name}
            </MenuItem>
          );
        })}
        {rows.length === 0 && !instances.isPending && <MenuNote>{t("components.content.noInstancesYet")}</MenuNote>}
      </MenuScroll>
      {all.isPending && rows.length > 0 && <MenuNote>{t("components.content.checkingVersions")}</MenuNote>}
      {!usable && !all.isPending && (
        <>
          <MenuSep />
          <MenuItem onSelect={() => navigate(newInstanceUrl())}>
            <Icon name="plus" size="s" />
            <span className="vx-trunc">{type === "resourcepack" ? t("components.content.newInstancePlain") : t("components.content.newInstanceFabric")}</span>
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

/** Datenpaket ohne Instanz-Kontext: je Instanz ein Untermenü mit ihren Welten. */
export function AddToWorldMenu({ projectId, title, large }: { projectId: string; title: string; large?: boolean }) {
  const { t } = useI18n();
  const instances = useInstances();
  const addContent = useAddContent();
  const { active, target, progress } = useContentState();
  const [open, setOpen] = useState(false);
  const list = instances.data ?? [];
  const worlds = useQueries({ queries: list.map((i) => ({ ...worldsQuery(i.id), enabled: open })) });
  // Wie im Menü für Instanzen: Versionen einmal laden, um Instanzen ohne passende Minecraft-Version vorab auszugrauen.
  const all = useQuery({ ...allVersionsQuery(projectId), enabled: open });
  const add = (i: Instance, world: World) =>
    void addContent(i, projectId, title, "datapack", { world, openAction: true }).then(
      (r) => r === "missing" && toast.error(t("components.content.notForMc", { name: title, version: i.minecraftVersion })),
    );
  const items: MenuEntry[] = list.map((i, k) => {
    const found = worlds[k].data;
    const reason = all.data && !all.data.some((v) => versionFits(v, i, "datapack")) ? t("components.content.noVersionForLower", { version: i.minecraftVersion }) : found?.length === 0 ? t("components.content.noWorldsLower") : null;
    return {
      id: i.id,
      text: reason ? `${i.name} (${reason})` : i.name,
      disabled: !!reason || !found?.length,
      items: (found ?? []).map((w) => ({ id: w.id, text: w.name, onSelect: () => add(i, w) })),
    };
  });

  if (active && target === projectId) return <JobProgress label={progressShortLabel(progress)} p={progressShare(progress)} width={jobWidth(large)} />;
  return (
    <Menu open={open} onOpenChange={setOpen} width={300} trigger={addMenuTrigger(title, "world", !!active, large)} items={[{ label: t("components.content.addToMenu") }, ...items]}>
      {list.length === 0 && !instances.isPending && <MenuNote>{t("components.content.noInstancesYet")}</MenuNote>}
      {worlds.some((q) => q.isPending) && <MenuNote>{t("components.content.searchingWorlds")}</MenuNote>}
    </Menu>
  );
}

/** Auslöser für „Hinzufügen zu …“: groß im Projektkopf, klein in der Katalogzeile. */
const addMenuTrigger = (title: string, where: "instance" | "world", disabled: boolean, large?: boolean) => {
  const ziel = where === "instance" ? t("common.instance") : t("components.common.world");
  return (
    <Button variant={large ? "primary" : "secondary"} size={large ? "l" : "s"} icon="plus" iconEnd="chevd" disabled={disabled} aria-label={large ? undefined : t("components.content.addToOne", { name: title, ziel })}>
      {large ? t("components.content.addTo", { ziel }) : t("common.add")}
    </Button>
  );
};

/** Modpack als neue Instanz; ohne `versionId` die neueste stabile Version mit unterstütztem Loader. */
export function useInstallPack(projectId: string, title: string, onDone?: (instanceId: string) => void, source: Source = "modrinth") {
  const { t } = useI18n();
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
        if (picked.reason) toast.error(t("components.pack.cannotInstall", { name: title }), { description: picked.reason });
        id = picked.version?.id;
      } catch (err) {
        toast.error(t("components.content.loadFailed", { name: title }), { description: errorMessage(err) });
      } finally {
        setChecking(false);
      }
      if (!id) return;
    }
    const perform = (op: string) => (source === "modrinth" ? api.modrinthInstallPack(id, name, op) : api.providerInstallPack(source, projectId, id, name, op));
    install.mutate(withTarget(projectId, perform, t("components.pack.installTask", { name }), { cancellable: true, doneLabel: t("components.pack.installTaskDone", { name }) }), {
      onSuccess: (inst) => {
        if (!inst) return;
        toast.success(t("components.pack.readyToast", { name: inst.name }), {
          action: onDone ? undefined : { label: t("common.open"), onClick: () => navigate(instanceUrl(inst.id)) },
        });
        if (onDone) onDone(inst.id);
        else navigate(instanceUrl(inst.id));
      },
    });
  }
  const busy = checking ? t("components.common.checking") : active && target === projectId ? progressLabel(progress).replace(/…$/, "") : null;
  return { run, busy, p: checking ? null : progressShare(progress), blocked: !!active || checking, cancel: !checking && busy ? cancelContent : undefined };
}

/** Loader-Namen; „minecraft“ ist Modrinths Marke für Ressourcen ohne Loader, „datapack“ der von Datenpaketen. */
const loaderNamesOf = (loaders: string[]) =>
  loaders.map((l) => (l === "datapack" ? t("components.catalog.kind.datapack") : (LOADER_LABELS[l as ModLoader] ?? l))).join(", ");
const loaderList = (v: ContentVersion) => loaderNamesOf(v.loaders.filter((l) => l !== "minecraft"));
const loaderNames = (v: ContentVersion) => loaderList(v) || "Vanilla";

/** Inhalt der Bestätigung; wird beim Schließen verworfen, der Name beginnt also immer beim Pack-Titel. */
function PackConfirmBody({ title, versions, picked, onConfirm }: {
  title: string; versions: UseQueryResult<ContentVersion[]>; picked: { version: ContentVersion | null; reason: string | null } | null;
  onConfirm: (versionId: string, name: string) => void;
}) {
  const { t } = useI18n();
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
      <Field label={t("components.instance.nameField")}>
        <TextField value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
      </Field>
      <dl className="kv">
        <dt>{t("components.pack.versionLabel")}</dt>
        <dd className="vx-trunc">{val(v?.version_number)}</dd>
        <dt>Minecraft</dt>
        <dd>{val(v?.game_versions.at(-1))}</dd>
        <dt>{t("components.common.loader")}</dt>
        <dd>{val(v && loaderNames(v))}</dd>
      </dl>
      {versions.error ? (
        <ErrorBox className="mt-3" title={t("components.version.loadFailed")} error={versions.error} onRetry={() => void versions.refetch()} />
      ) : picked && !v ? (
        <Hint tone="bad" live>{picked.reason}</Hint>
      ) : (
        <Hint>{t("components.pack.confirmHint")}</Hint>
      )}
    </form>
  );
}

/**
 * Bestätigung vor „Als neue Instanz anlegen“: zeigt Version, Minecraft und Loader, die Pumpkin Launcher wählt,
 * und lässt den Namen ändern. `ask()` öffnet sie (optional für eine bestimmte Version), `dialog` gehört ins Markup.
 */
function usePackConfirm(projectId: string, title: string, onDone?: (instanceId: string) => void, source: Source = "modrinth") {
  const { t } = useI18n();
  const pack = useInstallPack(projectId, title, onDone, source);
  const [ask, setAsk] = useState<{ versionId?: string } | null>(null);
  const versions = useQuery({ ...allVersionsQuery(projectId, source), enabled: !!ask });
  const picked = versions.data
    ? ask?.versionId
      ? { version: versions.data.find((v) => v.id === ask.versionId) ?? null, reason: t("components.version.gone") }
      : pickPackVersion(versions.data)
    : null;
  const dialog = (
    <Dialog
      open={!!ask}
      onOpenChange={(o) => !o && setAsk(null)}
      title={t("components.pack.newInstanceTitle")}
      sub={title}
      width={480}
      height={380}
      footer={<DialogActions cancel={t("common.cancel")} confirm={{ label: t("components.instance.createAction"), width: 170, form: "pack-confirm", disabled: !picked?.version || pack.blocked }} />}
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
  const { t } = useI18n();
  const { pack, ask, dialog } = usePackConfirm(projectId, title, onDone, source);
  return (
    <>
      {pack.busy ? (
        <JobProgress label={pack.busy} p={pack.p} width={120} onCancel={pack.cancel} cancelLabel={t("components.pack.cancelInstallPack", { name: title })} />
      ) : (
        <Button size="s" icon="plus" disabled={pack.blocked} aria-label={t("components.pack.createAria", { name: title })} onClick={() => ask()}>
          {t("components.newInstance.create")}
        </Button>
      )}
      {dialog}
    </>
  );
}

// Ein Begriff für alles Unfertige, wie im Dialog „Neue Instanz“.
const VERSION_TYPE: Record<ContentVersion["version_type"], string | null> = { release: null, beta: "components.version.prerelease", alpha: "components.version.prerelease" };

/** Aktionen in den Pack-Details: „Als neue Instanz anlegen“ plus „Andere Version“, beide mit Bestätigung. */
export function PackActions({ projectId, title, onDone, source = "modrinth" }: { projectId: string; title: string; onDone?: (instanceId: string) => void; source?: Source }) {
  const { t } = useI18n();
  const { pack, ask, dialog } = usePackConfirm(projectId, title, onDone, source);
  const versions = useQuery(allVersionsQuery(projectId, source));
  const { version, reason } = versions.data ? pickPackVersion(versions.data) : { version: null, reason: null };
  const fitting = versions.data?.filter(isPackVersionSupported) ?? [];

  if (pack.busy) return <JobProgress label={pack.busy} p={pack.p} width={230} onCancel={pack.cancel} cancelLabel={t("components.pack.cancelInstallPack", { name: title })} />;
  return (
    <>
      <Button variant="primary" size="l" icon="plus" disabled={!version || pack.blocked} onClick={() => ask(version?.id)}>
        {reason ?? t("components.pack.createAsInstance")}
      </Button>
      {fitting.length > 1 && (
        <Menu
          trigger={<Button iconEnd="chevd" disabled={pack.blocked}>{t("components.pack.otherVersion")}</Button>}
          items={[
            { label: t("components.pack.otherVersion") },
            ...fitting.slice(0, 30).map((v) => ({
              id: v.id,
              text: v.version_number,
              sub: `${loaderNames(v)} ${v.game_versions.at(-1) ?? ""}${VERSION_TYPE[v.version_type] ? ` · ${t(VERSION_TYPE[v.version_type]!)}` : ""}`,
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

export const SEARCH_PLACEHOLDER: Record<CatalogType, string> = lazyLabels({
  mod: "components.search.placeholder.mod", shader: "components.search.placeholder.shader", resourcepack: "components.search.placeholder.resourcepack",
  modpack: "components.search.placeholder.modpack", datapack: "components.search.placeholder.datapack",
});

/** Keine Verbindung: Katalog braucht Internet. */
function Offline({ onRetry, compact }: { onRetry: () => void; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <Empty
      ill="plug"
      title={t("components.offline.title")}
      size={compact ? "pane" : "page"}
      actions={
        <>
          <Button icon="redo" onClick={onRetry}>{t("common.retry")}</Button>
          {!compact && <ButtonLink variant="ghost" to="/instances">{t("components.offline.toLibrary")}</ButtonLink>}
        </>
      }
    >
      {t("components.offline.text")}
    </Empty>
  );
}

/** Überschrift ohne Suchbegriff je Sortierung. */
const SORT_HEADINGS: Record<SearchIndex, string> = lazyLabels({
  relevance: "components.sort.relevance", downloads: "components.sort.downloads", follows: "components.sort.follows", newest: "common.new", updated: "components.sort.updated",
});

/**
 * Suche mit „Beliebt“ als Startzustand. Mit `instance` passend gefiltert und mit „Hinzufügen“ je Zeile,
 * sonst mit `action` je Zeile. `compact` = schmale Zeilen im Seitenpanel.
 * `sort` fehlt = Downloads ohne Suchbegriff, sonst Relevanz. `feature` hebt ohne Suchbegriff den meistgeladenen bzw. meistgefolgten Treffer als Karte hervor.
 */
export function ContentResults({ type, instance, world, action, onOpen, query: typed, mc: outerMc, loader: outerLoader, fit = true, compact, onReset, sort, feature, source = "modrinth" }: {
  type: CatalogType; instance?: Instance; action?: (hit: ContentHit) => ReactNode; onOpen: (projectId: string, hit?: ContentHit) => void;
  /** Mit `instance`: Welt darin, in die Datenpakete kommen. */
  world?: World;
  /** Katalog-Quelle; ohne Angabe Modrinth. Anbieter ohne Schlüssel liefern nur Modpacks (CurseForge: Nachschlagen per Link). */
  source?: Source;
  /** Suchtext von außen (Entdecken, Seitenpanel); die Suche wartet auf eine Tippause. */
  query: string;
  mc?: string | null; loader?: string | null;
  /** Mit `instance`: nur Passendes zeigen (Version und Loader der Instanz). */
  fit?: boolean; compact?: boolean; onReset?: () => void; sort?: SearchIndex | null; feature?: boolean;
}) {
  const { t } = useI18n();
  const query = useDebounced(typed.trim(), 300);
  const mc = instance ? (fit ? instance.minecraftVersion : null) : (outerMc ?? null);
  const loader = instance ? (fit ? loaderFor(instance, type) : null) : (outerLoader ?? null);
  const index: SearchIndex = sort ?? (query ? "relevance" : "downloads");
  const info = SOURCES[source];
  const results = useInfiniteQuery({
    queryKey: catalogKeys.search(source, type, query, mc, loader, index),
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
      {/* Ohne Suchbegriff die Sortierung als Abschnittsüberschrift (wie auf Start), mit Suchbegriff die Trefferzahl; gleiche Höhe */}
      {!results.error && (
        <div aria-live="polite" className="mb-2.5">
          <SectionHeader
            as={compact ? "h3" : "h2"}
            size={compact ? "card" : "section"}
            title={!query ? SORT_HEADINGS[index] : results.data ? <><Count value={formatCount(total)} /> {t("components.search.hits")}</> : t("components.search.searching")}
          />
        </div>
      )}

      {results.error ? (
        navigator.onLine === false ? (
          <Offline compact={compact} onRetry={() => void results.refetch()} />
        ) : (
          <ErrorBox title={t("components.source.unreachable", { quelle: info.label })} error={results.error} onRetry={() => void results.refetch()} />
        )
      ) : results.isPending ? (
        <List variant={variant} aria-busy aria-label={t("components.common.loadingAria")}>
          {Array.from({ length: 6 }, (_, i) => <SkelRow key={i} feature={featured && i === 0} />)}
        </List>
      ) : hits.length === 0 ? (
        <Empty
          ill="search"
          title={t("components.search.nothingFound")}
          size={compact ? "pane" : "section"}
          actions={hasFilter && onReset ? <Button onClick={onReset}>{t("components.search.resetFilters")}</Button> : undefined}
        >
          {instance && fit ? t("components.search.nothingFits", { passt: fitsLabel(instance, type) }) : t("components.search.noneMatch", { art: TYPE_LABELS[type] })}
        </Empty>
      ) : (
        <>
          <List variant={variant} aria-label={TYPE_LABELS[type]}>
            {hits.map((hit, k) => {
              const busy = !instance && !!active && target === hit.project_id && type !== "modpack";
              const feat = featured && k === 0;
              return (
                <ListRow key={hit.project_id} feature={feat} index={k % 20} hit={{ onClick: () => onOpen(hit.project_id, hit), label: t("components.search.viewProject", { name: hit.title }) }}>
                  <ProjectIcon url={hit.icon_url} seed={hit.project_id} box={feat ? 104 : compact ? 40 : 72} />
                  <RowTitle
                    size={feat ? "feature" : "l"}
                    title={hit.title}
                    aside={compact ? undefined : t("components.search.byAuthor", { autor: hit.author })}
                    sub={hit.description}
                    meta={
                      <>
                        <span><Count value={formatDownloads(hit.downloads)} /> {t("components.stats.downloads")}</span>
                        {categoryNames(hit.categories, compact ? 0 : 2).map((c) => <Chip key={c} size="s" data-hide="900">{c}</Chip>)}
                        {!instance && <InChip small instances={installedIn.get(installedKey(source, hit.project_id))} />}
                      </>
                    }
                  />
                  <Cell flex align="end">
                    {busy ? (
                      <JobProgress label={progressShortLabel(progress)} p={progressShare(progress)} width={jobWidth(false, compact)} />
                    ) : instance ? (
                      <AddButton instance={instance} world={world} projectId={hit.project_id} title={hit.title} type={type} compact={compact} source={source} />
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
                {results.isFetchingNextPage ? t("components.search.loadingMore") : t("components.search.loadMore")}
              </Button>
            ) : (
              <Hint className="self-center">{hits.length === 1 ? t("components.search.oneResult") : t("components.search.allLoaded", { n: hits.length })}</Hint>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Details ----------

/** Wo das Projekt installiert sein muss: Client = dein Spiel, Server = der Server, auf dem du spielst. Reine Funktion, deshalb Modul-`t`. */
const sideText = ({ client_side: c, server_side: s }: ContentProject) => {
  if (c === "unsupported") return t("components.side.serverOnly");
  if (s === "unsupported") return t("components.side.clientOnly");
  if (c === "required" && s === "required") return t("components.side.both");
  if (c === "required") return t("components.side.clientServerOptional");
  if (s === "required") return t("components.side.serverClientOptional");
  return t("components.side.either");
};

const cmpMc = (a: string, b: string) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** Minecraft-Versionen einer Liste: bis drei einzeln, sonst Spanne und Anzahl („1.21.4 – 1.20.1“, „33 Versionen“). */
function McSummary({ versions }: { versions: ContentVersion[] }) {
  const { t } = useI18n();
  const all = [...new Set(versions.flatMap((v) => v.game_versions).filter((g) => /^\d+\.\d+(\.\d+)?$/.test(g)))].sort(cmpMc).reverse();
  if (!all.length) return <>{t("components.detail.unknown")}</>;
  if (all.length <= 3) return <>{all.join(", ")}</>;
  // Zwei feste Zeilen statt freiem Umbruch in der rechtsbündigen Spalte
  return (
    <>
      <span className="block">{all[0]} – {all.at(-1)}</span>
      <span className="block text-fg-3">{t("components.detail.versionCount", { n: all.length })}</span>
    </>
  );
}

/**
 * Projektseite: Kopf mit Bild und Aktion, links Beschreibung, rechts „Passt zu“ und Versionen.
 * Mit `instance` (Seitenpanel) wird für diese Instanz hinzugefügt, mit `world` in diese Welt; `hit` liefert Autor, Downloads und Kategorien aus der Suche.
 * Im Seitenpanel einspaltig (ui/overlay.css, .vx-sheet .proj-*).
 */
export function ContentDetail({ projectId, type, instance, world, action, onBack, backLabel = t("common.back"), hit, source = "modrinth" }: {
  projectId: string; type: CatalogType; instance?: Instance; world?: World; action?: (project: ContentProject) => ReactNode; onBack: () => void;
  backLabel?: string; hit?: ContentHit | null; source?: Source;
}) {
  const { t } = useI18n();
  const info = SOURCES[source];
  const project = useQuery({
    queryKey: catalogKeys.project(source, projectId),
    queryFn: () => (source === "modrinth" ? api.modrinthProject(projectId) : api.providerProject(source, projectId)),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const mc = instance?.minecraftVersion ?? null;
  const loader = instance ? loaderFor(instance, type) : null;
  const fitting = useQuery({
    queryKey: catalogKeys.versions(source, projectId, mc, loader),
    queryFn: () => (source === "modrinth" ? api.modrinthVersions(projectId, mc, loader) : api.providerVersions(source, projectId, mc, loader)),
    enabled: !!instance,
    staleTime: 10 * 60_000,
    retry: false,
  });
  // Datenpaket-Projekte bieten oft auch Mod-Versionen an; hier zählen nur die Datenpakete.
  const all = useQuery({ ...allVersionsQuery(projectId, source), select: (list) => (type === "datapack" ? list.filter((v) => v.loaders.includes("datapack")) : list) });
  const instances = useInstances();
  const title = project.data?.title ?? hit?.title ?? "";
  const { pack, ask: askPack, dialog: packDialog } = usePackConfirm(projectId, title, undefined, source);
  const installedIn = useInstalledIn();
  const shown = (instance ? fitting.data : type === "modpack" && info.install ? all.data?.filter(isPackVersionSupported) : all.data)?.slice(0, 5);
  const fitCount =
    source === "modrinth" && type !== "modpack" && all.data && instances.data
      ? instances.data.filter((i) => (type === "datapack" || kindsFor(i).includes(type as ModKind)) && all.data!.some((v) => versionFits(v, i, type))).length
      : null;
  const loaders = all.data ? [...new Set(all.data.flatMap((v) => v.loaders))].filter((l) => l !== "minecraft") : [];

  return (
    <section className="proj">
      <BackLink onClick={onBack}>{backLabel}</BackLink>
      {project.isPending && (
        <div className="proj-h" aria-busy aria-label={t("components.common.loadingAria")}>
          <Skel w={64} h={64} />
          <div className="flex flex-col gap-2.5">
            <Skel h={36} w="50%" />
            <Skel h={14} w="30%" />
          </div>
        </div>
      )}
      {project.error && <ErrorBox className="mt-3" title={t("components.detail.projectLoadFailed")} error={project.error} onRetry={() => void project.refetch()} />}
      {project.data && (
        <>
          <div className="proj-h">
            <ProjectIcon url={project.data.icon_url} seed={projectId} box={64} />
            <div className="min-w-0">
              <h1 title={title}>{title}</h1>
              <div className="by">
                {hit && <Meta items={[t("components.search.byAuthor", { autor: hit.author }), <><Count value={formatDownloads(hit.downloads)} /> {t("components.stats.downloads")}</>]} />}
                <Chip size="s">{t(TYPE_ONE_KEYS[type])}</Chip>
                {hit && categoryNames(hit.categories, 2).map((c) => <Chip key={c} size="s">{c}</Chip>)}
                {!instance && <InChip instances={installedIn.get(installedKey(source, projectId))} />}
              </div>
            </div>
            <div className="projact">
              {instance ? <AddButton instance={instance} world={world} projectId={projectId} title={title} type={type} large source={source} /> : action?.(project.data)}
            </div>
          </div>
          <div className="proj-b">
            <div>
              {project.data.description && <p className="lead">{project.data.description}</p>}
              <Description body={project.data.body} />
            </div>
            <aside className="side">
              <Panel notch={2} pad="m">
                <SectionHeader as="h3" size="card" title={t("components.detail.fitsHeading")} />
                <dl className="kv">
                  <dt>Minecraft</dt>
                  <dd>{all.data ? <McSummary versions={all.data} /> : "…"}</dd>
                  {type !== "resourcepack" && type !== "datapack" && (
                    <>
                      <dt>{t("components.common.loader")}</dt>
                      <dd>{type === "shader" ? "Iris (Fabric, Quilt, NeoForge)" : loaders.length ? loaderNamesOf(loaders) : all.data ? t("components.detail.notSpecified") : "…"}</dd>
                    </>
                  )}
                  {source === "modrinth" && (
                    <>
                      <dt>{t("components.detail.requiredOn")}</dt>
                      <dd>{sideText(project.data)}</dd>
                    </>
                  )}
                  {instance ? (
                    <>
                      <dt>{t("components.detail.thisInstance")}</dt>
                      <dd>{fitting.data ? (fitting.data.length ? t("components.detail.fits") : t("components.detail.noVersion")) : "…"}</dd>
                    </>
                  ) : fitCount != null && instances.data ? (
                    <>
                      <dt>{t("components.detail.yourInstances")}</dt>
                      <dd>{t("components.game.countOf", { done: fitCount, total: instances.data.length })}</dd>
                    </>
                  ) : null}
                </dl>
              </Panel>
              <Panel notch={2} pad="m">
                <SectionHeader as="h3" size="card" title={instance ? t("components.detail.versionsFor", { passt: fitsLabel(instance, type) }) : t("components.detail.versions")} />
                {!shown && <Skel h={44} />}
                {shown?.length === 0 && <Hint>{instance ? `${t("components.content.noVersionFor", { version: fitsLabel(instance, type) })}.` : t("components.detail.noVersionAvailable")}</Hint>}
                {!!shown?.length && (
                  <List variant="versions" aria-label={t("components.detail.versions")}>
                    {shown.map((v) => (
                      <ListRow key={v.id}>
                        <RowTitle
                          title={v.version_number}
                          sub={`${loaderList(v) || t("components.version.allLoaders")} · ${v.game_versions.at(-1)}${VERSION_TYPE[v.version_type] ? ` · ${t(VERSION_TYPE[v.version_type]!)}` : ""}`}
                        />
                        {instance ? (
                          <AddButton instance={instance} world={world} projectId={projectId} title={title} type={type} versionId={v.id} source={source} />
                        ) : type === "modpack" && info.install ? (
                          <IconButton size="s" icon="plus" label={t("components.detail.versionAsInstance", { version: v.version_number })} tip={t("components.detail.addVersionAsInstance")} disabled={pack.blocked} onClick={() => askPack(v.id)} />
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

/** Katalog im Seitenpanel einer Instanz; mit `world` nur Datenpakete für diese Welt. */
export function AddContentSheet({ instance, world, open, onOpenChange, initialKind }: {
  instance: Instance; world?: World; open: boolean; onOpenChange: (open: boolean) => void; initialKind?: ModKind;
}) {
  const { t } = useI18n();
  // Datenpakete gibt es hier nur von Modrinth.
  const kinds: CatalogType[] = world ? ["datapack"] : kindsFor(instance);
  const [type, setType] = useState<CatalogType>(initialKind && kinds.includes(initialKind) ? initialKind : kinds[0]);
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
      {kind === "shader" && !hasIris && <Hint tone="warn" className="mb-2">{t("components.sheet.shaderNeedsIris")}</Hint>}
      <ContentResults
        key={`${source}-${kind}`}
        source={source}
        type={kind}
        instance={instance}
        world={world}
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
      title={world ? t("components.sheet.datapacksForWorld", { welt: world.name }) : t("components.sheet.contentForInstance", { name: instance.name })}
      sub={t("components.sheet.autoVersion", { passt: fitsLabel(instance, world ? "datapack" : "mod") })}
      tools={
        projectId ? undefined : (
          <>
            {tabbed && (
              <Tabs variant="segment" size="s" idBase="sheet-art" label={t("components.sheet.kindLabel")} value={kind} onChange={setType} items={kinds.map((k) => ({ value: k, label: TYPE_LABELS[k] }))} />
            )}
            {!world && (
              <Select
                size="s"
                label={t("components.sheet.sourceLabel")}
                value={source}
                onChange={(v) => setSource(v as Source)}
                options={[{ value: "modrinth", label: "Modrinth" }, { value: "curseforge", label: "CurseForge" }]}
              />
            )}
            <SearchField size="s" value={query} onChange={setQuery} placeholder={t("components.sheet.searchPlaceholder")} autoFocus />
            <Switch checked={fit} onChange={setFit} label={t("components.sheet.onlyFitting", { passt: fitsLabel(instance, kind) })} visibleLabel />
          </>
        )
      }
    >
      {projectId && (
        <ContentDetail projectId={projectId} type={kind} instance={instance} world={world} hit={hit} source={source} backLabel={TYPE_LABELS[kind]} onBack={() => setProjectId(null)} />
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
