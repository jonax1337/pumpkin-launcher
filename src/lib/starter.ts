import { queryOptions } from "@tanstack/react-query";
import { catalogKeys } from "@/hooks/queryKeys";
import { CATALOG_STALE_MS } from "@/hooks/staleTimes";
import { api } from "./api";
import type { CatalogHit, CatalogType, ContentProject } from "./content-types";

/**
 * „Zum Einstieg“: bekannte, viel genutzte Modrinth-Projekte je Katalogart (Adressnamen). Eine feste Auswahl ohne
 * Anspruch auf Eignung oder Jugendschutz; sie bleibt klein und ändert sich nur bewusst.
 */
const STARTER_PICKS: Partial<Record<CatalogType, string[]>> = {
  modpack: ["fabulously-optimized", "better-mc-fabric-bmc2", "cobblemon-fabric"],
  mod: ["sodium", "iris", "fabric-api", "modmenu", "lithium", "ferrite-core", "entityculling", "appleskin", "xaeros-minimap", "jei"],
  shader: ["complementary-reimagined", "bsl-shaders", "complementary-unbound"],
  resourcepack: ["faithful-32x", "fresh-animations", "default-dark-mode"],
};

export const hasStarter = (type: CatalogType) => !!STARTER_PICKS[type];

/** Ein Projekt wie ein Suchtreffer; der Autor kennt die Projektabfrage nicht. */
const asHit = (project: ContentProject): CatalogHit => ({
  project_id: project.id,
  slug: project.slug,
  title: project.title,
  description: project.description,
  icon_url: project.icon_url,
  project_type: project.project_type,
  downloads: project.downloads,
  author: "",
  categories: project.categories,
  source: "modrinth",
});

/** Die Einstiegsauswahl einer Art in der festen Reihenfolge; was Modrinth nicht (mehr) kennt, fehlt einfach. */
export const starterQuery = (type: CatalogType) =>
  queryOptions({
    queryKey: catalogKeys.starter(type),
    queryFn: async () => {
      const slugs = STARTER_PICKS[type] ?? [];
      const projects = await api.modrinthProjects(slugs);
      return slugs.flatMap((slug) => projects.filter((p) => p.slug === slug && p.project_type === type).map(asHit));
    },
    staleTime: CATALOG_STALE_MS,
    retry: false,
  });
