import { useEffect, useEffectEvent } from "react";
import { useNavigate } from "react-router";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { SOURCES, type CatalogType, type Source } from "@/lib/content-types";
import type { DeepLinkRequest } from "@/lib/deep-link-types";
import { discoverUrl, instanceUrl } from "@/lib/routes";
import { toastError } from "@/lib/toast";
import type { Instance } from "@/lib/types";
import { askToLaunch } from "@/store/launchAsks";
import { usePlay } from "./usePlay";

/** Die Instanz, die ein Link nennt; gibt es sie nicht (mehr), ist das ein Fehler mit klarer Meldung. */
async function instanceOf(instanceId: string): Promise<Instance> {
  const instance = (await api.listInstances()).find((candidate) => candidate.id === instanceId);
  if (!instance) throw new Error(t("deepLinks.instanceMissing"));
  return instance;
}

/** Die Art, unter der `source` das Projekt führt; eine, die der Launcher nicht installieren kann, ist ein Fehler. */
function installableType(source: Source, projectType: string): CatalogType {
  const type = SOURCES[source].types.find((candidate) => candidate === projectType);
  if (!type) throw new Error(t("deepLinks.unsupportedProject", { type: projectType }));
  return type;
}

/**
 * Führt die Links aus, die von außen kommen (Backend: `deep_link.rs`). Ein Start fragt immer nach, außer der Link stammt aus
 * einer Verknüpfung des Nutzers (`trusted`); Installationen öffnen nur die Seite des Projekts, dort entscheidet der Nutzer.
 */
function useDeepLinkHandler() {
  const navigate = useNavigate();
  const play = usePlay();

  async function launch(request: Extract<DeepLinkRequest, { type: "launch" }>) {
    const instance = await instanceOf(request.instanceId);
    if (request.trusted) await play(instance, undefined, request.quickPlay);
    else askToLaunch({ instance, quickPlay: request.quickPlay });
  }

  async function openInstance(instanceId: string) {
    await instanceOf(instanceId);
    navigate(instanceUrl(instanceId));
  }

  /** `hint` ist die Art laut Link; Modrinth nennt Shader und Ressourcenpakete dort auch `mod`, deshalb gilt die des Projekts. */
  async function openModrinthProject(hint: CatalogType, slugOrId: string) {
    // Scheitert die Abfrage (offline), zeigt die Projektseite den Fehler selbst, mit der Art laut Link.
    const project = await api.modrinthProject(slugOrId).catch(() => null);
    const tab = project ? installableType("modrinth", project.project_type) : hint;
    navigate(discoverUrl({ tab, project: project?.id ?? slugOrId }));
  }

  async function openCurseforgeProject(addonId: number) {
    const project = await api.providerProject("curseforge", String(addonId));
    const tab = installableType("curseforge", project.project_type);
    navigate(discoverUrl({ tab, project: String(addonId), projectSource: "curseforge" }));
  }

  return (request: DeepLinkRequest): Promise<void> => {
    switch (request.type) {
      case "launch":
        return launch(request);
      case "open":
        return openInstance(request.instanceId);
      case "installModrinth":
        return openModrinthProject(request.contentType, request.project);
      case "installCurseforge":
        return openCurseforgeProject(request.addonId);
    }
  };
}

/** Holt die wartenden Links beim Start und bei jedem weiteren (`deep-link-opened`) ab und führt sie aus. */
export function useDeepLinkRequests() {
  const handle = useDeepLinkHandler();
  const runWaitingLinks = useEffectEvent(() => {
    api.takeDeepLinks().then((requests) => requests.forEach((request) => void handle(request).catch(toastError))).catch(toastError);
  });
  useEffect(() => {
    runWaitingLinks();
    const unlisten = api.onDeepLinkOpened(runWaitingLinks);
    return () => void unlisten.then((stop) => stop());
  }, []);
}
