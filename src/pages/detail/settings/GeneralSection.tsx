import { Actions, Button, CardGrid, FormRow, FormSection, Menu, TextField, ThumbCard } from "@/ui";
import { IconPicker } from "@/components/IconPicker";
import { InstanceIcon } from "@/components/InstanceIcon";
import { NAME_MAX_LENGTH, useGroupMenu } from "@/components/instance";
import { useI18n } from "@/i18n";
import { blurOnEnter } from "@/lib/dom";
import type { Instance } from "@/lib/types";
import { BIOME_KEYS } from "@/pixel/scene";
import { useSetIcon, useSetScene } from "@/hooks/useInstances";
import { useLook } from "@/store/look";
import type { InstanceForm } from "./useInstanceForm";

/** Name, Gruppe, Icon und Szene (Biom) der Instanz. */
export function GeneralSection({ instance, form, locked }: { instance: Instance; form: InstanceForm; locked: boolean }) {
  const { t } = useI18n();
  const look = useLook(instance.id);
  const setIcon = useSetIcon(instance.id);
  const setScene = useSetScene(instance.id);
  const groupItems = useGroupMenu(instance);
  const groupText = instance.group ?? t("detail.settings.noGroup");
  return (
    <FormSection title={t("detail.settings.generalSection")}>
      <FormRow label={t("common.name")} htmlFor="inst-name">
        <TextField
          id="inst-name"
          value={form.name}
          disabled={locked}
          maxLength={NAME_MAX_LENGTH}
          onChange={(e) => form.setName(e.target.value)}
          onBlur={form.saveName}
          onKeyDown={blurOnEnter}
        />
      </FormRow>
      <FormRow label={t("components.instance.group")} hint={t("detail.settings.groupHint")}>
        <Actions>
          <Menu
            align="start"
            items={groupItems}
            trigger={
              <Button iconEnd="chevd" disabled={locked} aria-label={t("detail.settings.groupAria", { name: groupText })}>
                {groupText}
              </Button>
            }
          />
        </Actions>
      </FormRow>
      <FormRow label={t("components.icon.label")} hint={t("components.icon.hint")} wide>
        <IconPicker
          key={instance.id}
          value={instance.icon}
          onChange={(next) => setIcon.mutate(next)}
          preview={<InstanceIcon instance={instance} bio={look.bio} />}
        />
      </FormRow>
      <FormRow label={t("detail.settings.lookLabel")} hint={t("detail.settings.lookHint")} wide>
        {/* Name sichtbar unter der Miniatur (dunkle Szenen wie die Höhle sind klein kaum zu erkennen) */}
        <CardGrid variant="thumb" role="group" aria-label={t("detail.settings.sceneAria")}>
          {BIOME_KEYS.map((biome) => (
            <ThumbCard
              key={biome}
              look={{ bio: biome, seed: look.seed }}
              title={t(`ui.biome.${biome}`)}
              pressed={look.bio === biome}
              hit={{ onClick: () => setScene.mutate({ biome, seed: look.seed }) }}
            />
          ))}
        </CardGrid>
      </FormRow>
    </FormSection>
  );
}
