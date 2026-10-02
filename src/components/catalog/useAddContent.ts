import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { t } from "@/i18n";
import { openManualDownloads } from "@/components/ManualDownloads";
import { enqueueContent } from "@/hooks/contentQueue";
import { worldKeys } from "@/hooks/queryKeys";
import { startContentInstall, withTarget } from "@/hooks/useContent";
import { api } from "@/lib/api";
import { catalogApi } from "@/lib/catalogApi";
import type { CatalogType, ContentVersion, ProjectRef, Source } from "@/lib/content-types";
import { errorMessage } from "@/lib/errors";
import { pickVersion } from "@/lib/mods";
import { instanceUrl, type InstanceTab } from "@/lib/routes";
import { ACTION_TOAST_MS } from "@/lib/toast";
import { LOADER_LABELS, type Instance, type World } from "@/lib/types";
import { fitFilter } from "./fit";
import { hasIris, IRIS_PROJECT_ID, irisSupported } from "./iris";

export interface AddRequest {
  instance: Instance;
  project: ProjectRef;
  type: CatalogType;
  source: Source;
  /** Datenpaket in diese Welt der Instanz. */
  world?: World;
  /** Diese Version statt der automatisch gewählten. */
  versionId?: string;
  /** Der Toast bekommt „Ansehen“ (Instanz, Tab Inhalte bzw. Welten). */
  openAction?: boolean;
}

/** „missing“ = keine Version für diese Instanz, „blocked“ = nur von Hand ladbar (CurseForge), „error“ = Versionen nicht ladbar. */
export type AddResult = "ok" | "missing" | "blocked" | "error";

/**
 * Datenpaket in die Welt. Der Lauf gibt die Instanz unverändert zurück (keine Abhängigkeiten), damit Fortschritt und
 * Aufgaben-Menü wie bei Mods laufen. Die Liste der Welt wird hier aufgefrischt, nicht erst im Erfolgs-Callback, der
 * bei einer inzwischen verlassenen Seite nicht mehr läuft.
 */
const installDatapack = async (qc: QueryClient, instance: Instance, world: World, versionId: string, operationId: string) => {
  await api.datapackInstall(instance.id, world.id, versionId, operationId);
  void qc.invalidateQueries({ queryKey: worldKeys.datapacks(instance.id, world.id) });
  return instance;
};

/** Wohin ein Inhalt kam: in die Welt (Tab Welten) oder in die Instanz (Tab Inhalte). */
const destination = (instance: Instance, world?: World): { label: string; tab: InstanceTab } =>
  world ? { label: t("components.content.destinationWorld", { world: world.name, instance: instance.name }), tab: "worlds" } : { label: instance.name, tab: "content" };

/** Die zu installierende Version; ohne `id` gibt es keine passende. `picked` trägt bei Anbietern ihre Daten (Datei-URL). */
interface ResolvedVersion {
  id?: string;
  picked?: ContentVersion;
}

/** Die Version aus `versionId` oder, ohne, die passende zur Instanz. */
async function resolveVersion(qc: QueryClient, { instance, project, type, source, versionId }: AddRequest): Promise<ResolvedVersion> {
  const catalog = catalogApi(source);
  if (!versionId) {
    const picked = pickVersion(await qc.fetchQuery(catalog.versionsQuery(project.id, fitFilter(instance, type)))) ?? undefined;
    return { id: picked?.id, picked };
  }
  if (!catalog.isProvider) return { id: versionId };
  const picked = (await qc.fetchQuery(catalog.versionsQuery(project.id))).find((v) => v.id === versionId);
  return { id: versionId, picked };
}

