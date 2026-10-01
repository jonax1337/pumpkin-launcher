import { Actions, Button, CardGrid, FormRow, FormSection, Menu, TextField, ThumbCard } from "@/ui";
import { useGroupMenu } from "@/components/instance";
import { useI18n } from "@/i18n";
import { blurOnEnter } from "@/lib/dom";
import type { Instance } from "@/lib/types";
import { BIOME_KEYS } from "@/pixel/scene";
import { useLook, useLookStore } from "@/store/look";
import type { InstanceForm } from "./useInstanceForm";

/** Maximale Länge des Instanznamens. */
const NAME_MAX_LENGTH = 64;

/** Name, Gruppe und Bild (Biom der Szene) der Instanz. */
export function GeneralSection({ instance, form, locked }: { instance: Instance; form: InstanceForm; locked: boolean }) {
  const { t } = useI18n();
  const look = useLook(instance.id);
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
      <FormRow label={t("detail.settings.lookLabel")} hint={t("detail.settings.lookHint")} wide>
        {/* Name sichtbar unter der Miniatur (dunkle Szenen wie die Höhle sind klein kaum zu erkennen) */}
        <CardGrid variant="thumb" role="group" aria-label={t("detail.settings.sceneAria")}>
          {BIOME_KEYS.map((biome) => (
            <ThumbCard
              key={biome}
              look={{ bio: biome, seed: look.seed }}
              title={t(`ui.biome.${biome}`)}
              pressed={look.bio === biome}
              hit={{ onClick: () => useLookStore.getState().setBiome(instance.id, biome) }}
            />
          ))}
        </CardGrid>
      </FormRow>
    </FormSection>
  );
}
