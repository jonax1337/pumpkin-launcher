import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { BackLink, Chip, Count, ErrorBox, Hint, IconButton, List, ListRow, Meta, Panel, ProjectIcon, RowTitle, SectionHeader, Skel } from "@/ui";
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
import { InstalledChipHead, useInstalledIn } from "./InstalledIn";
import { categoryNames, loaderText, sideText, versionLoaders, versionTypeSuffix } from "./labels";
import { usePackConfirm } from "./PackInstall";

/** So viele Versionen zeigt die Seite. */
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
      <span className="block">{all[0]} – {all.at(-1)}</span>
      <span className="block text-fg-3">{t("components.detail.versionCount", { n: all.length })}</span>
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
      <div className="flex flex-col gap-2.5">
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
  return (
    <div className="proj-h">
      <ProjectIcon url={project.icon_url} seed={projectId} box={64} />
      <div className="min-w-0">
        <h1 title={project.title}>{project.title}</h1>
        <div className="by">
          {hit && <Meta items={[t("components.search.byAuthor", { author: hit.author }), <><Count value={formatDownloads(hit.downloads)} /> {t("components.stats.downloads")}</>]} />}
          <Chip size="s">{t(TYPE_ONE_KEYS[type])}</Chip>
          {hit && categoryNames(hit.categories, CATEGORIES_IN_HEAD).map((c) => <Chip key={c} size="s">{c}</Chip>)}
          {!instance && <InstalledChipHead instances={installedIn.get(installedKey(source, projectId))} />}
        </div>
      </div>
      <div className="projact">
        {instance ? <AddProjectButton instance={instance} world={world} project={ref} type={type} source={source} /> : <ContentAction type={type} project={ref} source={source} large />}
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

/** Die jüngsten Versionen, bei einer Instanz die passenden; mit Knopf je Version zum Hinzufügen bzw. Anlegen als Instanz. */
function VersionsPanel({ project, scope }: { project: ContentProject; scope: DetailScope }) {
  const { t } = useI18n();
  const { projectId, type, source, instance, world } = scope;
  const all = useAllVersions(scope);
  const fitting = useFittingVersions(scope);
  const ref = { id: projectId, title: project.title };
  const { install, ask: askPack, dialog: packDialog } = usePackConfirm(ref, source);
  const asInstance = type === "modpack" && SOURCES[source].install;
  const shown = (instance ? fitting.data : asInstance ? all.data?.filter(isPackVersionSupported) : all.data)?.slice(0, SHOWN_VERSIONS);

  return (
    <Panel notch={2} pad="m">
      <SectionHeader as="h3" size="card" title={instance ? t("components.detail.versionsFor", { fits: fitsLabel(instance, type) }) : t("components.detail.versions")} />
      {!shown && <Skel h={44} />}
      {shown?.length === 0 && <Hint>{instance ? `${t("components.content.noVersionFor", { version: fitsLabel(instance, type) })}.` : t("components.detail.noVersionAvailable")}</Hint>}
      {!!shown?.length && (
        <List variant="versions" aria-label={t("components.detail.versions")}>
          {shown.map((v) => (
            <ListRow key={v.id}>
              <RowTitle title={v.version_number} sub={`${versionLoaders(v) || t("components.version.allLoaders")} · ${v.game_versions.at(-1)}${versionTypeSuffix(v)}`} />
              {instance ? (
                <AddVersionButton instance={instance} world={world} project={ref} type={type} source={source} versionId={v.id} />
              ) : asInstance ? (
                <IconButton size="s" icon="plus" label={t("components.detail.versionAsInstance", { version: v.version_number })} tip={t("components.detail.addVersionAsInstance")} disabled={install.blocked} onClick={() => askPack(v.id)} />
              ) : null}
            </ListRow>
          ))}
        </List>
      )}
      {packDialog}
    </Panel>
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
      {project.error && <ErrorBox className="mt-3" title={t("components.detail.projectLoadFailed")} error={project.error} onRetry={() => void project.refetch()} />}
      {project.data && (
        <>
          <ProjectHead project={project.data} scope={scope} hit={hit} />
          <div className="proj-b">
            <div>
              {project.data.description && <p className="lead">{project.data.description}</p>}
              <Description body={project.data.body} />
            </div>
            <aside className="proj-side">
              <FitsPanel project={project.data} scope={scope} />
              <VersionsPanel project={project.data} scope={scope} />
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
