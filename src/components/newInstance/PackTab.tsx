import { useState } from "react";
import { useNavigate } from "react-router";
import { useI18n } from "@/i18n";
import { Button, Choice, Count, ErrorBox, Hint, ProjectIcon, SearchField } from "@/ui";
import { SourceSelect } from "@/components/catalog/SourceSelect";
import { SourceTag } from "@/components/catalog/SourceTag";
import { useCatalogSearch } from "@/components/catalog/ContentResults";
import { useInstallPack } from "@/hooks/usePackInstall";
import { ALL_SOURCES, SOURCES, type CatalogHit, type ProjectRef, type Source, type SourceChoice } from "@/lib/content-types";
import { formatDownloads } from "@/lib/format";
import { discoverUrl } from "@/lib/routes";
import { ChoiceList, ChoiceListSkeleton } from "./ChoiceList";
import type { TabContext, TabModel } from "./tab";

const SKELETON_ROWS = 4;

/** Das gewählte Modpack samt Anbieter; dieselbe Nummer kann bei zwei Anbietern vorkommen. */
interface PackChoice extends ProjectRef {
  source: Source;
}

const sameChoice = (choice: PackChoice | null, hit: CatalogHit) => choice?.id === hit.project_id && choice.source === hit.source;

/** Modpack aus dem Katalog als neue Instanz: Quelle, Suche und Auswahlliste wie in „Entdecken“. */
function PackPane({ selected, onSelect }: { selected: PackChoice | null; onSelect: (pack: PackChoice) => void }) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [source, setSource] = useState<SourceChoice>(ALL_SOURCES);
  const { results, hits, query, failed } = useCatalogSearch(source, "modpack", { query: input, mc: null, loader: null, category: null, sort: null });
  return (
    <>
      <div className="ni-find">
        <SearchField value={input} onChange={setInput} placeholder={t("components.pack.searchPlaceholder")} autoFocus className="ni-find-field" />
        <SourceSelect value={source} onChange={setSource} />
      </div>
      {results.error ? (
        <ErrorBox title={t("components.catalog.unreachable")} error={results.error} onRetry={() => void results.refetch()} />
      ) : (
        <>
          {failed.length > 0 && <Hint tone="warn" className="ni-partial">{t("components.source.partial", { sources: failed.map((s) => SOURCES[s].label).join(", ") })}</Hint>}
          <ChoiceList aria-busy={results.isPending || undefined}>
            {results.isPending && <ChoiceListSkeleton n={SKELETON_ROWS} />}
            {hits.map((hit) => (
              <Choice
                key={`${hit.source}-${hit.project_id}`}
                media={<ProjectIcon url={hit.icon_url} seed={hit.project_id} />}
                title={hit.title}
                sub={t("components.search.byAuthorWithDesc", { author: hit.author, description: hit.description })}
                trail={
                  <>
                    {source === ALL_SOURCES && <SourceTag source={hit.source} />}
                    <Count value={formatDownloads(hit.downloads)} />
                  </>
                }
                selected={sameChoice(selected, hit)}
                onClick={() => onSelect({ id: hit.project_id, title: hit.title, source: hit.source })}
              />
            ))}
            {results.data && hits.length === 0 && <Hint>{t("components.pack.noneFound", { query })}</Hint>}
          </ChoiceList>
          {results.hasNextPage && (
            <Button className="ni-more" disabled={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>
              {results.isFetchingNextPage ? t("components.search.loadingMore") : t("components.search.loadMore")}
            </Button>
          )}
        </>
      )}
    </>
  );
}

/** Reiter „Modpack“: Pack aus dem Katalog wählen und als Instanz anlegen; läuft schon etwas, wird er vorgemerkt. */
export function usePackTab(ctx: TabContext): TabModel {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [pack, setPack] = useState<PackChoice | null>(null);
  const install = useInstallPack({ pack, source: pack?.source ?? "modrinth", onDone: ctx.onCreated });

  // Vorgemerkt heißt: Der Dialog hat nichts mehr zu zeigen.
  const submit = () => void install.run().then((accepted) => accepted && ctx.active && ctx.close());

  return {
    valid: !!pack && !install.blocked,
    label: install.busy ?? t("components.newInstance.create"),
    hint: pack ? (ctx.active ? t("components.pack.queueHint") : t("components.newInstance.installInBackground")) : t("components.newInstance.pickPack"),
    queues: false,
    busy: !!install.busy,
    cancel: install.cancel && { aria: t("components.newInstance.cancelInstall"), onClick: install.cancel },
    submit,
    renderPane: () => (
      <>
        <PackPane selected={pack} onSelect={setPack} />
        <Button
          variant="ghost"
          size="s"
          icon="chev-right"
          bleed="start"
          className="ni-discover"
          onClick={() => {
            ctx.close();
            navigate(discoverUrl({ tab: "modpack", project: pack?.id, projectSource: pack?.source }));
          }}
        >
          {t("components.newInstance.moreInDiscover")}
        </Button>
      </>
    ),
  };
}
