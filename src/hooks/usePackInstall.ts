import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { t } from "@/i18n";
import { catalogApi } from "@/lib/catalogApi";
import type { ProjectRef, Source } from "@/lib/content-types";
import { errorMessage } from "@/lib/errors";
import { pickPackVersion } from "@/lib/mods";
import { progressLabel, progressShare } from "@/lib/progress";
import { instanceUrl } from "@/lib/routes";
import type { Instance } from "@/lib/types";
import { useContentQueue } from "@/store/contentQueue";
import { useContentState } from "@/store/contentState";
import { enqueueContent, mustWait } from "./contentQueue";
import { cancelContent, startContentInstall, withTarget } from "./useContent";

interface PackInstallOptions {
  /** Das Modpack; `null`, solange noch keines gewählt ist (dann tut `run` nichts). */
  pack: ProjectRef | null;
  source: Source;
  /** Wird zusätzlich zum Toast mit „Öffnen“ aufgerufen, sobald die Instanz fertig ist. */
  onDone?: (instance: Instance) => void;
}

/** Eine bestimmte Version und ein eigener Name; ohne Angabe die neueste stabile Version mit dem Titel des Packs. */
interface PackRun {
  versionId?: string;
  name?: string;
}

/**
 * Modpack als neue Instanz; ohne `versionId` die neueste stabile Version mit unterstütztem Loader. Läuft schon ein
 * Vorgang, wird das Pack vorgemerkt und startet danach. Fertig meldet ein Toast mit „Öffnen“; die App springt nicht von allein.
 */
export function useInstallPack({ pack, source, onDone }: PackInstallOptions) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const { active, target, progress } = useContentState();
  const queued = useContentQueue((state) => !!pack && state.jobs.some((job) => job.target === pack.id));

  /** Die Version, die zu installieren ist; `undefined` nach einer Meldung an den Nutzer. */
  async function chooseVersion(project: ProjectRef): Promise<string | undefined> {
    setChecking(true);
    try {
      const picked = pickPackVersion(await qc.fetchQuery(catalogApi(source).versionsQuery(project.id)));
      if (picked.reason) toast.error(t("components.pack.cannotInstall", { name: project.title }), { description: picked.reason });
      return picked.version?.id;
    } catch (err) {
      toast.error(t("components.content.loadFailed", { name: project.title }), { description: errorMessage(err) });
    } finally {
      setChecking(false);
    }
  }

  function reportReady(instance: Instance) {
    toast.success(t("components.pack.readyToast", { name: instance.name }), {
      action: { label: t("common.open"), onClick: () => navigate(instanceUrl(instance.id)) },
    });
    onDone?.(instance);
  }

  function enqueue(project: ProjectRef, versionId: string, name: string) {
    const label = t("components.pack.installTask", { name });
    const run = withTarget(project.id, (operationId) => catalogApi(source).installPack({ projectId: project.id, versionId, name }, operationId), label, {
      cancellable: true,
      doneLabel: t("components.pack.installTaskDone", { name }),
    });
    if (mustWait()) toast(t("components.pack.queuedToast", { name }));
    enqueueContent({ target: project.id, label, start: () => startContentInstall(run, reportReady) });
  }

  /** Legt den Auftrag an (Version wählen, vormerken oder starten); `false`, wenn es nichts anzulegen gab oder keine Version passt. */
  async function run({ versionId, name }: PackRun = {}) {
    if (!pack) return false;
    const id = versionId ?? (await chooseVersion(pack));
    if (id) enqueue(pack, id, name ?? pack.title);
    return !!id;
  }

  const running = !!pack && !!active && target === pack.id;
  const busy = checking ? t("components.common.checking") : running ? progressLabel(progress).replace(/…$/, "") : null;
  return { run, busy, queued, p: checking ? null : progressShare(progress), blocked: checking || queued || running, cancel: !checking && busy ? cancelContent : undefined };
}
