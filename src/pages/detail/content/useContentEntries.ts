import { useMemo } from "react";
import { useI18n } from "@/i18n";
import { sortRows, type ContentSort } from "@/lib/contentSort";
import type { FileFacts, Mod } from "@/lib/types";
import { insertGhosts } from "./ghosts";
import { orderByDependency } from "./orderByDependency";
import type { Entry, Ghost, KindFilter, Row } from "./types";

/** Was die Liste für ihre Einträge braucht: Namen, Dateiangaben, Rang des Status und was die Suche und der Filter wollen. */
type EntrySettings = {
  mods: Mod[];
  ghosts: Ghost[];
  titleOf: (mod: Mod) => string;
  /** Ändert sich mit den geladenen Projekten (Titel), damit die Reihenfolge neu entsteht. */
  titles: unknown;
  facts: Map<string, FileFacts>;
  statusRank: (mod: Mod) => number;
  sort: ContentSort;
  kind: KindFilter;
  /** Kleingeschriebener Suchtext, auch über den Dateinamen; leer = alles. */
  needle: string;
};

/**
 * Einträge der Inhaltsliste: sortiert, mit Platzhaltern für Entferntes, gefiltert nach Art und Suchtext. `entries` ist
 * alles (die Stellen der Platzhalter beziehen sich darauf), `visible` das, was die Liste zeigt.
 */
export function useContentEntries({ mods, ghosts, titleOf, titles, facts, statusRank, sort, kind, needle }: EntrySettings) {
  const { resolved: language } = useI18n();
  // Die Reihenfolge nach Abhängigkeiten ist aufwendig und ändert sich nur mit den Inhalten, nicht mit Auswahl oder Suche.
  const dependencyOrder = useMemo(() => orderByDependency(mods), [mods]);
  const ordered = useMemo(
    () => dependencyOrder.map(({ mod, owners }): Row => ({ type: "row", mod, owners: owners.map(titleOf) })),
    // `titleOf` liest nur die geladenen Projekte, `titles` gibt ihren Stand an.
    [dependencyOrder, titles],
  );
  const entries = insertGhosts(sortRows(ordered, sort, { titleOf, facts, statusRank, language }), ghosts);
  const matches = (e: Entry) =>
    (kind === "all" || e.mod.kind === kind) &&
    (!needle || (e.type === "row" ? `${titleOf(e.mod)}\n${e.mod.fileName}` : e.title).toLowerCase().includes(needle));
  return { entries, visible: entries.filter(matches) };
}
