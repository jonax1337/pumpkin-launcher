import { de } from "./de.ts";
import { common } from "./en/common.ts";
import { components } from "./en/components.ts";
import { detail } from "./en/detail.ts";
import { errors } from "./en/errors.ts";
import { format } from "./en/format.ts";
import { hooks } from "./en/hooks.ts";
import { pages } from "./en/pages.ts";
import { settings } from "./en/settings.ts";
import { ui } from "./en/ui.ts";

/** Englisch muss exakt dieselben Schlüssel wie Deutsch definieren; der Typ erzwingt das beim Bauen. */
export const en: typeof de = { ...common, ...components, ...detail, ...errors, ...format, ...hooks, ...pages, ...settings, ...ui };
