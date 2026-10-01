import { useLocation } from "react-router";
import { useI18n } from "@/i18n";
import { BarButton, Icon, Tip } from "@/ui";
import { TABS } from "./mainTabs";
import { TasksButton } from "./TasksButton";

/**
 * Seitenleiste mit nur Symbolen: oben die Hauptbereiche (normale Links: Bereiche sind Seiten, keine Tabs),
 * unten Aufgaben und Einstellungen. Der Name steht im Tooltip und als aria-label.
 */
export function Sidebar() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  return (
    <nav className="side" aria-label={t("ui.nav.mainAreas")}>
      <div className="side-grp">
        {TABS.map((tab) => (
          <Tip key={tab.to} label={t(tab.key)} side="right">
            <BarButton side to={tab.to} aria-label={t(tab.key)} aria-keyshortcuts={tab.shortcut} current={tab.match(pathname)}>
              <Icon name={tab.icon} />
            </BarButton>
          </Tip>
        ))}
      </div>
      <div className="side-grp">
        <TasksButton />
        <Tip label={t("common.settings")} side="right">
          <BarButton
            side
            to="/settings"
            aria-label={t("common.settings")}
            aria-keyshortcuts="Control+,"
            current={pathname.startsWith("/settings")}
          >
            <Icon name="gear" />
          </BarButton>
        </Tip>
      </div>
    </nav>
  );
}
