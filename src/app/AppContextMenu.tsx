import { cloneElement, useEffect, useState, type HTMLAttributes, type ReactElement } from "react";
import { useLocation, useNavigate } from "react-router";
import { showShortcuts } from "@/components/ShortcutsDialog";
import { useAppUpdate } from "@/hooks/useAppUpdate";
import { useI18n } from "@/i18n";
import { newInstanceUrl } from "@/lib/routes";
import { useFriendsNav } from "@/pages/friends/useFriendsNav";
import { ContextMenu, type MenuEntry } from "@/ui";
import { dialogOpen } from "./dialogOpen";
import { FRIENDS_PATH, TABS } from "./mainTabs";

type AppSurface = ReactElement<Pick<HTMLAttributes<HTMLElement>, "onContextMenuCapture" | "onPointerDownCapture">>;

export function AppContextMenu({ children }: { children: AppSurface }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const friends = useFriendsNav();
  const { data: update } = useAppUpdate();
  const [inDialog, setInDialog] = useState(false);

  useEffect(() => {
    const preventNativeMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", preventNativeMenu);
    return () => window.removeEventListener("contextmenu", preventNativeMenu);
  }, []);

  function navigateFromMenu(to: string) {
    if (!dialogOpen()) void navigate(to);
  }

  const items: MenuEntry[] = [
    { label: t("ui.nav.mainAreas") },
    ...TABS.filter((tab) => tab.to !== FRIENDS_PATH || !friends.hidden).map((tab) => ({
      id: tab.to, text: t(tab.key), icon: tab.icon, disabled: inDialog,
      checked: tab.match(pathname), onSelect: () => navigateFromMenu(tab.to),
    })),
    { id: "settings", text: t("common.settings"), icon: "settings", disabled: inDialog, onSelect: () => navigateFromMenu("/settings") },
    "-",
    { id: "new-instance", text: t("components.newInstance.title"), icon: "plus", disabled: inDialog, onSelect: () => navigateFromMenu(newInstanceUrl()) },
    { id: "shortcuts", text: t("ui.shortcut.title"), icon: "keyboard", disabled: inDialog, onSelect: () => { if (!dialogOpen()) showShortcuts(); } },
    ...(update ? [{ id: "update", text: t("ui.titlebar.updateAvailable"), icon: "update" as const, disabled: inDialog, onSelect: () => navigateFromMenu("/settings?tab=ueber") }] : []),
  ];

  return (
    <ContextMenu items={items} includePortals>
      {cloneElement(children, {
        onContextMenuCapture: (event) => {
          children.props.onContextMenuCapture?.(event);
          setInDialog(dialogOpen());
        },
        onPointerDownCapture: (event) => {
          children.props.onPointerDownCapture?.(event);
          if (event.pointerType !== "mouse") setInDialog(dialogOpen());
        },
      })}
    </ContextMenu>
  );
}
