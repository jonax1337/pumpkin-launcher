import type { TKey } from "@/i18n";
import type { IconName } from "@/ui/types";

type MainTab = { to: string; key: TKey; icon: IconName; match: (pathname: string) => boolean; shortcut: string };

// Hauptbereiche; `key` ist der Wörterbuchschlüssel, die Beschriftung entsteht erst beim Rendern.
export const TABS: MainTab[] = [
  { to: "/", key: "ui.nav.home", icon: "home", match: (p) => p === "/", shortcut: "Control+1" },
  { to: "/instances", key: "ui.nav.library", icon: "box", match: (p) => p.startsWith("/instances"), shortcut: "Control+2" },
  { to: "/discover", key: "ui.nav.discover", icon: "search", match: (p) => p.startsWith("/discover"), shortcut: "Control+3" },
];
