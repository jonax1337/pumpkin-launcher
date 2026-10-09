import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { BackLink, Button, Chip, Count, DescriptionList, Heading, Hint, List, ListRow, Meta, Panel, ProjectIcon, RowTitle, SectionHeader, Skel, WorkspaceContent } from "@/ui";
import { ErrorBox } from "@/components/ErrorBox";
import { Description } from "@/components/Description";
import { useInstances } from "@/hooks/useInstances";
import { ALL_VERSIONS, catalogApi } from "@/lib/catalogApi";
import { installedKey, SOURCES, type CatalogType, type ContentHit, type ContentProject, type ContentVersion, type Source } from "@/lib/content-types";
import { TYPE_ONE_KEYS } from "@/lib/catalog";
import { formatDownloads } from "@/lib/format";
import { isPackVersionSupported } from "@/lib/mods";
import type { Instance, ModKind, World } from "@/lib/types";
import { AddProjectButton, AddVersionButton } from "./AddButtons";
import { ContentAction } from "./ContentAction";
import { fitFilter, fitsLabel, kindsFor, versionFits } from "./fit";
import { Gallery } from "./Gallery";
import { InstalledChipHead, useInstalledIn } from "./InstalledIn";
import { categoryNames, loaderText, sideText, versionLoaders, versionTypeSuffix } from "./labels";
import { usePackConfirm } from "./PackInstall";
import { VersionTable } from "./VersionTable";

/** So viele passende Versionen zeigt das Seitenpanel einer Instanz. */
const SHOWN_VERSIONS = 5;

/** Bis zu so viele Minecraft-Versionen stehen einzeln, darüber Spanne und Anzahl. */
const LISTED_MC_VERSIONS = 3;

const CATEGORIES_IN_HEAD = 2;

/** Wo die Seite steht: `page` (Entdecken) oder `panel` (Seitenpanel einer Instanz, einspaltig, Seitenleiste oben). */
export type DetailLayout = "page" | "panel";

/** Kopf der Instanz-Ansicht und ihres Platzhalters: Bild, Titel, Aktion in einem Raster. */
const HEAD_BASE = "grid min-h-16 items-center";

/** Die Unterschiede der beiden Layouts: Kopf, Titel und Aktion des Kopfs, Hauptraster, Seitenleiste, Einleitung und Beschreibung. */
const LAYOUT: Record<DetailLayout, { head: string; title: string; action: string; body: string; side: string; lead: string; desc: string }> = {
  page: {
    head: "grid-cols-[64px_minmax(0,1fr)_auto] gap-[18px] mt-2.5",
    title: "",
    action: "min-w-[250px] justify-end",
    body: "mt-5 grid grid-cols-[minmax(0,1fr)_280px] items-start gap-6 le-960:grid-cols-[minmax(0,1fr)]",
    side: "sticky top-4 flex min-w-0 flex-col gap-[18px] le-960:static",
    lead: "max-w-none min-w-0",
    desc: "max-w-none min-w-0",
  },
  panel: {
    head: "grid-cols-[64px_minmax(0,1fr)] gap-3.5 mt-1.5",
    title: "text-hd-dialog leading-[.95] whitespace-normal line-clamp-2",
    action: "col-[1/-1] min-h-14 min-w-0 justify-start",
    body: "mt-4 grid grid-cols-[minmax(0,1fr)] items-start gap-[18px]",
    side: "order-first flex flex-col gap-[18px]",
    lead: "max-w-[68ch]",
    desc: "",
  },
};

/** Welches Projekt die Seite zeigt und für wen: mit `instance` (Seitenpanel) wird für diese Instanz hinzugefügt, mit `world` in diese Welt. */
interface DetailScope {
  projectId: string;
  type: CatalogType;
  source: Source;
  instance?: Instance;
  world?: World;
}

/** Alle Versionen des Projekts. Datenpaket-Projekte bieten oft auch Mod-Versionen an; hier zählen nur die Datenpakete. */
const useAllVersions = ({ source, projectId, type }: DetailScope) =>
  useQuery({
    ...catalogApi(source).versionsQuery(projectId),
    select: (list) => (type === "datapack" ? list.filter((v) => v.loaders.includes("datapack")) : list),
  });

