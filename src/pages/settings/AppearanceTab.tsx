import { Actions, FormRow, Hint, Segmented, Select, Switch } from "@/ui";
import { Buddy, useBrand } from "@/branding/Brand";
import { SEASONS, type PumpkinChoice, type SeasonId } from "@/branding/calendar";
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

/** Name der Jahreszeit und ihr Zeitraum je Sprache (die Marken-Daten in branding/ sind deutsch); „standard“ hat keinen festen Zeitraum. */
const SEASON_KEYS: Record<SeasonId, { label: TKey; period?: TKey }> = {
  standard: { label: "pages.settings.season.standard" },
  spring: { label: "pages.settings.season.spring", period: "pages.settings.season.spring.period" },
  summer: { label: "pages.settings.season.summer", period: "pages.settings.season.summer.period" },
  halloween: { label: "pages.settings.season.halloween", period: "pages.settings.season.halloween.period" },
  winter: { label: "pages.settings.season.winter", period: "pages.settings.season.winter.period" },
};

/** Der Kürbis der laufenden Jahreszeit mit Name und dem Grund, warum er gerade gilt (automatisch oder fest gewählt). */
function SeasonStatus() {
  const { t } = useI18n();
  const { season } = useBrand();
  const pumpkin = useSettings((s) => s.pumpkin);
  const periodKey = SEASON_KEYS[season.id].period;
  const automaticTime = periodKey ? t(periodKey) : t("pages.settings.pumpkinBetweenSeasons");
  return (
    <div className="flex items-center gap-3">
      <Buddy size={72} />
      <div>
        <b>{season.name}</b>
        <Hint>
          {pumpkin === "auto" ? t("pages.settings.pumpkinAutoStatus", { time: automaticTime }) : t("pages.settings.pumpkinFixedStatus")}
        </Hint>
      </div>
    </div>
  );
}

/** Einstellungen › Darstellung: Sprache, Textgröße, Kürbis, Bewegung, Pixelgröße. */
export function AppearanceTab() {
  const { t } = useI18n();
  const language = useSettings((s) => s.language);
  const pumpkin = useSettings((s) => s.pumpkin);
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
      <FormRow label={t("pages.settings.pumpkinLabel")} htmlFor="pumpkin-choice" hint={t("pages.settings.pumpkinHint")}>
        <Select
          id="pumpkin-choice"
          value={pumpkin}
          options={[
            { value: "auto", label: t("pages.settings.pumpkinAuto") },
            ...SEASONS.map((season) => ({ value: season.id, label: `${season.name} · ${t(SEASON_KEYS[season.id].label)}` })),
          ]}
          onChange={(value) => set({ pumpkin: value as PumpkinChoice })}
        />
        <SeasonStatus />
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
