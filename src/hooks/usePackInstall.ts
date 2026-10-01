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
import { useContentState } from "@/store/contentState";
import { useBackgroundTask } from "./useBackgroundTask";
import { cancelContent } from "./useContent";

interface PackInstallOptions {
  /** Das Modpack; `null`, solange noch keines gewählt ist (dann tut `run` nichts). */
  pack: ProjectRef | null;
  source: Source;
  /** Statt zur Instanz zu navigieren: dem Aufrufer die fertige Instanz geben. */
  onDone?: (instance: Instance) => void;
}

/** Eine bestimmte Version und ein eigener Name; ohne Angabe die neueste stabile Version mit dem Titel des Packs. */
interface PackRun {
  versionId?: string;
  name?: string;
}

/** Modpack als neue Instanz; ohne `versionId` die neueste stabile Version mit unterstütztem Loader. */
export function useInstallPack({ pack, source, onDone }: PackInstallOptions) {
  const qc = useQueryClient();
  const background = useBackgroundTask();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const { active, target, progress } = useContentState();

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

  function install(project: ProjectRef, versionId: string, name: string) {
    background.run({
      key: project.id,
      label: t("components.pack.installTask", { name }),
      doneLabel: t("components.pack.installTaskDone", { name }),
      cancellable: true,
      task: (operationId) => catalogApi(source).installPack({ projectId: project.id, versionId, name }, operationId),
      onDone: (instance) => {
        toast.success(t("components.pack.readyToast", { name: instance.name }), {
          action: onDone ? undefined : { label: t("common.open"), onClick: () => navigate(instanceUrl(instance.id)) },
        });
        if (onDone) onDone(instance);
        else navigate(instanceUrl(instance.id));
      },
    });
  }

  async function run({ versionId, name }: PackRun = {}) {
    if (!pack) return;
    const id = versionId ?? (await chooseVersion(pack));
    if (id) install(pack, id, name ?? pack.title);
  }

  const busy = checking ? t("components.common.checking") : pack && active && target === pack.id ? progressLabel(progress).replace(/…$/, "") : null;
  return { run, busy, p: checking ? null : progressShare(progress), blocked: !!active || checking, cancel: !checking && busy ? cancelContent : undefined };
}