/** Die Versionen, die zur Instanz passen; ohne Instanz wird nichts geladen. */
const useFittingVersions = ({ source, projectId, type, instance }: DetailScope) =>
  useQuery({ ...catalogApi(source).versionsQuery(projectId, instance ? fitFilter(instance, type) : ALL_VERSIONS), enabled: !!instance });

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
  if (all.length <= LISTED_MC_VERSIONS) return <>{all.join(", ")}</>;
  // Zwei feste Zeilen statt freiem Umbruch in der rechtsbündigen Spalte
  return (
    <>
      <span className="block">{all[0]} – {all.at(-1)}</span>
      <span className="block text-(--fg-3)">{t("components.detail.versionCount", { n: all.length })}</span>
    </>
  );
}

/** Wie viele Instanzen eine Version des Projekts aufnehmen können; `null`, solange etwas fehlt oder die Art ein Modpack ist. */
function fittingInstanceCount(type: CatalogType, versions: ContentVersion[] | undefined, instances: Instance[] | undefined) {
  if (type === "modpack" || !versions || !instances) return null;
  const accepts = (i: Instance) => type === "datapack" || kindsFor(i).includes(type as ModKind);
  return instances.filter((i) => accepts(i) && versions.some((v) => versionFits(v, i, type))).length;
}

function ProjectSkeleton({ layout }: { layout: DetailLayout }) {
  const { t } = useI18n();
  return (
    <div className={cn(HEAD_BASE, LAYOUT[layout].head)} aria-busy aria-label={t("components.common.loadingAria")}>
      <Skel className="size-16" />
      <div className="flex flex-col gap-2.5">
        <Skel className="h-9 w-1/2" />
        <Skel className="h-3.5 w-[30%]" />
      </div>
    </div>
  );
}

/** Kopf: Bild, Titel, Autor und Zahlen (wenn die Suche sie lieferte), Aktion. */
function ProjectHead({ project, scope, layout, hit }: { project: ContentProject; scope: DetailScope; layout: DetailLayout; hit?: ContentHit | null }) {
  const { t } = useI18n();
  const { projectId, type, source, instance, world } = scope;
  const installedIn = useInstalledIn();
  const look = LAYOUT[layout];
  const ref = { id: projectId, title: project.title };
  const metadata = (
    <>
      {hit && <Meta items={[t("components.search.byAuthor", { author: hit.author }), <><Count value={formatDownloads(hit.downloads)} /> {t("components.stats.downloads")}</>]} />}
      <Chip size="s">{t(TYPE_ONE_KEYS[type])}</Chip>
      {hit && categoryNames(hit.categories, CATEGORIES_IN_HEAD).map((c) => <Chip key={c} size="s">{c}</Chip>)}
      {!instance && <InstalledChipHead instances={installedIn.get(installedKey(source, projectId))} />}
    </>
  );
  if (!instance) {
    return (
      <header className="mt-3 grid grid-cols-[104px_minmax(0,1fr)_auto] items-center gap-5 border-b-(length:--px) border-b-(color:--line) pb-[18px] le-960:grid-cols-[104px_minmax(0,1fr)]">
        <ProjectIcon url={project.icon_url} seed={projectId} box={104} />
        <div className="grid min-w-0 gap-2.5">
          <Heading level="page" className="truncate" title={project.title}>{project.title}</Heading>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-(color:--fg-2)">{metadata}</div>
        </div>
        <div className="flex min-w-0 items-center justify-end le-960:col-2 le-960:justify-start">
          <ContentAction type={type} project={ref} source={source} large />
        </div>
      </header>
    );
  }
  return (
    <div className={cn(HEAD_BASE, look.head)}>
      <ProjectIcon url={project.icon_url} seed={projectId} box={64} />
      <div className="min-w-0">
        <Heading level="page" as="h1" size="title" plain className={cn("truncate", look.title)} title={project.title}>{project.title}</Heading>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-[length:calc(13.5px*var(--tz))] text-(color:--fg-2)">{metadata}</div>
      </div>
      <div className={cn("flex h-14 items-center gap-2", look.action)}>
        <AddProjectButton instance={instance} world={world} project={ref} type={type} source={source} />
      </div>
    </div>
  );
}

