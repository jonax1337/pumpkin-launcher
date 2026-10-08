import type { TKey } from "@/i18n";
import type { IconName } from "@/ui/types";
import { withMod } from "./shortcuts";

type MainTab = { to: string; key: TKey; icon: IconName; match: (pathname: string) => boolean; shortcut: string };

/** Die Seite der Freunde; die Seitenleiste blendet sie ohne Schlüsselbund aus und zeigt eine Zahl daran. */
export const FRIENDS_PATH = "/friends";

// Hauptbereiche; `key` ist der Wörterbuchschlüssel, die Beschriftung entsteht erst beim Rendern.
const AREAS: Omit<MainTab, "shortcut">[] = [
  { to: "/", key: "ui.nav.home", icon: "home", match: (p) => p === "/" },
  { to: "/instances", key: "ui.nav.library", icon: "library", match: (p) => p.startsWith("/instances") },
  { to: "/discover", key: "ui.nav.discover", icon: "discover", match: (p) => p.startsWith("/discover") },
  { to: "/skins", key: "ui.nav.skins", icon: "skins", match: (p) => p.startsWith("/skins") },
  { to: FRIENDS_PATH, key: "ui.nav.friends", icon: "friends", match: (p) => p.startsWith(FRIENDS_PATH) },
  { to: "/announcements", key: "ui.nav.announcements", icon: "news", match: (p) => p.startsWith("/announcements") },
];

/** Die Reihenfolge ist die der Seitenleiste und bestimmt das Kürzel: der n-te Bereich ist Strg+n. */
export const TABS: MainTab[] = AREAS.map((area, index) => ({ ...area, shortcut: withMod(String(index + 1)) }));
