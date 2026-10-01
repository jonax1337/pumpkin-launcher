import { useLocation, useSearchParams } from "react-router";
import { useI18n } from "@/i18n";
import { useView } from "@/app/Layout";
import { AccountsSection } from "@/components/accounts/AccountsSection";
import { SupportSection } from "@/components/support";
import { FormSection, PageHeader, TabPanel, Tabs } from "@/ui";
import { AboutTab } from "./settings/AboutTab";
import { AdvancedTab } from "./settings/AdvancedTab";
import { AppearanceTab } from "./settings/AppearanceTab";
import { GameTab } from "./settings/GameTab";

// Abschnitte als Wert + Schlüssel; die Beschriftung löst die Oberfläche erst beim Rendern auf.
const SECTIONS = [
  { value: "konten", key: "components.account.accounts" },
  { value: "spiel", key: "pages.settings.tabGame" },
  { value: "darstellung", key: "pages.settings.tabAppearance" },
  { value: "erweitert", key: "components.newInstance.advanced" },
  { value: "support", key: "pages.settings.tabSupport" },
  { value: "ueber", key: "pages.settings.tabAbout" },
] as const;
type SectionId = (typeof SECTIONS)[number]["value"];

const sectionOf = (id: string | null) => SECTIONS.find((section) => section.value === id);

/** Inhalt des gewählten Abschnitts. */
function SectionBody({ id }: { id: SectionId }) {
  switch (id) {
    case "konten":
      return <div className="set-acc"><AccountsSection /></div>;
    case "spiel":
      return <GameTab />;
    case "darstellung":
      return <AppearanceTab />;
    case "erweitert":
      return <AdvancedTab />;
    case "support":
      return <SupportSection />;
    case "ueber":
      return <AboutTab />;
  }
}

/** Tabwechsel: klebt die Leiste oben, geht die Seite auf deren Ruhelage zurück, damit der neue Inhalt direkt darunter beginnt. */
function settleScroll(view: HTMLElement | null, tab: HTMLElement) {
  const bar = tab.closest<HTMLElement>("[role=tablist]");
  const head = bar?.previousElementSibling;
  if (!view || !bar || !head) return;
  const headBottom = head.getBoundingClientRect().bottom - view.getBoundingClientRect().top + view.scrollTop;
  const rest = headBottom + parseFloat(getComputedStyle(bar).marginTop);
  if (view.scrollTop > rest) view.scrollTop = rest;
}

export function SettingsPage() {
  const { t } = useI18n();
  const view = useView();
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  // ?tab=… gewinnt; #konten (aus dem Kontomenü) und die anderen Abschnitts-Anker öffnen ihren Tab.
  const section = sectionOf(params.get("tab")) ?? sectionOf(decodeURIComponent(hash.slice(1))) ?? SECTIONS[0];
  // Abschnitts-Beschriftungen erst hier auflösen, damit ein Sprachwechsel sofort greift.
  const tabs = SECTIONS.map(({ value, key }) => ({ value, label: t(key) }));

  return (
    <section className="page set">
      <PageHeader title={t("common.settings")} />
      <Tabs
        idBase="st"
        sticky
        className="mt-3"
        label={t("pages.settings.tabsLabel")}
        items={tabs}
        value={section.value}
        onChange={(id) => setParams({ tab: id }, { replace: true })}
        onActivate={(_, el) => settleScroll(view.current, el)}
      />

      {/* Nur der gewählte Tab. Der Tab-Name ist die Überschrift; das h2 bleibt für Vorleser und Überschriften-Sprünge. */}
      <TabPanel idBase="st" value={section.value}>
        <FormSection key={section.value} title={t(section.key)} srOnlyTitle>
          <SectionBody id={section.value} />
        </FormSection>
      </TabPanel>
    </section>
  );
}
