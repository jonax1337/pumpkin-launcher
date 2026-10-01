import type { Dict } from "./types.ts";
import { common } from "./de/common.ts";
import { components } from "./de/components.ts";
import { detail } from "./de/detail.ts";
import { format } from "./de/format.ts";
import { hooks } from "./de/hooks.ts";
import { pages } from "./de/pages.ts";
import { ui } from "./de/ui.ts";

/**
 * Deutsches Wörterbuch – Quelle der Wahrheit. Neue Namensräume hier anmelden.
 * Die Texte des Browser-Mocks (de/mock.ts) gehören nicht dazu: `mockWords.ts` lädt sie nur im Dev-Server.
 */
export const de = { ...common, ...components, ...detail, ...format, ...hooks, ...pages, ...ui } satisfies Dict;
