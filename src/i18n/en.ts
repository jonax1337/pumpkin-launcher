import { de } from "./de.ts";
import { common } from "./en/common.ts";
import { components } from "./en/components.ts";
import { detail } from "./en/detail.ts";
import { format } from "./en/format.ts";
import { hooks } from "./en/hooks.ts";
import { mock } from "./en/mock.ts";
import { pages } from "./en/pages.ts";
import { ui } from "./en/ui.ts";

/** Englisch muss exakt dieselben Schlüssel wie Deutsch definieren; der Typ erzwingt das beim Bauen. */
export const en: typeof de = { ...common, ...components, ...detail, ...format, ...hooks, ...mock, ...pages, ...ui };
