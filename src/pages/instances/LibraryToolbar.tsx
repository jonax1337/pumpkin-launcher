import { useSearchParams } from "react-router";
import { useI18n } from "@/i18n";
import { Button, SearchField, Segmented, Select, Spacer, Toolbar } from "@/ui";
import { newInstanceParams } from "@/lib/routes";
import { ALL_LOADERS, LOADER_LABELS, type ModLoader } from "@/lib/types";
import type { LibraryMode } from "./InstanceView";

export type Sort = "recent" | "name" | "created";

/** Was Suche, Loader-Filter und Sortierung der Bibliothek gerade vorgeben. */
export type LibraryFilters = { query: string; loader: ModLoader | "all"; sort: Sort };

/** „Neue Instanz“: öffnet den Dialog über die Adresse (derselbe Weg wie Strg+N). */
export function NewInstanceButton() {
  const { t } = useI18n();
  const [, setParams] = useSearchParams();
  return (
    <Button variant="primary" icon="plus" aria-keyshortcuts="Control+N" onClick={() => setParams(newInstanceParams(), { replace: true })}>
      {t("components.newInstance.title")}
    </Button>
  );
}

/** Werkzeugleiste der Bibliothek: Suche, Loader, Sortierung, Ansicht und „Neue Instanz“. */
export function LibraryToolbar({ filters, onFilters, mode, onMode }: {
  filters: LibraryFilters; onFilters: (patch: Partial<LibraryFilters>) => void; mode: LibraryMode; onMode: (mode: LibraryMode) => void;
}) {
  const { t } = useI18n();
  return (
    // Abstände: 16 über, 18 unter der Werkzeugleiste
    <Toolbar search="m" className="mt-4 mb-4.5">
      <SearchField value={filters.query} onChange={(query) => onFilters({ query })} placeholder={t("pages.instances.searchPlaceholder")} />
      <Select
        label={t("components.common.loader")}
        value={filters.loader}
        onChange={(loader) => onFilters({ loader: loader as LibraryFilters["loader"] })}
        options={[{ value: "all", label: t("common.all") }, ...ALL_LOADERS.map((l) => ({ value: l, label: LOADER_LABELS[l] }))]}
      />
      <Select
        label={t("pages.instances.sortLabel")}
        className="max-[900px]:hidden"
        value={filters.sort}
        onChange={(sort) => onFilters({ sort: sort as Sort })}
        options={[
          { value: "recent", label: t("pages.instances.colLastPlayed") },
          { value: "name", label: t("common.name") },
          { value: "created", label: t("pages.instances.sortCreated") },
        ]}
      />
      <Segmented
        iconsOnly
        label={t("pages.instances.viewLabel")}
        value={mode}
        onChange={onMode}
        items={[
          { value: "poster", label: t("pages.instances.viewPoster"), icon: "grid" },
          { value: "list", label: t("pages.instances.viewList"), icon: "list" },
        ]}
      />
      <Spacer />
      <NewInstanceButton />
    </Toolbar>
  );
}
