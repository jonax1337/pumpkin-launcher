import type { ReactNode, Ref } from "react";
import { useSearchParams } from "react-router";
import { SHORTCUT } from "@/app/shortcuts";
import { useI18n } from "@/i18n";
import { Button, SearchField, Select, Spacer, Toolbar } from "@/ui";
import { newInstanceParams } from "@/lib/routes";
import { ALL_LOADERS, LOADER_LABELS } from "@/lib/types";
import type { LibraryFilters, Sort } from "./libraryModel";

/** Fenster bis einschließlich 1280 px: Auswahlfelder ohne Beschriftung, damit „Auswählen“ nicht allein umbricht. */
const HIDE_LABEL = "le-1280:hidden";

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
 * Suche, Filter, Sortierung und Auswahlmodus; die Leiste bricht bei Platzmangel um.
 * Im Auswahlmodus (`picking`) steht `bar` als zweite Leiste im selben Platz.
 */
export function LibraryToolbar({ filters, onFilters, versions, sort, onSort, onPick, pickRef, picking, bar }: {
  filters: LibraryFilters;
  onFilters: (patch: Partial<LibraryFilters>) => void;
  /** Minecraft-Versionen der Instanzen, aus denen der Filter wählen lässt. */
  versions: string[];
  sort: Sort;
  onSort: (sort: Sort) => void;
  /** Auswahlmodus starten. */
  onPick: () => void;
  pickRef: Ref<HTMLButtonElement>;
  picking: boolean;
  bar: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Toolbar search="m" searchWrap altActive={picking} alt={bar}>
      <SearchField value={filters.query} onChange={(query) => onFilters({ query })} placeholder={t("pages.instances.searchPlaceholder")} />
      <Select
        label={t("components.common.loader")}
        labelClassName={HIDE_LABEL}
        value={filters.loader}
        onChange={(loader) => onFilters({ loader: loader as LibraryFilters["loader"] })}
        options={[{ value: "all", label: t("common.all") }, ...ALL_LOADERS.map((l) => ({ value: l, label: LOADER_LABELS[l] }))]}
      />
      <Select
        label={t("common.version")}
        labelClassName={HIDE_LABEL}
        value={filters.version}
        onChange={(version) => onFilters({ version })}
        options={[{ value: "all", label: t("common.all") }, ...versions.map((v) => ({ value: v, label: v }))]}
      />
      <Select
        label={t("pages.instances.sortLabel")}
        labelClassName={HIDE_LABEL}
        value={sort}
        onChange={(value) => onSort(value as Sort)}
        options={[
          { value: "recent", label: t("pages.instances.colLastPlayed") },
          { value: "name", label: t("common.name") },
          { value: "created", label: t("pages.instances.sortCreated") },
          { value: "playtime", label: t("pages.instances.colPlaytime") },
        ]}
      />
      <Spacer />
      <Button ref={pickRef} icon="select" onClick={onPick}>{t("pages.instances.pick")}</Button>
    </Toolbar>
  );
}
