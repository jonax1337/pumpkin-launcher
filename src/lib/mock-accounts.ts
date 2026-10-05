// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { Backend } from "./backend";
import { clone, newId, wait, type MockContext } from "./mock-util";
import type { Account, MsLoginStart } from "./types";

const MOCK_USERNAME = "Jonax1337";

/** Wie im echten Backend: die Anmelde-URL samt PKCE-Query. */
const BROWSER_LOGIN_URL =
  "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=00000000-0000-0000-0000-000000000000&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A53682%2F&scope=XboxLive.signin%20offline_access&code_challenge=mock&code_challenge_method=S256&state=mock";

/** Das Gerätecode-Verfahren: Seite und Code, die der Mock anzeigt. */
const DEVICE_LOGIN_URL = "https://www.microsoft.com/link";
const DEVICE_LOGIN_CODE = "B7KQ-X4TZ";

/** Wann die vorgetäuschte Bestätigung eintrifft. */
const CONFIRM_AFTER_MS = 6000;

/** Microsoft-Anmeldung im Browser: Code sofort, Bestätigung nach ein paar Sekunden. */
export function createAccountMock({ db }: MockContext, onAccountsChanged: () => void) {
  let cancelPending: (() => void) | null = null;

  return {
    async msLoginStart(method): Promise<MsLoginStart> {
      await wait(500);
      if (method !== "device") {
        return {
          mode: "browser",
          userCode: "",
          verificationUri: BROWSER_LOGIN_URL,
          expiresIn: 600,
          interval: 0,
          message: t("hooks.api.msLoginBrowser"),
        };
      }
      return {
        mode: "device",
        userCode: DEVICE_LOGIN_CODE,
        verificationUri: DEVICE_LOGIN_URL,
        expiresIn: 900,
        interval: 5,
        message: t("hooks.api.msLoginDevice", { url: DEVICE_LOGIN_URL, code: DEVICE_LOGIN_CODE }),
      };
    },
    msLoginFinish: () =>
      new Promise<Account>((resolve, reject) => {
        const timer = setTimeout(() => {
          cancelPending = null;
          const account: Account = { id: newId("ms"), username: MOCK_USERNAME, kind: "microsoft", active: true };
          db.accounts = [...db.accounts.filter((a) => a.username !== account.username), account];
          onAccountsChanged();
          resolve(clone(account));
        }, CONFIRM_AFTER_MS);
        cancelPending = () => {
          clearTimeout(timer);
          reject(new Error(t("hooks.api.loginCancelled")));
        };
      }),
    async msLoginCancel() {
      cancelPending?.();
      cancelPending = null;
    },
    msAccounts: () => Promise.resolve(clone(db.accounts)),
    msAccountRemove: (id) => {
      db.accounts = db.accounts.filter((a) => a.id !== id);
      onAccountsChanged();
      return Promise.resolve();
    },
    /** Im Browser-Mock immer erlaubt. */
    offlineAllowed: () => Promise.resolve(true),
  } satisfies Partial<Backend>;
}
