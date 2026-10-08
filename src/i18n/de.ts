import type { Dict } from "./types.ts";
import { common } from "./de/common.ts";
import { components } from "./de/components.ts";
import { crashAssistant } from "./de/crashAssistant.ts";
import { deepLinks } from "./de/deepLinks.ts";
import { detail } from "./de/detail.ts";
import { errors } from "./de/errors.ts";
import { format } from "./de/format.ts";
import { friends } from "./de/friends.ts";
import { friendsHost } from "./de/friendsHost.ts";
import { friendsInvite } from "./de/friendsInvite.ts";
import { friendsSettings } from "./de/friendsSettings.ts";
import { hooks } from "./de/hooks.ts";
import { launchSettings } from "./de/launchSettings.ts";
import { modProfiles } from "./de/modProfiles.ts";
import { pages } from "./de/pages.ts";
import { palette } from "./de/palette.ts";
import { settings } from "./de/settings.ts";
import { ui } from "./de/ui.ts";

/**
 * Deutsches Wörterbuch – Quelle der Wahrheit. Neue Namensräume hier anmelden.
 * Die Texte des Browser-Mocks (de/mock.ts) gehören nicht dazu: `mockWords.ts` lädt sie nur im Dev-Server.
 */
export const de = {
  ...common, ...components, ...deepLinks, ...detail, ...errors, ...format, ...friends, ...friendsHost, ...friendsInvite, ...friendsSettings,
  ...crashAssistant,
  ...hooks, ...launchSettings, ...modProfiles, ...pages, ...palette, ...settings, ...ui,
} satisfies Dict;
