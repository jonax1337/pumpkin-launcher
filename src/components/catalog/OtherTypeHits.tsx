import { useQueries } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { Button } from "@/ui";
import { catalogTotalQuery, type SearchRequest } from "@/lib/catalogSearch";
import type { CatalogType, SourceChoice } from "@/lib/content-types";
import { formatCount } from "@/lib/format";
import { typeLabel } from "./labels";

/**
 * „Auch 12 Treffer unter Mods“: dieselbe Suche in den anderen Reitern, mit Wechsel dorthin. Ohne Suchbegriff zeigt sie
 * nichts; Reiter ohne Treffer fehlen. `requestFor` nennt die Suche für einen Reiter (Filter, die dort nicht gelten, fallen weg).
 */
export function OtherTypeHits({ source, types, requestFor, onPick }: {
  source: SourceChoice; types: CatalogType[]; requestFor: (type: CatalogType) => SearchRequest; onPick: (type: CatalogType) => void;
}) {
  const { t } = useI18n();
  const totals = useQueries({
    queries: types.map((type) => ({ ...catalogTotalQuery(source, requestFor(type)), enabled: !!requestFor(type).query })),
  });
  const found = types.flatMap((type, i) => ((totals[i].data ?? 0) > 0 ? [{ type, total: totals[i].data ?? 0 }] : []));
  if (found.length === 0) return null;
  return (
    <div className="cat-also" aria-live="polite">
      {found.map(({ type, total }) => (
        <Button key={type} variant="ghost" size="s" icon="chev-right" onClick={() => onPick(type)}>
          {t(total === 1 ? "pages.discover.alsoIn.one" : "pages.discover.alsoIn.other", { n: formatCount(total), kind: typeLabel(type) })}
        </Button>
      ))}
    </div>
  );
}