/** „Passt zu“: Minecraft-Versionen, Loader, wo es installiert sein muss und wie viele Instanzen es aufnehmen. */
function FitsPanel({ project, scope, layout }: { project: ContentProject; scope: DetailScope; layout: DetailLayout }) {
  const { t } = useI18n();
  const { type, source, instance } = scope;
  const all = useAllVersions(scope);
  const fitting = useFittingVersions(scope);
  const instances = useInstances();
  const loaders = all.data ? [...new Set(all.data.flatMap((v) => v.loaders))].filter((l) => l !== "minecraft") : [];
  const fitCount = source === "modrinth" ? fittingInstanceCount(type, all.data, instances.data) : null;
  return (
    <Panel notch={2}>
      <SectionHeader level="card" title={t("components.detail.fitsHeading")} />
      <DescriptionList
        size="s"
        end
        items={[
          { label: "Minecraft", value: all.data ? <McSummary versions={all.data} /> : "…" },
          type !== "resourcepack" && type !== "datapack" && {
            label: t("components.common.loader"),
            value: type === "shader" ? t("components.detail.shaderLoaders") : loaders.length ? loaderText(loaders) : all.data ? t("components.detail.notSpecified") : "…",
          },
          source === "modrinth" && { label: t("components.detail.requiredOn"), value: sideText(project) },
          instance
            ? { label: t("components.detail.thisInstance"), value: fitting.data ? (fitting.data.length ? t("components.detail.fits") : t("components.detail.noVersion")) : "…" }
            : fitCount != null && instances.data
              ? { label: t("components.detail.yourInstances"), value: t("components.game.countOf", { done: fitCount, total: instances.data.length }) }
              : null,
        ]}
        className={layout === "page" ? "wrap-anywhere" : undefined}
      />
    </Panel>
  );
}

/** Seitenpanel einer Instanz: die jüngsten Versionen, die zu ihr passen, mit Knopf je Version zum Hinzufügen. */
function FittingVersionsPanel({ project, scope, instance }: { project: ContentProject; scope: DetailScope; instance: Instance }) {
  const { t } = useI18n();
  const { projectId, type, source, world } = scope;
  const fitting = useFittingVersions(scope);
  const ref = { id: projectId, title: project.title };
  const shown = fitting.data?.slice(0, SHOWN_VERSIONS);

  return (
    <Panel notch={2}>
      <SectionHeader level="card" title={t("components.detail.versionsFor", { fits: fitsLabel(instance, type) })} />
      {!shown && <Skel className="h-11" />}
      {shown?.length === 0 && <Hint>{`${t("components.content.noVersionFor", { version: fitsLabel(instance, type) })}.`}</Hint>}
      {!!shown?.length && (
        <List flat aria-label={t("components.detail.versions")}>
          {shown.map((v) => (
            <ListRow key={v.id}>
              <RowTitle title={v.version_number} sub={`${versionLoaders(v) || t("components.version.allLoaders")} · ${v.game_versions.at(-1)}${versionTypeSuffix(v)}`} />
              <AddVersionButton instance={instance} world={world} project={ref} type={type} source={source} versionId={v.id} />
            </ListRow>
          ))}
        </List>
      )}
      {!!shown?.length && <Hint icon="info" className="mt-2.5">{t("components.security.noScan")}</Hint>}
    </Panel>
  );
}

