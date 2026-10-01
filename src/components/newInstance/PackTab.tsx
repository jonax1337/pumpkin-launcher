import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { Button, Choice, Count, ErrorBox, Hint, ProjectIcon, SearchField } from "@/ui";
import { catalogKeys } from "@/hooks/queryKeys";
import { SEARCH_STALE_MS } from "@/hooks/staleTimes";
import { useDebounced } from "@/hooks/useDebounced";
import { useInstallPack } from "@/hooks/usePackInstall";
import { catalogApi } from "@/lib/catalogApi";
import { defaultSort, type ProjectRef } from "@/lib/content-types";
import { formatDownloads } from "@/lib/format";
import { discoverUrl } from "@/lib/routes";
import { ChoiceList, ChoiceListSkeleton } from "./ChoiceList";
import type { TabContext, TabModel } from "./tab";

const SKELETON_ROWS = 4;

/** Modpack aus dem Katalog als neue Instanz: Suche und Auswahlliste. */
function PackPane({ selected, onSelect }: { selected: string | null; onSelect: (pack: ProjectRef) => void }) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const query = useDebounced(input.trim());
  const results = useQuery({
    queryKey: catalogKeys.packPicker(query),
    queryFn: () => catalogApi("modrinth").search({ query, type: "modpack", mc: null, loader: null, offset: 0, index: defaultSort(query) }),
    staleTime: SEARCH_STALE_MS,
    retry: false,
  });
  return (
    <>
      <SearchField value={input} onChange={setInput} placeholder={t("components.pack.searchPlaceholder")} autoFocus className="mb-4" />
      {results.error ? (
        <ErrorBox title={t("components.catalog.unreachable")} error={results.error} onRetry={() => void results.refetch()} />
      ) : (
        <ChoiceList aria-busy={results.isPending || undefined}>
          {results.isPending && <ChoiceListSkeleton n={SKELETON_ROWS} />}
          {results.data?.hits.map((hit) => (
            <Choice
              key={hit.project_id}
              media={<ProjectIcon url={hit.icon_url} seed={hit.project_id} />}
              title={hit.title}
              sub={t("components.search.byAuthorWithDesc", { author: hit.author, description: hit.description })}
              trail={<Count value={formatDownloads(hit.downloads)} />}
              selected={selected === hit.project_id}
              onClick={() => onSelect({ id: hit.project_id, title: hit.title })}
            />
          ))}
          {results.data && !results.data.hits.length && <Hint>{t("components.pack.noneFound", { query })}</Hint>}
        </ChoiceList>
      )}
    </>
  );
}

/** Reiter „Modpack“: Pack aus dem Katalog wählen und als Instanz anlegen. */
export function usePackTab(ctx: TabContext): TabModel {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [pack, setPack] = useState<ProjectRef | null>(null);
  const install = useInstallPack({ pack, source: "modrinth", onDone: ctx.onCreated });

  return {
    valid: !!pack && !install.blocked,
    label: install.busy ?? t("components.newInstance.create"),
    hint: pack ? t("components.newInstance.installInBackground") : t("components.newInstance.pickPack"),
    queues: true,
    busy: !!install.busy,
    cancel: install.cancel && { aria: t("components.newInstance.cancelInstall"), onClick: install.cancel },
    submit: () => void install.run(),
    renderPane: () => (
      <>
        <PackPane selected={pack?.id ?? null} onSelect={setPack} />
        <Button
          variant="ghost"
          size="s"
          icon="chev"
          bleed="start"
          className="mt-2.5"
          onClick={() => {
            ctx.close();
            navigate(discoverUrl({ project: pack?.id }));
          }}
        >
          {t("components.newInstance.moreInDiscover")}
        </Button>
      </>
    ),
  };
}
