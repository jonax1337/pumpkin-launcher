import type { TKey } from "@/i18n";
import type { IconName } from "@/ui/types";
import { withMod } from "./shortcuts";

type MainTab = { to: string; key: TKey; icon: IconName; match: (pathname: string) => boolean; shortcut: string };

// Hauptbereiche; `key` ist der Wörterbuchschlüssel, die Beschriftung entsteht erst beim Rendern.
const AREAS: Omit<MainTab, "shortcut">[] = [
  { to: "/", key: "ui.nav.home", icon: "home", match: (p) => p === "/" },
  { to: "/instances", key: "ui.nav.library", icon: "box", match: (p) => p.startsWith("/instances") },
  { to: "/discover", key: "ui.nav.discover", icon: "search", match: (p) => p.startsWith("/discover") },
  { to: "/skins", key: "ui.nav.skins", icon: "shirt", match: (p) => p.startsWith("/skins") },
];

/** Die Reihenfolge ist die der Seitenleiste und bestimmt das Kürzel: der n-te Bereich ist Strg+n. */
export const TABS: MainTab[] = AREAS.map((area, index) => ({ ...area, shortcut: withMod(String(index + 1)) }));
