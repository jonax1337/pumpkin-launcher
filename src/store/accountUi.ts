import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { create } from "zustand";
import { accountKeys } from "@/hooks/queryKeys";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { Account, MsLoginStart } from "@/lib/types";
import { useOfflineAllowed } from "@/store/offline";
import { useSettings } from "@/store/settings";

// ---------- Microsoft-Anmeldung (ein Dialog für Kontomenü, Einstellungen und Onboarding) ----------

type LoginState = { step: "idle" } | { step: "starting" } | { step: "code"; info: MsLoginStart } | { step: "done"; name: string } | { step: "error"; message: string };
export const useMsLogin = create<LoginState>(() => ({ step: "idle" }));
// Jeder Versuch bekommt eine Nummer; Antworten eines abgebrochenen Versuchs werden verworfen.
let attempt = 0;

/** Was nach dem Speichern des Namens passiert (z. B. „Spielen“ fortsetzen); `label` nennt die Instanz. */
export type AfterName = { label: string; run: () => void };

/** Offene Kontenteile: Menü in der Fensterleiste und Dialog „Spielername hinzufügen“. */
export const useAccountUi = create<{ menu: boolean; offline: boolean; then: AfterName | null }>(() => ({ menu: false, offline: false, then: null }));

/** `method: "device"` erzwingt den Gerätecode (Knopf „Stattdessen Code verwenden“); sonst Anmeldung im Browser. Außerhalb React, deshalb Modul-`t`. */
export async function startMsLogin(qc: QueryClient, method?: "device") {
  const mine = ++attempt;
  useMsLogin.setState({ step: "starting" }, true);
  try {
    const info = await api.msLoginStart(method);
    if (mine !== attempt) return;
    useMsLogin.setState({ step: "code", info }, true);
    void api.openExternal(info.verificationUri).catch(() => undefined);
    const account = await api.msLoginFinish();
    if (mine !== attempt) return;
    return loggedIn(account, qc);
  } catch (err) {
    if (mine === attempt) useMsLogin.setState({ step: "error", message: errorMessage(err) }, true);
  }
}

/** Das Konto ist aktiv. Aus „Spielen“ ohne Namen gekommen: Dialog zu und direkt weiter (der Spielen-Knopf zeigt den Fortschritt). */
function loggedIn(account: Account, qc: QueryClient) {
  useSettings.getState().selectAccount({ kind: "microsoft", id: account.id, username: account.username });
  void qc.invalidateQueries({ queryKey: accountKeys.microsoft });
  const then = useAccountUi.getState().then;
  if (!then) return useMsLogin.setState({ step: "done", name: account.username }, true);
  useAccountUi.setState({ then: null });
  useMsLogin.setState({ step: "idle" }, true);
  toast.success(t("components.account.loggedInAs", { name: account.username }));
  return then.run();
}

export function closeMsLogin() {
  const running = ["starting", "code"].includes(useMsLogin.getState().step);
  attempt++;
  useAccountUi.setState({ then: null });
  useMsLogin.setState({ step: "idle" }, true);
  if (running) void api.msLoginCancel().catch(() => undefined);
}

/** Spielername hinzufügen; ohne Erlaubnis des Backends (`offline_allowed`) gibt es den Dialog nicht. */
export const openAddOffline = () => {
  if (useOfflineAllowed.getState().allowed) useAccountUi.setState({ offline: true, menu: false, then: null });
};

/**
 * „Spielen“ ohne Konto: Dialog für den Namen öffnen, danach geht es mit `then` weiter.
 * Ist Offline nicht erlaubt (offizieller Build ohne Microsoft-Konto), startet stattdessen die Anmeldung.
 */
export const askPlayerName = (then: AfterName, qc: QueryClient) => {
  if (useOfflineAllowed.getState().allowed) return useAccountUi.setState({ offline: true, menu: false, then });
  useAccountUi.setState({ menu: false, then });
  void startMsLogin(qc);
};
