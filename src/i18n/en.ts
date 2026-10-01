import { de } from "./de.ts";
import { common } from "./en/common.ts";
import { detail } from "./en/detail.ts";
import { format } from "./en/format.ts";
import { pages } from "./en/pages.ts";

/** Englisch muss exakt dieselben Schlüssel wie Deutsch definieren; der Typ erzwingt das beim Bauen. */
export const en: typeof de = { ...common, ...detail, ...format, ...pages };
