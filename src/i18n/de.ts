import type { Dict } from "./types.ts";
import { common } from "./de/common.ts";
import { format } from "./de/format.ts";

/** Deutsches Wörterbuch – Quelle der Wahrheit. Neue Namensräume hier anmelden (`…pages`). */
export const de = { ...common, ...format } satisfies Dict;
