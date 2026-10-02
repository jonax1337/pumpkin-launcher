import type { Instance, ModLoader } from "@/lib/types";

export type Sort = "recent" | "name" | "created" | "playtime";

/** Was Suche, Loader- und Versionsfilter der Bibliothek gerade vorgeben; „all“ = kein Filter. */
export type LibraryFilters = { query: string; loader: ModLoader | "all"; version: string };

export const NO_FILTERS: LibraryFilters = { query: "", loader: "all", version: "all" };

/** Ein Abschnitt der Bibliothek: Gruppe (`null` = ohne Gruppe) und ihre Instanzen. */
export type Section = [group: string | null, members: Instance[]];

/** Schränkt irgendein Filter die Liste ein? */
export const hasFilters = ({ query, loader, version }: LibraryFilters) => query.trim() !== "" || loader !== "all" || version !== "all";

/** Erfüllt die Instanz Suche (Name oder Minecraft-Version), Loader und Version? */
export function matchesFilters(instance: Instance, { query, loader, version }: LibraryFilters): boolean {
  const needle = query.trim().toLowerCase();
  const matchesText = !needle || instance.name.toLowerCase().includes(needle) || instance.minecraftVersion.includes(needle);
  return matchesText && (loader === "all" || instance.loader === loader) && (version === "all" || instance.minecraftVersion === version);
}

/** Minecraft-Versionen der Instanzen, die höchste zuerst. */
export function versionsOf(instances: Instance[]): string[] {
  return [...new Set(instances.map((i) => i.minecraftVersion))].sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
}

/** Gruppen in der gewählten Reihenfolge; Neue ohne Platz in `order` folgen in der Reihenfolge von `groups`. */
export function orderedGroups(groups: string[], order: string[]): string[] {
  const known = order.filter((group) => groups.includes(group));
  return [...known, ...groups.filter((group) => !known.includes(group))];
}

/** Abschnitte je Gruppe in der Reihenfolge von `groups`, Instanzen ohne Gruppe zuletzt; leere Abschnitte entfallen. */
export function sectionsOf(instances: Instance[], groups: string[]): Section[] {
  const sections = groups
    .map((group): Section => [group, instances.filter((i) => i.group === group)])
    .filter(([, members]) => members.length > 0);
  const withoutGroup = instances.filter((i) => !i.group);
  return withoutGroup.length ? [...sections, [null, withoutGroup]] : sections;
}

/** `groups` mit `group` um einen Platz verschoben (`step` -1 = nach vorn, 1 = nach hinten); am Rand unverändert. */
export function movedGroup(groups: string[], group: string, step: -1 | 1): string[] {
  const from = groups.indexOf(group);
  const to = from + step;
  if (from < 0 || to < 0 || to >= groups.length) return groups;
  const moved = [...groups];
  [moved[from], moved[to]] = [moved[to], moved[from]];
  return moved;
}

/** Die Ids von `from` bis `to` (beide eingeschlossen) in der Reihenfolge von `ids`; leer, wenn eine fehlt. */
export function rangeBetween(ids: string[], from: string, to: string): string[] {
  const start = ids.indexOf(from);
  const end = ids.indexOf(to);
  if (start < 0 || end < 0) return [];
  return ids.slice(Math.min(start, end), Math.max(start, end) + 1);
}
