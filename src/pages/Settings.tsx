import { useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { useI18n } from "@/i18n";
import { useView } from "@/app/Layout";
import { AccountAddButtons, AccountsSection } from "@/components/accounts/AccountsSection";
import { showShortcuts } from "@/components/ShortcutsDialog";
import { Button, ContextMenu, Form, Heading, Page, PageHeader, TabPanel, Workspace, WorkspaceContent, WorkspaceRail, WorkspaceTabs, type MenuEntry } from "@/ui";
import { AboutTab } from "./settings/AboutTab";
import { AppearanceTab } from "./settings/AppearanceTab";
import { FriendsTab } from "./settings/FriendsTab";
import { GameTab } from "./settings/GameTab";
import { PanelActions, PanelActionsProvider } from "./settings/PanelActions";
import { StorageTab } from "./settings/StorageTab";
import { SECTIONS, sectionOf, type SectionId } from "./settings/sections";

/** Inhalt des gewählten Abschnitts. */
function SectionBody({ id }: { id: SectionId }) {
  switch (id) {
    case "konten":
      return (
        <>
          <PanelActions><AccountAddButtons /></PanelActions>
          <AccountsSection />
        </>
      );
    case "spiel":
      return <GameTab />;
    case "freunde":
      return <FriendsTab />;
    case "speicher":
      return <StorageTab />;
    case "darstellung":
      return <AppearanceTab />;
    case "ueber":
      return <AboutTab />;
  }
}

export function SettingsPage() {
  const { t } = useI18n();
  const view = useView();
  const { hash } = useLocation();
  // Platz für die Aktionen der Reiter im Kopf der Inhaltsplatte (PanelActions)
  const [actionsTarget, setActionsTarget] = useState<HTMLElement | null>(null);
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
      <Page>
        <PageHeader title={t("common.settings")}>
          <Button onClick={showShortcuts}>{t("pages.settings.shortcutsButton")}</Button>
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
          <WorkspaceContent id="settings-content" className="@container/settings-content min-h-[480px]">
            <TabPanel idBase="settings" value={section.value} tabIndex={0}>
              <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                <Heading level="section" className="mr-auto">{t(section.key)}</Heading>
                <div className="contents" ref={setActionsTarget} />
              </header>
              <PanelActionsProvider value={actionsTarget}>
                <Form flat key={section.value}>
                  <SectionBody id={section.value} />
                </Form>
              </PanelActionsProvider>
            </TabPanel>
          </WorkspaceContent>
        </Workspace>
      </Page>
    </ContextMenu>
  );
}
