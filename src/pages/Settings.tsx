import { useLocation, useSearchParams } from "react-router";
import { useI18n } from "@/i18n";
import { useView } from "@/app/Layout";
import { AccountsSection } from "@/components/accounts/AccountsSection";
import { SupportSection } from "@/components/support";
import { showShortcuts } from "@/components/ShortcutsDialog";
import { Button, ContextMenu, FormSection, PageHeader, TabPanel, Workspace, WorkspaceContent, WorkspaceRail, WorkspaceTabs, type MenuEntry } from "@/ui";
import { AboutTab } from "./settings/AboutTab";
import { AppearanceTab } from "./settings/AppearanceTab";
import { FriendsTab } from "./settings/FriendsTab";
import { GameTab } from "./settings/GameTab";
import { StorageTab } from "./settings/StorageTab";
import { SECTIONS, sectionOf, type SectionId } from "./settings/sections";
import "./settings/settings.css";

/** Über den Launcher, darunter Hilfe und Fehlermeldungen. */
function AboutAndSupport() {
  const { t } = useI18n();
  return (
    <>
      <AboutTab />
      <FormSection title={t("pages.settings.tabSupport")} level={3}>
        <SupportSection />
      </FormSection>
    </>
  );
}

/** Inhalt des gewählten Abschnitts. */
function SectionBody({ id }: { id: SectionId }) {
  switch (id) {
    case "konten":
      return <AccountsSection />;
    case "spiel":
      return <GameTab />;
    case "freunde":
      return <FriendsTab />;
    case "speicher":
      return <StorageTab />;
    case "darstellung":
      return <AppearanceTab />;
    case "ueber":
      return <AboutAndSupport />;
  }
}

export function SettingsPage() {
  const { t } = useI18n();
  const view = useView();
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  // ?tab=… gewinnt; #konten (aus dem Kontomenü) und die anderen Abschnitts-Anker öffnen ihren Abschnitt.
  const section = sectionOf(params.get("tab")) ?? sectionOf(decodeURIComponent(hash.slice(1))) ?? SECTIONS[0];
  // Abschnitts-Beschriftungen erst hier auflösen, damit ein Sprachwechsel sofort greift.
  const sections = SECTIONS.map(({ value, key, icon }) => ({ value, label: t(key), icon }));
  const selectSection = (id: SectionId) => {
    setParams({ tab: id }, { replace: true });
    view.current?.scrollTo({ top: 0 });
  };
  const menu: MenuEntry[] = [
    ...sections.map(({ value, label }) => ({
      id: value, text: label, checked: value === section.value, onSelect: () => selectSection(value),
    })),
    "-",
    { id: "shortcuts", text: t("pages.settings.shortcutsButton"), onSelect: showShortcuts },
  ];

  return (
    <ContextMenu items={menu}>
      <section className="page set settings-page">
        <PageHeader title={t("common.settings")}>
          <Button size="s" onClick={showShortcuts}>{t("pages.settings.shortcutsButton")}</Button>
        </PageHeader>
        <Workspace rail={
          <WorkspaceRail>
            <WorkspaceTabs
              idBase="settings"
              label={t("pages.settings.tabsLabel")}
              items={sections}
              value={section.value}
              onChange={selectSection}
              onActivate={() => view.current?.scrollTo({ top: 0 })}
            />
          </WorkspaceRail>
        }>
          <WorkspaceContent id="settings-content" className="settings-content">
            <TabPanel idBase="settings" value={section.value} tabIndex={0}>
              <FormSection key={section.value} title={t(section.key)} className="settings-section">
                <SectionBody id={section.value} />
              </FormSection>
            </TabPanel>
          </WorkspaceContent>
        </Workspace>
      </section>
    </ContextMenu>
  );
}
