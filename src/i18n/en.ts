import { de } from "./de.ts";
import { common } from "./en/common.ts";
import { format } from "./en/format.ts";
import { components } from "./en/components.ts";

/** Englisch muss exakt dieselben Schlüssel wie Deutsch definieren; der Typ erzwingt das beim Bauen. */
export const en: typeof de = { ...common, ...format, ...components };
