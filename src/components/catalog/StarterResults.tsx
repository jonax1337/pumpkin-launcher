import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { Empty, ErrorBox, List, SkelRow, StatusPanel } from "@/ui";
import type { CatalogHit, CatalogType } from "@/lib/content-types";
import { starterQuery } from "@/lib/starter";
import { PAGE_LAYOUT, ResultRow, usePageRowParts } from "./ContentResults";
import { typeLabel } from "./labels";

/** Platzhalter, solange die Auswahl lädt. */
const SKELETON_ROWS = 4;

/** „Zum Einstieg“: die feste Auswahl bekannter Projekte der Art, mit denselben Zeilen und Aktionen wie die Suche. */
export function StarterResults({ type, onOpen }: { type: CatalogType; onOpen: (projectId: string, hit: CatalogHit) => void }) {
  const { t } = useI18n();
  const starter = useQuery(starterQuery(type));
  const rowParts = usePageRowParts(type);
  return (
    <div>
      <StatusPanel className="cat-note">{t("pages.discover.starterNote")}</StatusPanel>
      {starter.error ? (
        <ErrorBox title={t("components.catalog.unreachable")} error={starter.error} onRetry={() => void starter.refetch()} />
      ) : starter.isPending ? (
        <List variant={PAGE_LAYOUT.list} aria-busy aria-label={t("components.common.loadingAria")}>
          {Array.from({ length: SKELETON_ROWS }, (_, i) => <SkelRow key={i} />)}
        </List>
      ) : starter.data.length === 0 ? (
        <Empty title={t("components.search.nothingFound")} size={PAGE_LAYOUT.emptySize}>{t("components.search.noneMatch", { kind: typeLabel(type) })}</Empty>
      ) : (
        <List variant={PAGE_LAYOUT.list} divided aria-label={typeLabel(type)}>
          {starter.data.map((hit, k) => (
            <ResultRow key={hit.project_id} hit={hit} index={k} feature={false} layout={PAGE_LAYOUT} showSource={false} parts={rowParts(hit)} onOpen={onOpen} />
          ))}
        </List>
      )}
    </div>
  );
}
