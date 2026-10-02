import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { create } from "zustand";
import { useI18n } from "@/i18n";
import { t as translate } from "@/i18n/core";
import { api } from "@/lib/api";
import { catalogApi } from "@/lib/catalogApi";
import type { ContentVersion, Source } from "@/lib/content-types";
import type { Instance, ModpackOrigin, PackTarget, PackUpdateOutcome } from "@/lib/types";
import { useBackgroundTask } from "./useBackgroundTask";
import { packProject } from "./usePackIconUrl";
import { lifecycleKeys } from "./queryKeys";
import { CATALOG_STALE_MS } from "./staleTimes";

/** Versions-ID der installierten Pack-Version; Packs aus einer Datei haben keine. */
export function installedPackVersion(origin: ModpackOrigin | null): string | null {
  switch (origin?.type) {
    case "modrinth":
    case "provider":
      return origin.versionId;
    case "curseforge":
      return String(origin.fileId);
    default:
      return null;
  }
}

/** Was über das Modpack einer Instanz bekannt ist; Name und Versionen kommen bei Katalog-Packs aus dem Netz. */
export interface PackStatus {
  /** Katalog-Quelle; null bei einem Pack aus einer Datei. */
  source: Source | null;
  name: string | null;
  /** Installierte Version, wie das Pack sie nennt. */
  version: string | null;
  /** Alle Versionen, neueste zuerst. */
  versions: ContentVersion[];
  /** Neuestes Release nach der installierten Version, sonst null. */
  latest: ContentVersion | null;
  loading: boolean;
  error: Error | null;
}

/** Pack einer Instanz samt verfügbarer Updates; null bei Instanzen ohne Modpack. */
export function usePackStatus(instance: Instance): PackStatus | null {
  const origin = instance.modpack;
  const pack = packProject(origin);
  const catalog = catalogApi(pack?.source ?? "modrinth");
  const project = useQuery({ ...catalog.projectQuery(pack?.projectId ?? ""), enabled: !!pack });
  const versions = useQuery({ ...catalog.versionsQuery(pack?.projectId ?? ""), enabled: !!pack });
  if (!origin) return null;
  if (origin.type === "file") {
    return { source: null, name: origin.name || null, version: origin.version || null, versions: [], latest: null, loading: false, error: null };
  }
  const list = versions.data ?? [];
  const at = list.findIndex((v) => v.id === installedPackVersion(origin));
  const newer = at > 0 ? list.slice(0, at) : [];
  return {
    source: pack?.source ?? null,
    name: project.data?.title ?? null,
    version: at >= 0 ? list[at].version_number : null,
    versions: list,
    latest: newer.find((v) => v.version_type === "release") ?? null,
    loading: !!pack && (project.isPending || versions.isPending),
    error: versions.error,
  };
}

/** Änderungsprotokoll einer Pack-Version; null, wo die Quelle keins führt. */
export function usePackChangelog(instanceId: string, versionId: string | null) {
  return useQuery({
    queryKey: lifecycleKeys.changelog(instanceId, versionId ?? ""),
    queryFn: () => api.packChangelog(instanceId, versionId!),
    enabled: !!versionId,
    staleTime: CATALOG_STALE_MS,
    retry: false,
  });
}

/** Ergebnis des letzten Pack-Updates je Instanz, solange die App läuft (für die Zusammenfassung in den Einstellungen). */
export const usePackReports = create<Record<string, PackUpdateOutcome>>(() => ({}));

/** „Neu: 2 · Aktualisiert: 40 · …“; leere Posten fallen weg. */
export function changesLine({ changes, worldBackups }: PackUpdateOutcome): string {
  const counts = [
    ["added", changes.added.length],
    ["updated", changes.updated.length],
    ["removed", changes.removed.length],
    ["kept", changes.kept.length],
    ["worlds", worldBackups],
  ] as const;
  const parts = counts.filter(([, n]) => n > 0).map(([key, n]) => translate(`detail.pack.summary.${key}`, { n }));
  return parts.join(" · ") || translate("detail.pack.summary.nothing");
}

/** Pack-Update im Hintergrund: Fortschritt und „Abbrechen“ im Aufgaben-Menü, danach die Zusammenfassung als Toast. */
export function usePackUpdate(instance: Instance) {
  const { t } = useI18n();
  const { run, isPending } = useBackgroundTask();
  const start = (target: PackTarget) =>
    run({
      key: `pack:${instance.id}`,
      label: t("detail.pack.updateTask", { name: instance.name }),
      doneLabel: t("detail.pack.updateTaskDone", { name: instance.name }),
      cancellable: true,
      task: async (operationId) => {
        const outcome = await api.packUpdate(instance.id, target, operationId);
        usePackReports.setState({ [instance.id]: outcome });
        toast.success(t("detail.pack.updatedToast", { name: instance.name }), { description: changesLine(outcome) });
        return outcome.instance;
      },
    });
  return { start, isPending };
}