/** Versionen eines Modpacks als Tabelle mit „Anlegen“ je Version (nach Bestätigung); was Pumpkin Launcher nicht installieren kann, ist gekennzeichnet. */
function PackVersionTable({ project, scope, versions }: { project: ContentProject; scope: DetailScope; versions: ContentVersion[] }) {
  const { t } = useI18n();
  const { install, ask, dialog } = usePackConfirm({ id: scope.projectId, title: project.title }, scope.source);
  return (
    <>
      <VersionTable
        versions={versions}
        action={(v) =>
          isPackVersionSupported(v) ? (
            <Button size="s" icon="plus" disabled={install.blocked} aria-label={t("components.detail.versionAsInstance", { version: v.version_number })} onClick={() => ask(v.id)}>
              {t("components.newInstance.create")}
            </Button>
          ) : (
            <Chip size="s" tone="warn">{t("components.pack.noSupportedVersion")}</Chip>
          )
        }
      />
      <Hint icon="info" className="mt-2.5">{t("components.security.noScan")}</Hint>
      {dialog}
    </>
  );
}

/** Alle Versionen des Projekts mit Art, Minecraft, Loader, Datum und Änderungen; bei Modpacks mit „Anlegen“ je Version. */
function VersionsSection({ project, scope }: { project: ContentProject; scope: DetailScope }) {
  const { t } = useI18n();
  const all = useAllVersions(scope);
  const asInstance = scope.type === "modpack" && SOURCES[scope.source].install;
  return (
    <section className="mt-7 min-w-0 @container overflow-x-auto">
      <SectionHeader level="section" title={t("components.detail.allVersions")} className="mb-2.5" />
      {all.isPending && <Skel className="h-11" />}
      {all.error && <ErrorBox title={t("components.version.loadFailed")} error={all.error} onRetry={() => void all.refetch()} />}
      {all.data?.length === 0 && <Hint>{t("components.detail.noVersionAvailable")}</Hint>}
      {!!all.data?.length && (asInstance ? <PackVersionTable project={project} scope={scope} versions={all.data} /> : <VersionTable versions={all.data} />)}
    </section>
  );
}

/**
 * Projektseite: Kopf mit Bild und Aktion, links Beschreibung, rechts „Passt zu“ und Versionen.
 * Mit `instance` (Seitenpanel) wird für diese Instanz hinzugefügt, mit `world` in diese Welt, sonst bietet die Seite die Aktion
 * ohne Instanz-Kontext an; `hit` liefert Autor, Downloads und Kategorien aus der Suche.
 * `layout`: `page` (Entdecken: Beschreibung links, Seitenleiste rechts und klebend) oder `panel` (Seitenpanel einer Instanz: einspaltig, Seitenleiste oben).
 */
export function ContentDetail({ projectId, type, source, instance, world, layout, onBack, backLabel, hit }: DetailScope & {
  layout: DetailLayout; onBack: () => void; backLabel: string; hit?: ContentHit | null;
}) {
  const { t } = useI18n();
  const scope: DetailScope = { projectId, type, source, instance, world };
  const project = useQuery(catalogApi(source).projectQuery(projectId));
  const look = LAYOUT[layout];
  return (
    <section>
      <BackLink onClick={onBack}>{backLabel}</BackLink>
      {project.isPending && <ProjectSkeleton layout={layout} />}
      {project.error && <ErrorBox className="mt-3" title={t("components.detail.projectLoadFailed")} error={project.error} onRetry={() => void project.refetch()} />}
      {project.data && (
        <>
          <ProjectHead project={project.data} scope={scope} layout={layout} hit={hit} />
          <div className={look.body}>
            <WorkspaceContent plain={!!instance}>
              {project.data.description && <p className={cn("mt-0.5 text-[length:calc(15.5px*var(--tz))] leading-[1.55] text-(color:--fg)", look.lead)}>{project.data.description}</p>}
              <Gallery images={project.data.gallery} project={project.data.title} />
              <Description body={project.data.body} className={cn("mt-3.5", look.desc)} />
              {!instance && <VersionsSection project={project.data} scope={scope} />}
            </WorkspaceContent>
            <aside className={look.side}>
              <FitsPanel project={project.data} scope={scope} layout={layout} />
              {instance && <FittingVersionsPanel project={project.data} scope={scope} instance={instance} />}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
