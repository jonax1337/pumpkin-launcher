import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { BackLink, Button, Chip, Count, ErrorBox, Heading, Hint, List, ListRow, Meta, Panel, ProjectIcon, RowTitle, SectionHeader, Skel, WorkspaceContent } from "@/ui";
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
      <span className="kv-line">{all[0]} – {all.at(-1)}</span>
      <span className="kv-line kv-faint">{t("components.detail.versionCount", { n: all.length })}</span>
    </>
  );
}

/** Wie viele Instanzen eine Version des Projekts aufnehmen können; `null`, solange etwas fehlt oder die Art ein Modpack ist. */
function fittingInstanceCount(type: CatalogType, versions: ContentVersion[] | undefined, instances: Instance[] | undefined) {
  if (type === "modpack" || !versions || !instances) return null;
  const accepts = (i: Instance) => type === "datapack" || kindsFor(i).includes(type as ModKind);
  return instances.filter((i) => accepts(i) && versions.some((v) => versionFits(v, i, type))).length;
}

function ProjectSkeleton() {
  const { t } = useI18n();
  return (
    <div className="proj-h" aria-busy aria-label={t("components.common.loadingAria")}>
      <Skel w={64} h={64} />
      <div className="proj-skel-t">
        <Skel h={36} w="50%" />
        <Skel h={14} w="30%" />
      </div>
    </div>
  );
}

/** Kopf: Bild, Titel, Autor und Zahlen (wenn die Suche sie lieferte), Aktion. */
function ProjectHead({ project, scope, hit }: { project: ContentProject; scope: DetailScope; hit?: ContentHit | null }) {
  const { t } = useI18n();
  const { projectId, type, source, instance, world } = scope;
  const installedIn = useInstalledIn();
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
      <header className="proj-hd">
        <ProjectIcon url={project.icon_url} seed={projectId} box={104} />
        <div className="proj-hd-main">
          <Heading level="page" className="vx-trunc" title={project.title}>{project.title}</Heading>
          <div className="proj-hd-meta">{metadata}</div>
        </div>
        <div className="proj-hd-act">
          <ContentAction type={type} project={ref} source={source} large />
        </div>
      </header>
    );
  }
  return (
    <div className="proj-h">
      <ProjectIcon url={project.icon_url} seed={projectId} box={64} />
      <div className="proj-h-main">
        <h1 title={project.title}>{project.title}</h1>
        <div className="by">{metadata}</div>
      </div>
      <div className="projact">
        <AddProjectButton instance={instance} world={world} project={ref} type={type} source={source} />
      </div>
    </div>
  );
}

/** „Passt zu“: Minecraft-Versionen, Loader, wo es installiert sein muss und wie viele Instanzen es aufnehmen. */
function FitsPanel({ project, scope }: { project: ContentProject; scope: DetailScope }) {
  const { t } = useI18n();
  const { type, source, instance } = scope;
  const all = useAllVersions(scope);
  const fitting = useFittingVersions(scope);
  const instances = useInstances();
  const loaders = all.data ? [...new Set(all.data.flatMap((v) => v.loaders))].filter((l) => l !== "minecraft") : [];
  const fitCount = source === "modrinth" ? fittingInstanceCount(type, all.data, instances.data) : null;
  return (
    <Panel notch={2} pad="m">
      <SectionHeader as="h3" size="card" title={t("components.detail.fitsHeading")} />
      <dl className="kv">
        <dt>Minecraft</dt>
        <dd>{all.data ? <McSummary versions={all.data} /> : "…"}</dd>
        {type !== "resourcepack" && type !== "datapack" && (
          <>
            <dt>{t("components.common.loader")}</dt>
            <dd>{type === "shader" ? t("components.detail.shaderLoaders") : loaders.length ? loaderText(loaders) : all.data ? t("components.detail.notSpecified") : "…"}</dd>
          </>
        )}
        {source === "modrinth" && (
          <>
            <dt>{t("components.detail.requiredOn")}</dt>
            <dd>{sideText(project)}</dd>
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
    <Panel notch={2} pad="m">
      <SectionHeader as="h3" size="card" title={t("components.detail.versionsFor", { fits: fitsLabel(instance, type) })} />
      {!shown && <Skel h={44} />}
      {shown?.length === 0 && <Hint>{`${t("components.content.noVersionFor", { version: fitsLabel(instance, type) })}.`}</Hint>}
      {!!shown?.length && (
        <List variant="versions" aria-label={t("components.detail.versions")}>
          {shown.map((v) => (
            <ListRow key={v.id}>
              <RowTitle title={v.version_number} sub={`${versionLoaders(v) || t("components.version.allLoaders")} · ${v.game_versions.at(-1)}${versionTypeSuffix(v)}`} />
              <AddVersionButton instance={instance} world={world} project={ref} type={type} source={source} versionId={v.id} />
            </ListRow>
          ))}
        </List>
      )}
      {!!shown?.length && <Hint icon="info" className="cat-hint">{t("components.security.noScan")}</Hint>}
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
      <Hint icon="info" className="cat-hint">{t("components.security.noScan")}</Hint>
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
    <section className="vtab-sec">
      <SectionHeader as="h2" size="section" title={t("components.detail.allVersions")} className="vtab-head" />
      {all.isPending && <Skel h={44} />}
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
 * Im Seitenpanel einspaltig (ui/overlay.css, .vx-sheet .proj-*).
 */
export function ContentDetail({ projectId, type, source, instance, world, onBack, backLabel, hit }: DetailScope & {
  onBack: () => void; backLabel: string; hit?: ContentHit | null;
}) {
  const { t } = useI18n();
  const scope: DetailScope = { projectId, type, source, instance, world };
  const project = useQuery(catalogApi(source).projectQuery(projectId));
  return (
    <section className="proj">
      <BackLink onClick={onBack}>{backLabel}</BackLink>
      {project.isPending && <ProjectSkeleton />}
      {project.error && <ErrorBox className="proj-err" title={t("components.detail.projectLoadFailed")} error={project.error} onRetry={() => void project.refetch()} />}
      {project.data && (
        <>
          <ProjectHead project={project.data} scope={scope} hit={hit} />
          <div className="proj-b">
            <WorkspaceContent variant={instance ? "plain" : "panel"}>
              {project.data.description && <p className="lead">{project.data.description}</p>}
              <Gallery images={project.data.gallery} project={project.data.title} />
              <Description body={project.data.body} />
              {!instance && <VersionsSection project={project.data} scope={scope} />}
            </WorkspaceContent>
            <aside className="proj-side">
              <FitsPanel project={project.data} scope={scope} />
              {instance && <FittingVersionsPanel project={project.data} scope={scope} instance={instance} />}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
