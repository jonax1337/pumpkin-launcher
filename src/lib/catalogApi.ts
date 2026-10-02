import { queryOptions } from "@tanstack/react-query";
import { catalogKeys } from "@/hooks/queryKeys";
import { CATALOG_STALE_MS } from "@/hooks/staleTimes";
import { api } from "./api";
import type { ModInstall, PackInstall, SearchOptions, VersionFilter } from "./backend";
import type { ContentProject, ContentSearch, ContentVersion, Source } from "./content-types";
import type { Instance } from "./types";

/** Alle Versionen eines Projekts, ohne Einschränkung auf Minecraft-Version oder Loader. */
export const ALL_VERSIONS: VersionFilter = { mc: null, loader: null };

/** Was jede Katalog-Quelle kann; Modrinth und die Anbieter ohne Schlüssel unterscheiden sich nur in den Backend-Aufrufen. */
interface CatalogBackend {
  project(projectId: string): Promise<ContentProject>;
  versions(projectId: string, filter: VersionFilter): Promise<ContentVersion[]>;
  search(options: SearchOptions): Promise<ContentSearch>;
  installMod(mod: ModInstall, operationId: string): Promise<Instance>;
  installPack(pack: PackInstall, operationId: string): Promise<Instance>;
}

const modrinthBackend: CatalogBackend = {
  project: (projectId) => api.modrinthProject(projectId),
  versions: (projectId, { mc, loader }) => api.modrinthVersions(projectId, mc, loader),
  search: (options) => api.modrinthSearch(options),
  installMod: ({ instanceId, versionId }, operationId) => api.modrinthInstallMod(instanceId, versionId, operationId),
  installPack: ({ versionId, name }, operationId) => api.modrinthInstallPack(versionId, name, operationId),
};

const providerBackend = (source: Source): CatalogBackend => ({
  project: (projectId) => api.providerProject(source, projectId),
  versions: (projectId, filter) => api.providerVersions(source, projectId, filter),
  search: (options) => api.providerSearch(source, options),
  installMod: (mod, operationId) => api.providerInstallMod(source, mod, operationId),
  installPack: (pack, operationId) => api.providerInstallPack(source, pack, operationId),
});

/**
 * Der Katalog einer Quelle: Abfragen samt Query-Schlüssel und die Installationen. Wer Projekte, Versionen oder Treffer
 * braucht, fragt hier, statt je nach Quelle zwischen Modrinth- und Anbieter-Aufrufen zu wählen.
 */
export function catalogApi(source: Source) {
  const backend = source === "modrinth" ? modrinthBackend : providerBackend(source);
  return {
    /** Anbieter ohne Schlüssel (nicht Modrinth): Ihre Versionen kennen die Datei-URL erst nach dem Abruf. */
    isProvider: source !== "modrinth",
    installMod: backend.installMod,
    installPack: backend.installPack,
    search: backend.search,
    projectQuery: (projectId: string) =>
      queryOptions({
        queryKey: catalogKeys.project(source, projectId),
        queryFn: () => backend.project(projectId),
        staleTime: CATALOG_STALE_MS,
        retry: false,
      }),
    versionsQuery: (projectId: string, filter: VersionFilter = ALL_VERSIONS) =>
      queryOptions({
        queryKey: catalogKeys.versions(source, projectId, filter.mc, filter.loader),
        queryFn: () => backend.versions(projectId, filter),
        staleTime: CATALOG_STALE_MS,
        retry: false,
      }),
  };
}
