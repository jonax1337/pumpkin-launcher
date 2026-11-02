import { Actions, FormRow, Hint, Segmented, Switch } from "@/ui";
import { useI18n, type LanguageChoice, type TKey } from "@/i18n";
import { useReducedMotion } from "@/hooks/useMediaQuery";
import { useSettings, type PxSize, type TextSize } from "@/store/settings";

const PX_SIZE_KEYS: { value: PxSize; key: TKey }[] = [
  { value: "s", key: "pages.settings.pxSizeSmall" },
  { value: "m", key: "pages.settings.pxSizeMedium" },
  { value: "l", key: "pages.settings.pxSizeLarge" },
];

/** Die Stufen in der Reihenfolge der Auswahl; die Befehlspalette schaltet sie der Reihe nach weiter. */
export const TEXT_SIZE_KEYS: { value: TextSize; key: TKey }[] = [
  { value: "m", key: "pages.settings.textSizeNormal" },
  { value: "l", key: "pages.settings.textSizeLarge" },
  { value: "xl", key: "pages.settings.textSizeLarger" },
];

const LANGUAGE_KEYS: { value: LanguageChoice; key: TKey }[] = [
  { value: "system", key: "pages.settings.langSystem" },
  { value: "de", key: "pages.settings.langGerman" },
  { value: "en", key: "pages.settings.langEnglish" },
];

/** Einstellungen › Darstellung: Sprache, Textgröße, Bewegung, Pixelgröße. */
export function AppearanceTab() {
  const { t } = useI18n();
  const language = useSettings((s) => s.language);
  const motion = useSettings((s) => s.motion);
  const pxSize = useSettings((s) => s.pxSize);
  const textSize = useSettings((s) => s.textSize);
  const set = useSettings((s) => s.set);
  const reduced = useReducedMotion();
  return (
    <>
      <FormRow label={t("pages.settings.pxSizeLabel")} hint={t("pages.settings.pxSizeHint")}>
        <Segmented<PxSize>
          size="s"
          label={t("pages.settings.pxSizeLabel")}
          value={pxSize}
          onChange={(size) => set({ pxSize: size })}
          items={PX_SIZE_KEYS.map(({ value, key }) => ({ value, label: t(key) }))}
        />
      </FormRow>
      <FormRow label={t("pages.settings.textSizeLabel")} hint={t("pages.settings.textSizeHint")}>
        <Segmented<TextSize>
          size="s"
          label={t("pages.settings.textSizeLabel")}
          value={textSize}
          onChange={(size) => set({ textSize: size })}
          items={TEXT_SIZE_KEYS.map(({ value, key }) => ({ value, label: t(key) }))}
        />
      </FormRow>
      <FormRow label={t("pages.settings.motionLabel")} hint={t("pages.settings.motionHint")}>
        {/* Wünscht das System weniger Bewegung, gewinnt das: Schalter aus und gesperrt, mit Grund daneben. */}
        <Actions gap={12}>
          <Switch
            checked={motion && !reduced}
            disabled={reduced}
            onChange={(on) => set({ motion: on })}
            label={t("pages.settings.motionLabel")}
            stateText={reduced ? undefined : [t("ui.switch.on"), t("ui.switch.off")]}
          />
          {reduced && <Hint icon="info">{t("pages.settings.motionReducedHint")}</Hint>}
        </Actions>
      </FormRow>
      <FormRow label={t("common.language")} hint={t("pages.settings.languageHint")}>
        <Segmented<LanguageChoice>
          size="s"
          label={t("common.language")}
          value={language}
          onChange={(choice) => set({ language: choice })}
          items={LANGUAGE_KEYS.map(({ value, key }) => ({ value, label: t(key) }))}
        />
      </FormRow>
    </>
  );
}
