import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocation, useSearchParams } from "react-router";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "sonner";
import { useI18n } from "@/i18n";
import { useView } from "@/app/Layout";
import { UpdateRow } from "@/components/AppUpdate";
import { JavaChooser, MemoryChooser, MemoryHelp } from "@/components/common";
import { AccountsSection } from "@/components/PlayerNames";
import { SupportSection } from "@/components/support";
import { Actions, Button, Count, FormRow, FormSection, Hint, PageHeader, Segmented, Select, Switch, TabPanel, Tabs } from "@/ui";
import { api } from "@/lib/api";
import { Buddy, BrandWordmark, useBrand } from "@/branding/Brand";
import { SEASONS, type PumpkinChoice } from "@/branding/calendar";
import type { LanguageChoice } from "@/i18n";
import { useSettings, type PxSize } from "@/store/settings";
import pkg from "../../package.json";

// Abschnitte als Wert + Schlüssel; die Beschriftung löst die Oberfläche erst beim Rendern auf.
const SECTION_KEYS = [
  { value: "konten", key: "components.account.accounts" },
  { value: "spiel", key: "pages.settings.tabGame" },
  { value: "darstellung", key: "pages.settings.tabAppearance" },
  { value: "erweitert", key: "components.newInstance.advanced" },
  { value: "support", key: "pages.settings.tabSupport" },
  { value: "ueber", key: "pages.settings.tabAbout" },
] as const;
type SectionId = (typeof SECTION_KEYS)[number]["value"];

const PX_SIZE_KEYS: { value: PxSize; key: string }[] = [
  { value: "s", key: "pages.settings.pxSizeSmall" },
  { value: "m", key: "pages.settings.pxSizeMedium" },
  { value: "l", key: "pages.settings.pxSizeLarge" },
];
const LANGUAGE_KEYS: { value: LanguageChoice; key: string }[] = [
  { value: "system", key: "pages.settings.langSystem" },
  { value: "de", key: "pages.settings.langGerman" },
  { value: "en", key: "pages.settings.langEnglish" },
];

