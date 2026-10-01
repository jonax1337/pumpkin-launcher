import { de } from "./de.ts";
import { common } from "./en/common.ts";
import { format } from "./en/format.ts";
import { mock } from "./en/mock.ts";

/** Englisch muss exakt dieselben Schlüssel wie Deutsch definieren; der Typ erzwingt das beim Bauen. */
export const en: typeof de = { ...common, ...format, ...mock };
