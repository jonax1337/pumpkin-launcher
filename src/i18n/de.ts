import type { Dict } from "./types.ts";
import { common } from "./de/common.ts";
import { components } from "./de/components.ts";
import { detail } from "./de/detail.ts";
import { format } from "./de/format.ts";
import { hooks } from "./de/hooks.ts";
import { pages } from "./de/pages.ts";

/** Deutsches Wörterbuch – Quelle der Wahrheit. Neue Namensräume hier anmelden. */
export const de = { ...common, ...components, ...detail, ...format, ...hooks, ...pages } satisfies Dict;
