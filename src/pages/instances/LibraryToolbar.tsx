import type { Ref } from "react";
import { useSearchParams } from "react-router";
import { SHORTCUT } from "@/app/shortcuts";
import { useI18n } from "@/i18n";
import { Button, SearchField, Segmented, Select, Toolbar } from "@/ui";
import { newInstanceParams } from "@/lib/routes";
import { ALL_LOADERS, LOADER_LABELS } from "@/lib/types";
import type { LibraryFilters, Sort } from "./libraryModel";
import type { LibraryView } from "./useLibraryView";

/** „Neue Instanz“: öffnet den Dialog über die Adresse (derselbe Weg wie Strg+N). */
export function NewInstanceButton() {
  const { t } = useI18n();
  const [, setParams] = useSearchParams();
  return (
    <Button variant="primary" icon="plus" aria-keyshortcuts={SHORTCUT.newInstance} onClick={() => setParams(newInstanceParams(), { replace: true })}>
      {t("components.newInstance.title")}
    </Button>
  );
}

/**
 * Werkzeugleiste der Bibliothek: Suche, Loader, Minecraft-Version, Sortierung, Ansicht, „Auswählen“ und „Neue Instanz“.
 * Sie bricht um (pixelkino.css), sobald der Platz fehlt, statt Bedienelemente zu verlieren; „Neue Instanz“ bleibt rechts.
 */
export function LibraryToolbar({ filters, onFilters, versions, view, onPick, pickRef }: {
  filters: LibraryFilters;
  onFilters: (patch: Partial<LibraryFilters>) => void;
  /** Minecraft-Versionen der Instanzen, aus denen der Filter wählen lässt. */
  versions: string[];
  view: LibraryView;
  /** Auswahlmodus starten. */
  onPick: () => void;
  pickRef: Ref<HTMLButtonElement>;
}) {
  const { t } = useI18n();
  return (
    // Abstände: 16 über, 18 unter der Werkzeugleiste
    <Toolbar search="m" className="lib-toolbar mt-4 mb-4.5">
      <SearchField value={filters.query} onChange={(query) => onFilters({ query })} placeholder={t("pages.instances.searchPlaceholder")} />
      <Select
        label={t("components.common.loader")}
        value={filters.loader}
        onChange={(loader) => onFilters({ loader: loader as LibraryFilters["loader"] })}
        options={[{ value: "all", label: t("common.all") }, ...ALL_LOADERS.map((l) => ({ value: l, label: LOADER_LABELS[l] }))]}
      />
      <Select
        label={t("common.version")}
        value={filters.version}
        onChange={(version) => onFilters({ version })}
        options={[{ value: "all", label: t("common.all") }, ...versions.map((v) => ({ value: v, label: v }))]}
      />
      <Select
        label={t("pages.instances.sortLabel")}
        value={view.sort}
        onChange={(sort) => view.setSort(sort as Sort)}
        options={[
          { value: "recent", label: t("pages.instances.colLastPlayed") },
          { value: "name", label: t("common.name") },
          { value: "created", label: t("pages.instances.sortCreated") },
          { value: "playtime", label: t("pages.instances.colPlaytime") },
        ]}
      />
      <Segmented
        iconsOnly
        label={t("pages.instances.viewLabel")}
        value={view.mode}
        onChange={view.setMode}
        items={[
          { value: "poster", label: t("pages.instances.viewPoster"), icon: "grid" },
          { value: "list", label: t("pages.instances.viewList"), icon: "list" },
        ]}
      />
      <Button ref={pickRef} icon="check" onClick={onPick}>{t("pages.instances.pick")}</Button>
      <NewInstanceButton />
    </Toolbar>
  );
}
