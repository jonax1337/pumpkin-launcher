import { useQuery } from "@tanstack/react-query";
import { catalogApi } from "@/lib/catalogApi";
import { SOURCE_KEYS, type Source } from "@/lib/content-types";
import type { Instance, ModpackOrigin } from "@/lib/types";

type PackProject = { source: Source; projectId: string };

/** Das Katalog-Projekt, aus dem die Instanz stammt; `null` bei Instanzen ohne Modpack oder aus einer Datei. */
export function packProject(modpack: ModpackOrigin | null): PackProject | null {
  if (modpack?.type === "modrinth") return { source: "modrinth", projectId: modpack.projectId };
  if (modpack?.type === "curseforge") return { source: "curseforge", projectId: String(modpack.projectId) };
  if (modpack?.type !== "provider") return null;
  const source = SOURCE_KEYS.find((key) => key === modpack.source);
  return source ? { source, projectId: modpack.projectId } : null;
}

/**
 * Adresse des Modpack-Icons, aus dem die Instanz stammt; `undefined` ohne Pack, ohne Icon und solange nichts geladen ist (offline).
 * Wird nur angezeigt und nie auf die Platte geschrieben: bei CurseForge verbieten die API-Bedingungen das Zwischenspeichern.
 */
export function usePackIconUrl(instance: Instance): string | undefined {
  const pack = packProject(instance.modpack);
  const project = useQuery({ ...catalogApi(pack?.source ?? "modrinth").projectQuery(pack?.projectId ?? ""), enabled: !!pack });
  return project.data?.icon_url ?? undefined;
}
