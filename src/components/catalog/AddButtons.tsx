import { useState, type ComponentProps } from "react";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { Button, Chip, Hint, IconButton, JobProgress } from "@/ui";
import { useContentState } from "@/store/contentState";
import { projectKey, type CatalogType, type ProjectRef, type Source } from "@/lib/content-types";
import { ownerKey } from "@/lib/mods";
import type { Instance, World } from "@/lib/types";
import { fitsLabel } from "./fit";
import { HEAD_JOB_WIDTH, ROW_JOB_WIDTH, SIDE_JOB_WIDTH, useJobProgressFor } from "./jobProgress";
import { useAddContent } from "./useAddContent";

// Hinzufügen im Kontext einer Instanz (Datenpakete: einer Welt darin): Knopf, „Installiert“, Fortschritt oder „Keine Version“.

interface AddTarget {
  instance: Instance;
  world?: World;
  project: ProjectRef;
  type: CatalogType;
  source: Source;
}

interface AddActionOptions extends AddTarget {
  versionId?: string;
  jobWidth: ComponentProps<typeof JobProgress>["width"];
  /** Meldet fehlende Versionen selbst; ohne steht „Keine Version“ an der Stelle des Knopfes. */
  onMissing?: () => void;
}

/** `instead` steht an der Stelle des Knopfes, solange es nicht `null` ist: installiert, prüft, läuft oder keine Version. */
function useAddAction({ instance, world, project, type, source, versionId, jobWidth, onMissing }: AddActionOptions) {
  const { t } = useI18n();
  const addContent = useAddContent();
  const disabled = useContentState((s) => !!s.active);
  const job = useJobProgressFor(project.id, jobWidth);
  const [state, setState] = useState<"idle" | "checking" | "missing">("idle");
  const installed = instance.mods.some((m) => ownerKey(m) === projectKey(source, project.id));

  async function add() {
    setState("checking");
    const result = await addContent({ instance, project, type, source, world, versionId });
    const missing = result === "missing";
    setState(missing && !onMissing ? "missing" : "idle");
    if (missing) onMissing?.();
  }

  const instead = installed ? (
    <Chip icon="check">{t("components.content.installed")}</Chip>
  ) : state === "checking" ? (
    <JobProgress label={t("components.common.checking")} p={null} width={jobWidth} />
  ) : (
    (job ?? (state === "missing" ? <Hint>{t("components.content.noVersionFor", { version: instance.minecraftVersion })}</Hint> : null))
  );
  return { instead, disabled, add };
}

/** Kleiner Knopf in der Zeile des Seitenpanels. */
export function AddRowButton(target: AddTarget) {
  const { t } = useI18n();
  const { instance, project, type } = target;
  const { instead, disabled, add } = useAddAction({
    ...target,
    jobWidth: SIDE_JOB_WIDTH,
    onMissing: () => toast.error(t("components.content.notAvailableFor", { name: project.title, fits: fitsLabel(instance, type) })),
  });
  return (
    instead ?? <Button size="s" icon="plus" disabled={disabled} aria-label={t("components.content.addAria", { name: project.title })} onClick={add}>{t("common.add")}</Button>
  );
}

/** Symbolknopf an einer Version in der Liste der Projektseite. */
export function AddVersionButton({ versionId, ...target }: AddTarget & { versionId: string }) {
  const { t } = useI18n();
  const { instead, disabled, add } = useAddAction({ ...target, versionId, jobWidth: ROW_JOB_WIDTH });
  return (
    instead ?? <IconButton size="s" icon="download" label={t("components.content.addThisVersion", { name: target.project.title })} tip={t("components.content.addVersion")} disabled={disabled} onClick={add} />
  );
}

/** Großer Knopf im Kopf der Projektseite. */
export function AddProjectButton(target: AddTarget) {
  const { t } = useI18n();
  const { instead, disabled, add } = useAddAction({ ...target, jobWidth: HEAD_JOB_WIDTH });
  return instead ?? <Button variant="primary" size="l" icon="plus" disabled={disabled} onClick={add}>{t("common.add")}</Button>;
}
