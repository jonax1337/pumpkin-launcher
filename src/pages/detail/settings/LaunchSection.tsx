import { FormSection } from "@/ui";
import { useI18n } from "@/i18n";
import type { Instance } from "@/lib/types";
import { LaunchFields } from "./LaunchFields";
import type { InstanceForm } from "./useInstanceForm";

/** Umgebungsvariablen, Wrapper und Befehle vor dem Start und nach dem Ende der Instanz. */
export function LaunchSection({ instance, form, locked }: { instance: Instance; form: InstanceForm; locked: boolean }) {
  const { t } = useI18n();
  return (
    <FormSection title={t("launchSettings.section")}>
      <LaunchFields scope="instance" value={instance.launch} disabled={locked} onCommit={(launch) => form.save({ launch }, t("launchSettings.saved"))} />
    </FormSection>
  );
}
