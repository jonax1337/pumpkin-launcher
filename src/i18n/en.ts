import { de } from "./de.ts";
import { common } from "./en/common.ts";
import { components } from "./en/components.ts";
import { crashAssistant } from "./en/crashAssistant.ts";
import { deepLinks } from "./en/deepLinks.ts";
import { detail } from "./en/detail.ts";
import { errors } from "./en/errors.ts";
import { format } from "./en/format.ts";
import { friends } from "./en/friends.ts";
import { friendsHost } from "./en/friendsHost.ts";
import { friendsInvite } from "./en/friendsInvite.ts";
import { friendsSettings } from "./en/friendsSettings.ts";
import { hooks } from "./en/hooks.ts";
import { launchSettings } from "./en/launchSettings.ts";
import { modProfiles } from "./en/modProfiles.ts";
import { pages } from "./en/pages.ts";
import { palette } from "./en/palette.ts";
import { settings } from "./en/settings.ts";
import { ui } from "./en/ui.ts";

/** Englisch muss exakt dieselben Schlüssel wie Deutsch definieren; der Typ erzwingt das beim Bauen. */
export const en: typeof de = {
  ...common, ...components, ...deepLinks, ...detail, ...errors, ...format, ...friends, ...friendsHost, ...friendsInvite, ...friendsSettings,
  ...crashAssistant,
  ...hooks, ...launchSettings, ...modProfiles, ...pages, ...palette, ...settings, ...ui,
};
