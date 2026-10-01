// Nur im Browser-Dev-Modus dynamisch geladen (siehe api.ts); im Release-Build nicht enthalten.
import { t } from "@/i18n";
import type { Backend } from "./backend";
import { clone, newId, wait, type MockContext } from "./mock-util";
import type { Account, MsLoginStart } from "./types";

const MOCK_USERNAME = "Jonax1337";

/** Das Gerätecode-Verfahren: Seite und Code, die der Mock anzeigt. */
const DEVICE_LOGIN_URL = "https://www.microsoft.com/link";
const DEVICE_LOGIN_CODE = "B7KQ-X4TZ";

/** Wann die vorgetäuschte Bestätigung eintrifft. */
const CONFIRM_AFTER_MS = 6000;

/** Microsoft-Anmeldung im Browser: Code sofort, Bestätigung nach ein paar Sekunden. */
export function createAccountMock({ db }: MockContext) {
  let cancelPending: (() => void) | null = null;

  return {
    async msLoginStart(method): Promise<MsLoginStart> {
      await wait(500);
      if (method !== "device") {
        return {
          mode: "browser",
          userCode: "",
          verificationUri: "https://login.microsoftonline.com/consumers/",
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
    msAccountRemove: (id) => Promise.resolve(void (db.accounts = db.accounts.filter((a) => a.id !== id))),
    /** Im Browser-Mock immer erlaubt. */
    offlineAllowed: () => Promise.resolve(true),
  } satisfies Partial<Backend>;
}