/** CurseForge: Die Autoren erlauben den Download nur über die Webseite. Nicht umgehen, sondern beim Laden von Hand helfen. */
async function offerManualDownload(qc: QueryClient, { instance, project, source }: AddRequest, versionId: string, picked: ContentVersion) {
  const page = await qc.fetchQuery(catalogApi(source).projectQuery(project.id)).then((p) => p.web_url).catch(() => null);
  openManualDownloads({
    instanceId: instance.id,
    instanceName: instance.name,
    items: [{
      projectId: Number(project.id),
      fileId: Number(versionId),
      name: project.title,
      fileName: picked.files[0]?.filename ?? project.title,
      url: page ?? `https://www.curseforge.com/minecraft/search?search=${encodeURIComponent(project.title)}`,
    }],
  });
}

/** Iris als Mod für eine Instanz, die Shader hat, aber keine Iris. */
const IRIS_REQUEST = { project: { id: IRIS_PROJECT_ID, title: "Iris Shaders" }, type: "mod", source: "modrinth" } as const;

/**
 * Wählt die passende Version automatisch (oder nimmt `versionId`) und installiert mit Abhängigkeiten, Datenpakete in
 * die Welt `world`. Mehrere Aufträge laufen nacheinander (Warteschlange im Aufgaben-Menü). Ein Shader ohne Iris in der
 * Instanz kommt mit dem Angebot, Iris nachzuinstallieren.
 */
export function useAddContent() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  function reportAdded({ project, world, openAction, type }: AddRequest, result: Instance, before: number) {
    const extra = result.mods.length - before - 1;
    const deps = extra > 0 ? t(extra === 1 ? "components.content.deps.one" : "components.content.deps.other", { n: extra }) : "";
    if (!openAction) toast.success(t("components.content.added", { name: project.title }) + deps);
    else {
      const { label, tab } = destination(result, world);
      toast.success(t("components.content.nowIn", { name: project.title, target: label }) + deps, {
        action: { label: t("components.content.viewAction"), onClick: () => navigate(instanceUrl(result.id, tab)) },
      });
    }
    if (type === "shader" && !hasIris(result)) offerIris(result);
  }

  function offerIris(instance: Instance) {
    if (!irisSupported(instance)) {
      toast.warning(t("components.content.irisUnsupported", { loader: LOADER_LABELS[instance.loader] }), {
        description: t("components.content.shaderAlternative"),
        duration: ACTION_TOAST_MS,
      });
      return;
    }
    toast.warning(t("components.content.irisMissingIn", { instance: instance.name }), {
      description: t("components.content.shaderNeedsIris"),
      duration: ACTION_TOAST_MS,
      action: { label: t("components.content.installIris"), onClick: () => void installIris(instance) },
    });
  }

  async function installIris(instance: Instance) {
    const result = await add({ ...IRIS_REQUEST, instance, openAction: true });
    if (result === "missing") toast.error(t("components.content.notForMc", { name: IRIS_REQUEST.project.title, version: instance.minecraftVersion }));
  }

  function startInstall(request: AddRequest, versionId: string) {
    const { instance, project, source, world } = request;
    const before = instance.mods.length;
    const label = t("components.content.installTaskIn", { name: project.title, target: destination(instance, world).label });
    const run = withTarget(
      project.id,
      (operationId) =>
        world
          ? installDatapack(qc, instance, world, versionId, operationId)
          : catalogApi(source).installMod({ instanceId: instance.id, projectId: project.id, versionId }, operationId),
      label,
      { doneLabel: t("components.content.installTaskDone", { name: project.title }) },
    );
    enqueueContent({ target: project.id, label, start: () => startContentInstall(run, (result) => reportAdded(request, result, before)) });
  }

  const add = async (request: AddRequest): Promise<AddResult> => {
    let found: ResolvedVersion;
    try {
      found = await resolveVersion(qc, request);
    } catch (err) {
      toast.error(t("components.content.loadFailed", { name: request.project.title }), { description: errorMessage(err) });
      return "error";
    }
    if (!found.id) return "missing";
    if (found.picked && catalogApi(request.source).isProvider && !found.picked.files[0]?.url) {
      await offerManualDownload(qc, request, found.id, found.picked);
      return "blocked";
    }
    startInstall(request, found.id);
    return "ok";
  };
  return add;
}
