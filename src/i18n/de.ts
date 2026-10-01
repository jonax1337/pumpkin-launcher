import type { Dict } from "./types.ts";
import { common } from "./de/common.ts";
import { format } from "./de/format.ts";
import { mock } from "./de/mock.ts";

/** Deutsches Wörterbuch – Quelle der Wahrheit. Neue Namensräume hier anmelden (`…pages`). */
export const de = { ...common, ...format, ...mock } satisfies Dict;
