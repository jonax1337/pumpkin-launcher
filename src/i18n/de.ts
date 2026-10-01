import type { Dict } from "./types.ts";
import { common } from "./de/common.ts";
import { format } from "./de/format.ts";
import { pages } from "./de/pages.ts";

/** Deutsches Wörterbuch – Quelle der Wahrheit. Neue Namensräume hier anmelden (`…pages`). */
export const de = { ...common, ...format, ...pages } satisfies Dict;
