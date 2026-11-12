import { FormRow, FormSection, Switch } from "@/ui";
import { useSetSharing } from "@/hooks/useInstances";
import { useI18n } from "@/i18n";
import { toastError } from "@/lib/toast";
import type { Instance, Sharing } from "@/lib/types";

/** Serverliste und Spieloptionen mit den anderen teilenden Instanzen gemeinsam haben; jeder Schalter speichert sofort. */
export function SharingSection({ instance, locked }: { instance: Instance; locked: boolean }) {
  const { t } = useI18n();
  const setSharing = useSetSharing(instance.id);
  const disabled = locked || setSharing.isPending;
  const stateText: [string, string] = [t("detail.settings.sharingOn"), t("detail.settings.sharingOff")];
  const change = (part: keyof Sharing) => (on: boolean) =>
    setSharing.mutate({ ...instance.sharing, [part]: on }, { onError: toastError });
  return (
    <FormSection plate title={t("detail.settings.sharingTitle")}>
      <FormRow label={t("detail.settings.shareServersLabel")} hint={t("detail.settings.shareServersHint")}>
        <Switch
          label={t("detail.settings.shareServersLabel")}
          checked={instance.sharing.servers}
          disabled={disabled}
          stateText={stateText}
          onChange={change("servers")}
        />
      </FormRow>
      <FormRow
        label={t("detail.settings.shareOptionsLabel")}
        hint={t("detail.settings.shareOptionsHint")}
        aside={t("detail.settings.shareOptionsAside")}
      >
        <Switch
          label={t("detail.settings.shareOptionsLabel")}
          checked={instance.sharing.options}
          disabled={disabled}
          stateText={stateText}
          onChange={change("options")}
        />
      </FormRow>
    </FormSection>
  );
}
