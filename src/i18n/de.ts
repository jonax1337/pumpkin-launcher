import type { Dict } from "./types.ts";
import { common } from "./de/common.ts";
import { detail } from "./de/detail.ts";
import { format } from "./de/format.ts";

/** Deutsches Wörterbuch – Quelle der Wahrheit. Neue Namensräume hier anmelden (`…pages`). */
export const de = { ...common, ...detail, ...format } satisfies Dict;
