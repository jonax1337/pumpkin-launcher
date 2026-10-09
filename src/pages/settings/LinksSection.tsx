import { FormRow, FormSection, Switch } from "@/ui";
import { useForeignLinks, useSetForeignLinks } from "@/hooks/useForeignLinks";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";

/**
 * Links anderer Programme (`modrinth://`, `curseforge://`) dem Launcher überlassen; ausgeschaltet, bis der Nutzer es will.
 * Der Schalter zeigt, was das System meldet, nicht eine gemerkte Einstellung; auf macOS und im Browser gibt es ihn nicht.
 */
export function LinksSection() {
  const { t } = useI18n();
  const foreign = useForeignLinks();
  const set = useSetForeignLinks();
  if (!api.capabilities.foreignSchemes) return null;
  return (
    <FormSection title={t("deepLinks.settings.sectionTitle")} level={3}>
      <FormRow label={t("deepLinks.settings.label")} hint={t("deepLinks.settings.hint")}>
        <Switch
          label={t("deepLinks.settings.label")}
          checked={foreign.data ?? false}
          disabled={foreign.isPending || set.isPending}
          onChange={(on) => set.mutate(on)}
          stateText={[t("ui.switch.on"), t("ui.switch.off")]}
        />
      </FormRow>
    </FormSection>
  );
}
