import { Actions, Button, FormRow, FormSection, Progress, StatusPanel } from "@/ui";
import { isBusy, usePhase } from "@/components/play/phase";
import { useInstallPercent } from "@/components/play/installPercent";
import { askDelete } from "@/components/instance";
import { useI18n } from "@/i18n";
import { useInstall } from "@/hooks/usePlay";
import { LOADER_LABELS, type Instance } from "@/lib/types";
import { cn } from "@/lib/utils";

/** „Minecraft 1.21.4 · Fabric 0.16.10“; ohne Loader nur die Minecraft-Version. */
function versionText(i: Instance) {
  const minecraft = `Minecraft ${i.minecraftVersion}`;
  if (i.loader === "vanilla") return minecraft;
  return `${minecraft} · ${LOADER_LABELS[i.loader]}${i.loaderVersion ? ` ${i.loaderVersion}` : ""}`;
}

/** Breite von Knopf und Balken beim Reparieren in px; fest, damit der Balken erscheinen kann, ohne dass etwas springt. */
const REPAIR_BUTTON_WIDTH = 160;
const REPAIR_PROGRESS_WIDTH = 180;

/** Spielversion und Reparieren. */
export function VersionSection({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  const install = useInstall();
  const phase = usePhase(instance.id);
  const percent = useInstallPercent(instance);
  const repairing = percent != null;
  return (
    <FormSection title={t("common.version")}>
      <FormRow label={t("detail.settings.gameVersionLabel")} aside={t("detail.settings.versionAside")}>
        {/* Reiner Text: auf Höhe des Labels (10 px wie dessen Innenabstand) */}
        <span className="pt-2.5">{versionText(instance)}</span>
      </FormRow>
      <FormRow label={t("detail.settings.repairLabel")} hint={t("detail.settings.repairHint")}>
        <Actions>
          <Button
            icon="redo"
            width={REPAIR_BUTTON_WIDTH}
            disabled={isBusy(phase) || install.isPending}
            onClick={() => install.mutate(instance)}
          >
            {repairing ? t("detail.settings.repairing") : t("detail.settings.repairLabel")}
          </Button>
          {/* Platz bleibt reserviert: der Balken erscheint, ohne dass etwas springt */}
          <Progress
            p={(percent ?? 0) / 100}
            width={REPAIR_PROGRESS_WIDTH}
            className={cn(!repairing && "invisible")}
            label={t("detail.settings.repairProgress")}
          />
        </Actions>
      </FormRow>
    </FormSection>
  );
}

/** Instanz löschen; gesperrt, solange etwas läuft. */
export function DangerSection({ instance }: { instance: Instance }) {
  const { t } = useI18n();
  const phase = usePhase(instance.id);
  return (
    <FormSection title={t("detail.settings.dangerSection")}>
      <StatusPanel
        tone="bad"
        title={t("detail.settings.deleteInstance")}
        actions={
          <Button variant="danger" icon="trash" disabled={isBusy(phase)} onClick={() => askDelete(instance)}>
            {t("common.delete")}
          </Button>
        }
      >
        {t("detail.settings.deleteInstanceText")}
      </StatusPanel>
    </FormSection>
  );
}