const RM = "(prefers-reduced-motion: reduce)";
const subscribeRm = (cb: () => void) => {
  const mq = matchMedia(RM);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** Java: automatisch (mitgelieferte Runtime) oder eigene Java-Installation. */
function JavaRow() {
  const { t } = useI18n();
  const javaPath = useSettings((s) => s.javaPath);
  const set = useSettings((s) => s.set);
  return (
    <FormRow
      label="Java"
      hint={t("pages.settings.javaHint")}
      group="radiogroup"
      aside={t("pages.settings.javaAside")}
    >
      <JavaChooser
        name="gjava"
        value={javaPath}
        onChange={(path) => set({ javaPath: path })}
        fallback={<>{t("components.memory.auto")} <span className="text-fg-3">{t("pages.settings.javaAutomaticNote")}</span></>}
      />
    </FormRow>
  );
}

export function SettingsPage() {
  const { t } = useI18n();
  const { season } = useBrand();
  const s = useSettings();
  const view = useView();
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  // ?tab=… gewinnt; #konten (aus dem Kontomenü) und die anderen Abschnitts-Anker öffnen ihren Tab.
  const fromHash = decodeURIComponent(hash.slice(1));
  const tab: SectionId = SECTION_KEYS.find((sec) => sec.value === params.get("tab"))?.value ?? SECTION_KEYS.find((sec) => sec.value === fromHash)?.value ?? "konten";
  // Abschnitts-Beschriftungen erst hier auflösen, damit ein Sprachwechsel sofort greift.
  const sections = SECTION_KEYS.map(({ value, key }) => ({ value, label: t(key) }));
  const [version, setVersion] = useState<string>(pkg.version);
  const reduced = useSyncExternalStore(subscribeRm, () => matchMedia(RM).matches);

  useEffect(() => {
    if (!api.isMock) void getVersion().then(setVersion).catch(() => undefined);
  }, []);

  // Tabwechsel: klebt die Leiste oben, geht die Seite auf deren Ruhelage zurück, damit der neue Inhalt direkt darunter beginnt.
  function settle(tabEl: HTMLElement) {
    const el = view.current, bar = tabEl.closest<HTMLElement>("[role=tablist]");
    const head = bar?.previousElementSibling;
    if (!el || !bar || !head) return;
    const rest = head.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop + parseFloat(getComputedStyle(bar).marginTop);
    if (el.scrollTop > rest) el.scrollTop = rest;
  }

  const label = sections.find((sec) => sec.value === tab)!.label;

  return (
    <section className="page set">
      <PageHeader title={t("common.settings")} />
      <Tabs
        idBase="st"
        sticky
        className="mt-3"
        label={t("pages.settings.tabsLabel")}
        items={sections}
        value={tab}
        onChange={(id) => setParams({ tab: id }, { replace: true })}
        onActivate={(_, el) => settle(el)}
      />

      {/* Nur der gewählte Tab. Der Tab-Name ist die Überschrift; das h2 bleibt für Vorleser und Überschriften-Sprünge. */}
      <TabPanel idBase="st" value={tab}>
        <FormSection key={tab} title={label} srOnlyTitle>
          {tab === "konten" && (
            <div className="set-acc">
              <AccountsSection />
            </div>
          )}

          {tab === "spiel" && (
            <>
              <FormRow label={t("ui.memory.label")} hint={t("pages.settings.memoryHint")} group="radiogroup" aside={<MemoryHelp value={s.memoryMb} />}>
                <MemoryChooser name="gram" value={s.memoryMb} onChange={(mb) => s.set({ memoryMb: mb })} help={false} />
              </FormRow>
              <JavaRow />
            </>
          )}

          {tab === "darstellung" && (
            <>
              <FormRow label={t("common.language")} hint={t("pages.settings.languageHint")}>
                <Segmented<LanguageChoice> size="s" label={t("common.language")} value={s.language} onChange={(language) => s.set({ language })} items={LANGUAGE_KEYS.map(({ value, key }) => ({ value, label: t(key) }))} />
              </FormRow>
              <FormRow label={t("pages.settings.pumpkinLabel")} htmlFor="pumpkin-choice" hint={t("pages.settings.pumpkinHint")}>
                <Select
                  id="pumpkin-choice"
                  value={s.pumpkin}
                  options={[
                    { value: "auto", label: t("pages.settings.pumpkinAuto") },
                    ...SEASONS.map((seasonEntry) => ({ value: seasonEntry.id, label: `${seasonEntry.name} · ${seasonEntry.label}` })),
                  ]}
                  onChange={(value) => s.set({ pumpkin: value as PumpkinChoice })}
                />
                <Actions gap={12}>
                  <Buddy size={72} />
                  <div><b>{season.name}</b><Hint>{s.pumpkin === 'auto' ? t("pages.settings.pumpkinAutoStatus", { zeit: season.id === 'standard' ? t("pages.settings.pumpkinBetweenSeasons") : season.period }) : t("pages.settings.pumpkinFixedStatus")}</Hint></div>
                </Actions>
              </FormRow>
              <FormRow label={t("pages.settings.motionLabel")} hint={t("pages.settings.motionHint")}>
                {/* Wünscht das System weniger Bewegung, gewinnt das: Schalter aus und gesperrt, mit Grund daneben. */}
                <Actions gap={12}>
                  <Switch
                    checked={s.motion && !reduced}
                    disabled={reduced}
                    onChange={(motion) => s.set({ motion })}
                    label={t("pages.settings.motionLabel")}
                    stateText={reduced ? undefined : [t("ui.switch.on"), t("ui.switch.off")]}
                  />
                  {reduced && <Hint icon="info">{t("pages.settings.motionReducedHint")}</Hint>}
                </Actions>
              </FormRow>
              <FormRow label={t("pages.settings.pxSizeLabel")} hint={t("pages.settings.pxSizeHint")}>
                <Segmented<PxSize> size="s" label={t("pages.settings.pxSizeLabel")} value={s.pxSize} onChange={(pxSize) => s.set({ pxSize })} items={PX_SIZE_KEYS.map(({ value, key }) => ({ value, label: t(key) }))} />
              </FormRow>
            </>
          )}

          {tab === "erweitert" && (
            <>
              <FormRow label={t("pages.settings.resetLabel")} hint={t("pages.settings.resetHint")}>
                <Actions>
                  <Button
                    icon="redo"
                    onClick={() => {
                      s.reset();
                      toast.success(t("pages.settings.resetDoneToast"));
                    }}
                  >
                    {t("pages.settings.resetButton")}
                  </Button>
                </Actions>
              </FormRow>
            </>
          )}

          {tab === "support" && <SupportSection />}

          {tab === "ueber" && (
            <>
              <div className="brand-about">
                <Buddy mood="hello" size={96} />
                <div>
                  <BrandWordmark />
                  <div className="text-fg-2">
                    {t("common.version")} <Count value={version} /> · {t("pages.settings.aboutTagline")}
                  </div>
                </div>
              </div>
              <UpdateRow />
              <Hint className="mt-3.5">{t("pages.settings.aboutSources")}</Hint>
            </>
          )}
        </FormSection>
      </TabPanel>
    </section>
  );
}
