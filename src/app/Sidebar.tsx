import { useLocation } from "react-router";
import { useI18n } from "@/i18n";
import { useFriendsNav } from "@/pages/friends/useFriendsNav";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { MINUTE } from "@/lib/time";
import { useAnnouncementReadStore } from "@/store/announcementRead";
import { BarButton, Icon, Tip } from "@/ui";
import { FRIENDS_PATH, TABS } from "./mainTabs";
import { SHORTCUT, shortcutLabel } from "./shortcuts";
import { TasksButton } from "./TasksButton";

/**
 * Seitenleiste mit nur Symbolen: oben die Hauptbereiche (normale Links: Bereiche sind Seiten, keine Tabs),
 * unten Aufgaben und Einstellungen. Der Name steht im Tooltip und als aria-label.
 */
export function Sidebar() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const friends = useFriendsNav();
  const announcements = useAnnouncements(5 * MINUTE);
  const readIds = useAnnouncementReadStore((state) => state.readIds);
  const read = new Set(readIds);
  const announcementBadge = new Set(announcements.data?.pages.flat()
    .filter((entry) => !read.has(entry.id)).map((entry) => entry.id)).size;
  const withShortcut = (name: string, shortcut: string) => `${name} (${shortcutLabel(shortcut, t)})`;
  const tabs = TABS.filter((tab) => !(tab.to === FRIENDS_PATH && friends.hidden));
  return (
    <nav className="side" aria-label={t("ui.nav.mainAreas")}>
      <div className="side-grp">
        {tabs.map((tab) => {
          const isAnnouncements = tab.to === "/announcements";
          const badge = isAnnouncements ? announcementBadge : tab.to === FRIENDS_PATH ? friends.badge : 0;
          const label = badge > 0
            ? t(isAnnouncements ? "ui.nav.announcementsBadgeAria" : "ui.nav.friendsBadgeAria", { name: t(tab.key), count: badge })
            : t(tab.key);
          return (
            <Tip key={tab.to} label={withShortcut(label, tab.shortcut)} side="right">
              <BarButton
                side
                to={tab.to}
                aria-label={label}
                aria-keyshortcuts={tab.shortcut}
                current={tab.match(pathname)}
                badge={badge}
              >
                <Icon name={tab.icon} size="l" />
              </BarButton>
            </Tip>
          );
        })}
      </div>
      <div className="side-grp">
        <TasksButton />
        <Tip label={withShortcut(t("common.settings"), SHORTCUT.settings)} side="right">
          <BarButton
            side
            to="/settings"
            aria-label={t("common.settings")}
            aria-keyshortcuts={SHORTCUT.settings}
            current={pathname.startsWith("/settings")}
          >
            <Icon name="settings" size="l" />
          </BarButton>
        </Tip>
      </div>
    </nav>
  );
}
