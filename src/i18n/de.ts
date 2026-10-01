import type { Dict } from "./types.ts";
import { common } from "./de/common.ts";
import { format } from "./de/format.ts";
import { ui } from "./de/ui.ts";

/** Deutsches Wörterbuch – Quelle der Wahrheit. Neue Namensräume hier anmelden (`…ui`). */
export const de = { ...common, ...format, ...ui } satisfies Dict;
